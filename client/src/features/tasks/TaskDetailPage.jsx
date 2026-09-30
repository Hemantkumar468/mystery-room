import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Upload, Trash2, Paperclip, Image as ImageIcon, AlertTriangle, Ban, CheckCircle2, Clock,
  MessageCircle, Video, Pencil, Send, XCircle, Lock, RotateCcw, ShieldAlert,
  TrendingUp, ListChecks, CalendarClock, Link2, FileCheck2, PlayCircle, MapPin,
  Link2 as LinkIcon, ExternalLink, Plus, X, HelpCircle, Flame,
} from 'lucide-react';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { can } from '../../lib/roles.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useUsers } from '../../app/api/usersApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { formNameOf } from '../guide/taskGuide.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import {
  useUpdateTask, useTaskByCode, useTasks, useUploadTaskAttachment, useDeleteTaskAttachment,
  useAddTaskComment, useAddTaskUpdate,
  useSubmitTaskForApproval, useTaskDecision,
  useAddTaskLinkMutation, useDeleteTaskLinkMutation,
} from '../../app/api/tasksApi.js';
import {
  TASK_STATUS_META, TASK_APPROVAL_META, TASK_STATUS_SELECTABLE, LEGAL_TASK_TRANSITIONS, PRIORITY_META, deptMeta,
  canApprove, canManagementApprove, canWorkOnTask, isOwnTaskWork,
  isTaskOpen, isApprovedTask, isReworkTask, isWaitingDept,
} from '../../lib/ui.js';
import {
  fmtDate, fmtDateTime, fmtFileSize, fmtDuration, daysUntil, fmtNumber, fmtCurrency,
} from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { TaskBrief } from '../../components/ui/TaskBrief.jsx';
import { TaskFocusCard } from './TaskFocusCard.jsx';
import { TaskSubmissionPanel } from './TaskSubmissionPanel.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import {
  isImage, isVideo, fileMeta, toDateInput, AttachmentRow, VideoCard, CommentsThread, ActivityLog,
} from './taskDetailShared.jsx';
import { PropertyCaptureModal } from '../property/PropertyCaptureModal.jsx';
import { PropertyDetailsModal } from '../property/PropertyDetailsModal.jsx';
import { useStageRecords } from '../../app/api/recordsApi.js';

/** Real horizontal status stepper — only steps/dates the schema actually
 * tracks (createdAt/actualStart/actualEnd/submittedForApprovalAt/approvedAt).
 * Mirrors the real approval pipeline (Assigned → In Progress → Completed →
 * Waiting Approval → Approved), not just the old 4-step work-status flow —
 * so clicking Submit For Approval / Approve visibly advances this. `review`
 * is legacy and folded into the "In Progress" position; Blocked/Rejected are
 * exception states (shown via their own banners above) rather than steps of
 * their own, so they hold at "In Progress" here too. */
/**
 * The task's current status, plus every status it may legally move to.
 *
 * Options come from `LEGAL_TASK_TRANSITIONS`, the same map the server enforces
 * in `task.service.js#update`, so a button is only ever offered for a move that
 * will actually succeed. The approval-tier statuses are deliberately absent —
 * they are reached through the approval pipeline, never a direct status write,
 * and offering them here would produce a guaranteed 400.
 */
function StatusControl({ task, canWork, pending, onChange }) {
  const meta = TASK_STATUS_META[task.status] || { label: task.status, color: 'var(--text-subtle)' };
  const moves = LEGAL_TASK_TRANSITIONS[task.status] || [];

  return (
    <div className="col gap-2" data-guide="task-status">
      <span className="label" style={{ marginBottom: 0 }}>Status</span>
      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>

        {moves.length > 0 && <span className="tiny muted">move to</span>}

        {moves.map((next) => {
          const m = TASK_STATUS_META[next] || { label: next, color: 'var(--text-subtle)' };
          return (
            <button
              key={next}
              type="button"
              className="btn btn-subtle btn-sm"
              disabled={!canWork || pending}
              title={!canWork ? 'Only the assigned doer or a manager can change this' : `Move to ${m.label}`}
              onClick={() => onChange(next)}
              style={{ color: m.color }}
            >
              {m.label}
            </button>
          );
        })}

        {/* Terminal or pipeline-owned states have no legal direct move; saying
            so beats an empty row the reader has to interpret. */}
        {moves.length === 0 && (
          <span className="tiny muted">
            {task.status === 'approved'
              ? 'Approved and locked — no further changes.'
              : 'Waiting on approval — the reviewer moves it from here.'}
          </span>
        )}
      </div>
    </div>
  );
}

function ProgressTimeline({ task }) {
  /* Two axes, drawn as one line. The first three steps are the task's own
     three states; the last two are its sign-off, which lives on
     `approvalState` and is not a status any more. Reading them off one field,
     as this did, put every migrated task at step -1. */
  const STEPS = [
    { key: 'pending', label: 'Assigned', dateKey: 'createdAt' },
    { key: 'processing', label: 'Work In Progress', dateKey: 'actualStart' },
    { key: 'complete', label: 'Completed', dateKey: 'actualEnd' },
    { key: 'waiting_department', label: 'Waiting Approval', dateKey: 'submittedForApprovalAt' },
    { key: 'approved', label: 'Approved', dateKey: 'approvedAt' },
  ];
  const ORDER = STEPS.map((s) => s.key);
  const approval = task.approvalState || 'none';
  /* Sent back for rework reads as work in progress, which is what it is. */
  const here = approval === 'approved' ? 'approved'
    : approval === 'waiting_management' ? 'waiting_department'
      : approval === 'waiting_department' ? 'waiting_department'
        : approval === 'rejected' ? 'processing'
          : task.status;
  const currentIdx = ORDER.indexOf(here);

  return (
    <div className="row ptl-track" style={{ alignItems: 'flex-start' }}>
      {STEPS.map((step, i) => {
        const idx = ORDER.indexOf(step.key);
        const reached = currentIdx >= idx;
        const isCurrent = currentIdx === idx;
        const date = step.dateKey ? task[step.dateKey] : null;
        return (
          <div key={step.key} className="col" style={{ flex: 1, alignItems: 'center', textAlign: 'center', minWidth: 88 }}>
            <div className="row" style={{ width: '100%', alignItems: 'center' }}>
              <div style={{ flex: i === 0 ? '0 0 0' : 1, height: 2, background: (reached && i !== 0) ? 'var(--success)' : 'var(--border)' }} />
              <div style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                background: reached ? 'var(--success)' : 'var(--surface-hover)',
                color: reached ? '#fff' : 'var(--text-subtle)',
                boxShadow: isCurrent ? '0 0 0 3px var(--primary)33' : 'none',
              }}
              >
                {reached && !isCurrent ? <CheckCircle2 size={13} /> : <span style={{ fontSize: 10, fontWeight: 700 }}>{i + 1}</span>}
              </div>
              <div style={{ flex: i === STEPS.length - 1 ? '0 0 0' : 1, height: 2, background: currentIdx > idx ? 'var(--success)' : 'var(--border)' }} />
            </div>
            <span className="tiny" style={{ fontWeight: isCurrent ? 700 : 600, color: isCurrent ? 'var(--primary)' : 'var(--text-muted)', marginTop: 4 }}>{step.label}</span>
            {date && <span className="tiny muted">{fmtDate(date)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** One cell of the Department / Priority / Start Date / Due Date info strip. */
function InfoStripCell({ label, value, valueColor, sub, subColor, last }) {
  return (
    <div className="col gap-1" style={{ flex: '1 1 0', minWidth: 110, padding: '10px 14px', borderRight: last ? 'none' : '1px solid var(--border)' }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: valueColor || 'var(--text)' }}>{value ?? '—'}</span>
      {sub && <span className="tiny" style={{ color: subColor || valueColor, fontWeight: 600 }}>{sub}</span>}
    </div>
  );
}

/** One column of the Overview tab's Recent Updates / Attachments / Videos preview strip. */
function PreviewCol({ title, count, onViewAll, empty, children }) {
  return (
    <div className="col gap-2" style={{ flex: '1 1 0', minWidth: 160 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="label" style={{ marginBottom: 0 }}>{title}{count != null ? ` (${count})` : ''}</span>
        {onViewAll && count > 0 && (
          <button type="button" onClick={onViewAll} className="tiny" style={{ color: 'var(--primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            View All
          </button>
        )}
      </div>
      {count === 0 ? <span className="tiny muted">{empty}</span> : <div className="col gap-2">{children}</div>}
    </div>
  );
}

/** Host of a URL, for the second line of a link row. Falls back to the raw
 *  string rather than throwing on anything unparseable. */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www./, '');
  } catch {
    return url;
  }
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'updates', label: 'Updates' },
  { key: 'attachments', label: 'Attachments' },
  // A reference URL rather than an upload — a drawing set, a Drive folder.
  // Sits beside Attachments because it answers the same question.
  { key: 'links', label: 'Links' },
  { key: 'images', label: 'Images' },
  { key: 'videos', label: 'Videos' },
  { key: 'comments', label: 'Comments' },
  { key: 'activity', label: 'Activity' },
];

/**
 * Task Detail — its own page (not a drawer/modal), so a task can be opened,
 * bookmarked, and shared as a real URL: /projects/:id/tasks/:code — the human
 * -readable task code (e.g. MR-BHO-001-T052), not the raw Mongo id. Tabbed:
 * Overview / Updates / Attachments / Images / Videos / Comments / Activity.
 * `allTasks` (the project's full task list) resolves each dependency's live
 * status without an extra fetch. `departments` feeds the Edit Task department
 * picker — same options list Department Planning's Allocate Task uses.
 */
/**
 * Stages whose forms complete their own task on submit — see
 * completeTaskForForm, which fires for any record with a parent and an
 * assessment type. p2 is the four site evaluations, p3 the six closure
 * documents. p1 capture is not here because it deliberately does NOT
 * self-close: a hunt is several properties and only the doer knows when it
 * is done.
 */
const SELF_CLOSING_STAGES = new Set(['p2', 'p3']);

export function TaskDetailPage() {
  const { id, code } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Department Planning only allocates tasks — it isn't where department/
  // management sign-off happens (that's Execution and Approval Workflow's
  // job), so a task opened from its "Allocated Tasks" drill-down
  // (DepartmentTasksPage.jsx) shows status as read-only, never an Approve/
  // Reject action, regardless of the viewer's role.
  const fromDepartmentPlanning = new URLSearchParams(location.search).get('from') === 'department-planning';
  // Execution's job is doing the work and marking it complete — the
  // department/management sign-off itself belongs to Approval Workflow, the
  // next phase. So a task opened from Execution's own task list never shows
  // an Approve/Reject action either, just its real status (including the
  // informational "waiting on approval" text) — only Approval Workflow's
  // entry point leaves the actual decision buttons enabled.
  const fromExecution = new URLSearchParams(location.search).get('from') === 'execution';
  const hideApprovalActions = fromDepartmentPlanning || fromExecution;

  const { data: t, isLoading, isError: taskError, refetch: refetchTask } = useTaskByCode(code);
  const { data: project, isError: projectError, refetch: refetchProject } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const departments = (template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [])
    .map((dt) => ({ key: dt.key, name: dt.name, subtitle: dt.subtitle }));
  const { data: tasksResp } = useTasks({ project: id, limit: 500 });
  const allTasks = tasksResp?.data || tasksResp || [];

  const update = useUpdateTask(id);
  const users = useUsers();
  const upload = useUploadTaskAttachment(id);
  const [linkDraft, setLinkDraft] = useState({ label: '', url: '' });
  const [addLink, addingLink] = useAddTaskLinkMutation();
  const [removeLink, removingLink] = useDeleteTaskLinkMutation();
  const removeAttachment = useDeleteTaskAttachment(id);
  const addComment = useAddTaskComment(id);
  const addUpdate = useAddTaskUpdate(id);
  const submitApproval = useSubmitTaskForApproval(id);
  const decide = useTaskDecision(id);
  const { data: activity } = useProjectActivity(id);
  const currentUser = useAppSelector(selectCurrentUser);
  const fileRef = useRef(null);

  const [tab, setTab] = useState('overview');

  /**
   * "Mark as Complete" over an unticked checklist WARNS and then proceeds.
   *
   * It used to stop: the click walked the person to the checklist, lit up the
   * items in the way, and went no further, with the server refusing the call
   * too (CHECKLIST_INCOMPLETE). Pointing at the unticked boxes is genuinely
   * useful — it answers "what am I missing?" — but it is an answer, not a
   * verdict, and the doer is the one who knows whether an item still applies.
   *
   * So the dialog offers both: Complete Task Anyway sends it, Go Back returns
   * to the checklist with the pending items highlighted. `checklistNudge` now
   * only drives that highlight; it no longer gates anything.
   */
  const checklistRef = useRef(null);
  const [checklistNudge, setChecklistNudge] = useState(false);
  /** Non-null while the warning dialog is up — the items it is warning about. */
  const [pendingConfirm, setPendingConfirm] = useState(null);
  /** Why the checklist is lit: 'complete' (Go Back from the warning) or
   *  'submitted' (a form was just filed for this task) — the note differs. */
  const [nudgeReason, setNudgeReason] = useState('complete');
  /** Light up the unticked items and bring them into view — nothing if all ticked. */
  const pointAtChecklist = (reason, items) => {
    if (!(items || []).some((c) => !c.done)) return;
    setNudgeReason(reason);
    setTab('overview');
    setChecklistNudge(true);
    // After the Overview has rendered and the checklist has taken its column.
    setTimeout(() => checklistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  };
  /* Arriving from the "Tick the checklist" toast after submitting a form on a
     phase page (app/api/checklistReminder.js): highlight, then drop the flag so
     a reload does not light it up again. Other query params are kept. */
  useEffect(() => {
    if (!t?._id) return;
    const params = new URLSearchParams(location.search);
    if (params.get('checklist') !== '1') return;
    params.delete('checklist');
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : '' }, { replace: true, state: location.state });
    pointAtChecklist('submitted', t.checklist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?._id, location.search]);
  const [checklist, setChecklist] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const [uploadErr, setUploadErr] = useState('');
  const [updateErr, setUpdateErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [updateDraft, setUpdateDraft] = useState({ body: '', photos: [] });
  const [updatePct, setUpdatePct] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approving, setApproving] = useState(false);
  const [signatureInput, setSignatureInput] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);

  /**
   * IS THIS A PROPERTY CAPTURE TASK?
   *
   * Phase 1 capture tasks have no `appPath` (they are not form-linked), sit on
   * stageKey `p1`, and their title or template key says "capture". The button
   * says "Property Capture" and opens the same PropertyCaptureModal the
   * Properties queue uses, pre-set to the task's own project. After the doer
   * files one or more properties, CaptureTaskDone asks the real question:
   * another, or finished?
   */
  const isCapture = Boolean(
    t && !t.appPath && t.stageKey === 'p1'
    && /captur/i.test(`${t.templateTaskKey || ''} ${t.title || ''}`)
  );

  /* Which captured property is being read in full — see PropertyDetailsModal. */
  const [readingProperty, setReadingProperty] = useState(null);

  /** Properties captured on this project's Phase 1 capture form — shown below the card. */
  const { data: capturedRecords, isFetching: capturedLoading } = useStageRecords(
    id,
    'p1',
    {},
    { enabled: isCapture && Boolean(id) },
  );
  const capturedRows = useMemo(() => {
    const list = Array.isArray(capturedRecords) ? capturedRecords : [];
    return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }, [capturedRecords]);

  const byId = useMemo(() => {
    const m = new Map();
    for (const x of allTasks) m.set(String(x._id), x);
    return m;
  }, [allTasks]);

  useEffect(() => {
    setChecklist(t?.checklist?.map((c) => ({ ...c })) || []);
  }, [t?._id, t?.checklist?.length]);

  const { goBack } = useGoBack('/my-tasks');

  if (isLoading || (!project && !projectError)) {
    return (<><Topbar title="Task Detail" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (taskError || projectError) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={goBack}><ArrowLeft size={16} /></button>Task Detail</span>} />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><AlertTriangle size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Couldn’t load this task</span>
                <span className="sm muted">The task service didn’t respond. Please try again.</span>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => { refetchTask(); refetchProject(); }}><RotateCcw size={15} style={{ marginRight: 6 }} /> Retry</button>
            </div>
          </div>
        </div>
      </>
    );
  }
  if (!t) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={goBack}><ArrowLeft size={16} /></button>Task Detail</span>} />
        <div className="content">
          <EmptyState title="Task not found" hint="It may have been deleted, or the link is stale." />
        </div>
      </>
    );
  }

  const patch = (body) => update.mutate({ id: t._id, ...body });
  const patchAsync = (body) => update.mutateAsync({ id: t._id, ...body });

  const toggleCheck = (idx) => {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    setChecklist(next);
    patch({ checklist: next.map(({ label, done, required }) => ({ label, done, required })) });
  };

  const doneCount = checklist.filter((c) => c.done).length;
  const progress = checklist.length ? Math.round((doneCount / checklist.length) * 100) : (t.status === 'done' ? 100 : 0);

  const dLeft = t.plannedEnd ? daysUntil(t.plannedEnd) : null;
  const overdue = isTaskOpen(t) && dLeft != null && dLeft < 0;
  /* No task can be blocked since the three-state migration. */
  const blocked = false;
  const isAdmin = can.administer(currentUser?.role);
  const locked = isApprovedTask(t) && !isAdmin;
  // Mirrors the server's own doer-or-manager rule (task.service.js#update),
  // so read-only viewers see a disabled control instead of a 403 on click.
  const canWork = canWorkOnTask(currentUser, t);
  // Role/department eligibility alone isn't enough — the server also
  // enforces separation of duties (task.service.js#decide's isOwnWork
  // guard), so an eligible Admin/Manager who is themself the assignee or
  // submitter of THIS task is still blocked from deciding it.
  const selfWorkDept = isOwnTaskWork(currentUser, t, 'department');
  const selfWorkMgmt = isOwnTaskWork(currentUser, t, 'management');
  const canDecide = !hideApprovalActions && canApprove(currentUser, t) && !selfWorkDept;
  const canMgmtDecide = !hideApprovalActions && canManagementApprove(currentUser) && !selfWorkMgmt;
  // Go-Live Checklist (Phase 9) approvals require a typed-name confirmation
  // at both tiers — see task.service.js#decide's stageKey==='p9' guard.
  // Every other phase keeps today's one-click Approve unchanged.
  const requiresSignature = t.stageKey === 'p9';
  // Execution's job is doing the work, not tracking the approval pipeline
  // that follows — so within that context every status collapses to just
  // "Executed" (work is done, in whatever stage of sign-off) or "Pending".
  const executed = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'].includes(t.status);

  const deps = (t.dependencies || []).map((d) => {
    const full = byId.get(String(d._id || d));
    return { _id: String(d._id || d), code: d.code || full?.code, title: d.title || full?.title, status: full?.status };
  });
  const blockingDeps = deps.filter((d) => d.status && d.status !== 'done');

  const links = t.links || [];
  const attachments = t.attachments || [];
  const images = attachments.filter(isImage);
  const videos = attachments.filter((a) => !isImage(a) && isVideo(a));
  const files = attachments.filter((a) => !isImage(a) && !isVideo(a));
  const comments = t.comments || [];
  const updates = [...comments.filter((c) => c.kind === 'update')].reverse();
  const plainComments = [...comments.filter((c) => c.kind !== 'update')].reverse();
  const taskActivity = (activity || []).filter((a) => a.entityType === 'task' && String(a.entityId) === String(t._id));

  /* Approval wins over the work state wherever it has something to say —
     the same rule TaskFocusCard and My Tasks' JourneyBadge use. The topbar
     used to print "Complete" on a task that was sitting in an approver's
     queue, contradicting the card six inches below it. */
  const st = (t.approvalState && t.approvalState !== 'none' && TASK_APPROVAL_META[t.approvalState])
    ? TASK_APPROVAL_META[t.approvalState]
    : (TASK_STATUS_META[t.status] || {});
  const pr = PRIORITY_META[t.priority] || {};
  // Character count rather than measuring the rendered box: the header also
  // carries a back button and up to three badges, so the point at which the
  // title wraps past two lines moves around. ~90 characters is comfortably
  // past a normal one-line title and well short of the two-line clamp, so the
  // toggle appears only for titles that are genuinely long.
  const dm = deptMeta(t.department);

  /* What this task is actually about, rather than which department owns it.
     A task that names one of its stage's modules (Site Evaluation's four
     assessments, Commercial Closure's LOI/lease/NOCs) shows that module under
     the template's own name for it.

     " assessment" is appended only where the phase itself calls them
     assessments, so p2 reads "Operational assessment" while p3's LOI does not
     become "LOI assessment". A task that owns no module keeps the department,
     which is all there is to say about it. */
  /* On a phone the header carries only the first word — "Operational" rather
     than "Operational assessment" — so the theme, bell and account controls
     fit on the same line instead of being pushed onto one of their own.
     Nothing is lost: the full name stays as the element's tooltip, and it
     reads in full as the heading of the card directly below. */

  /* WHO SIGNS THIS OFF — by name.

     The template's `approval.approver` is free text ("Department Manager"):
     it names a ROLE, so a doer waiting on approval still had no idea whom to
     chase. These are the real accounts, resolved from the same rule the
     server enforces:
       department tier  — MD/EA anywhere, or a Manager in the task's own
                          department            (task.service.js#canApprove)
       management tier  — MD/EA, or ANY Manager
                          (task.service.js#canManagementApprove)
     Mirrored from the server, never invented. If the two ever drift, the
     server still refuses the write, so the worst this can do is name one
     person too many on screen — never let the wrong person through. */
  const managementTier = t.status === 'waiting_management_approval';
  const approvers = (users.data || [])
    .filter((u) => u.isActive !== false)
    .filter((u) => {
      if (can.actForLeadership(u.role)) return true;
      if (u.role !== 'manager') return false;
      return managementTier ? true : Boolean(t.department && u.department === t.department);
    })
    /* The doer never signs off their own work — the same rule the page already
       states as "it needs a second person to sign off". */
    .filter((u) => String(u._id) !== String(t.assignee?._id || t.assignee || ""));

  /* Naming all of them is worse than naming none: this deployment resolves to
     eight people, five of whom are MDs. The department manager is who the
     doer actually chases, so they are named; leadership is the fallback and
     is summarised rather than listed. */
  const approverManagers = approvers.filter((u) => u.role === 'manager');
  const approverLeads = approvers.length - approverManagers.length;

  const formStage = template?.stages?.find((st) => st.key === t.stageKey);
  const formName = formNameOf(t.formKey, formStage);
  /* The stage's own name is not always the word. Phase 2 is called "Site
     Evaluation", so testing only for "assessment" left this at the bare
     "Operational" — which on a button reads as a missing word. The task's
     title carries it when the stage does not: "Do the Operational assessment
     — Taj Mahal". */
  const moduleLabel = formName && /assessment|evaluation/i.test(`${formStage?.name || ''} ${t.title || ''}`)
    ? `${formName} assessment`
    : formName;

  // Schedule variance is derived purely from the two real dates the schema
  // already tracks (plannedEnd vs. actualEnd) — only meaningful once the
  // task is actually done, so it's null (and hidden) until then.
  const scheduleVarianceDays = (t.actualEnd && t.plannedEnd)
    ? Math.round((new Date(t.actualEnd) - new Date(t.plannedEnd)) / 86400000)
    : null;
  const evidenceCount = attachments.length;

  // Execution's own "Execution Health" strip — every number here comes from
  // fields the Task schema actually stores; nothing here is estimated or
  // fabricated. Only rendered in the Execution context (?from=execution).
  const executionKpis = fromExecution ? [
    {
      key: 'progress', label: 'Execution Progress', value: progress, valueSuffix: '%',
      icon: TrendingUp, color: 'var(--primary)', soft: 'var(--primary-soft)',
    },
    {
      key: 'checklist', label: 'Checklist',
      value: checklist.length ? doneCount : null,
      valueSuffix: checklist.length ? ` / ${checklist.length}` : undefined,
      sub: checklist.length ? 'items complete' : 'No checklist items',
      icon: ListChecks, color: 'var(--info)', soft: 'var(--info-soft)',
    },
    {
      key: 'due', label: t.status === 'done' ? 'Completed On' : 'Due Date',
      value: t.status === 'done' ? null : (dLeft != null ? Math.abs(dLeft) : null),
      valueSuffix: isTaskOpen(t) && dLeft != null ? 'd' : undefined,
      sub: t.status === 'done'
        ? fmtDate(t.actualEnd)
        : (dLeft != null ? (dLeft < 0 ? 'overdue' : dLeft === 0 ? 'due today' : 'remaining') : 'No due date set'),
      subColor: isTaskOpen(t) && dLeft != null ? (dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)') : undefined,
      icon: CalendarClock,
      color: overdue ? 'var(--danger)' : 'var(--success)',
      soft: overdue ? 'var(--danger-soft)' : 'var(--success-soft)',
    },
    {
      key: 'variance', label: 'Schedule Variance',
      value: scheduleVarianceDays != null ? Math.abs(scheduleVarianceDays) : null,
      valueSuffix: scheduleVarianceDays != null ? 'd' : undefined,
      sub: scheduleVarianceDays == null ? 'Not completed yet'
        : scheduleVarianceDays < 0 ? 'ahead of schedule'
          : scheduleVarianceDays === 0 ? 'on schedule' : 'behind schedule',
      subColor: scheduleVarianceDays == null ? undefined : scheduleVarianceDays > 0 ? 'var(--danger)' : 'var(--success)',
      icon: TrendingUp, color: 'var(--warning)', soft: 'var(--warning-soft)',
    },
    {
      key: 'evidence', label: 'Evidence Files', value: evidenceCount,
      sub: evidenceCount ? `${images.length} photo${images.length === 1 ? '' : 's'} · ${videos.length} video${videos.length === 1 ? '' : 's'} · ${files.length} doc${files.length === 1 ? '' : 's'}` : 'None uploaded yet',
      icon: FileCheck2, color: 'var(--info)', soft: 'var(--info-soft)',
      onClick: () => setTab('attachments'),
    },
    {
      key: 'dependencies', label: 'Dependencies',
      value: deps.length ? blockingDeps.length : null,
      valueSuffix: deps.length ? ` / ${deps.length}` : undefined,
      sub: deps.length === 0 ? 'None' : blockingDeps.length > 0 ? 'blocking' : 'all clear',
      subColor: deps.length === 0 ? undefined : blockingDeps.length > 0 ? 'var(--warning)' : 'var(--success)',
      icon: Link2, color: 'var(--primary)', soft: 'var(--primary-soft)',
    },
  ] : [];

  const onPickFiles = async (e) => {
    const pickedFiles = [...e.target.files];
    e.target.value = '';
    if (!pickedFiles.length) return;
    setUploadErr('');
    for (const file of pickedFiles) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await upload.mutateAsync({ taskId: t._id, file, onProgress: setUploadPct });
      } catch (err) {
        setUploadErr(err?.response?.data?.message || `Couldn't upload "${file.name}".`);
      }
    }
    setUploadPct(null);
  };

  const onDeleteAttachment = (a) => {
    if (!window.confirm(`Delete "${a.originalName || 'this file'}"? This removes it from storage too.`)) return;
    removeAttachment.mutate({ taskId: t._id, attachmentId: a._id });
  };

  const startEdit = () => {
    setEditDraft({
      title: t.title || '',
      description: t.description || '',
      department: t.department || '',
      plannedStart: toDateInput(t.plannedStart),
      plannedEnd: toDateInput(t.plannedEnd),
      estimatedHours: t.estimatedHours || 0,
      status: t.status,
      priority: t.priority,
      assignee: t.assignee?._id || '',
    });
    setEditing(true);
    setTab('overview');
  };
  const saveEdit = () => {
    patch({
      title: editDraft.title,
      description: editDraft.description,
      department: editDraft.department || undefined,
      plannedStart: editDraft.plannedStart || undefined,
      plannedEnd: editDraft.plannedEnd || undefined,
      estimatedHours: Number(editDraft.estimatedHours) || 0,
      // Approval statuses (e.g. an Admin editing an Approved/locked task) aren't
      // selectable here — never send one back, the server would reject it anyway.
      status: TASK_STATUS_SELECTABLE.includes(editDraft.status) ? editDraft.status : undefined,
      priority: editDraft.priority,
      assignee: editDraft.assignee || null,
    });
    setEditing(false);
  };

  const postComment = () => {
    if (!commentDraft.trim()) return;
    addComment.mutate({ taskId: t._id, body: commentDraft.trim() }, { onSuccess: () => setCommentDraft('') });
  };

  const postUpdate = () => {
    if (!updateDraft.body.trim() && updateDraft.photos.length === 0) return;
    setUpdateErr('');
    addUpdate.mutate(
      { taskId: t._id, body: updateDraft.body.trim(), photos: updateDraft.photos, onProgress: setUpdatePct },
      {
        onSuccess: () => { setUpdateDraft({ body: '', photos: [] }); setUpdatePct(null); },
        onError: (err) => {
          setUpdatePct(null);
          setUpdateErr(err?.response?.data?.message || "Couldn't post this update — try again.");
        },
      },
    );
  };

  // Only reachable for a task that was already sitting at "done" before this
  // auto-submit behavior existed — marking a task Done now hands it straight
  // to department-manager approval server-side (see task.service.js#update's
  // autoSubmitting branch), so this is a one-time recovery path, not the
  // normal flow.
  const onSubmitForApproval = () => submitApproval.mutate(t._id, {
    onError: (err) => window.alert(err?.response?.data?.message || 'Could not submit this task for approval — try again.'),
  });
  const onApprove = () => {
    if (requiresSignature) { setApproving(true); setTab('overview'); return; }
    decide.mutate({ taskId: t._id, decision: 'approve' }, {
      onError: (err) => window.alert(err?.response?.data?.message || 'Could not approve this task — try again.'),
    });
  };
  const confirmApprove = () => {
    if (signatureInput.trim().toLowerCase() !== (currentUser?.name || '').trim().toLowerCase()) return;
    decide.mutate(
      { taskId: t._id, decision: 'approve', signature: signatureInput.trim() },
      {
        onSuccess: () => { setApproving(false); setSignatureInput(''); },
        onError: (err) => window.alert(err?.response?.data?.message || 'Could not approve this task — try again.'),
      },
    );
  };
  const openReject = () => { setRejecting(true); setTab('overview'); };
  const confirmReject = () => {
    if (!rejectReason.trim()) return;
    decide.mutate(
      { taskId: t._id, decision: 'reject', reason: rejectReason.trim() },
      {
        onSuccess: () => { setRejecting(false); setRejectReason(''); },
        onError: (err) => window.alert(err?.response?.data?.message || 'Could not reject this task — try again.'),
      },
    );
  };
  const resumeWork = () => patch({ status: 'processing' });
  /* Starting is ONE step and only that: it tells everyone the work has begun
     (pending → processing). It used to be "Start up and send for approval",
     which marked the task complete and sent it for sign-off in the same click —
     before anything had been filed. Submitting the work, completing the task
     and asking for approval each keep their own button. */
  const startTask = () => patch({ status: 'processing' });
  const pendingTaskCta = t.status === 'pending' ? {
    label: update.isPending ? 'Starting…' : 'Start Task',
    icon: <PlayCircle size={15} aria-hidden />,
    onClick: startTask,
    disabled: update.isPending || !canWork,
    guide: 'task-start',
  } : null;

  /**
   * THE ONE THING THIS TASK NEEDS NEXT, as a single button.
   *
   * Not started → start it. Under way → finish it. Anything else (waiting on
   * sign-off, already approved, rejected) is not the doer's move, so the slot
   * is empty rather than offering something that would be refused. Edit Task
   * stays in the instructions card: it is a correction, not the next step.
   */
  const completeAction = {
    label: update.isPending ? 'Completing…' : 'Mark as Complete',
    icon: <CheckCircle2 size={15} aria-hidden />,
    disabled: update.isPending || !canWork,
    guide: 'task-complete',
    onClick: () => {
      /* THE CHECKLIST NO LONGER GUARDS COMPLETION. It listed what was still
         unticked and then offered "Complete Task Anyway", so it never stopped
         anything - it asked the same question twice, in a dialog the reader
         had to get past to press the button they had already pressed. These
         tasks mostly carry no checklist at all. One plain confirmation takes
         its place; the checklist itself is untouched and still on the task. */
      setPendingConfirm(true);
    },
  };


  /**
   * THE RECEIPT FOR A SUBMITTED FORM.
   *
   * Filing the form completes the task on the server
   * (record.service.js#completeTaskForForm), so the task's OWN completion
   * stamp is the submission's — there is no second source to reconcile and
   * nothing extra to fetch. `appPath` doubles as the preview: it reopens the
   * form on the saved record, which is what "let me see what I sent" means.
   */
  const formSubmission = (t.appPath && (t.status === 'complete' || t.completedAt))
    ? { at: t.completedAt || t.actualEnd, by: t.completedBy?.name, href: t.appPath }
    : null;

  const stateAction = (t.approvalState && t.approvalState !== 'none')
    ? null
    : t.status === 'pending'
      ? pendingTaskCta && { ...pendingTaskCta, icon: <PlayCircle size={15} aria-hidden /> }
      : t.status === 'processing'
        ? completeAction
        /* NOT `submitAction`. A finished task used to grow a second button
           reading "Submit For Approval" — so the last step of every job was
           an extra click whose meaning was "now ask permission to have
           finished", and tasks sat complete-but-unsubmitted because nobody
           reads a button that appears after they believe they are done.

           IT IS NOT GONE, it is folded: the same action is inside "More
           details" below, so a task that genuinely needs a signature can
           still be sent by somebody who goes looking for it. Deleting it
           outright would close the only door into the approval queue —
           submitForApproval() is the sole writer of `waiting_department`. */
        : null;

  /** The warnings, as one block — drawn beside the buttons, not above them. */
  const alertBand = (overdue || blocked || blockingDeps.length > 0) ? (
    <div className="tv-alertband" data-tone={overdue ? 'danger' : 'warning'}>
      {overdue && (
        <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--danger)', fontWeight: 600 }}>
          <AlertTriangle size={15} /> Overdue by {Math.abs(dLeft)} day{Math.abs(dLeft) === 1 ? '' : 's'} — due {fmtDate(t.plannedEnd)}
        </span>
      )}
      {blocked && (
        <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--warning)', fontWeight: 600 }}>
          <Ban size={15} /> Marked as blocked
        </span>
      )}
      {blockingDeps.length > 0 && (
        <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--warning)' }}>
          <Clock size={15} /> Waiting on {blockingDeps.length} unfinished {blockingDeps.length === 1 ? 'dependency' : 'dependencies'}: {blockingDeps.map((d) => d.code).join(', ')}
        </span>
      )}
      {t.extensionRequest?.reason && (
        <span className="tiny muted">Root cause on record: "{t.extensionRequest.reason}"</span>
      )}
    </div>
  ) : null;

  /* The form's own button is NOT added here. `task.appPath` already reaches
     TaskBrief, which renders it as the task's primary action — adding a
     second one made six buttons on this page that all went to the same
     place. See TaskBrief.jsx, where that button is now named after the form
     it opens instead of "Open the module". */

  // Department Planning's read-only view shows just "Assigned" (see the
  // Progress section below) — no approval-status text or action buttons at
  // all, since sign-off isn't its concern.
  let footerActions;
  /* Sign-off is asked FIRST, and off its own field: a task waiting on a
     decision is complete work, not a fourth status. Asking `t.status` for it
     -- as every branch below used to -- matched nothing at all once the data
     migrated, so the chain fell through to its last arm on every task. */
  const approval = t.approvalState || 'none';
  if (fromDepartmentPlanning) {
    footerActions = null;
  } else if (approval === 'waiting_department') {
    footerActions = canDecide ? (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" style={{ color: 'var(--danger)' }} onClick={openReject}>
          <XCircle size={14} style={{ marginRight: 6 }} /> Reject
        </button>
        <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={onApprove}>
          <CheckCircle2 size={14} style={{ marginRight: 6 }} /> Approve
        </button>
      </div>
    ) : fromExecution ? (
      <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
        <CheckCircle2 size={14} /> Executed
      </span>
    ) : (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        {/* Name the approver the template chose, so "waiting" says who for. */}
        <Clock size={14} /> Waiting for approval{t.approval?.approver ? ` by ${t.approval.approver}` : ''}
      </span>
    );
  } else if (approval === 'waiting_management') {
    footerActions = canMgmtDecide ? (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" style={{ color: 'var(--danger)' }} onClick={openReject}>
          <XCircle size={14} style={{ marginRight: 6 }} /> Reject
        </button>
        <button type="button" className="btn btn-primary" disabled={decide.isPending} onClick={onApprove}>
          <CheckCircle2 size={14} style={{ marginRight: 6 }} /> Give Management Approval
        </button>
      </div>
    ) : fromExecution ? (
      // Unlike waiting_approval (whose next action is Execution's own
      // Approval Queue tab, one click away), a task at this tier has already
      // left Execution's story — its decision only happens on the Approval
      // Workflow (P7) page. A bare "Executed" badge here dead-ended the user
      // with no way to find that out, so this links straight there instead.
      <button
        type="button"
        className="btn btn-subtle btn-sm"
        style={{ color: 'var(--success)' }}
        onClick={() => navigate(`/projects/${id}/approval-workflow`)}
      >
        <CheckCircle2 size={14} style={{ marginRight: 6 }} />
        Executed — waiting on Management Approval (Phase 7)
        <ArrowRight size={13} style={{ marginLeft: 6 }} />
      </button>
    ) : selfWorkMgmt && String(t.approvedBy?._id || t.approvedBy || '') === String(currentUser?.id || currentUser?._id || '') ? (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <ShieldAlert size={14} />
        You already cleared this task at the department tier — management approval needs a different approver.
      </span>
    ) : (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <Clock size={14} /> Waiting for management approval
      </span>
    );
  } else if (approval === 'approved') {
    footerActions = isAdmin ? (
      <button type="button" className="btn btn-subtle" onClick={startEdit}>
        <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task (Admin)
      </button>
    ) : fromExecution ? (
      <span className="task-done-chip"><CheckCircle2 size={15} /> Executed</span>
    ) : null;
  } else if (approval === 'rejected') {
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        <button type="button" className="btn btn-primary" disabled={!canWork} onClick={resumeWork} data-guide="task-resume">
          <RotateCcw size={14} style={{ marginRight: 6 }} /> Resume Work
        </button>
      </div>
    );
  } else if (t.status === 'complete') {
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        {/* Submit For Approval lives in the page header now (stateAction) —
            the card would be the second copy of the same button. */}
      </div>
    );
  } else if (t.status === 'pending') {
    /* Not started yet. "Start Task" itself is the first button of the task's
       action row (pendingTaskCta) — repeating it here would show it twice. */
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
      </div>
    );
  } else {
    /* processing -- work is under way, so the offer is to finish it. */
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        {/* Mark as Complete is in the page header (stateAction). Every
            unticked checklist item is still warned about there — the
            confirmation dialog is shared. */}
      </div>
    );
  }

  return (
    <>
      {/*
        * THE BAR CARRIES THE WAY BACK, AND NOTHING ELSE.
        *
        * It used to repeat the whole card: the title (clamped to two lines,
        * with a "Show full title" control because these titles are routinely
        * paragraphs), the code, the status badge, the priority badge, the
        * delayed badge, and a subtitle with the code AGAIN plus the
        * countdown and a percentage. All of it is in the card six inches
        * below, at a size you can actually read, and one of the copies was
        * wrong often enough to matter — the badge here printed the work
        * state while the card printed the approval state.
        *
        * Two copies of one fact is not twice the information. It is one
        * fact and one chance for them to disagree.
        */}
      <Topbar
        title={(
          <span className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            <button className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            <span>Task</span>
          </span>
        )}
      />
      <div className="content page-compact tasks-blue">
        <div className="content-narrow col gap-4 fade-in">
          {fromExecution && <KpiStrip cards={executionKpis} />}

          {tab === 'overview' && (
            <div className="col gap-4 task-detail-overview">
              {/*
                * THE JOB, AND THEN EVERYTHING ELSE.
                *
                * TaskFocusCard is the page: what is being asked, by whom, by
                * when, and the one button that does it. Everything below —
                * the checklist, the brief, the attachments, the links, the
                * comments, the activity log, the approval controls — is still
                * here in full and still works; it is folded because a doer
                * opening their own job needs none of it to do the job, and a
                * page that opens with nine cards is a page nobody reads.
                *
                * A FOLD, NOT A DELETION. Managers chase tasks from this same
                * page and the history is the whole point for them; it is one
                * click away rather than gone.
                */}
              <TaskFocusCard
                task={t}
                /* `moduleLabel`, not `formName`: the bare key reads "Open
                   Operational", which names nothing. It is already the
                   assessment-aware label a few lines up. */
                formName={moduleLabel}
                projectName={project?.name}
                canWork={canWork}
                completing={update.isPending}
                /* Same one plain confirmation as the action bar above. */
                onComplete={() => setPendingConfirm(true)}
                submission={formSubmission}
                isCapture={isCapture}
                /* A phase whose register is a COLLECTION is filled once per
                   row, so its task keeps a finished button — read off the
                   template rather than a list of task keys here, so a new
                   collection phase needs no change in this file. */
                /**
                 * A FORM THAT CLOSES ITS OWN TASK NEEDS NO COMPLETE BUTTON.
                 *
                 * `captureMode: 'collection'` is set on p1, p2 AND p3 in the
                 * live template, so every assessment and every closure
                 * document was being treated like the vendor panel and grew
                 * a "Complete Task" button beside "Fill the …". Those forms
                 * finish their task on submit already
                 * (record.service.js#completeTaskForForm), so the button
                 * could only ever be pressed EARLY — closing a task whose
                 * form had not been filled.
                 *
                 * The vendor panel is the real multi-fill case: one task,
                 * one form, many vendors, and nothing closes it but the
                 * person building it. Property capture is the other, and it
                 * has its own branch (`isCapture`) with its own button.
                 */
                multiFill={formStage?.captureMode === 'collection'
                  && !SELF_CLOSING_STAGES.has(t.stageKey)}
                onCapture={() => setCaptureOpen(true)}
                /* Drives the "Task completed" button on a capture task: it
                   only appears once at least one property is filed. */
                capturedCount={capturedRows.length}
              />

              {/* CAPTURED PROPERTIES — accumulated below the card.
                  Every property filed against this project appears here, newest
                  first, so the doer sees their work building up as they go. */}
              {isCapture && (
                <section className="tf-captured">
                  <h3 className="tf-captured-head">
                    Captured Properties by you
                    {capturedRows.length > 0 && (
                      <span className="tf-captured-count">{capturedRows.length}</span>
                    )}
                  </h3>
                  {capturedLoading ? (
                    <p className="sm muted" style={{ margin: 0 }}>Loading properties…</p>
                  ) : capturedRows.length === 0 ? (
                    <p className="sm muted" style={{ margin: 0 }}>
                      No properties captured yet. Click <b>Property Capture</b> to start.
                    </p>
                  ) : (
                    <ul className="tf-captured-list">
                      {capturedRows.map((r) => {
                        const title = r.title || r.values?.property_name || r.values?.name || 'Untitled property';
                        const locality = r.locality || r.values?.locality || r.values?.address || r.values?.city || '';
                        const area = r.areaSqft || r.values?.carpet_area || r.values?.super_built_up_area || r.values?.area_sqft || '';
                        return (
                          /**
                           * THE PROPERTY OPENS. It was plain text — the doer
                           * files a site, sees its name appear, and has no way
                           * to read back what they just wrote: the pin on the
                           * map, the rent, the frontage, the owner's number,
                           * the photos. All of it was one screen away in the
                           * Properties queue, through a module, a step and a
                           * table of forty rows.
                           *
                           * The report fetches the record by id, so the whole
                           * capture form comes back with it — map link
                           * included — and it opens here rather than
                           * navigating, because the doer is mid-hunt and the
                           * task is where they are working.
                           */
                          <li key={r._id || r.id} className="tf-captured-item">
                            <button
                              type="button"
                              className="tf-captured-open"
                              onClick={() => setReadingProperty({
                                recordId: r._id || r.id,
                                title,
                                city: r.city || r.values?.city || project?.city || '',
                                locality,
                                projectId: id,
                                projectName: project?.name,
                                /* The report's header strip prints these, and
                                   without them it read "Filled in by: Not
                                   recorded" directly above an audit block
                                   naming the person — the record knows, so
                                   hand it over rather than let one report
                                   contradict itself. */
                                source: r.source || 'captured',
                                filedBy: r.submittedBy?.name || r.createdBy?.name || null,
                                filedAt: r.submittedAt || r.createdAt || null,
                                status: r.status,
                              })}
                              title={`Read everything filed for ${title}`}
                            >
                              <span className="tf-captured-name">{title}</span>
                              <span className="tf-captured-meta">
                                {[
                                  locality,
                                  area ? `${Number(area).toLocaleString('en-IN')} sq ft` : null,
                                  r.createdAt ? fmtDate(r.createdAt) : null,
                                ].filter(Boolean).join(' · ')}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              )}

              {/* The property capture modal — same form the Properties queue
                  uses, pre-set to this task's project so the doer does not have
                  to pick a city again. */}
              {isCapture && (
                <PropertyCaptureModal
                  open={captureOpen}
                  onClose={() => setCaptureOpen(false)}
                  startProject={project}
                />
              )}

              {readingProperty && (
                <PropertyDetailsModal
                  row={readingProperty}
                  onClose={() => setReadingProperty(null)}
                />
              )}



              {rejecting && (
                <div className="col gap-2" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--danger)0F', border: '1px solid var(--danger)33' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--danger)', fontWeight: 600 }}>
                    <XCircle size={15} /> Reject this task — a reason is required
                  </span>
                  <textarea
                    className="textarea" rows={2} placeholder="What needs to change before this can be approved?"
                    value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="row gap-2">
                    <button type="button" className="btn btn-primary" style={{ background: 'var(--danger)' }} disabled={decide.isPending || !rejectReason.trim()} onClick={confirmReject}>
                      {decide.isPending ? 'Rejecting…' : 'Confirm Reject'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setRejecting(false); setRejectReason(''); }}>Cancel</button>
                  </div>
                </div>
              )}

              {approving && (
                <div className="col gap-2" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
                    <CheckCircle2 size={15} /> Type your full name to confirm this Go-Live approval
                  </span>
                  <input
                    className="input" placeholder={currentUser?.name || 'Your full name'}
                    value={signatureInput} onChange={(e) => setSignatureInput(e.target.value)}
                  />
                  <div className="row gap-2">
                    <button
                      type="button" className="btn btn-primary"
                      disabled={decide.isPending || signatureInput.trim().toLowerCase() !== (currentUser?.name || '').trim().toLowerCase()}
                      onClick={confirmApprove}
                    >
                      {decide.isPending ? 'Approving…' : 'Confirm Approval'}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setApproving(false); setSignatureInput(''); }}>Cancel</button>
                  </div>
                </div>
              )}

              {!fromExecution && isApprovedTask(t) && (
                <div className="col gap-1" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
                    <Lock size={15} /> Approved and locked — no further edits except by an Admin
                  </span>
                  <span className="tiny muted">
                    {t.approvedBy?.name ? `Department approval by ${t.approvedBy.name}` : 'Department approved'}{t.approvedAt ? ` · ${fmtDateTime(t.approvedAt)}` : ''}
                    {t.approvalSignature ? ` — signed "${t.approvalSignature}"` : ''}
                    {t.approvalRemarks ? ` — "${t.approvalRemarks}"` : ''}
                  </span>
                  {t.managementApprovedBy?.name && (
                    <span className="tiny muted">
                      Management approval by {t.managementApprovedBy.name}{t.managementApprovedAt ? ` · ${fmtDateTime(t.managementApprovedAt)}` : ''}
                      {t.managementApprovalSignature ? ` — signed "${t.managementApprovalSignature}"` : ''}
                      {t.managementApprovalRemarks ? ` — "${t.managementApprovalRemarks}"` : ''}
                    </span>
                  )}
                </div>
              )}

              {isReworkTask(t) && (
                <div className="col gap-1" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--danger)0F', border: '1px solid var(--danger)33' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--danger)', fontWeight: 600 }}>
                    <ShieldAlert size={15} /> Rejected — {t.rejectReason}
                  </span>
                  <span className="tiny muted">
                    {t.rejectedBy?.name ? `By ${t.rejectedBy.name}` : ''}{t.rejectedAt ? ` · ${fmtDateTime(t.rejectedAt)}` : ''}
                  </span>
                </div>
              )}

              {!fromDepartmentPlanning && !fromExecution && isWaitingDept(t) && (
                <div className="col gap-1" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--text)', fontWeight: 600 }}>
                    <Clock size={15} /> Waiting on department manager approval
                  </span>
                  <span className="tiny muted">
                    Submitted{t.submittedForApprovalBy?.name ? ` by ${t.submittedForApprovalBy.name}` : ''}{t.submittedForApprovalAt ? ` · ${fmtDateTime(t.submittedForApprovalAt)}` : ''}
                  </span>
                  {approvers.length > 0 && (
                    <span className="tiny muted">
                      Can be approved by{' '}
                      {approverManagers.length > 0
                        ? approverManagers.map((u) => u.name).join(' or ')
                        : 'any MD or EA'}
                      {approverManagers.length > 0 && approverLeads > 0 ? ' — or any MD or EA' : ''}
                    </span>
                  )}
                </div>
              )}

              {editing && (
                <div className="col gap-3">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label">Title</label>
                    <input className="input" value={editDraft.title} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label">Description</label>
                    <textarea className="textarea" rows={3} value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
                  </div>
                  <div className="row gap-4 wrap">
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
                      <label className="label">Status</label>
                      <select className="select" value={editDraft.status} onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value }))}>
                        {!TASK_STATUS_SELECTABLE.includes(editDraft.status) && (
                          <option value={editDraft.status} disabled>{TASK_STATUS_META[editDraft.status]?.label || editDraft.status}</option>
                        )}
                        {TASK_STATUS_SELECTABLE.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s].label}</option>)}
                      </select>
                    </div>
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
                      <label className="label">Priority</label>
                      <select className="select" value={editDraft.priority} onChange={(e) => setEditDraft((d) => ({ ...d, priority: e.target.value }))}>
                        {Object.keys(PRIORITY_META).map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label">Assignee</label>
                    <select className="select" value={editDraft.assignee} onChange={(e) => setEditDraft((d) => ({ ...d, assignee: e.target.value }))}>
                      <option value="">Unassigned</option>
                      {(users.data || []).map((u) => (
                        <option key={u._id} value={u._id}>{u.name} · {u.title || u.role}</option>
                      ))}
                    </select>
                  </div>
                  <div className="row gap-4 wrap">
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 150 }}>
                      <label className="label">Department</label>
                      <select className="select" value={editDraft.department} onChange={(e) => setEditDraft((d) => ({ ...d, department: e.target.value }))}>
                        <option value="">—</option>
                        {departments.map((dept) => <option key={dept.key} value={dept.key}>{dept.name}</option>)}
                      </select>
                    </div>
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 130 }}>
                      <label className="label">Planned start</label>
                      <input type="date" className="input" value={editDraft.plannedStart} onChange={(e) => setEditDraft((d) => ({ ...d, plannedStart: e.target.value }))} />
                    </div>
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 130 }}>
                      <label className="label">Due date</label>
                      <input type="date" className="input" value={editDraft.plannedEnd} onChange={(e) => setEditDraft((d) => ({ ...d, plannedEnd: e.target.value }))} />
                    </div>
                    <div className="field grow" style={{ marginBottom: 0, minWidth: 110 }}>
                      <label className="label">Est. hours</label>
                      <input type="number" min="0" className="input" value={editDraft.estimatedHours} onChange={(e) => setEditDraft((d) => ({ ...d, estimatedHours: e.target.value }))} />
                    </div>
                  </div>
                  <div className="row gap-2">
                    <button type="button" className="btn btn-primary" onClick={saveEdit}>Save</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'updates' && (
            <div className="col gap-4">
              {!locked && canWork && (
                <div className="col gap-2" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <textarea
                    className="textarea"
                    rows={3}
                    placeholder={fromExecution
                      ? 'Log today\'s execution — work done, site conditions, next steps…'
                      : 'Share a progress update — site status, work completed, next steps…'}
                    value={updateDraft.body}
                    onChange={(e) => setUpdateDraft((d) => ({ ...d, body: e.target.value }))}
                  />
                  {updateDraft.photos.length > 0 && (
                    <div className="row gap-2 wrap">
                      {updateDraft.photos.map((f, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <span key={i} className="tiny row gap-1" style={{ alignItems: 'center', background: 'var(--surface-hover)', padding: '3px 8px', borderRadius: 'var(--radius-pill)' }}>
                          {f.name}
                          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 0 }}
                            onClick={() => setUpdateDraft((d) => ({ ...d, photos: d.photos.filter((_, idx) => idx !== i) }))}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {updatePct != null && (
                    <div style={{ height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${updatePct}%`, background: 'var(--gradient-primary)', transition: 'width .2s' }} />
                    </div>
                  )}
                  {updateErr && <span className="tiny" style={{ color: 'var(--danger)' }}>{updateErr}</span>}
                  <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                    <label className="btn btn-subtle btn-sm" style={{ cursor: 'pointer' }}>
                      <ImageIcon size={13} style={{ marginRight: 6 }} /> Add Photos
                      <input
                        type="file" multiple accept="image/*" style={{ display: 'none' }}
                        onChange={(e) => setUpdateDraft((d) => ({ ...d, photos: [...d.photos, ...e.target.files] })) || (e.target.value = '')}
                      />
                    </label>
                    <button type="button" className="btn btn-primary btn-sm" disabled={addUpdate.isPending} onClick={postUpdate}>
                      {addUpdate.isPending ? 'Posting…' : (fromExecution ? 'Log Entry' : 'Post Update')}
                    </button>
                  </div>
                </div>
              )}

              {updates.length === 0 ? (
                <EmptyState
                  icon={MessageCircle}
                  title={fromExecution ? 'No execution log entries yet' : 'No updates yet'}
                  hint={fromExecution ? 'Daily execution notes with site photos will show up here.' : 'Progress notes with photos will show up here.'}
                />
              ) : (
                <div className="col gap-3">
                  {updates.map((u) => (
                    <div key={u._id} className="row gap-2" style={{ alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <Avatar name={u.author?.name} color={u.author?.avatarColor} size={30} />
                      <div className="col grow gap-1" style={{ minWidth: 0 }}>
                        <span className="row gap-2" style={{ alignItems: 'center' }}>
                          <span className="sm" style={{ fontWeight: 600 }}>{u.author?.name || 'Someone'}</span>
                          <span className="tiny muted">{fmtDateTime(u.createdAt)}</span>
                        </span>
                        {u.body && <span className="sm">{u.body}</span>}
                        {u.photos?.length > 0 && (
                          <div className="row gap-2 wrap" style={{ marginTop: 4 }}>
                            {u.photos.map((p) => (
                              <a key={p._id} href={p.url} target="_blank" rel="noreferrer">
                                <img src={p.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'links' && (
            <div className="col gap-3">
              <span className="tiny muted">
                Reference links — the drawing set, a Drive folder, a spec. Nothing is
                uploaded, so a link always opens the current version rather than a copy
                frozen at the moment it was attached.
              </span>

              {canWork && !locked && (
                <form
                  className="row gap-2 wrap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const url = linkDraft.url.trim();
                    if (!url) return;
                    addLink({ taskId: t._id, projectId: t.project?._id || t.project, url, label: linkDraft.label.trim() })
                      .unwrap()
                      .then(() => setLinkDraft({ label: '', url: '' }))
                      .catch(() => { /* surfaced by the shared error toast */ });
                  }}
                >
                  <input
                    className="input"
                    style={{ flex: '1 1 180px' }}
                    placeholder="Label (e.g. Ground floor layout)"
                    value={linkDraft.label}
                    onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))}
                  />
                  {/* Deliberately not type="url": the browser rejects a pasted
                      "drive.google.com/…" before it can be submitted, and the
                      server is what adds the missing scheme. */}
                  <input
                    className="input"
                    style={{ flex: '2 1 260px' }}
                    type="text"
                    inputMode="url"
                    placeholder="Paste a link — drive.google.com/… or https://…"
                    value={linkDraft.url}
                    onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value }))}
                  />
                  <button type="submit" className="btn btn-subtle btn-sm" disabled={!linkDraft.url.trim() || addingLink.isLoading}>
                    <Plus size={13} style={{ marginRight: 6 }} />
                    {addingLink.isLoading ? 'Adding…' : 'Add link'}
                  </button>
                </form>
              )}

              {links.length === 0 ? (
                <span className="tiny muted">No links added yet.</span>
              ) : (
                <div className="col gap-2">
                  {links.map((l) => (
                    <div key={l._id} className="row gap-2" style={{ alignItems: 'center', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                      <span className="center" style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--info-soft)', color: 'var(--info)', flexShrink: 0 }}>
                        <LinkIcon size={15} />
                      </span>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="col grow"
                        style={{ minWidth: 0 }}
                        title={l.url}
                      >
                        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label || l.url}</span>
                        <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</span>
                      </a>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" title="Open in a new tab">
                        <ExternalLink size={13} />
                      </a>
                      {canWork && !locked && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Remove this link"
                          disabled={removingLink.isLoading}
                          onClick={() => removeLink({ taskId: t._id, projectId: t.project?._id || t.project, linkId: l._id })}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'attachments' && (
            <div className="col gap-2">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="tiny muted">{fromExecution ? 'Execution evidence — completion reports, inspection sign-offs, invoices, blueprints.' : 'Compliance receipts, technical blueprints, spreadsheets, PDFs.'}</span>
                <button type="button" className="btn btn-subtle btn-sm" disabled={upload.isPending || locked || !canWork} onClick={() => fileRef.current?.click()}>
                  <Upload size={13} style={{ marginRight: 6 }} /> {upload.isPending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
              {uploadPct != null && (
                <div style={{ height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadPct}%`, background: 'var(--gradient-primary)', transition: 'width .2s' }} />
                </div>
              )}
              {uploadErr && <span className="tiny" style={{ color: 'var(--danger)' }}>{uploadErr}</span>}
              {files.length === 0 ? (
                <div className="row gap-2 tiny muted" style={{ alignItems: 'center', padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 8 }}>
                  <Paperclip size={16} /> No attachments yet — upload receipts or blueprints.
                </div>
              ) : (
                <div className="col gap-2">
                  {files.map((a) => <AttachmentRow key={a._id} a={a} onDelete={locked || !canWork ? undefined : onDeleteAttachment} deleting={removeAttachment.isPending} />)}
                </div>
              )}
            </div>
          )}

          {tab === 'images' && (
            <div className="col gap-2">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="tiny muted">Site photos and visual evidence.</span>
                <button type="button" className="btn btn-subtle btn-sm" disabled={upload.isPending || locked || !canWork} onClick={() => fileRef.current?.click()}>
                  <Upload size={13} style={{ marginRight: 6 }} /> {upload.isPending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
              {images.length === 0 ? (
                <EmptyState icon={ImageIcon} title="No images yet" hint="Upload site photos to see them here." />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                  {images.map((a) => (
                    <div key={a._id} className="col gap-1">
                      <a href={a.url} target="_blank" rel="noreferrer">
                        <img src={a.url} alt={a.originalName || ''} style={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 8 }} />
                      </a>
                      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.originalName}</span>
                        {!locked && canWork && (
                          <button type="button" style={{ background: 'none', border: 'none', cursor: removeAttachment.isPending ? 'default' : 'pointer', color: 'var(--danger)', padding: 0, flexShrink: 0, opacity: removeAttachment.isPending ? 0.5 : 1 }} disabled={removeAttachment.isPending} onClick={() => onDeleteAttachment(a)} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'videos' && (
            <div className="col gap-2">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="tiny muted">Site walkthroughs and progress footage.</span>
                <button type="button" className="btn btn-subtle btn-sm" disabled={upload.isPending || locked || !canWork} onClick={() => fileRef.current?.click()}>
                  <Upload size={13} style={{ marginRight: 6 }} /> {upload.isPending ? 'Uploading…' : 'Upload'}
                </button>
              </div>
              {videos.length === 0 ? (
                <EmptyState icon={Video} title="No videos yet" hint="Upload a walkthrough or progress clip to see it here." />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                  {videos.map((a) => <VideoCard key={a._id} a={a} onDelete={locked || !canWork ? undefined : onDeleteAttachment} deleting={removeAttachment.isPending} />)}
                </div>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <div className="col gap-4">
              {!locked && canWork && (
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <textarea
                    className="textarea grow" rows={2} placeholder="Write a comment…"
                    value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
                  />
                  <button type="button" className="btn btn-primary btn-sm" disabled={addComment.isPending || !commentDraft.trim()} onClick={postComment}>
                    {addComment.isPending ? 'Posting…' : 'Post'}
                  </button>
                </div>
              )}
              {plainComments.length === 0 ? (
                <EmptyState icon={MessageCircle} title="No comments yet" hint="Discussion and feedback on this task will show up here." />
              ) : (
                <div className="col gap-3">
                  {plainComments.map((c) => (
                    <div key={c._id} className="row gap-2" style={{ alignItems: 'flex-start', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                      <Avatar name={c.author?.name} color={c.author?.avatarColor} size={30} />
                      <div className="col grow" style={{ minWidth: 0 }}>
                        <span className="row gap-2" style={{ alignItems: 'center' }}>
                          <span className="sm" style={{ fontWeight: 600 }}>{c.author?.name || 'Someone'}</span>
                          <span className="tiny muted">{fmtDateTime(c.createdAt)}</span>
                        </span>
                        <span className="sm">{c.body}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'activity' && <ActivityLog activity={taskActivity} />}

          <input
            ref={fileRef} type="file" multiple
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.tsv,.txt,.rtf,.ppt,.pptx,.odt,.ods,.odp,.zip,.rar,.7z,.dwg,.dxf,.dwf,.dgn,.rvt,.rfa,.ifc,.skp,.3ds,.max,.obj,.fbx,.dae,.blend,.step,.stp,.iges,.igs,.stl,.ai,.psd,.indd,.eps,.cdr,.sketch,.fig,.xd"
            style={{ display: 'none' }}
            onChange={onPickFiles}
          />
        </div>
      </div>

      {/**
        * ARE YOU SURE - and nothing else.
        *
        * Completing a task is a one-way statement about work other people are
        * waiting on, so it still asks. What it no longer does is inventory the
        * checklist on the way through.
        */}
      <Modal
        open={!!pendingConfirm}
        onClose={() => setPendingConfirm(null)}
        title="Are you sure this task is complete?"
        /* `tasks-blue` by hand: the dialog is rendered outside the page's own
           blue wrapper (it sits beside `.content`, not inside it), so without
           this the confirm button came out gold among blue ones. */
        className="tasks-blue mt-confirm"
        width={440}
        footer={(
          <div className="row gap-2" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-subtle" onClick={() => setPendingConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={update.isPending}
              onClick={() => {
                setPendingConfirm(null);
                setChecklistNudge(false);
                patch({ status: 'complete' });
              }}
            >
              {update.isPending ? 'Completing…' : 'Yes, it is complete'}
            </button>
          </div>
        )}
      />
    </>
  );
}

export default TaskDetailPage;
