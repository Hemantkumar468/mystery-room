import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, Plus,
  CheckCircle2, XCircle, Clock, Eye, FilePenLine, Circle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useProject, useProjectActivity, useTemplate,
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision, useCompleteStage,
} from '../../lib/queries.js';
import { fmtDateTime, fromNow, fmtDate } from '../../lib/format.js';
import { useAuthStore } from '../../store/authStore.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RecordsTable } from './records/RecordsTable.jsx';
import { ModuleKpiCards } from './records/ModuleKpiCards.jsx';
import { computeScorecard } from './records/scoring.js';
import { approvedTypeCount, isTypeApproved, propertyNo, buildRecordMeta, matchesStatusFilter } from './records/recordUi.js';

/** One accent color per module card — drawn from existing theme tokens so both light/dark themes stay consistent; no new colors invented. */
const MODULE_ACCENTS = ['var(--teal-500)', 'var(--info)', 'var(--warning)', 'var(--chart-7)', 'var(--success)', 'var(--chart-8)'];

/**
 * A module card's own display status — a finer 5-tier read (Pending/In
 * Progress/In Review/Approved/Rejected) than the 3-tier status the shared
 * RecordsTable/AssessmentCard normally show. "Approved" wins once the type
 * has ever been approved (see isTypeApproved) even if a newer resubmission
 * is mid-flight; otherwise it reflects the latest record's own status.
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

const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 'var(--space-4)' };

/** One Commercial Finalization Workspace card — colored badge, title, status, record count, short description, and a button that always starts a brand-new submission (never resumes/overwrites an existing one — see openModule). */
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
 * Commercial Finalization — single-page workspace: the workflow no longer
 * asks the user to pick a property, it always resolves to the one
 * shortlisted property that has fully cleared Site Evaluation (every one of
 * p2's assessments Approved) and loads its workspace directly.
 *
 * Layout mirrors a specific enterprise reference: header (breadcrumb +
 * title/subtitle + Overall Commercial Progress card + Next Phase card),
 * Property Summary, the six commercial modules as a single non-wrapping row
 * of cards, then a 65/35 split of Commercial Records and Activity Timeline.
 * No Stage Overview / Task Assignment / manual Mark Done — completing every
 * module automatically completes the stage and unlocks Phase 4.
 */
export function CommercialFinalizationPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p3';

  // Base pool: every shortlisted property, same as every earlier stage.
  // Narrowed below to only those that have fully cleared Site Evaluation —
  // exactly one of those (the first) becomes this page's workspace.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: siteEvalRecords } = useStageRecords(id, 'p2');
  const { data: assessmentRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createAssessment = useCreateRecord(id, stageKey);
  const updateAssessment = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null); // KPI card click narrows the Records table below
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const siteEvalTypes = template?.stages?.find((s) => s.key === 'p2')?.assessmentTypes || [];
  const siteEvalTypeKeys = siteEvalTypes.length
    ? siteEvalTypes.map((t) => t.key)
    : ['feasibility', 'financial', 'technical', 'operational'];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Site Evaluation assessment has at least one
  // Approved record ever qualify — never rejected or still in-progress ones.
  const isEvaluated = (propertyId) =>
    siteEvalTypes.length > 0 && approvedTypeCount(siteEvalRecords, propertyId, siteEvalTypes) === siteEvalTypes.length;
  const properties = (shortlisted || []).filter((p) => isEvaluated(p._id));
  // The single property this page ever works on — no picker, no route param.
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = useMemo(
    () => (assessmentRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId)),
    [assessmentRecords, propertyId],
  );
  const steps = assessmentTypes.map((type, index) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    const sorted = [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return {
      type,
      index,
      record: sorted[0] || null,
      submissionCount: typeRecords.length,
      statusKey: moduleStatusKey(type, propertyRecords, propertyId),
      done: isTypeApproved(propertyRecords, propertyId, type),
    };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const overallPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;

  const scorecard = useMemo(
    () => (property ? computeScorecard(property, siteEvalRecords || [], siteEvalTypeKeys) : null),
    [property, siteEvalRecords, siteEvalTypeKeys],
  );
  const lastEvalApproval = scorecard
    ? Object.values(scorecard.sections)
        .map((s) => s.approvedRecord)
        .filter(Boolean)
        .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0]
    : null;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no commercial records yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  // Every module Approved → the stage completes itself and Phase 4 unlocks,
  // no manual "Mark Done" click. Guarded so it only ever fires once per
  // visit (completeStage is idempotent server-side too).
  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (assessmentTypes.length > 0 && doneCount === assessmentTypes.length) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, assessmentTypes.length, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Commercial Finalization" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Commercial Finalization</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Commercial Finalization stage" hint="This project has no Commercial Finalization stage." />
        </div>
      </>
    );
  }

  const commStatusKey = property ? (doneCount === assessmentTypes.length ? 'approved' : doneCount === 0 ? 'pending' : 'in_progress') : 'pending';
  const commMeta = MODULE_STATUS_META[commStatusKey];

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openStep = (index) => {
    const { type } = steps[index];
    setActiveForm({ type, record: null, readOnly: false });
  };
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
  const switchToEdit = () => setActiveForm((f) => (f ? { ...f, readOnly: false } : f));
  const closeForm = () => setActiveForm(null);

  const saveAssessment = async (values, status) => {
    const { type, record } = activeForm;
    if (record && record.status !== 'approved') {
      await updateAssessment.mutateAsync({ id: record._id, values, status });
    } else {
      await createAssessment.mutateAsync({ values, status, assessmentType: type.key, parentRecordId: propertyId });
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
      <div className="content page-compact">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="1. Property Summary">
              <div style={tileGrid}><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="1. Property Summary">
              <EmptyState
                icon={ClipboardList}
                title="No eligible properties yet"
                hint="Complete Site Evaluation before starting Commercial Finalization."
              />
            </SectionCard>
          ) : (
            <>
              {/* 1. Property Summary — auto-loaded, read-only, never re-selected here. */}
              <SectionCard title="1. Property Summary">
                <div className="col gap-4">
                  <div style={tileGrid}>
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile
                      label="Overall Site Evaluation Score"
                      value={scorecard?.overallScore != null ? (
                        <Badge color="var(--success)" soft="var(--success-soft)">{scorecard.overallScore}/100</Badge>
                      ) : '—'}
                    />
                    <InfoTile label="Approved Date" value={lastEvalApproval ? fmtDate(lastEvalApproval.approvedAt) : '—'} />
                    <InfoTile label="Evaluation Completed By" value={lastEvalApproval?.approvedBy?.name || '—'} />
                  </div>
                  <div className="divider" />
                  <div className="row gap-5 wrap" style={{ alignItems: 'center' }}>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Current Commercial Status</span>
                      <Badge color={commMeta.color} soft={commMeta.soft} dot>{commMeta.label}</Badge>
                    </div>
                    <div className="col gap-1 grow" style={{ minWidth: 220 }}>
                      <span className="tiny subtle upper">Overall Commercial Progress</span>
                      <ProgressBar value={overallPct} height={7} />
                      <span className="tiny muted">{overallPct}% Completed</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* KPI strip — click a card to narrow Commercial Records below. */}
              <ModuleKpiCards
                steps={steps}
                doneCount={doneCount}
                total={assessmentTypes.length}
                activeFilter={statusFilter}
                onFilterClick={(k) => setStatusFilter((f) => (k === 'all' || f === k ? null : k))}
              />

              {/* 2. Commercial Finalization Workspace — six modules, one row,
                  never wrapping (scrolls horizontally if it must). */}
              <SectionCard title="2. Commercial Finalization Workspace" bodyClass="card-body-compact">
                {assessmentTypes.length ? (
                  <div className="commercial-finalization-grid">
                    {steps.map(({ type, index, submissionCount, statusKey }) => (
                      <ModuleCard
                        key={type.key}
                        index={index}
                        type={type}
                        statusKey={statusKey}
                        submissionCount={submissionCount}
                        onNewSubmission={() => openStep(index)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No workflows configured" hint="Add assessment types to the Commercial Finalization stage in the template." />
                )}
              </SectionCard>

              {/* 3. Commercial Records (65%) / 4. Activity Timeline (35%). */}
              <div className="pc-bottom-grid">
                <RecordsTable
                  title="3. Commercial Records"
                  typeColumnLabel="Module"
                  records={statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords}
                  assessmentTypes={assessmentTypes}
                  canDecide={canDecide}
                  decidePending={decide.isPending}
                  onView={openView}
                  statusMetaFor={(record) => {
                    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                    return MODULE_STATUS_META[type ? moduleStatusKey(type, propertyRecords, propertyId) : 'pending']
                      || (record.status === 'approved' ? MODULE_STATUS_META.approved
                        : record.status === 'rejected' ? MODULE_STATUS_META.rejected
                        : record.status === 'submitted' ? MODULE_STATUS_META.in_review
                        : MODULE_STATUS_META.in_progress);
                  }}
                  emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                  emptyHint={statusFilter ? 'Click the active KPI card again to clear the filter.' : 'Click New Submission above to file the first record.'}
                />

                <SectionCard title="4. Activity Timeline">
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
                              <div className="tiny muted">{a.actor?.name || 'System'} · {fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
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
          saving={activeForm.record ? updateAssessment.isPending : createAssessment.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
          activity={activeForm.readOnly ? (activities || []).filter((a) => a.meta?.recordId === String(activeForm.record?._id)) : null}
          onEdit={activeForm.readOnly && activeForm.record && activeForm.record.status !== 'approved' ? switchToEdit : null}
          onApprove={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => doApprove(activeForm.record) : null}
          onReject={activeForm.readOnly && canDecide && activeForm.record?.status === 'submitted' ? () => openReject(activeForm.record) : null}
          decidePending={decide.isPending}
          onSaveDraft={({ values }) => saveAssessment(values, 'draft')}
          onSubmit={({ values }) => saveAssessment(values, 'submitted')}
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

export default CommercialFinalizationPage;
