import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Rocket, CheckCircle2, FilePenLine, Pencil, Eye } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
} from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { fmtDate, fmtCurrency } from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { approvedTypeCount, propertyNo, buildRecordMeta } from './records/recordUi.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { can } from '../../lib/roles.js';

/**
 * Phase 4 — Project Creation. Unlike the earlier six-module workspace, this is
 * ONE master "Project Setup" form (spec: create the project with budget, target
 * opening date and project manager). All fields are section-grouped in a single
 * template assessmentType (`project_creation`) and captured as a single record.
 * Key fields are pre-filled from the project that already exists.
 *
 * Approval — not submission — creates the project: a manager approving the
 * master form is what completes this stage (server-side, in
 * record.service.js#decide, re-validated by completeStage's p4 gate) and
 * unlocks Phase 5. This page therefore renders stage state, it never drives it.
 */
const MASTER_KEY = 'project_creation';

const STATUS_META = {
  draft: { label: 'Draft', color: 'var(--info)', soft: 'var(--info-soft)' },
  submitted: { label: 'Submitted', color: 'var(--success)', soft: 'var(--success-soft)' },
  approved: { label: 'Approved', color: 'var(--success)', soft: 'var(--success-soft)' },
  rejected: { label: 'Rejected', color: 'var(--danger)', soft: 'var(--danger-soft)' },
};

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' };

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value || '—'}</span>
    </div>
  );
}

/** A labelled block of tiles for the created-project overview. */
function SummaryGroup({ title, children, topBorder = true }) {
  return (
    <div className="col gap-2" style={topBorder ? { borderTop: '1px solid var(--border)', paddingTop: 14 } : undefined}>
      <span className="tiny upper" style={{ letterSpacing: '0.07em', fontWeight: 700, color: 'var(--text-subtle)' }}>{title}</span>
      <div style={tileGrid}>{children}</div>
    </div>
  );
}

export function ProjectCreationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const stageKey = 'p4';

  const { data: project, isLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: commercialRecords } = useStageRecords(id, 'p3');
  const { data: p4Records, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const [activeForm, setActiveForm] = useState(null); // { record, initialValues, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const openLoggedRef = useRef(false);

  // Eligibility: the property that cleared Commercial Finalization (its
  // mandatory modules approved — NOC/Commercial Approvals are optional).
  const commercialTypes = template?.stages?.find((s) => s.key === 'p3')?.assessmentTypes || [];
  const mandatoryCommercialTypes = commercialTypes.filter((t) => !t.subKeyField);
  const isCommerciallyFinalized = (pid) =>
    mandatoryCommercialTypes.length > 0
    && approvedTypeCount(commercialRecords, pid, mandatoryCommercialTypes) === mandatoryCommercialTypes.length;
  const properties = (shortlisted || []).filter((p) => isCommerciallyFinalized(p._id));
  const property = properties[0] || null;
  const propertyId = property?._id;

  const p4Types = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
  const masterType = p4Types.find((t) => t.key === MASTER_KEY) || p4Types[0] || null;

  const myRecords = useMemo(
    () => (p4Records || []).filter((r) => String(r.parentRecordId) === String(propertyId)),
    [p4Records, propertyId],
  );
  const record = useMemo(
    () => [...myRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null,
    [myRecords],
  );
  const submitted = !!record && (record.status === 'submitted' || record.status === 'approved');
  // Approval — not submission — is what actually creates the project and
  // completes this phase (enforced server-side in completeStage's p4 gate).
  const approved = record?.status === 'approved';

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  // Pre-fill a brand-new master form from the project that already exists.
  const prefill = () => ({
    project_name: project?.name,
    estimated_budget: project?.budget?.planned,
    currency: 'INR',
    project_start_date: project?.plannedStartDate ? String(project.plannedStartDate).slice(0, 10) : undefined,
    target_opening_date: project?.targetEndDate ? String(project.targetEndDate).slice(0, 10) : undefined,
    project_manager: project?.owner?.name,
    owner: project?.owner?.name,
    region: property?.values?.city,
  });

  // NOTE: this stage is completed by the SERVER, the moment a manager
  // approves the Project Setup form (record.service.js#decide's p4 branch,
  // re-validated by completeStage's own p4 gate). There is deliberately no
  // client-side completion here — the old version fired on *submission*,
  // which completed the phase before anyone had approved it.

  // Log "property opened" once, first visit with no record yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (myRecords.length === 0) markOpened.mutate(propertyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  if (isLoading || !project) {
    return (<><Topbar title="Project Creation" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Project Creation</span>} />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Project Creation stage" hint="This project has no Project Creation stage." />
        </div>
      </>
    );
  }

  const openCreate = () => setActiveForm({ record: null, initialValues: prefill(), readOnly: false });
  const openEdit = () => setActiveForm({ record, initialValues: record?.values, readOnly: false });
  const openView = () => setActiveForm({ record, initialValues: record?.values, readOnly: true });
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const save = async (values, status) => {
    if (record && record.status !== 'approved') {
      await updateRecord.mutateAsync({ id: record._id, values, status });
    } else {
      await createRecord.mutateAsync({ values, status, assessmentType: MASTER_KEY, parentRecordId: propertyId });
    }
    closeForm();
  };

  const doApprove = () => decide.mutate({ id: record._id, decision: 'approve' }, { onSuccess: closeForm });
  const doReject = (reason) =>
    decide.mutate({ id: rejectTarget._id, decision: 'reject', reason }, { onSuccess: () => { setRejectTarget(null); closeForm(); } });

  const smeta = STATUS_META[record?.status] || STATUS_META.draft;
  const v = record?.values || {};
  const depts = v.departments_involved;
  const money = (x) => (x != null && x !== '' ? fmtCurrency(x) : '—');
  const dateOf = (x) => (x ? fmtDate(x) : '—');

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            {stage.name}
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="se-page se-page--tight-top content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Project Setup">
              <div style={tileGrid}><InfoTile label="Loading…" value="…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Project Setup">
              <EmptyState icon={ClipboardList} title="No eligible property yet" hint="Complete Commercial Finalization before creating the project." />
            </SectionCard>
          ) : (
            <>
              {/* PRIMARY: the master form CTA, or the created-project summary. */}
              <SectionCard
                title="Project Setup"
                subtitle="One master form to create the project"
                style={{ order: 1 }}
              >
                {!record ? (
                  <div className="col gap-3" style={{ alignItems: 'flex-start' }}>
                    <p className="sm muted" style={{ maxWidth: 580, lineHeight: 1.5 }}>
                      Create the project for <b>{property.title}</b> — one master form covering Project Details,
                      Budget, Timeline, Leadership, Team &amp; Approval. Key fields are pre-filled from the project
                      you already set up.
                    </p>
                    <button type="button" className="btn btn-primary" onClick={openCreate} disabled={readOnly}>
                      <Rocket size={15} /> Start Project Setup
                    </button>
                  </div>
                ) : (
                  <div className="col gap-4">
                    <div className="row between wrap" style={{ alignItems: 'center', gap: 12 }}>
                      <div className="row gap-2" style={{ alignItems: 'center' }}>
                        {approved
                          ? <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
                          : <FilePenLine size={18} style={{ color: 'var(--info)' }} />}
                        <span style={{ fontWeight: 700 }}>
                          {approved ? 'Project Created' : submitted ? 'Awaiting manager approval' : 'Draft in progress'}
                        </span>
                        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
                      </div>
                      <div className="row gap-2">
                        {canDecide && record.status === 'submitted' && (
                          <>
                            <button type="button" className="btn btn-outline-success btn-sm" onClick={doApprove} disabled={readOnly || decide.isPending}>
                              ✓ Approve
                            </button>
                            <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setRejectTarget(record)} disabled={readOnly || decide.isPending}>
                              ✕ Reject
                            </button>
                          </>
                        )}
                        <button type="button" className="btn btn-subtle btn-sm" onClick={openView}><Eye size={14} /> View</button>
                        {record.status !== 'approved' && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={openEdit} disabled={readOnly}>
                            <Pencil size={14} /> {record.status === 'draft' ? 'Continue' : 'Edit'}
                          </button>
                        )}
                      </div>
                    </div>
                    <SummaryGroup title="Overview" topBorder={false}>
                      <InfoTile label="Project Name" value={v.project_name} />
                      <InfoTile label="Project Code" value={v.project_code || project.code} />
                      <InfoTile label="Project Type" value={v.project_type} />
                      <InfoTile label="Region / City" value={v.region || project.city} />
                    </SummaryGroup>

                    <SummaryGroup title="Budget">
                      <InfoTile label="Estimated Budget" value={money(v.estimated_budget)} tone="var(--success)" />
                      <InfoTile label="Setup Cost" value={money(v.capex)} />
                      <InfoTile label="Monthly Operating Cost" value={money(v.opex)} />
                      <InfoTile label="Contingency" value={money(v.contingency_budget)} />
                    </SummaryGroup>

                    <SummaryGroup title="Timeline">
                      <InfoTile label="Project Start Date" value={dateOf(v.project_start_date || project.plannedStartDate)} />
                      <InfoTile label="Target Opening (Go-Live)" value={dateOf(v.target_opening_date || project.targetEndDate)} tone="var(--primary)" />
                      <InfoTile label="Construction Start" value={dateOf(v.construction_start)} />
                      <InfoTile label="Interior Start" value={dateOf(v.interior_start)} />
                      <InfoTile label="Testing Date" value={dateOf(v.testing_date)} />
                      <InfoTile label="Expected Completion" value={dateOf(v.expected_completion)} />
                    </SummaryGroup>

                    <SummaryGroup title="Leadership">
                      <InfoTile label="Project Manager" value={v.project_manager} />
                      <InfoTile label="Reporting Manager" value={v.reporting_manager} />
                      <InfoTile label="Construction Head" value={v.construction_head} />
                      <InfoTile label="Operations Head" value={v.operations_head} />
                      <InfoTile label="Owner" value={v.owner} />
                    </SummaryGroup>

                    <div className="col gap-2" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                      <span className="tiny upper" style={{ letterSpacing: '0.07em', fontWeight: 700, color: 'var(--text-subtle)' }}>
                        Team{Array.isArray(depts) && depts.length ? ` · ${depts.length} departments` : ''}
                      </span>
                      {Array.isArray(depts) && depts.length ? (
                        <div className="row wrap gap-2">
                          {depts.map((d) => <Badge key={d} color="var(--info)" soft="var(--info-soft)">{d}</Badge>)}
                        </div>
                      ) : <span className="sm muted">—</span>}
                    </div>

                    {(v.description || v.milestones) && (
                      <SummaryGroup title="Notes">
                        {v.description && <InfoTile label="Description" value={v.description} />}
                        {v.milestones && <InfoTile label="Milestones" value={v.milestones} />}
                      </SummaryGroup>
                    )}

                    {/* Reflects the real stage status from the server, not a
                        guess made from the form's own status. */}
                    {isCompleted ? (
                      <div className="sm" style={{ color: 'var(--success)', background: 'var(--success-soft)', padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
                        ✓ Phase 4 complete — Phase 5 (Department Planning) is now unlocked.
                      </div>
                    ) : submitted && (
                      <div className="sm" style={{ color: 'var(--warning)', background: 'var(--warning-soft)', padding: '10px 12px', borderRadius: 8, fontWeight: 600 }}>
                        Waiting on manager approval — Phase 5 unlocks once the Project Setup is approved.
                      </div>
                    )}
                  </div>
                )}
              </SectionCard>

              {/* Collapsible property context — below the work. */}
              <SectionCard title="Property Summary" collapsible defaultCollapsed style={{ order: 3 }}>
                <div style={tileGrid}>
                  <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                  <InfoTile label="Property Name" value={property.title} />
                  <InfoTile label="City" value={property.values?.city} />
                  <InfoTile label="Locality" value={property.values?.locality} />
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>

      {activeForm && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={masterType?.masterDataSchema || []}
          recordNoun="Project"
          initialValues={activeForm.initialValues || null}
          submitLabel="Create Project"
          saving={record ? updateRecord.isPending : createRecord.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(record, myRecords, masterType?.name) : null}
          onEdit={!readOnly && activeForm.readOnly && record && record.status !== 'approved' ? switchToEdit : null}
          onApprove={!readOnly && activeForm.readOnly && canDecide && record?.status === 'submitted' ? doApprove : null}
          onReject={!readOnly && activeForm.readOnly && canDecide && record?.status === 'submitted' ? () => setRejectTarget(record) : null}
          decidePending={decide.isPending}
          onSaveDraft={({ values }) => save(values, 'draft')}
          onSubmit={({ values }) => save(values, 'submitted')}
        />
      )}

      <RejectDialog
        open={!!rejectTarget}
        title="Reject Project Setup"
        onClose={() => setRejectTarget(null)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this project setup being rejected?"
      />
    </>
  );
}

export default ProjectCreationPage;
