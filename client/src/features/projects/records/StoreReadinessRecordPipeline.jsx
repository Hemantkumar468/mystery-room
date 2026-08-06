import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList,
  CheckCircle2, XCircle, Clock, UserCog, Eye, FilePenLine, Circle,
} from 'lucide-react';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar } from '../../../components/ui/primitives.jsx';
import { SkPropertyIdentification, SkeletonActivity } from '../../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../../app/api/templatesApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
} from '../../../app/api/recordsApi.js';
import { useProject, useProjectActivity, useCompleteStage } from '../../../app/api/projectsApi.js';
import { fmtDateTime, fromNow, fmtDate } from '../../../lib/format.js';
import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { RecordFormModal } from './RecordFormModal.jsx';
import { RejectDialog } from './RejectDialog.jsx';
import { RecordsTable } from './RecordsTable.jsx';
import { approvedTypeCount, isTypeApproved, propertyNo, buildRecordMeta, matchesStatusFilter } from './recordUi.js';
import { can } from '../../../lib/roles.js';

/** One accent color per checklist card — cycles the reference's literal blue/green/orange/red set, page-scoped (see .store-readiness-page in globals.css). */
const MODULE_ACCENTS = [
  'var(--sr-blue)', 'var(--sr-green)', 'var(--sr-orange)', 'var(--sr-red)', 'var(--sr-gray)',
];

/**
 * A checklist card's own display status — Pending / In Progress / Completed /
 * Rejected, the reference's four-word vocabulary. "Completed" wins once the
 * module has ever been approved (see isTypeApproved) even if a newer
 * resubmission is mid-flight; "In Progress" folds together both a still-open
 * draft and an already-submitted-awaiting-decision record, since the
 * reference shows only these four states, not Department Planning's finer
 * five-tier read.
 */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: 'var(--sr-gray)', soft: 'var(--surface-hover)' },
  in_progress: { label: 'In Progress', color: 'var(--sr-blue)', soft: 'rgba(37,99,235,0.12)' },
  approved: { label: 'Completed', color: 'var(--sr-green)', soft: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: 'var(--sr-red)', soft: 'rgba(239,68,68,0.12)' },
};

function moduleStatusKey(type, records, propertyId) {
  if (isTypeApproved(records, propertyId, type)) return 'approved';
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  return 'in_progress'; // draft or submitted, awaiting a decision
}

/** The same module's latest record (or null), for reading its checklist-field answers. */
function latestRecordOf(type, records, propertyId) {
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  return own.length ? [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null;
}

/**
 * "X/Y" checklist-item completion for one module's latest record — counts
 * every boolean field in the module's own masterDataSchema that's been
 * ticked true, not how many times the module was submitted (that's what the
 * reference's card counts read as: "12/12" checklist items done).
 */
function checklistProgress(record, schema) {
  const boolFields = (schema || []).filter((f) => f.type === 'boolean');
  const total = boolFields.length;
  const done = record ? boolFields.filter((f) => record.values?.[f.key] === true).length : 0;
  return { done, total };
}

/** Icon + color for one activity-timeline entry, read off its message text — every record.service.js message uses one of these verbs. */
function timelineMetaFor(message = '') {
  const m = message.toLowerCase();
  if (m.includes('rejected')) return { Icon: XCircle, color: 'var(--sr-red)' };
  if (m.includes('approved') || m.includes('completed')) return { Icon: CheckCircle2, color: 'var(--sr-green)' };
  if (m.includes('submitted')) return { Icon: Clock, color: 'var(--sr-orange)' };
  if (m.includes('assigned')) return { Icon: UserCog, color: 'var(--sr-blue)' };
  if (m.includes('opened')) return { Icon: Eye, color: 'var(--text-subtle)' };
  if (m.includes('created') || m.includes('updated') || m.includes('draft')) return { Icon: FilePenLine, color: 'var(--sr-blue)' };
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

/** Full (non-compact) Indian-grouped currency, e.g. ₹12,50,000 — same reading Department Planning's Property Summary uses for the approved budget figure. */
const fmtBudget = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));

/**
 * One Store Readiness Workspace card — number badge, checklist name, status
 * badge, "X/Y" checklist-item completion, short description, and a button
 * that always starts a brand-new submission. It never resumes an
 * in-progress draft (unlimited submissions, never overwrite — see
 * saveRecord) — to continue an existing draft/submitted/rejected record
 * instead, open it from the Checklist Records table below and use Edit in
 * its read-only view.
 */
function ModuleCard({ index, type, statusKey, progress, onOpenChecklist }) {
  const smeta = MODULE_STATUS_META[statusKey];
  return (
    <div className="card pc-module-card">
      <div className="pc-module-head">
        <span className="pc-module-num" style={{ background: MODULE_ACCENTS[index % MODULE_ACCENTS.length] }}>{index + 1}</span>
        <span className="pc-module-title" title={type.name}>{type.name}</span>
      </div>
      <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
        <span className="tiny muted">{progress.done}/{progress.total}</span>
      </div>
      <span className="pc-module-desc">{type.subtitle}</span>
      <div className="row gap-2" style={{ flexWrap: 'wrap', marginTop: 'auto', paddingTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm pc-module-action" onClick={onOpenChecklist}>
          Open Checklist
        </button>
      </div>
    </div>
  );
}

/**
 * One bottom KPI card. When `filterKey` is given, the card becomes a button
 * that narrows the Checklist Records table above to matching rows (see
 * matchesStatusFilter) — clicking the already-active card clears the filter.
 * Cards with no real backing status (Need Rework/Blocked, always 0 today) or
 * that aren't a count at all (Overall Readiness, a percentage) render as
 * plain, non-clickable cards.
 */
function KpiCard({ label, value, sub, tone, filterKey, activeFilter, onFilterClick }) {
  const isActive = filterKey === 'all' ? !activeFilter : Boolean(filterKey) && activeFilter === filterKey;
  const clickable = Boolean(filterKey);
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      className={`pc-kpi-card${clickable ? ' clickable' : ''}${isActive ? ' active' : ''}`}
      style={isActive && tone ? { borderColor: tone, boxShadow: `0 0 0 2px ${tone}33` } : undefined}
      onClick={clickable ? () => onFilterClick(filterKey) : undefined}
    >
      <span className="pc-kpi-label">{label}</span>
      <span className="pc-kpi-value" style={tone ? { color: tone } : undefined}>{value}</span>
      {sub && <span className="pc-kpi-sub">{sub}</span>}
    </Tag>
  );
}

/**
 * PRESERVED, UNROUTED — the original Record-based Store Readiness Checklist
 * (p8) workspace: fourteen module-level checklist forms (assessmentTypes),
 * one Record submission per module. Replaced in routing by the Task-based
 * `StoreReadinessDashboardPage`/`CategoryDetailsPage` redesign (per-item
 * assignee/due-date/status/approval tracking instead of one form per
 * module) — kept here, exactly like `PropertyApprovalPipeline.jsx`, in case
 * this shape is needed again. No logic changes from the original
 * `StoreReadinessPage.jsx` beyond relative import paths and the export name.
 *
 * Single-page workspace, same shape as Commercial Finalization / Project
 * Creation / Department Planning: the workflow never asks the user to pick a
 * property, it always resolves to the one shortlisted property that has
 * fully cleared Approval Workflow (every one of p7's sign-off modules
 * Approved) and loads its workspace directly.
 */
export function StoreReadinessRecordPipeline() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);

  const stageKey = 'p8';

  // Base pool: every shortlisted property, same as every earlier stage.
  // Narrowed below to only those that have fully cleared Approval Workflow —
  // exactly one of those (the first) becomes this page's workspace.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: approvalRecords } = useStageRecords(id, 'p7');
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');
  const { data: readinessRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  // Logged against the property itself (a Phase 1 record), so it invalidates
  // the same caches a Phase 1 record mutation would.
  const markOpened = useMarkRecordOpened(id, 'p1');
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null); // KPI card click narrows the Checklist Records table above
  const openLoggedRef = useRef(false);
  const autoCompletedRef = useRef(false);

  const approvalTypes = template?.stages?.find((s) => s.key === 'p7')?.assessmentTypes || [];
  const assessmentTypes = template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];

  // Only properties whose every Approval Workflow sign-off has at least one
  // Approved record ever qualify — never rejected or still in-progress ones.
  const isApproved = (propId) =>
    approvalTypes.length > 0 && approvedTypeCount(approvalRecords, propId, approvalTypes) === approvalTypes.length;
  const properties = (shortlisted || []).filter((p) => isApproved(p._id));
  // The single property this page ever works on — no picker, no route param.
  const property = properties[0] || null;
  const propertyId = property?._id;

  const propertyRecords = (readinessRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const steps = assessmentTypes.map((type) => {
    const statusKey = moduleStatusKey(type, readinessRecords, propertyId);
    const latest = latestRecordOf(type, readinessRecords, propertyId);
    return { type, statusKey, progress: checklistProgress(latest, type.masterDataSchema) };
  });
  const doneCount = approvedTypeCount(readinessRecords, propertyId, assessmentTypes);
  const pendingCount = steps.filter((s) => s.statusKey === 'pending').length;
  const inProgressCount = steps.filter((s) => s.statusKey === 'in_progress').length;
  const rejectedCount = steps.filter((s) => s.statusKey === 'rejected').length;
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const overallPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;

  // Project Creation facts for the Store Summary — Budget, Target Opening
  // Date and Project Manager all come from p4's own approved modules
  // (Budget Planning / Timeline Planning / Project Manager Assignment), the
  // latest-approved one of each if a module was ever resubmitted.
  const p4Records = (projectCreationRecords || []).filter((r) => String(r.parentRecordId) === String(propertyId));
  const latestApprovedOfType = (key) => {
    const approved = p4Records.filter((r) => r.assessmentType === key && r.status === 'approved');
    return approved.length ? [...approved].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] : null;
  };
  const budget = latestApprovedOfType('budget')?.values?.estimated_budget;
  const targetOpeningDate = latestApprovedOfType('timeline')?.values?.target_opening_date;
  const projectManager = latestApprovedOfType('manager_assignment')?.values?.project_manager;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  // "Property opened" is logged once — the very first time this workspace is
  // visited for a property that has no Store Readiness records yet.
  useEffect(() => {
    if (openLoggedRef.current || recordsLoading || !property) return;
    openLoggedRef.current = true;
    if (propertyRecords.length === 0) {
      markOpened.mutate(propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordsLoading, property]);

  // Every checklist Approved → the stage completes itself and Phase 9
  // unlocks, no manual "Mark Done" click. Guarded so it only ever fires once
  // per visit (completeStage is idempotent server-side too).
  useEffect(() => {
    if (autoCompletedRef.current || !stage || isCompleted) return;
    if (assessmentTypes.length > 0 && doneCount === assessmentTypes.length) {
      autoCompletedRef.current = true;
      completeStage.mutate(stageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount, assessmentTypes.length, stage, isCompleted]);

  if (isLoading || !project) {
    return (<><Topbar title="Store Readiness Checklist" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Store Readiness Checklist</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Store Readiness stage" hint="This project has no Store Readiness Checklist stage." />
        </div>
      </>
    );
  }

  const relevantIds = new Set([String(propertyId), ...propertyRecords.map((r) => String(r._id))]);
  const propertyActivity = (activities || [])
    .filter((a) => relevantIds.has(a.meta?.recordId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // The workspace card's own action always opens a blank form for a brand
  // new submission — resuming an existing draft happens from the Checklist
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
      <div className="content page-compact store-readiness-page">
        <div className="content-narrow col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="1. Store Summary">
              <div className="dp-summary-row1"><InfoTile label="Property Name" value="Loading…" /></div>
            </SectionCard>
          ) : !property ? (
            <SectionCard title="1. Store Summary">
              <EmptyState
                icon={ClipboardList}
                title="This property is not yet eligible for the Store Readiness Checklist."
                hint="Complete every Approval Workflow sign-off before starting the Store Readiness Checklist."
              />
            </SectionCard>
          ) : (
            <>
              {/* Store Summary — collapsed by default and placed below the work:
                  a doer opens the phase to act, not to read a dashboard. */}
              <SectionCard title="Store Summary" collapsible defaultCollapsed style={{ order: 3 }}>
                <div className="col gap-3">
                  <div className="dp-summary-row1">
                    <InfoTile label="Property Number" value={propertyNo(property.seq)} />
                    <InfoTile label="Property Name" value={property.title} />
                    <InfoTile label="Project Name" value={project.name} />
                    <InfoTile label="City" value={property.values?.city} />
                    <InfoTile label="Locality" value={property.values?.locality} />
                    <InfoTile label="Project Manager" value={projectManager || '—'} />
                    <InfoTile label="Target Opening Date" value={targetOpeningDate ? fmtDate(targetOpeningDate) : '—'} />
                    <InfoTile label="Budget" value={fmtBudget(budget)} />
                  </div>
                  <div className="dp-summary-row2">
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Current Phase</span>
                      <div><Badge color="var(--sr-green)" soft="rgba(34,197,94,0.12)" dot>{stage.name}</Badge></div>
                    </div>
                    <div className="col gap-1">
                      <span className="tiny subtle upper">Overall Readiness Progress</span>
                      <ProgressBar value={overallPct} height={7} gradient="var(--sr-blue)" />
                      <span className="tiny muted">{overallPct}% ({doneCount}/{assessmentTypes.length || 0} Checklists Completed)</span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* Store Readiness Workspace — the actual work, first. Fourteen checklists, one non-wrapping row. */}
              <SectionCard
                title="Store Readiness Workspace"
                subtitle="Pick a checklist to fill and submit its record"
                bodyClass="card-body-compact"
                style={{ order: 1 }}
              >
                {assessmentTypes.length ? (
                  <div className="store-readiness-grid">
                    {steps.map(({ type, statusKey, progress }, i) => (
                      <ModuleCard
                        key={type.key}
                        index={i}
                        type={type}
                        statusKey={statusKey}
                        progress={progress}
                        onOpenChecklist={() => openNewSubmission(type)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={ClipboardList} title="No checklists configured" hint="Add assessment types to the Store Readiness Checklist stage in the template." />
                )}
              </SectionCard>

              {/* Checklist Records (65%) / Activity Timeline (35%) — the submission history, right under the work. */}
              <div className="pc-bottom-grid" style={{ order: 6 }}>
                <RecordsTable
                  title="3. Checklist Records"
                  typeColumnLabel="Checklist"
                  records={statusFilter ? allRecords.filter((r) => matchesStatusFilter(r, statusFilter)) : allRecords}
                  assessmentTypes={assessmentTypes}
                  canDecide={canDecide}
                  decidePending={decide.isPending}
                  onView={openView}
                  onApprove={doApprove}
                  onReject={openReject}
                  statusMetaFor={(record) => {
                    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
                    return MODULE_STATUS_META[type ? moduleStatusKey(type, readinessRecords, propertyId) : 'pending'];
                  }}
                  emptyTitle={statusFilter ? 'No records match this filter' : 'No records filed yet'}
                  emptyHint={statusFilter ? 'Click the active KPI card again to clear the filter.' : 'Use Open Checklist on a card above to see it here.'}
                />

                <SectionCard title="4. Activity Timeline">
                  {activitiesLoading ? (
                    <SkeletonActivity rows={4} />
                  ) : propertyActivity.length ? (
                    <div className="pc-timeline" style={{ maxHeight: 170, overflowY: 'auto' }}>
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

              {/* Bottom KPI Cards — click one to narrow Checklist Records above. */}
              <div className="pc-kpi-grid" style={{ order: 4 }}>
                <KpiCard label="Total Checklists" value={assessmentTypes.length} sub="All readiness checklists" filterKey="all" activeFilter={statusFilter} onFilterClick={(k) => setStatusFilter(null)} />
                <KpiCard label="Completed" value={doneCount} sub={`${overallPct}% of total`} tone="var(--sr-green)" filterKey="approved" activeFilter={statusFilter} onFilterClick={(k) => setStatusFilter((f) => (f === k ? null : k))} />
                <KpiCard label="Pending" value={pendingCount} sub={pendingCount ? 'Awaiting action' : 'None pending'} tone="var(--sr-orange)" filterKey="pending" activeFilter={statusFilter} onFilterClick={(k) => setStatusFilter((f) => (f === k ? null : k))} />
                <KpiCard label="In Progress" value={inProgressCount} sub={inProgressCount ? 'Work in progress' : 'None in progress'} tone="var(--sr-blue)" filterKey="in_progress" activeFilter={statusFilter} onFilterClick={(k) => setStatusFilter((f) => (f === k ? null : k))} />
                <KpiCard label="Rejected" value={rejectedCount} sub={rejectedCount ? 'Needs attention' : 'No rejections'} tone="var(--sr-red)" filterKey="rejected" activeFilter={statusFilter} onFilterClick={(k) => setStatusFilter((f) => (f === k ? null : k))} />
                <KpiCard label="Need Rework" value={0} sub="No rework" tone="var(--sr-gray)" />
                <KpiCard label="Blocked" value={0} sub="No blocks" tone="var(--sr-gray)" />
                <div className="pc-kpi-card">
                  <span className="pc-kpi-label">Overall Readiness</span>
                  <span className="pc-kpi-value" style={{ color: 'var(--sr-green)' }}>{overallPct}%</span>
                  <ProgressBar value={overallPct} height={6} gradient="var(--sr-blue)" />
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

export default StoreReadinessRecordPipeline;
