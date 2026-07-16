import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus,
  CheckCircle2, XCircle, Clock, UserCog, Eye, FilePenLine, Circle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate,
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { useAuthStore } from '../../store/authStore.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { ModuleKpiCards } from './records/ModuleKpiCards.jsx';
import {
  STEP_STATUS_META, COMMERCIAL_STATUS_META, approvedTypeCount, isTypeApproved,
  propertyNo, buildRecordMeta, matchesStatusFilter,
} from './records/recordUi.js';

/** Aggregate a property's workflow statuses into one Pending/In Progress/Completed badge — shared shape for both Commercial Status and Project Status. */
function stageStatusOf(doneCount, total) {
  if (!total || doneCount === 0) return 'pending';
  if (doneCount === total) return 'completed';
  return 'in_progress';
}

/**
 * One accent color per module card (matches the numbered badge in the
 * reference design) — purely decorative, drawn from existing theme tokens so
 * both light/dark themes stay consistent; no new colors invented.
 */
const MODULE_ACCENTS = ['var(--info)', 'var(--success)', 'var(--warning)', 'var(--chart-7)', 'var(--teal-500)', 'var(--chart-8)'];

/**
 * A module card's own display status — a finer 5-tier read (Pending/In
 * Progress/In Review/Approved/Rejected) than the 3-tier stageStatusOf used for
 * the stage-level aggregates (Commercial Status/Project Status) above.
 * "Approved" wins once the type has ever been approved (see isTypeApproved)
 * even if a newer resubmission is mid-flight; otherwise it reflects the
 * latest record's own status.
 */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--info)', soft: 'var(--info-soft)' },
  in_review: { label: 'In Review', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  approved: { label: 'Approved', color: 'var(--success)', soft: 'var(--success-soft)' },
  rejected: { label: 'Rejected', color: 'var(--danger)', soft: 'var(--danger-soft)' },
};

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  if (latest.status === 'submitted') return 'in_review';
  return 'in_progress'; // draft
}

/** Icon + color for one activity-timeline entry, read off its message text — every record.service.js message uses one of these verbs. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--danger)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--success)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--warning)' };
  if (m.includes('assigned')) return { Icon: UserCog, color: 'var(--chart-7)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--info)' };
  return { Icon: Circle, color: 'var(--text-subtle)' };
}

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/**
 * One Project Creation Workspace card — number badge, title, status badge,
 * record count, short description, and a button that always starts a
 * brand-new submission. It never resumes an in-progress draft (that's what
 * "unlimited submissions, never overwrite" means here) — to continue an
 * existing draft/submitted/rejected record instead, open it from the Project
 * Records table below and use Edit in its read-only view.
 */
function ModuleCard({ index, type, statusKey, submissionCount, onNewSubmission }) {
  const smeta = MODULE_STATUS_META[statusKey];
  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="pc-module-num" style={{ background: MODULE_ACCENTS[index % MODULE_ACCENTS.length] }}>{index + 1}</span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div><Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge></div>
      <span className="pc-module-count">{submissionCount} {submissionCount === 1 ? 'Record' : 'Records'}</span>
      <span className="pc-module-desc">{type.subtitle}</span>
      <button type="button" className="btn btn-outline-primary btn-sm pc-module-action" onClick={onNewSubmission}>
        <Plus size={14} /> New Submission
      </button>
    </div>
  );
}

/**
 * Project Creation — single-page workspace, same shape as Commercial
 * Finalization: the workflow no longer asks the user to pick a property, it
 * always resolves to the one shortlisted property that has fully cleared
 * Commercial Finalization (every one of p3's six workflows Approved: LOI,
 * Lease Agreement, Legal Verification, Deposit, NOCs, Commercial Approvals)
 * and loads its workspace directly.
 *
 * Layout intentionally mirrors a specific enterprise reference pixel-for-
 * pixel: header (title/subtitle + progress card + next-phase card),
 * Property Summary, the six modules as a single non-wrapping row of cards,
 * then a 65/35 split of Project Records and Activity Timeline. No Stage
 * Overview / Task Assignment / Mark Done admin sections — this page is the
 * property workspace only.
 */
export function ProjectCreationPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p4';

  // Base pool: every shortlisted property, same as every earlier stage.
  // Narrowed below to only those that have fully cleared Commercial
  // Finalization — exactly one of those (the first) becomes this page's
  // workspace.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: commercialRecords } = useStageRecords(id, 'p3');
  const { data: projectRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null); // KPI card click narrows the Records table below
  const openLoggedRef = useRef(false);

  const commercialTypes = template?.stages?.find((s) => s.key === 'p3')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Commercial Finalization workflow has at
  // least one Approved record ever qualify — never rejected or still
  // in-progress ones (LOI, Lease Agreement, Legal Verification, Deposit,
  // NOCs, Commercial Approvals).
  const isCommerciallyFinalized = (propertyId) =>
    commercialTypes.length > 0 && approvedTypeCount(commercialRecords, propertyId, commercialTypes) === commercialTypes.length;
  const properties = (shortlisted || []).filter((p) => isCommerciallyFinalized(p._id));
  // The single property this page ever works on — no picker, no route param.
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = (projectRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const steps = assessmentTypes.map((type) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    return { type, submissionCount: typeRecords.length, statusKey: moduleStatusKey(type, projectRecords, propertyId) };
  });
  const doneCount = approvedTypeCount(projectRecords, propertyId, assessmentTypes);
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Commercial Finalization facts for the Property Summary — completion date
  // is the moment the *last* of the six workflows was approved (whichever
  // approval timestamp is latest), since that's what actually completed p3.
  const commercialApproved = (commercialRecords || []).filter(
    (r) => String(r.parentRecordId) === String(propertyId) && r.status === 'approved',
  );
  const lastCommercialApproval = commercialApproved.length
    ? [...commercialApproved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0]
    : null;
  const commercialDoneCount = approvedTypeCount(commercialRecords, propertyId, commercialTypes);
  const commercialScorePct = commercialTypes.length ? Math.round((commercialDoneCount / commercialTypes.length) * 100) : 0;
  const cmeta = COMMERCIAL_STATUS_META[stageStatusOf(commercialDoneCount, commercialTypes.length)];

  const pStatus = STEP_STATUS_META[stageStatusOf(doneCount, assessmentTypes.length)];

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no Project Creation records yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  if (isLoading || !project) {
    return (<><Topbar title="Project Creation" /><div className="content"><SkPropertyIdentification /></div></>);
  }

  const backToProject = () => navigate(`/projects/${id}`);

  // The workspace card's own action always opens a blank form for a brand
  // new submission — resuming an existing draft happens from the Project
  // Records table below (View → Edit) instead, see ModuleCard.
  const openNewSubmission = (type) => setActiveForm({ type, record: null, readOnly: false });
  // Records-table row click — the whole row is the action, opening the
  // read-only view. Edit/Approve/Reject all live inside that view's footer
  // instead (see RecordFormModal) — there's no separate Actions column here.
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const saveRecord = async (values, status) => {
    const { type, record } = activeForm;
    if (record && record.status !== 'approved') {
      await updateRecord.mutateAsync({ id: record._id, values, status });
    } else {
      await createRecord.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
    }
    closeForm();
  };

  const doApprove = (record) => {
    decide.mutate({ id: record._id, decision: 'approve' }, { onSuccess: () => closeForm() });
  };
  const openReject = (record) => setRejectTarget(record);
  const doReject = (reason) => {
    decide.mutate(
      { id: rejectTarget._id, decision: 'reject', reason },
      { onSuccess: () => { setRejectTarget(null); closeForm(); } },
    );
  };

  // Newest first — same convention as every other stage's Activity Timeline.
  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={backToProject} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            Project Creation
          </span>
        }
        subtitle={`${project.code} · ${project.name}`}
      />
      <div className="content page-compact">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Property Summary">
              <div className="pc-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Property Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for Project Creation."
                hint="Complete Commercial Finalization (LOI, Lease Agreement, Legal Verification, Deposit, NOCs and Commercial Approvals) before starting Project Creation."
              />
            </SectionCard>
          ) : (
            <>
              {/* 1. Property Summary — auto-loaded, never re-selected here, read-only. */}
              <SectionCard title="Property Summary">
                <div className="col gap-3">
                  <div className="pc-summary-row1">
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile label="Commercial Completion Date" value={lastCommercialApproval ? fmtDate(lastCommercialApproval.approvedAt) : '—'} />
                    <InfoTile label="Commercial Approved By" value={lastCommercialApproval?.approvedBy?.name || '—'} />
                  </div>
                  <div className="pc-summary-row2">
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Commercial Status</span>
                      <div><Badge color={cmeta.color}>{cmeta.label}</Badge></div>
                    </div>
                    <InfoTile label="Commercial Score" value={`${commercialScorePct}/100`} tone="var(--success)" />
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Project Status</span>
                      <div><Badge color={pStatus.color}>{pStatus.label}</Badge></div>
                    </div>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Overall Project Progress</span>
                      <ProgressBar value={assessmentTypes.length ? (doneCount / assessmentTypes.length) * 100 : 0} height={7} />
                      <span className="tiny muted">{doneCount}/{assessmentTypes.length || 0} Completed</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* KPI strip — click a card to narrow Project Records below. */}
              <ModuleKpiCards
                steps={steps}
                doneCount={doneCount}
                total={assessmentTypes.length}
                activeFilter={statusFilter}
                onFilterClick={(k) => setStatusFilter((f) => (k === 'all' || f === k ? null : k))}
              />

              {/* 2. Project Creation Workspace — six modules, one non-wrapping row. */}
              <SectionCard title="Project Creation Workspace" bodyClass="card-body-compact">
                {assessmentTypes.length ? (
                  <div className="pc-grid">
                    {steps.map(({ type, submissionCount, statusKey }, i) => (
                      <ModuleCard
                        key={type.key}
                        index={i}
                        type={type}
                        statusKey={statusKey}
                        submissionCount={submissionCount}
                        onNewSubmission={() => openNewSubmission(type)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No modules configured" hint="Add assessment types to the Project Creation stage in the template." />
                )}
              </SectionCard>

              {/* 3 + 4. Bottom split — Project Records (65%) / Activity Timeline (35%). */}
              <div className="pc-bottom-grid">
                <RecordsTable
                  title="Project Records"
                  typeColumnLabel="Module"
                  records={statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords}
                  assessmentTypes={assessmentTypes}
                  onView={openView}
                  emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                  emptyHint={statusFilter ? 'Click the active KPI card again to clear the filter.' : 'Use New Submission on a module above to see it here.'}
                />

                <SectionCard title="Activity Timeline">
                  {activitiesLoading ? (
                    <SkeletonActivity rows={4} />
                  ) : propertyActivity.length ? (
                    <div className="pc-timeline">
                      {propertyActivity.map((a, i) => {
                        const { Icon, color } = timelineMetaFor(a.message);
                        return (
                          <div key={a._id} className="pc-timeline-item">
                            <div className="pc-timeline-rail">
                              <span className="pc-timeline-icon" style={{ color }}>
                                <Icon size={14} />
                              </span>
                              {i < propertyActivity.length - 1 && <span className="pc-timeline-rail-line" />}
                            </div>
                            <div className="pc-timeline-body">
                              <div className="sm" style={{ fontWeight: 600 }}>{a.message}</div>
                              <div className="tiny muted">{a.actor?.name || 'System'}</div>
                              <div className="tiny subtle">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
                  )}
                </SectionCard>
              </div>
            </>
          )}
        </div>
      </div>

      {activeForm && (
        <RecordFormModal
          open
          onClose={closeForm}
          schema={activeForm.type.masterDataSchema}
          recordNoun={activeForm.type.name}
          initialValues={activeForm.record?.values || null}
          submitLabel="Submit Record"
          saving={activeForm.record ? updateRecord.isPending : createRecord.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' ? switchToEdit : null}
          onApprove={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => doApprove(activeForm.record) : null}
          onReject={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => openReject(activeForm.record) : null}
          decidePending={decide.isPending}
          onSaveDraft={({ values }) => saveRecord(values, 'draft')}
          onSubmit={({ values }) => saveRecord(values, 'submitted')}
        />
      )}

      <RejectDialog
        open={!!rejectTarget}
        title={`Reject ${rejectTarget ? rejectTarget.title : ''}`}
        onClose={() => setRejectTarget(null)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this record being rejected?"
      />
    </>
  );
}

export default ProjectCreationPage;
