import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronRight, ClipboardList, Lock, Rocket,
  CheckCircle2, XCircle, Clock, UserCog, Eye, FilePenLine, Circle,
  ShieldCheck, ClipboardCheck, PackageCheck, CreditCard, UserCheck, Megaphone, PartyPopper, ShoppingBag,
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
import { approvedTypeCount, isTypeApproved, propertyNo, buildRecordMeta, matchesStatusFilter } from './records/recordUi.js';

/** Icon + accent color per module, keyed off its assessmentType key so a template reorder never desyncs the visuals. */
const MODULE_VISUALS = {
  go_live_approval: { Icon: ShieldCheck, color: 'var(--sl-blue)' },
  final_store_inspection: { Icon: ClipboardCheck, color: 'var(--sl-green)' },
  inventory_verification: { Icon: PackageCheck, color: 'var(--sl-orange)' },
  pos_billing_activation: { Icon: CreditCard, color: 'var(--sl-purple)' },
  staff_attendance_verification: { Icon: UserCheck, color: 'var(--sl-teal)' },
  marketing_launch: { Icon: Megaphone, color: 'var(--sl-red)' },
  store_opening_ceremony: { Icon: PartyPopper, color: 'var(--sl-blue)' },
  customer_go_live: { Icon: ShoppingBag, color: 'var(--sl-green)' },
};
const FALLBACK_VISUAL = { Icon: Circle, color: 'var(--sl-gray)' };

/** Caps the sidebar Activity Timeline so a long-lived property's activity log can't blow out the 25%-column layout — matches the reference's bounded panel + "View Full Timeline" link. */
const TIMELINE_VISIBLE_COUNT = 8;

/**
 * One module card's own display status — Pending / In Progress / Completed /
 * Rejected, the same four-word vocabulary Store Readiness uses. "Completed"
 * wins once the module has ever been approved even if a newer resubmission
 * is mid-flight; "In Progress" folds together both a still-open draft and an
 * already-submitted-awaiting-decision record.
 */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: 'var(--sl-gray)', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--sl-blue)', soft: 'rgba(37,99,235,0.12)' },
  approved: { label: 'Completed', color: 'var(--sl-green)', soft: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: 'var(--sl-red)', soft: 'rgba(239,68,68,0.12)' },
};

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  return 'in_progress';
}

/** The same module's latest record (or null), any status — used for live checklist progress. */
function latestRecordOf(type, records, propertyId) {
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  return own.length ? [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null;
}

/** The same module's latest *approved* record (or null) — used for facts that should only reflect a signed-off submission. */
function latestApprovedRecordOf(type, records, propertyId) {
  const approved = (records || []).filter(
    (r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key && r.status === 'approved',
  );
  return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
}

/** "X/Y" boolean-checklist-item completion for one module's latest record. */
function checklistProgress(record, schema) {
  const boolFields = (schema || []).filter((f) => f.type === 'boolean');
  const total = boolFields.length;
  const done = record ? boolFields.filter((f) => record.values?.[f.key] === true).length : 0;
  return { done, total };
}

/** Icon + color for one activity-timeline entry, read off its message text. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--sl-red)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--sl-green)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--sl-orange)' };
  if (m.includes('assigned')) return { Icon: UserCog, color: 'var(--sl-blue)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--sl-blue)' };
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

/** One Store Launch Workspace card — colored icon, module name, status badge, submission count, subtitle, and an "Open Module" button that always starts a brand-new submission. */
function ModuleCard({ type, statusKey, recordCount, onOpenModule }) {
  const smeta = MODULE_STATUS_META[statusKey];
  const { Icon, color } = MODULE_VISUALS[type.key] || FALLBACK_VISUAL;
  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="sl-module-icon" style={{ background: color }}><Icon size={15} /></span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div><Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge></div>
      <span className="pc-module-count">{recordCount} {recordCount === 1 ? 'Record' : 'Records'}</span>
      <span className="pc-module-desc">{type.subtitle}</span>
      <button type="button" className="btn btn-sm sl-open-btn pc-module-action" onClick={onOpenModule}>
        Open Module
      </button>
    </div>
  );
}

/**
 * Store Launch — Phase 9's dedicated workspace, same "no property picker"
 * shape as every other module-based phase page: it always resolves to the
 * one shortlisted property that has fully cleared Store Readiness (every
 * one of p8's checklists Approved) and loads its workspace directly.
 *
 * Layout follows a specific enterprise reference: Store Summary + a Launch
 * Progress/Next Phase sidebar (75/25), Store Launch Workspace + Activity
 * Timeline (75/25), then full-width Store Launch Records, a Store Launch
 * Checklist strip, and a bottom analytics row. No manual "Mark Done" —
 * completing every module automatically completes the stage.
 */
export function StoreLaunchPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p9';

  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: readinessRecords } = useStageRecords(id, 'p8');
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: launchRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAuthStore((s) => s.user);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';

  const [activeForm, setActiveForm] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const readinessTypes = template?.stages?.find((s) => s.key === 'p8')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Store Readiness checklist has at least one
  // Approved record ever qualify.
  const isReady = (propId) =>
    readinessTypes.length > 0 && approvedTypeCount(readinessRecords, propId, readinessTypes) === readinessTypes.length;
  const properties = (shortlisted || []).filter((p) => isReady(p._id));
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = (launchRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const steps = assessmentTypes.map((type) => {
    const statusKey = moduleStatusKey(type, launchRecords, propertyId);
    const recordCount = propertyRecords.filter((r) => r.assessmentType === type.key).length;
    return { type, statusKey, recordCount };
  });
  const doneCount = approvedTypeCount(launchRecords, propertyId, assessmentTypes);
  const rejectedModuleCount = steps.filter((s) => s.statusKey === 'rejected').length;
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Go-Live Approval doubles as the Store Summary's sign-off facts and the
  // page's twelve-item Store Launch Checklist — see storeLaunchTemplate.js.
  const goLiveType = assessmentTypes.find((t) => t.key === 'go_live_approval') || null;
  const goLiveLatest = goLiveType ? latestRecordOf(goLiveType, launchRecords, propertyId) : null;
  const goLiveApproved = goLiveType ? latestApprovedRecordOf(goLiveType, launchRecords, propertyId) : null;
  const goLiveStatusKey = goLiveType ? moduleStatusKey(goLiveType, launchRecords, propertyId) : 'pending';
  const checklistItems = (goLiveType?.masterDataSchema || []).filter((f) => f.type === 'boolean');
  const checklist = checklistProgress(goLiveLatest, goLiveType?.masterDataSchema);
  const launchProgressPct = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;

  const storeManager = goLiveApproved?.values?.store_manager;
  const actualOpeningDate = goLiveApproved?.values?.actual_opening_date;
  const actualCost = goLiveApproved?.values?.actual_cost;

  // Project Creation facts for the Store Summary — same lookup every later
  // phase page uses (latest approved record of each type).
  const p4Records = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const latestApprovedOfType = (key) => {
    const approved = p4Records.filter((r) => r.assessmentType === key && r.status === 'approved');
    return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
  };
  const budget = latestApprovedOfType('budget')?.values?.estimated_budget;
  const targetOpeningDate = latestApprovedOfType('timeline')?.values?.target_opening_date;
  const projectManager = latestApprovedOfType('manager_assignment')?.values?.project_manager;

  const readinessDoneCount = approvedTypeCount(readinessRecords, propertyId, readinessTypes);
  const readinessPct = readinessTypes.length ? Math.round((readinessDoneCount / readinessTypes.length) * 100) : 0;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';
  const nextStage = project?.stages?.find((s) => s.key === 'p10');

  const launchStatus = isCompleted ? 'Store Opened' : rejectedModuleCount > 0 ? 'Needs Attention' : doneCount > 0 ? 'In Progress' : 'Pending';
  const launchStatusMeta = isCompleted
    ? { color: 'var(--sl-green)', soft: 'rgba(34,197,94,0.12)' }
    : rejectedModuleCount > 0
      ? { color: 'var(--sl-red)', soft: 'rgba(239,68,68,0.12)' }
      : doneCount > 0
        ? { color: 'var(--sl-blue)', soft: 'rgba(37,99,235,0.12)' }
        : { color: 'var(--sl-gray)', soft: 'var(--surface-hover)' };
  const launchApprovalLabel = { approved: 'Approved', rejected: 'Rejected', in_progress: 'In Review', pending: 'Pending' }[goLiveStatusKey];
  const launchApprovalColor = MODULE_STATUS_META[goLiveStatusKey].color;

  const diffDays = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
  const launchDelayDays = targetOpeningDate && actualOpeningDate ? diffDays(actualOpeningDate, targetOpeningDate) : null;
  const launchDelayLabel = launchDelayDays == null ? '—' : launchDelayDays === 0 ? 'On Time' : `${launchDelayDays > 0 ? '+' : ''}${launchDelayDays} Days`;
  const budgetVariance = budget != null && actualCost != null ? budget - actualCost : null;
  const budgetVariancePct = budgetVariance != null && budget ? (budgetVariance / budget) * 100 : null;
  const budgetVarianceLabel = budgetVariance == null ? '—' : `${fmtBudget(budgetVariance)} (${budgetVariancePct.toFixed(2)}%)`;

  // Checklist-derived analytics — "Total Modules" here means the twelve
  // Go-Live Approval checklist items (matches the reference's Store Launch
  // Checklist strip directly above it), not the eight workspace cards.
  const analyticsCompleted = checklist.done;
  const analyticsPending = checklist.total - checklist.done;
  const analyticsApproved = goLiveStatusKey === 'approved' ? checklist.done : 0;
  const analyticsRejected = goLiveStatusKey === 'rejected' ? checklist.total : 0;

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
    return (<><Topbar title="Store Launch" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Store Launch</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Store Launch stage" hint="This project has no Store Launch stage." />
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
  // The Store Launch Records table's own inline Status dropdown (own
  // reason/confirm dialogs, see StatusDropdown.jsx) — a second, independent
  // entry point into the same decide() mutation the modal's Approve/Reject
  // footer buttons above already use.
  const onTableDecide = (record, verb, extra) => {
    decide.mutate({ id: record._id, decision: verb, reason: extra?.reason, remarks: extra?.remarks });
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
      <div className="content page-compact store-launch-page">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Store Summary">
              <div className="sl-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Store Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for Store Launch."
                hint="Complete every Store Readiness checklist before starting Store Launch."
              />
            </SectionCard>
          ) : (
            <>
              {/* Top: Store Summary (75%) / Launch Progress + Next Phase (25%). */}
              <div className="sl-top-grid">
                <SectionCard title="Store Summary">
                  <div className="col gap-3">
                    <div className="sl-summary-row1">
                      <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                      <InfoTile label="Property Name" value={property.title} />
                      <InfoTile label="Project Name" value={project.name} />
                      <InfoTile label="Store Code" value={project.code} />
                      <InfoTile label="Commercial Type" value={property.values?.commercial_type} />
                      <InfoTile label="City" value={property.values?.city} />
                      <InfoTile label="Locality" value={property.values?.locality} />
                    </div>
                    <div className="sl-summary-row2">
                      <InfoTile label="Project Manager" value={projectManager || '—'} />
                      <InfoTile label="Store Manager" value={storeManager || '—'} />
                      <InfoTile label="Target Opening Date" value={targetOpeningDate ? fmtDate(targetOpeningDate) : '—'} />
                      <InfoTile label="Actual Opening Date" value={actualOpeningDate ? fmtDate(actualOpeningDate) : '—'} />
                    </div>
                    <div className="sl-summary-row3">
                      <InfoTile label="Budget" value={fmtBudget(budget)} />
                      <InfoTile label="Actual Cost" value={fmtBudget(actualCost)} />
                      <InfoTile label="Overall Readiness" value={`${readinessPct}%`} />
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Launch Status</span>
                        <div><Badge color={launchStatusMeta.color} soft={launchStatusMeta.soft} dot>{launchStatus}</Badge></div>
                      </div>
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Store Progress</span>
                        <ProgressBar value={launchProgressPct} height={7} gradient="var(--sl-blue)" />
                        <span className="tiny muted">{launchProgressPct}%</span>
                      </div>
                      <div className="col gap-1">
                        <span className="tiny subtle upper">Launch Approval Status</span>
                        <div><Badge color={launchApprovalColor} soft={MODULE_STATUS_META[goLiveStatusKey].soft} dot>{launchApprovalLabel}</Badge></div>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <div className="sl-sidebar">
                  <div className="card sl-progress-card">
                    <div className="sl-progress-head">
                      <span className="sl-progress-icon"><Rocket size={15} /></span>
                      <span className="sl-progress-title">Overall Launch Progress</span>
                    </div>
                    <div className="col gap-1" style={{ alignItems: 'center' }}>
                      <span className="sl-progress-value">{launchProgressPct}%</span>
                      <ProgressBar value={launchProgressPct} height={7} gradient="var(--sl-blue)" />
                      <span className="sl-progress-sub">{checklist.done} / {checklist.total || 0} Completed</span>
                    </div>
                  </div>
                  <div
                    className={`card pc-next-card${isCompleted ? '' : ' locked'}`}
                    onClick={() => isCompleted && navigate(`/projects/${id}/project-closure`)}
                  >
                    <div className="col">
                      <span className="pc-next-card-label">{isCompleted ? 'Next Phase Unlocked' : 'Next Phase Locked'}</span>
                      <span className="pc-next-card-phase">Phase 10</span>
                      <span className="pc-next-card-name">{nextStage?.name || 'Project Closure'}</span>
                      {!isCompleted && <span className="tiny subtle" style={{ marginTop: 4 }}>All launch modules approved</span>}
                    </div>
                    {isCompleted ? <ChevronRight size={18} color="var(--sl-green)" /> : <Lock size={16} color="var(--text-subtle)" />}
                  </div>
                </div>
              </div>

              {/* Middle: Store Launch Workspace (75%) / Activity Timeline (25%). */}
              <div className="sl-middle-grid">
                <SectionCard title="Store Launch Workspace" bodyClass="card-body-compact">
                  {assessmentTypes.length ? (
                    <div className="store-launch-grid">
                      {steps.map(({ type, statusKey, recordCount }) => (
                        <ModuleCard
                          key={type.key}
                          type={type}
                          statusKey={statusKey}
                          recordCount={recordCount}
                          onOpenModule={() => openNewSubmission(type)}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={ClipboardList} title="No modules configured" hint="Add assessment types to the Store Launch stage in the template." />
                  )}
                </SectionCard>

                <SectionCard title="Activity Timeline">
                  {activitiesLoading ? (
                    <SkeletonActivity rows={4} />
                  ) : propertyActivity.length ? (
                    <div className="col gap-2">
                      <div className="pc-timeline">
                        {propertyActivity.slice(0, TIMELINE_VISIBLE_COUNT).map((a, i, arr) => {
                          const { Icon, color } = timelineMetaFor(a.message);
                          return (
                            <div key={a._id} className="pc-timeline-item">
                              <div className="pc-timeline-rail">
                                <span className="pc-timeline-icon" style={{ color }}>
                                  <Icon size={14} />
                                </span>
                                {i < arr.length - 1 && <span className="pc-timeline-rail-line" />}
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
                      {propertyActivity.length > TIMELINE_VISIBLE_COUNT && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate(`/projects/${id}`)}>
                          View Full Timeline
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
                  )}
                </SectionCard>
              </div>

              {/* Store Launch Records. */}
              <RecordsTable
                title="Store Launch Records"
                typeColumnLabel="Module"
                records={statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords}
                assessmentTypes={assessmentTypes}
                canDecide={canDecide}
                decidePending={decide.isPending}
                onView={openView}
                onDecide={onTableDecide}
                showReviewedBy
                showApprovedOn
                showAttachments
                statusMetaFor={(record) => {
                  const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                  return MODULE_STATUS_META[type ? moduleStatusKey(type, launchRecords, propertyId) : 'pending'];
                }}
                emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                emptyHint={statusFilter ? 'Clear the filter to see every record.' : 'Use Open Module on a card above to see it here.'}
              />

              {/* Store Launch Checklist — the Go-Live Approval module's twelve boolean items. */}
              <SectionCard title="Store Launch Checklist">
                {checklistItems.length ? (
                  <div className="sl-checklist-row">
                    {checklistItems.map((field) => {
                      const done = goLiveLatest?.values?.[field.key] === true;
                      const itemStatus = goLiveStatusKey === 'rejected' ? 'rejected' : done ? 'approved' : 'pending';
                      const meta = MODULE_STATUS_META[itemStatus];
                      const ItemIcon = itemStatus === 'approved' ? CheckCircle2 : itemStatus === 'rejected' ? XCircle : Clock;
                      return (
                        <div key={field.key} className="sl-checklist-card">
                          <span className="sl-checklist-card-icon" style={{ background: meta.color }}>
                            <ItemIcon size={13} />
                          </span>
                          <span className="sl-checklist-card-label">{field.label}</span>
                          <div><Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge></div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No checklist configured" hint="Add checklist items to the Go-Live Approval module in the template." />
                )}
              </SectionCard>

              {/* Bottom analytics row. */}
              <div className="sl-analytics-row">
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Total Modules</span><span className="sl-analytics-value">{checklist.total || 0}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Completed</span><span className="sl-analytics-value" style={{ color: 'var(--sl-green)' }}>{analyticsCompleted}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Pending</span><span className="sl-analytics-value" style={{ color: 'var(--sl-orange)' }}>{analyticsPending}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Approved</span><span className="sl-analytics-value" style={{ color: 'var(--sl-green)' }}>{analyticsApproved}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Rejected</span><span className="sl-analytics-value" style={{ color: 'var(--sl-red)' }}>{analyticsRejected}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Overall Launch Progress</span><span className="sl-analytics-value" style={{ color: 'var(--sl-blue)' }}>{launchProgressPct}%</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Target Opening Date</span><span className="sl-analytics-value">{targetOpeningDate ? fmtDate(targetOpeningDate) : '—'}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Actual Opening Date</span><span className="sl-analytics-value">{actualOpeningDate ? fmtDate(actualOpeningDate) : '—'}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Launch Delay</span><span className="sl-analytics-value">{launchDelayLabel}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Budget</span><span className="sl-analytics-value">{fmtBudget(budget)}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Actual Cost</span><span className="sl-analytics-value">{fmtBudget(actualCost)}</span></div>
                <div className="sl-analytics-tile"><span className="sl-analytics-label">Budget Variance</span><span className="sl-analytics-value">{budgetVarianceLabel}</span></div>
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

export default StoreLaunchPage;
