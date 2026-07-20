import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList,
  CheckCircle2, XCircle, Clock, UserCog, Eye, FilePenLine, Circle,
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
import { approvedTypeCount, isTypeApproved, propertyNo, buildRecordMeta } from './records/recordUi.js';

/** One accent color per approval card — cycles the reference's literal blue/green/orange/red/gray set, page-scoped (see .approval-workflow-page in globals.css). */
const MODULE_ACCENTS = [
  'var(--aw-blue)', 'var(--aw-green)', 'var(--aw-orange)', 'var(--aw-red)', 'var(--aw-gray)',
];

/**
 * A module's own display status — the reference's four-word vocabulary
 * (Approved / Pending / Rejected / Under Review), plus Locked for the final
 * (CEO/MD) card while any other module isn't Approved yet. "Approved" wins
 * once ever approved (see isTypeApproved) even if a later resubmission is
 * mid-flight; a draft that hasn't been submitted yet still reads as Pending
 * (nothing for a reviewer to act on).
 */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: 'var(--aw-gray)', soft: 'rgba(100,116,139,0.12)' },
  in_review: { label: 'Under Review', color: 'var(--aw-orange)', soft: 'rgba(245,158,11,0.12)' },
  approved: { label: 'Approved', color: 'var(--aw-green)', soft: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: 'var(--aw-red)', soft: 'rgba(239,68,68,0.12)' },
  locked: { label: 'Locked', color: 'var(--aw-gray)', soft: 'rgba(100,116,139,0.12)' },
};

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  if (latest.status === 'submitted') return 'in_review';
  return 'pending'; // draft — nothing for a reviewer to act on yet
}

/** Icon + color for one activity-timeline entry, read off its message text — every record.service.js message uses one of these verbs. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--aw-red)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--aw-green)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--aw-orange)' };
  if (m.includes('assigned')) return { Icon: UserCog, color: 'var(--aw-blue)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--aw-blue)' };
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

const fmtBudget = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));

/**
 * One Approval Workspace card — number badge, department name, status
 * badge, approval count, short description, and an "Open Approvals" button
 * that starts a brand-new submission (same "never resumes a draft" rule as
 * Department Planning's ModuleCard — resuming happens from the Approval
 * Records table below instead). The CEO/MD card renders locked/disabled
 * until every other module has been approved.
 */
function ModuleCard({ index, type, statusKey, onNewSubmission, locked }) {
  const smeta = MODULE_STATUS_META[locked ? 'locked' : statusKey];
  return (
    <div className={`card pc-module-card${locked ? ' locked' : ''}`}>
      <div className="pc-module-head">
        <span className="pc-module-num" style={{ background: MODULE_ACCENTS[index % MODULE_ACCENTS.length] }}>{index + 1}</span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
      </div>
      <span className="pc-module-desc">{type.subtitle}</span>
      <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onNewSubmission} disabled={locked}>
          Open Approvals
        </button>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone }) {
  return (
    <div className="pc-kpi-card">
      <span className="pc-kpi-label">{label}</span>
      <span className="pc-kpi-value" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="pc-kpi-sub">{sub}</span>}
    </div>
  );
}

/**
 * Approval Workflow — single-page workspace, same shape as Department
 * Planning / Commercial Finalization / Project Creation: no property picker,
 * it always resolves to the one shortlisted property that has fully cleared
 * Department Planning (every one of p5's ten modules Approved) and loads its
 * workspace directly. Execution (p6) isn't used as a gate — it isn't
 * decision-gated and has no dedicated completion signal yet.
 *
 * Layout mirrors the client's enterprise reference: breadcrumb + header
 * (title/subtitle + progress card + next-phase card), Project Summary, the
 * twelve approval modules as a single non-wrapping row of cards, a 65/35
 * split of Approval Records and Activity Timeline, then a KPI summary strip.
 * No Stage Overview / Task Assignment / manual Mark Done — approving every
 * module automatically completes the stage and unlocks Phase 8.
 */
export function ApprovalWorkflowPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p7';

  // Base pool: every shortlisted property. Narrowed below to only those that
  // have fully cleared Department Planning — the first of those becomes this
  // page's workspace.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: departmentPlanningRecords } = useStageRecords(id, 'p5');
  const { data: approvalRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const departmentPlanningTypes = template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  const isDepartmentPlanned = (propId) =>
    departmentPlanningTypes.length > 0
    && approvedTypeCount(departmentPlanningRecords, propId, departmentPlanningTypes) === departmentPlanningTypes.length;
  const properties = (shortlisted || []).filter((p) => isDepartmentPlanned(p._id));
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = (approvalRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const steps = assessmentTypes.map((type, i) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    const isLast = i === assessmentTypes.length - 1;
    const othersApproved = assessmentTypes.length > 1
      && approvedTypeCount(approvalRecords, propertyId, assessmentTypes.slice(0, -1)) === assessmentTypes.length - 1;
    return {
      type,
      submissionCount: typeRecords.length,
      statusKey: moduleStatusKey(type, approvalRecords, propertyId),
      locked: isLast && !othersApproved,
    };
  });
  const doneCount = approvedTypeCount(approvalRecords, propertyId, assessmentTypes);
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const overallPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;
  const pendingCount = steps.filter((s) => s.statusKey === 'pending').length;
  const underReviewCount = steps.filter((s) => s.statusKey === 'in_review').length;
  const rejectedCount = steps.filter((s) => s.statusKey === 'rejected').length;

  // Project Creation facts for the Property Summary — same source Department
  // Planning already reads them from.
  const p4Records = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const latestApprovedOfType = (key) => {
    const approved = p4Records.filter((r) => r.assessmentType === key && r.status === 'approved');
    return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
  };
  const budget = latestApprovedOfType('budget')?.values?.estimated_budget;
  const targetOpeningDate = latestApprovedOfType('timeline')?.values?.target_opening_date;
  const projectManager = latestApprovedOfType('manager_assignment')?.values?.project_manager;
  const executionCompletionDate = project?.stages?.find((s) => s.key === 'p6')?.completedAt;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (assessmentTypes.length > 0 && doneCount === assessmentTypes.length) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, assessmentTypes.length, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Approval Workflow" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Approval Workflow</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Approval Workflow stage" hint="This project has no Approval Workflow stage." />
        </div>
      </>
    );
  }

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const openNewSubmission = (type) => setActiveForm({ type, record: null, readOnly: false });
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
      <div className="content page-compact approval-workflow-page">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="1. Project Summary">
              <div className="dp-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="1. Project Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for Approval Workflow."
                hint="Complete every Department Planning module (Construction, Interior, Procurement, Automation, IT, Marketing, HR, Finance, Operations, Legal) before starting Approval Workflow."
              />
            </SectionCard>
          ) : (
            <>
              {/* Project Summary — collapsed by default and placed below the
                  work: a doer opens the phase to act, not to read a dashboard.
                  Context stays one click away. Auto-loaded, read-only. */}
              <SectionCard title="Project Summary" collapsible defaultCollapsed style={{ order: 3 }}>
                <div className="col gap-3">
                  <div className="dp-summary-row1">
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="Project Name" value={project.name} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile label="Project Manager" value={projectManager || '—'} />
                    <InfoTile label="Budget" value={fmtBudget(budget)} />
                  </div>
                  <div className="pc-summary-row2">
                    <InfoTile label="Target Opening Date" value={targetOpeningDate ? fmtDate(targetOpeningDate) : '—'} />
                    <InfoTile label="Execution Completion Date" value={executionCompletionDate ? fmtDate(executionCompletionDate) : '—'} />
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Current Phase</span>
                      <div><Badge color="var(--aw-green)" soft="rgba(34,197,94,0.12)" dot>{stage.name}</Badge></div>
                    </div>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Overall Approval Progress</span>
                      <ProgressBar value={overallPct} height={7} gradient="var(--aw-blue)" />
                      <span className="tiny muted">{doneCount}/{assessmentTypes.length || 0} Completed</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* Approval Workflow Workspace — the work, first. Twelve modules,
                  one non-wrapping row. */}
              <SectionCard
                title="Approval Workflow Workspace"
                subtitle="Pick a workflow to fill and submit its record"
                bodyClass="card-body-compact"
                style={{ order: 1 }}
              >
                {assessmentTypes.length ? (
                  <div className="approval-workflow-grid">
                    {steps.map(({ type, statusKey, locked }, i) => (
                      <ModuleCard
                        key={type.key}
                        index={i}
                        type={type}
                        statusKey={statusKey}
                        locked={locked}
                        onNewSubmission={() => openNewSubmission(type)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No approval modules configured" hint="Add assessment types to the Approval Workflow stage in the template." />
                )}
              </SectionCard>

              {/* Approval Records — full submission history, right under the
                  work so a reviewer can open any filed row to assess it. */}
              <div style={{ order: 2 }}>
                <RecordsTable
                  title="Approval Records"
                  typeColumnLabel="Department"
                  records={allRecords}
                  assessmentTypes={assessmentTypes}
                  canDecide={canDecide}
                  decidePending={decide.isPending}
                  onView={openView}
                  onApprove={doApprove}
                  onReject={openReject}
                  showReviewed
                  extraColumn={{ label: 'Approval Type', render: (record) => record.values?.approval_type }}
                  wrapClassName="aw-table-scroll"
                  statusMetaFor={(record) => {
                    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                    return MODULE_STATUS_META[type ? moduleStatusKey(type, approvalRecords, propertyId) : 'pending'];
                  }}
                  emptyTitle="No approval records filed yet"
                  emptyHint="Use Open Approvals on a module above to see it here."
                />
              </div>

              {/* Activity Timeline — reference material, pushed below the work. */}
              <SectionCard title="Activity Timeline" style={{ order: 6 }}>
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

              {/* Bottom KPI Cards — summary stats, below the work. */}
              <div className="pc-kpi-grid aw-kpi-grid" style={{ order: 4 }}>
                <KpiCard label="Total Approvals" value={assessmentTypes.length} sub="All approvals required" />
                <KpiCard label="Approved" value={doneCount} sub={`${overallPct}% of total`} tone="var(--aw-green)" />
                <KpiCard label="Pending" value={pendingCount} sub={pendingCount ? 'Awaiting action' : 'None pending'} tone="var(--aw-gray)" />
                <KpiCard label="Under Review" value={underReviewCount} sub={underReviewCount ? 'In review process' : 'None in review'} tone="var(--aw-orange)" />
                <KpiCard label="Rejected" value={rejectedCount} sub={rejectedCount ? 'Needs attention' : 'No rejections'} tone="var(--aw-red)" />
                <KpiCard label="Escalated" value={0} sub="No escalations" tone="var(--aw-gray)" />
                <div className="pc-kpi-card">
                  <span className="pc-kpi-label">Overall Progress</span>
                  <span className="pc-kpi-value" style={{ color: 'var(--aw-green)' }}>{overallPct}%</span>
                  <ProgressBar value={overallPct} height={6} gradient="var(--aw-blue)" />
                  <span className="pc-kpi-sub">{doneCount}/{assessmentTypes.length || 0} Completed</span>
                </div>
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

export default ApprovalWorkflowPage;
