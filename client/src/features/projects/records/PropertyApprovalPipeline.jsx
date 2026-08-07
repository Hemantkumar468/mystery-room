import { cloneElement, useMemo, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, XCircle, Clock, Search, ChevronDown,
  CalendarDays, Download, Send, Paperclip, Eye, PlayCircle, Building2, Users, Landmark, Scale,
  Briefcase, Flag, MoreVertical,
} from 'lucide-react';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, Avatar, ProgressRing } from '../../../components/ui/primitives.jsx';
import { DonutChart } from '../../../components/charts/chartkit.jsx';
import { SkPropertyIdentification } from '../../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../../app/api/templatesApi.js';
import { useUsers } from '../../../app/api/usersApi.js';
import {
  useStageRecords, useCreateRecord, useUpdateRecord, useMarkRecordOpened, useRecordDecision,
  useAddRecordComment,
} from '../../../app/api/recordsApi.js';
import { useProject, useCompleteStage } from '../../../app/api/projectsApi.js';
import { useTasks } from '../../../app/api/tasksApi.js';
import { fmtDateTime, fmtDate, fromNow } from '../../../lib/format.js';
import { deptMeta, PRIORITY_META } from '../../../lib/ui.js';
import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { RecordFormModal } from './RecordFormModal.jsx';
import { RejectDialog } from './RejectDialog.jsx';
import { approvedTypeCount, buildRecordMeta } from './recordUi.js';
import { ROLES, can } from '../../../lib/roles.js';

/**
 * PRESERVED, UNROUTED — the original Phase 7 "Approval Workflow" page, kept
 * intact after the Phase 6/7 redesign replaced ApprovalWorkflowPage.jsx with
 * a Task-based (department → management tier) Approval Dashboard. This is a
 * *different* pipeline: a fixed six-stage Record-backed property-assessment
 * flow (Department Review -> Functional Review -> Finance Approval -> Legal
 * Review -> Management Approval -> Final Approval), independent of Task
 * approvals. It was decoupled from the server's own `completeStage('p7')`
 * gate (which checks Task.status, not these Records) — see the redesign plan
 * for details. Nothing here is wired to a route; it's kept in case this
 * pipeline is needed again, verbatim except for import paths after the move
 * from `features/projects/ApprovalWorkflowPage.jsx` into `records/`.
 */

/** A module's own display status — Approved / Pending / Rejected / Under
 * Review. "Approved" wins once ever approved even if a later resubmission
 * is mid-flight; a draft that hasn't been submitted yet still reads as
 * Pending (nothing for a reviewer to act on). */
const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: 'var(--aw-gray)', soft: 'rgba(100,116,139,0.12)' },
  in_review: { label: 'In Progress', color: 'var(--aw-purple)', soft: 'rgba(139,92,246,0.12)' },
  approved: { label: 'Approved', color: 'var(--aw-green)', soft: 'rgba(34,197,94,0.12)' },
  rejected: { label: 'Rejected', color: 'var(--aw-red)', soft: 'rgba(239,68,68,0.12)' },
};

/** One icon per pipeline stage, purely decorative (Current Approval card / timeline). */
const STAGE_ICONS = {
  department_review: Building2,
  functional_review: Users,
  finance_approval: Landmark,
  legal_review: Scale,
  management_approval: Briefcase,
  final_approval: Flag,
};

function moduleStatusKey(type, records, propertyId) {
  const own = (records || []).filter((r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === type.key);
  if (own.some((r) => r.status === 'approved')) return 'approved';
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  if (latest.status === 'submitted') return 'in_review';
  return 'pending'; // draft — nothing for a reviewer to act on yet
}

/**
 * Which real department (or role, for the two non-department gates) each of
 * the six fixed pipeline stages maps to — used purely to find a plausible
 * real approver (via useUsers) and to color/label the table's Department
 * column. Not stored anywhere; the assessmentType key is the source of truth.
 */
const PIPELINE_META = {
  department_review: { department: 'operations' },
  functional_review: { department: 'projects' },
  finance_approval: { department: 'finance' },
  legal_review: { department: 'legal' },
  // Predicates, not role strings. `final_approval` used to filter on the
  // literal 'admin', which has not been a role since the MD/EA split — the
  // pool came back empty and the Leadership step resolved to no approver at
  // all. `can.actForLeadership` is the same MD-or-EA rule used just below.
  management_approval: { roleMatches: (r) => r === ROLES.MANAGER, label: 'Management' },
  final_approval: { roleMatches: can.actForLeadership, label: 'Leadership' },
};

function stageDeptMeta(key) {
  const meta = PIPELINE_META[key];
  if (meta?.department) return deptMeta(meta.department);
  return { label: meta?.label || '—', color: 'var(--aw-gray)' };
}

/** Best real user to show as "Assigned To" for a stage — a manager in the
 * matching department, else anyone in that department, else (for the two
 * role-gated stages) a manager/admin. Returns null rather than fabricating
 * a name when nobody real matches. */
function findApprover(users, key) {
  const meta = PIPELINE_META[key];
  if (!meta) return null;
  const pool = meta.department
    ? (users || []).filter((u) => u.department === meta.department)
    : (users || []).filter((u) => meta.roleMatches?.(u.role));
  if (!pool.length) return null;
  // Prefer a Manager, then anyone who may sign off at all (MD or EA), then
  // whoever is left — the fallback chain, not a hardcoded role list.
  return pool.find((u) => u.role === ROLES.MANAGER)
    || pool.find((u) => can.actForLeadership(u.role))
    || pool[0];
}

/** Real due date — submission time + the stage's own SLA window, not fabricated. */
function computeDueDate(record, slaDays) {
  const base = record?.submittedAt || record?.createdAt;
  if (!base) return null;
  return new Date(new Date(base).getTime() + (slaDays || 5) * 86400000);
}

const requestCode = (record) =>
  record ? `APR-${new Date(record.createdAt).getFullYear()}-${String(record.seq).padStart(4, '0')}` : '—';

const priorityMeta = (record) => PRIORITY_META[String(record?.values?.priority || 'medium').toLowerCase()] || PRIORITY_META.medium;

const EMPTY_FILTERS = { search: '', stage: '', status: '', priority: '', department: '', dueBefore: '' };
const PAGE_SIZE = 10;

/** Client-side CSV export of the approval requests currently loaded. */
function exportApprovalsCsv(records, projectCode) {
  const header = ['Request ID', 'Stage', 'Department', 'Requested By', 'Requested On', 'Due Date', 'Status', 'Priority'];
  const rows = records.map((r) => [
    requestCode(r), r._typeName || r.title || '', r._deptLabel || '',
    r.submittedBy?.name || r.createdBy?.name || '—', r.submittedAt ? fmtDate(r.submittedAt) : '',
    r._dueDate ? fmtDate(r._dueDate) : '', MODULE_STATUS_META[r._statusKey]?.label || r.status,
    priorityMeta(r).label,
  ]);
  const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectCode || 'approvals'}-approval-requests.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/** One tile in the top overview strip — label, icon + big number + optional
 * %, then a thin progress bar underneath when a rate applies. */
function AwStatCard({ icon: Icon, label, value, color, pct, sub }) {
  return (
    <div className="card" style={{ padding: '10px 12px', flex: '1 1 0', minWidth: 130, display: 'flex', flexDirection: 'column' }}>
      <span className="tiny muted" style={{ fontWeight: 600 }}>{label}</span>
      <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
        {Icon && (
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: `${color}1A`, color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon size={13} strokeWidth={2.2} />
          </span>
        )}
        <span style={{ fontSize: 19, fontWeight: 750, lineHeight: 1 }}>{value}</span>
        {pct != null && <span className="tiny" style={{ marginLeft: 'auto', color, fontWeight: 700 }}>{pct}%</span>}
      </div>
      {pct != null ? (
        <div style={{ height: 4, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color }} />
        </div>
      ) : sub && <span className="tiny muted" style={{ marginTop: 6 }}>{sub}</span>}
    </div>
  );
}

/** Horizontal 6-step "Approval Flow" — reuses the app's phase-stepper CSS
 * (.se-phase-step*, see PhaseWorkflowProgress.jsx) but is a static display,
 * not navigation: no onClick, no locked/disabled state. */
function ApprovalFlowStepper({ steps }) {
  return (
    <div className="se-phase-stepper">
      {steps.map((step, i) => {
        const access = step.statusKey === 'approved' ? 'completed' : step.isCurrent ? 'current' : 'locked';
        return (
          <div key={step.type.key} className="se-phase-step-wrap">
            <div className={`se-phase-step se-phase-step--${access}${step.statusKey === 'rejected' ? ' se-phase-step--rejected' : ''}`} style={{ cursor: 'default' }} title={step.type.name}>
              <span className="se-phase-step-dot">
                {step.statusKey === 'approved' ? <CheckCircle2 size={13} /> : step.statusKey === 'rejected' ? <XCircle size={13} /> : i + 1}
              </span>
              <span className="se-phase-step-label">{step.type.name}</span>
            </div>
            {i < steps.length - 1 && <span className={`se-phase-step-connector se-phase-step-connector--${access}`} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Approval Workflow — single-page workspace, same shape as Department
 * Planning / Commercial Finalization / Project Creation: no property picker,
 * it always resolves to the one shortlisted property that has fully cleared
 * Department Planning and loads its workspace directly.
 *
 * A fixed six-stage pipeline (Department Review -> Functional Review ->
 * Finance Approval -> Legal Review -> Management Approval -> Final Approval)
 * gates progression to Store Readiness. Each stage is a real Record
 * (assessmentType = the stage key); approving every stage automatically
 * completes p7 and unlocks Phase 8.
 */
export function PropertyApprovalPipeline() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: users } = useUsers({ status: 'active' });

  const stageKey = 'p7';

  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: departmentPlanningRecords } = useStageRecords(id, 'p5');
  const { data: approvalRecords, isLoading: recordsLoading } = useStageRecords(id, stageKey);
  // Cross-reference into Phase 6: which Execution tasks have cleared their own
  // department-manager sign-off — a different, task-level approval pipeline
  // from this page's stage-level Record pipeline, surfaced here for context.
  const { data: approvedExecTasksResp } = useTasks({ project: id, stageKey: 'p6', status: 'approved', limit: 100 });
  const approvedExecTasks = approvedExecTasksResp?.data || approvedExecTasksResp || [];

  const createRecord = useCreateRecord(id, stageKey);
  const updateRecord = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const completeStage = useCompleteStage(id);
  const markOpened = useMarkRecordOpened(id, 'p1');
  const addComment = useAddRecordComment(id, stageKey);
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const [activeForm, setActiveForm] = useState(null); // { type, record, readOnly } | null
  const [rejectTarget, setRejectTarget] = useState(null);
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [f, setF] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
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
  const allRecords = [...propertyRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';
  const slaDays = stage?.slaDays || 5;

  const steps = assessmentTypes.map((type) => {
    const typeRecords = propertyRecords.filter((r) => r.assessmentType === type.key);
    const latest = typeRecords.length ? [...typeRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] : null;
    return { type, record: latest, statusKey: moduleStatusKey(type, approvalRecords, propertyId) };
  }).map((step, i, arr) => ({ ...step, isCurrent: arr.findIndex((s) => s.statusKey !== 'approved') === i }));

  const currentStepIndex = steps.findIndex((s) => s.statusKey !== 'approved');
  const currentStep = currentStepIndex === -1 ? steps[steps.length - 1] : steps[currentStepIndex];

  const doneCount = approvedTypeCount(approvalRecords, propertyId, assessmentTypes);
  const overallPct = assessmentTypes.length ? Math.round((doneCount / assessmentTypes.length) * 100) : 0;
  const pendingCount = steps.filter((s) => s.statusKey === 'pending').length;
  const underReviewCount = steps.filter((s) => s.statusKey === 'in_review').length;
  const rejectedCount = steps.filter((s) => s.statusKey === 'rejected').length;

  const approvedWithTimes = allRecords.filter((r) => r.status === 'approved' && r.approvedAt && (r.submittedAt || r.createdAt));
  const avgApprovalDays = approvedWithTimes.length
    ? approvedWithTimes.reduce((sum, r) => sum + (new Date(r.approvedAt) - new Date(r.submittedAt || r.createdAt)) / 86400000, 0) / approvedWithTimes.length
    : null;

  const selectedRecord = allRecords.find((r) => String(r._id) === String(selectedRecordId)) || currentStep?.record || null;
  const selectedType = selectedRecord ? assessmentTypes.find((t) => t.key === selectedRecord.assessmentType) : currentStep?.type;

  // Enrich every record with the derived fields the table/CSV export need,
  // keyed off its own assessment type rather than recomputed per row.
  const enrichedRecords = allRecords.map((r) => {
    const type = assessmentTypes.find((t) => t.key === r.assessmentType);
    const dm = stageDeptMeta(r.assessmentType);
    return {
      ...r,
      _typeName: type?.name || r.title,
      _deptLabel: dm.label,
      _deptColor: dm.color,
      _dueDate: computeDueDate(r, slaDays),
      _statusKey: moduleStatusKey(type || { key: r.assessmentType }, approvalRecords, propertyId),
    };
  });

  const setField = (k) => (e) => { setPage(1); setF((old) => ({ ...old, [k]: e.target.value })); };
  const visibleRecords = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return enrichedRecords.filter((r) => {
      if (q && !r._typeName?.toLowerCase().includes(q) && !requestCode(r).toLowerCase().includes(q)) return false;
      if (f.stage && r.assessmentType !== f.stage) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.priority && String(r.values?.priority || 'medium').toLowerCase() !== f.priority) return false;
      if (f.department && (PIPELINE_META[r.assessmentType]?.department || '') !== f.department) return false;
      if (f.dueBefore && (!r._dueDate || r._dueDate > new Date(`${f.dueBefore}T23:59:59`))) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrichedRecords, f]);
  const pageCount = Math.max(1, Math.ceil(visibleRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRecords = visibleRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

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

  const openNewSubmission = (type) => setActiveForm({ type, record: null, readOnly: false });
  const openView = (record) => {
    const type = assessmentTypes.find((t) => t.key === record.assessmentType);
    setActiveForm({ type, record, readOnly: true });
  };
  const switchToEdit = () => setActiveForm((f2) => (f2 ? { ...f2, readOnly: false } : f2));
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

  const takeAction = () => {
    if (!currentStep) return;
    if (!currentStep.record) openNewSubmission(currentStep.type);
    else openView(currentStep.record);
  };

  const currentApprover = currentStep ? findApprover(users, currentStep.type.key) : null;
  const currentDueDate = currentStep ? computeDueDate(currentStep.record, slaDays) : null;

  const donutData = [
    { name: 'Approved', value: doneCount, color: 'var(--aw-green)' },
    { name: 'In Progress', value: underReviewCount, color: 'var(--aw-purple)' },
    { name: 'Pending', value: pendingCount, color: 'var(--aw-gray)' },
    { name: 'Rejected', value: rejectedCount, color: 'var(--aw-red)' },
  ].filter((d) => d.value > 0);

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
        <div className="content-wide col gap-3 fade-in">
          {propertiesLoading || templateLoading ? (
            <SectionCard title="Project Summary">
              <InfoTile label="Loading…" value="…" />
            </SectionCard>
          ) : !property ? (
            <SectionCard title="Project Summary">
              <EmptyState
                icon={ClipboardList}
                title="This project is not yet eligible for Approval Workflow."
                hint="Complete every Department Planning module before starting Approval Workflow."
              />
            </SectionCard>
          ) : (
            <>
              {/* Overview stats */}
              <div className="row gap-2" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
                <div className="card" style={{ padding: '10px 12px', flex: '1 1 0', minWidth: 150, display: 'flex', flexDirection: 'column' }}>
                  <span className="tiny muted" style={{ fontWeight: 600 }}>Overall Approval Progress</span>
                  <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6 }}>
                    <div style={{ flexShrink: 0 }}>
                      <ProgressRing value={overallPct} size={36} stroke={4} color="var(--aw-green)" />
                    </div>
                    <div className="col" style={{ gap: 1 }}>
                      <span style={{ fontSize: 19, fontWeight: 750, lineHeight: 1 }}>{overallPct}%</span>
                      <span className="tiny muted">{doneCount} of {assessmentTypes.length} approvals completed</span>
                    </div>
                  </div>
                </div>
                <AwStatCard icon={ClipboardList} value={assessmentTypes.length} label="Total Approvals" color="var(--aw-blue)" sub="Across all stages" />
                <AwStatCard icon={CheckCircle2} value={doneCount} label="Approved" color="var(--aw-green)" pct={overallPct} />
                <AwStatCard icon={Clock} value={pendingCount + underReviewCount} label="Pending" color="var(--aw-orange)" pct={assessmentTypes.length ? Math.round(((pendingCount + underReviewCount) / assessmentTypes.length) * 100) : 0} />
                <AwStatCard icon={XCircle} value={rejectedCount} label="Rejected" color="var(--aw-red)" pct={assessmentTypes.length ? Math.round((rejectedCount / assessmentTypes.length) * 100) : 0} />
                <AwStatCard icon={Clock} value={avgApprovalDays != null ? `${avgApprovalDays.toFixed(1)} Days` : '—'} label="Avg Approval Time" color="var(--aw-gray)" />
              </div>

              {/* Approval Flow stepper */}
              <SectionCard title="Approval Flow">
                {assessmentTypes.length ? <ApprovalFlowStepper steps={steps} /> : (
                  <EmptyState icon={ClipboardList} title="No approval stages configured" hint="Add assessment types to the Approval Workflow stage in the template." />
                )}
              </SectionCard>

              {/* Approved Execution tasks — cross-reference into Phase 6's
                  task-level approvals, so a reviewer here can see what's
                  already cleared without leaving this page. */}
              <SectionCard
                title={`Approved Execution Tasks (${approvedExecTasks.length})`}
                subtitle="Tasks from Phase 6 Execution that have cleared their own department-manager approval"
              >
                {approvedExecTasks.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="No execution tasks approved yet" hint="Tasks approved in Phase 6 Execution will show up here." />
                ) : (
                  <div className="col">
                    {approvedExecTasks.map((t) => {
                      const dm = deptMeta(t.department);
                      return (
                        <div
                          key={t._id}
                          className="row gap-3"
                          style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                          onClick={() => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`)}
                        >
                          <CheckCircle2 size={15} style={{ color: 'var(--aw-green)', flexShrink: 0 }} />
                          <div className="col grow" style={{ minWidth: 0 }}>
                            <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                            <span className="tiny muted">{t.code}</span>
                          </div>
                          {t.department && <Badge color={dm.color}>{dm.label}</Badge>}
                          {t.assignee?.name && (
                            <div className="row gap-2" style={{ alignItems: 'center', flexShrink: 0 }}>
                              <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={22} />
                              <span className="tiny muted">{t.assignee.name}</span>
                            </div>
                          )}
                          <span className="tiny muted" style={{ flexShrink: 0 }}>{t.approvedAt ? fmtDate(t.approvedAt) : '—'}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>

              {/* Requests table + Current Approval / Timeline sidebar */}
              <div className="row gap-3" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 520px', minWidth: 320 }}>
                  {allRecords.length > 0 && (
                    <div className="filter-toolbar" style={{ marginBottom: 12 }}>
                      <div className="filter-search">
                        <Search size={14} className="muted" />
                        <input value={f.search} onChange={setField('search')} placeholder="Search requests by stage, ID…" />
                      </div>
                      <FilterBox label="Stage" icon={ChevronDown}>
                        <select value={f.stage} onChange={setField('stage')}>
                          <option value="">All</option>
                          {assessmentTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                      </FilterBox>
                      <FilterBox label="Status" icon={ChevronDown}>
                        <select value={f.status} onChange={setField('status')}>
                          <option value="">All</option>
                          <option value="draft">Draft</option>
                          <option value="submitted">Under Review</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </FilterBox>
                      <FilterBox label="Priority" icon={ChevronDown}>
                        <select value={f.priority} onChange={setField('priority')}>
                          <option value="">All</option>
                          {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                        </select>
                      </FilterBox>
                      <FilterBox label="Department" icon={ChevronDown}>
                        <select value={f.department} onChange={setField('department')}>
                          <option value="">All</option>
                          {[...new Set(Object.values(PIPELINE_META).map((m) => m.department).filter(Boolean))].map((d) => (
                            <option key={d} value={d}>{deptMeta(d).label}</option>
                          ))}
                        </select>
                      </FilterBox>
                      <FilterBox label="Due Date" icon={CalendarDays}>
                        <input type="date" value={f.dueBefore} onChange={setField('dueBefore')} />
                      </FilterBox>
                      <button type="button" className="btn btn-subtle btn-sm" onClick={() => exportApprovalsCsv(visibleRecords, project.code)}>
                        <Download size={14} style={{ marginRight: 6 }} /> Export
                      </button>
                    </div>
                  )}

                  <SectionCard title={`All Approval Requests (${visibleRecords.length})`} subtitle={`${allRecords.length} requests filed in total`}>
                    {allRecords.length === 0 ? (
                      <EmptyState icon={ClipboardList} title="No approval requests filed yet" hint="Use Take Action on the Current Approval card to file the first request." />
                    ) : visibleRecords.length === 0 ? (
                      <EmptyState title="No requests match these filters" hint="Try clearing a filter." />
                    ) : (
                      <div className="col gap-2">
                        <div className="aw-table-scroll" style={{ overflowX: 'auto' }}>
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Request ID</th><th>Stage</th><th>Department</th><th>Requested By</th>
                                <th>Requested On</th><th>Due Date</th><th>Status</th><th>Priority</th><th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedRecords.map((r) => {
                                const smeta = MODULE_STATUS_META[r._statusKey] || MODULE_STATUS_META.pending;
                                const pmeta = priorityMeta(r);
                                const dLeft = r._dueDate ? Math.ceil((r._dueDate - new Date()) / 86400000) : null;
                                return (
                                  <tr
                                    key={r._id}
                                    onClick={() => setSelectedRecordId(r._id)}
                                    style={{ cursor: 'pointer', background: String(selectedRecordId) === String(r._id) ? 'var(--surface-hover)' : undefined }}
                                  >
                                    <td className="sm" style={{ fontWeight: 600 }}>{requestCode(r)}</td>
                                    <td><Badge color={smeta.color} soft={smeta.soft}>{r._typeName}</Badge></td>
                                    <td><Badge color={r._deptColor}>{r._deptLabel}</Badge></td>
                                    <td>
                                      {r.submittedBy?.name ? (
                                        <div className="row gap-2" style={{ alignItems: 'center' }}>
                                          <Avatar name={r.submittedBy.name} color={r.submittedBy.avatarColor} size={24} />
                                          <span className="sm">{r.submittedBy.name}</span>
                                        </div>
                                      ) : <span className="tiny muted">—</span>}
                                    </td>
                                    <td className="sm">{r.submittedAt ? fmtDate(r.submittedAt) : '—'}</td>
                                    <td>
                                      <div className="col">
                                        <span className="sm">{r._dueDate ? fmtDate(r._dueDate) : '—'}</span>
                                        {dLeft != null && r.status !== 'approved' && (
                                          <span className="tiny" style={{ color: dLeft < 0 ? 'var(--aw-red)' : dLeft <= 2 ? 'var(--aw-orange)' : 'var(--aw-green)' }}>
                                            {dLeft < 0 ? `${Math.abs(dLeft)} day${Math.abs(dLeft) === 1 ? '' : 's'} left` : dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft === 1 ? '' : 's'} left`}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td><Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge></td>
                                    <td><Badge color={pmeta.color} soft={pmeta.soft}>{pmeta.label}</Badge></td>
                                    <td onClick={(e) => e.stopPropagation()}>
                                      <RowActionsMenu
                                        onView={() => openView(r)}
                                        onApprove={canDecide && r.status === 'submitted' ? () => doApprove(r) : null}
                                        onReject={canDecide && r.status === 'submitted' ? () => openReject(r) : null}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {pageCount > 1 && (
                          <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="tiny muted">
                              Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, visibleRecords.length)} of {visibleRecords.length}
                            </span>
                            <div className="row gap-2" style={{ alignItems: 'center' }}>
                              <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                                <button key={p} className={`btn btn-icon btn-sm ${p === currentPage ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPage(p)}>{p}</button>
                              ))}
                              <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </SectionCard>
                </div>

                <div style={{ flex: '1 1 300px', minWidth: 280 }} className="col gap-3">
                  <SectionCard title="Current Approval" action={currentStep && <Badge color={MODULE_STATUS_META[currentStep.statusKey]?.color} soft={MODULE_STATUS_META[currentStep.statusKey]?.soft} dot>{MODULE_STATUS_META[currentStep.statusKey]?.label}</Badge>}>
                    {!currentStep ? (
                      <EmptyState title="No stages configured" />
                    ) : (
                      <div className="col gap-3">
                        <div className="row gap-2" style={{ alignItems: 'center' }}>
                          <div className="list-row-icon" style={{ width: 32, height: 32, background: 'var(--aw-purple-soft)', color: 'var(--aw-purple)' }}>
                            {(() => { const StageIcon = STAGE_ICONS[currentStep.type.key] || ClipboardList; return <StageIcon size={16} />; })()}
                          </div>
                          <div className="col">
                            <span className="sm" style={{ fontWeight: 650 }}>{currentStep.type.name}</span>
                            <span className="tiny muted">Stage {currentStepIndex === -1 ? steps.length : currentStepIndex + 1} of {steps.length}</span>
                          </div>
                        </div>
                        <div className="col gap-1">
                          <span className="tiny subtle upper">Assigned To</span>
                          {currentApprover ? (
                            <div className="row gap-2" style={{ alignItems: 'center' }}>
                              <Avatar name={currentApprover.name} color={currentApprover.avatarColor} size={28} />
                              <div className="col">
                                <span className="sm" style={{ fontWeight: 600 }}>{currentApprover.name}</span>
                                {currentApprover.title && <span className="tiny muted">{currentApprover.title}</span>}
                              </div>
                            </div>
                          ) : <span className="sm muted">Unassigned</span>}
                        </div>
                        <div className="col gap-1">
                          <span className="tiny subtle upper">Due Date</span>
                          <span className="sm row gap-1" style={{ alignItems: 'center' }}>
                            <CalendarDays size={13} className="muted" /> {currentDueDate ? fmtDate(currentDueDate) : '—'}
                          </span>
                          {currentDueDate && currentStep.statusKey !== 'approved' && (() => {
                            const dLeft = Math.ceil((currentDueDate - new Date()) / 86400000);
                            return (
                              <span className="tiny" style={{ color: dLeft < 0 ? 'var(--aw-red)' : dLeft <= 2 ? 'var(--aw-orange)' : 'var(--aw-green)', fontWeight: 600 }}>
                                {dLeft < 0 ? `Overdue by ${Math.abs(dLeft)} day${Math.abs(dLeft) === 1 ? '' : 's'}` : dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft === 1 ? '' : 's'} left`}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="row gap-2">
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!currentStep.record} onClick={() => currentStep.record && openView(currentStep.record)}>View Details</button>
                          <button type="button" className="btn btn-primary btn-sm" onClick={takeAction}>
                            {!currentStep.record ? <><PlayCircle size={14} style={{ marginRight: 4 }} />Start Request</> : 'Take Action'}
                          </button>
                        </div>
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Approval Timeline" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedRecordId(null)}>View All</button>}>
                    <div className="pc-timeline">
                      {steps.map((step, i) => {
                        const smeta = MODULE_STATUS_META[step.statusKey] || MODULE_STATUS_META.pending;
                        const approver = findApprover(users, step.type.key);
                        const dueDate = computeDueDate(step.record, slaDays);
                        const Icon = step.statusKey === 'approved' ? CheckCircle2 : step.statusKey === 'rejected' ? XCircle : step.statusKey === 'in_review' ? Clock : null;
                        let sub = 'Pending';
                        if (step.statusKey === 'approved') sub = `Approved by ${step.record?.decidedBy?.name || step.record?.approvedBy?.name || 'Reviewer'} · ${fmtDate(step.record?.approvedAt)}`;
                        else if (step.statusKey === 'rejected') sub = `Rejected by ${step.record?.decidedBy?.name || step.record?.rejectedBy?.name || 'Reviewer'} · ${fmtDate(step.record?.rejectedAt)}`;
                        else if (step.statusKey === 'in_review') sub = `In Progress by ${approver?.name || 'Unassigned'}${dueDate ? ` · Due ${fmtDate(dueDate)}` : ''}`;
                        return (
                          <div key={step.type.key} className="pc-timeline-item">
                            <div className="pc-timeline-rail">
                              <span className="pc-timeline-icon" style={{ color: smeta.color, background: step.statusKey === 'pending' ? 'var(--surface-2)' : `${smeta.color}1A`, fontSize: 12, fontWeight: 700 }}>
                                {Icon ? <Icon size={14} /> : i + 1}
                              </span>
                              {i < steps.length - 1 && <span className="pc-timeline-rail-line" />}
                            </div>
                            <div className="pc-timeline-body">
                              <div className="sm" style={{ fontWeight: 600 }}>{step.type.name}</div>
                              <div className="tiny muted">{sub}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </div>
              </div>

              {/* Request Details / Comments & Notes / Approval Summary */}
              <div className="row gap-3" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <SectionCard title="Request Details">
                    {!selectedRecord ? (
                      <EmptyState title="Nothing selected" hint="Pick a row from All Approval Requests, or file the current stage's request." />
                    ) : (
                      <div className="col gap-3">
                        <div className="row gap-4 wrap">
                          <InfoTile label="Request ID" value={requestCode(selectedRecord)} />
                          <InfoTile label="Priority" value={priorityMeta(selectedRecord).label} tone={priorityMeta(selectedRecord).color} />
                          <InfoTile label="Requested On" value={fmtDateTime(selectedRecord.submittedAt || selectedRecord.createdAt)} />
                          <InfoTile label="Stage" value={selectedType?.name} />
                        </div>
                        <div className="col gap-1">
                          <span className="tiny subtle upper">Description</span>
                          <span className="sm">{selectedRecord.values?.description || '—'}</span>
                        </div>
                        <div className="col gap-1">
                          <span className="tiny subtle upper">Attachments</span>
                          {selectedRecord.attachments?.length ? (
                            <div className="col gap-1">
                              {selectedRecord.attachments.map((att) => (
                                <a
                                  key={att._id}
                                  href={att.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="sm row gap-2"
                                  style={{ alignItems: 'center', color: 'var(--text)' }}
                                >
                                  <Paperclip size={13} style={{ color: 'var(--aw-blue)', flexShrink: 0 }} />
                                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{att.name || 'Attachment'}</span>
                                  <Download size={13} className="muted" style={{ flexShrink: 0 }} />
                                </a>
                              ))}
                            </div>
                          ) : <span className="sm muted">No attachments</span>}
                        </div>
                      </div>
                    )}
                  </SectionCard>
                </div>

                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <CommentsPanel record={selectedRecord} onAdd={(body) => addComment.mutate({ id: selectedRecord._id, body })} pending={addComment.isPending} />
                </div>

                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <SectionCard title="Approval Summary">
                    {assessmentTypes.length === 0 ? (
                      <EmptyState title="No approval stages yet" />
                    ) : (
                      <>
                        <DonutChart data={donutData} height={180} innerRadius={50} outerRadius={72} centerLabel={{ value: assessmentTypes.length, label: 'Approvals' }} />
                        <div className="col gap-2" style={{ marginTop: 8 }}>
                          {donutData.map((d) => (
                            <div key={d.name} className="row gap-2" style={{ alignItems: 'center' }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                              <span className="sm grow">{d.name}</span>
                              <span className="sm muted">{d.value} ({Math.round((d.value / assessmentTypes.length) * 100)}%)</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </SectionCard>
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
          submitLabel="Submit Request"
          saving={activeForm.record ? updateRecord.isPending : createRecord.isPending}
          loading={templateLoading}
          readOnly={activeForm.readOnly}
          meta={activeForm.readOnly ? buildRecordMeta(activeForm.record, allRecords, activeForm.type.name) : null}
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
        placeholder="Why is this request being rejected?"
      />
    </>
  );
}

/** One compact filter control — small label and value sharing a single bordered box (matches ExecutionPage's FilterBox). */
function FilterBox({ label, icon: Icon, children }) {
  return (
    <div className="filter-box">
      <span className="filter-box-label">{label}</span>
      <div className="filter-box-value">
        {children}
        <Icon size={13} />
      </div>
      {cloneElement(children, { className: 'filter-box-overlay', tabIndex: -1, 'aria-hidden': true })}
    </div>
  );
}

/** Per-row "…" actions menu — View always, Approve/Reject only when offered (canDecide + still Submitted). Same click-outside pattern as DepartmentTasksPage's RowActionsMenu. */
function RowActionsMenu({ onView, onApprove, onReject }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-subtle btn-icon btn-sm" onClick={() => setOpen((o) => !o)} title="Actions">
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, minWidth: 160, padding: 6, boxShadow: 'var(--shadow-2)' }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); onView(); }}>
            <Eye size={14} style={{ marginRight: 6 }} /> View Details
          </button>
          {onApprove && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--aw-green)' }} onClick={() => { setOpen(false); onApprove(); }}>
              <CheckCircle2 size={14} style={{ marginRight: 6 }} /> Approve
            </button>
          )}
          {onReject && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--aw-red)' }} onClick={() => { setOpen(false); onReject(); }}>
              <XCircle size={14} style={{ marginRight: 6 }} /> Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Comment feed + add-comment box for the selected approval request. */
function CommentsPanel({ record, onAdd, pending }) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onAdd(body);
    setDraft('');
  };
  return (
    <SectionCard title="Comments & Notes">
      {!record ? (
        <EmptyState title="Nothing selected" hint="Comments become available once a request is selected." />
      ) : (
        <div className="col gap-3">
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Add a comment…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn-primary btn-icon" disabled={!draft.trim() || pending} onClick={submit} title="Send">
              <Send size={15} />
            </button>
          </div>
          <div className="col gap-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {record.comments?.length ? [...record.comments].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map((c) => (
              <div key={c._id} className="row gap-2" style={{ alignItems: 'flex-start' }}>
                <Avatar name={c.author?.name} color={c.author?.avatarColor} size={28} />
                <div className="col gap-1" style={{ minWidth: 0 }}>
                  <div className="row gap-2" style={{ alignItems: 'baseline' }}>
                    <span className="sm" style={{ fontWeight: 650 }}>{c.author?.name || 'Someone'}</span>
                    {c.author?.title && <span className="tiny muted">{c.author.title}</span>}
                    <span className="tiny subtle">{fromNow(c.createdAt)}</span>
                  </div>
                  <span className="sm" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</span>
                </div>
              </div>
            )) : <span className="sm muted">No comments yet</span>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export default PropertyApprovalPipeline;
