import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Upload, Trash2, Paperclip, Image as ImageIcon, AlertTriangle, Ban, CheckCircle2, Clock,
  MessageCircle, Video, Pencil, Send, XCircle, Lock, RotateCcw, ShieldAlert,
  TrendingUp, ListChecks, CalendarClock, Link2, FileCheck2, PlayCircle,
} from 'lucide-react';
import { can } from '../../lib/roles.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, Avatar, EmptyState } from '../../components/ui/primitives.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useUsers } from '../../app/api/usersApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import {
  useUpdateTask, useTaskByCode, useTasks, useUploadTaskAttachment, useDeleteTaskAttachment,
  useAddTaskComment, useAddTaskUpdate,
  useSubmitTaskForApproval, useTaskDecision,
} from '../../app/api/tasksApi.js';
import {
  TASK_STATUS_META, TASK_STATUS_SELECTABLE, LEGAL_TASK_TRANSITIONS, PRIORITY_META, deptMeta,
  isTaskDelayed, canApprove, canManagementApprove, canWorkOnTask, isOwnTaskWork,
} from '../../lib/ui.js';
import { fmtDate, fmtDateTime, fmtFileSize, fmtDuration, daysUntil } from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import {
  isImage, isVideo, fileMeta, toDateInput, AttachmentRow, VideoCard, CommentsThread, ActivityLog,
} from './taskDetailShared.jsx';

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
    <div className="col gap-2">
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
  const ORDER = ['todo', 'in_progress', 'review', 'done', 'waiting_approval', 'approved'];
  const STEPS = [
    { key: 'todo', label: 'Assigned', dateKey: 'createdAt' },
    { key: 'in_progress', label: 'Work In Progress', dateKey: 'actualStart' },
    { key: 'done', label: 'Completed', dateKey: 'actualEnd' },
    { key: 'waiting_approval', label: 'Waiting Approval', dateKey: 'submittedForApprovalAt' },
    { key: 'approved', label: 'Approved', dateKey: 'approvedAt' },
  ];
  const currentIdx = (task.status === 'blocked' || task.status === 'rejected')
    ? ORDER.indexOf('in_progress')
    : ORDER.indexOf(task.status);

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
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

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'updates', label: 'Updates' },
  { key: 'attachments', label: 'Attachments' },
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
  const removeAttachment = useDeleteTaskAttachment(id);
  const addComment = useAddTaskComment(id);
  const addUpdate = useAddTaskUpdate(id);
  const submitApproval = useSubmitTaskForApproval(id);
  const decide = useTaskDecision(id);
  const { data: activity } = useProjectActivity(id);
  const currentUser = useAppSelector(selectCurrentUser);
  const fileRef = useRef(null);

  const [tab, setTab] = useState('overview');
  const [checklist, setChecklist] = useState([]);
  const [uploadPct, setUploadPct] = useState(null);
  const [uploadErr, setUploadErr] = useState('');
  const [updateErr, setUpdateErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [updateDraft, setUpdateDraft] = useState({ body: '', photos: [] });
  const [updatePct, setUpdatePct] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [approving, setApproving] = useState(false);
  const [signatureInput, setSignatureInput] = useState('');

  const byId = useMemo(() => {
    const m = new Map();
    for (const x of allTasks) m.set(String(x._id), x);
    return m;
  }, [allTasks]);

  useEffect(() => {
    setChecklist(t?.checklist?.map((c) => ({ ...c })) || []);
  }, [t?._id, t?.checklist?.length]);

  const goBack = () => navigate(-1);

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

  const toggleCheck = (idx) => {
    const next = checklist.map((c, i) => (i === idx ? { ...c, done: !c.done } : c));
    setChecklist(next);
    patch({ checklist: next.map(({ label, done, required }) => ({ label, done, required })) });
  };

  const doneCount = checklist.filter((c) => c.done).length;
  const progress = checklist.length ? Math.round((doneCount / checklist.length) * 100) : (t.status === 'done' ? 100 : 0);

  const dLeft = t.plannedEnd ? daysUntil(t.plannedEnd) : null;
  const overdue = t.status !== 'done' && dLeft != null && dLeft < 0;
  const blocked = t.status === 'blocked';
  const isAdmin = can.administer(currentUser?.role);
  const locked = t.status === 'approved' && !isAdmin;
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
  const delayed = isTaskDelayed(t);
  // Execution's job is doing the work, not tracking the approval pipeline
  // that follows — so within that context every status collapses to just
  // "Executed" (work is done, in whatever stage of sign-off) or "Pending".
  const executed = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'].includes(t.status);

  const deps = (t.dependencies || []).map((d) => {
    const full = byId.get(String(d._id || d));
    return { _id: String(d._id || d), code: d.code || full?.code, title: d.title || full?.title, status: full?.status };
  });
  const blockingDeps = deps.filter((d) => d.status && d.status !== 'done');

  const attachments = t.attachments || [];
  const images = attachments.filter(isImage);
  const videos = attachments.filter((a) => !isImage(a) && isVideo(a));
  const files = attachments.filter((a) => !isImage(a) && !isVideo(a));
  const comments = t.comments || [];
  const updates = [...comments.filter((c) => c.kind === 'update')].reverse();
  const plainComments = [...comments.filter((c) => c.kind !== 'update')].reverse();
  const taskActivity = (activity || []).filter((a) => a.entityType === 'task' && String(a.entityId) === String(t._id));

  const st = TASK_STATUS_META[t.status] || {};
  const pr = PRIORITY_META[t.priority] || {};
  // Character count rather than measuring the rendered box: the header also
  // carries a back button and up to three badges, so the point at which the
  // title wraps past two lines moves around. ~90 characters is comfortably
  // past a normal one-line title and well short of the two-line clamp, so the
  // toggle appears only for titles that are genuinely long.
  const isLongTitle = (t.title || '').length > 90;
  const dm = deptMeta(t.department);

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
      valueSuffix: t.status !== 'done' && dLeft != null ? 'd' : undefined,
      sub: t.status === 'done'
        ? fmtDate(t.actualEnd)
        : (dLeft != null ? (dLeft < 0 ? 'overdue' : dLeft === 0 ? 'due today' : 'remaining') : 'No due date set'),
      subColor: t.status !== 'done' && dLeft != null ? (dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)') : undefined,
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
  const resumeWork = () => patch({ status: 'in_progress' });

  // Department Planning's read-only view shows just "Assigned" (see the
  // Progress section below) — no approval-status text or action buttons at
  // all, since sign-off isn't its concern.
  let footerActions;
  if (fromDepartmentPlanning) {
    footerActions = null;
  } else if (t.status === 'waiting_approval') {
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
    ) : selfWorkDept ? (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <ShieldAlert size={14} /> You can’t approve or reject your own task — it needs a second person to sign off.
      </span>
    ) : (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <Clock size={14} /> Waiting for department manager approval
      </span>
    );
  } else if (t.status === 'waiting_management_approval') {
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
    ) : selfWorkMgmt ? (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <ShieldAlert size={14} />
        {String(t.approvedBy?._id || t.approvedBy || '') === String(currentUser?.id || currentUser?._id || '')
          ? 'You already cleared this task at the department tier — management approval needs a different approver.'
          : 'You can’t approve or reject your own task — it needs a second person to sign off.'}
      </span>
    ) : (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <Clock size={14} /> Waiting for management approval
      </span>
    );
  } else if (t.status === 'approved') {
    footerActions = isAdmin ? (
      <button type="button" className="btn btn-subtle" onClick={startEdit}>
        <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task (Admin)
      </button>
    ) : fromExecution ? (
      <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 600 }}>
        <CheckCircle2 size={14} /> Executed
      </span>
    ) : (
      <span className="sm muted row gap-2" style={{ alignItems: 'center' }}>
        <Lock size={14} /> Approved and locked
      </span>
    );
  } else if (t.status === 'rejected') {
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        <button type="button" className="btn btn-primary" disabled={!canWork} onClick={resumeWork}>
          <RotateCcw size={14} style={{ marginRight: 6 }} /> Resume Work
        </button>
      </div>
    );
  } else if (t.status === 'done') {
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        {fromExecution ? (
          <button type="button" className="btn btn-primary" disabled={submitApproval.isPending || !canWork} onClick={onSubmitForApproval}>
            <CheckCircle2 size={14} style={{ marginRight: 6 }} /> {submitApproval.isPending ? 'Completing…' : 'Complete'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={submitApproval.isPending || !canWork} onClick={onSubmitForApproval}>
            <Send size={14} style={{ marginRight: 6 }} /> {submitApproval.isPending ? 'Submitting…' : 'Submit For Approval'}
          </button>
        )}
      </div>
    );
  } else if (t.status === 'todo') {
    // Assigned work hasn't started yet — the only legal move is into
    // in_progress (see LEGAL_TASK_TRANSITIONS). Offering "Mark as Complete"
    // here would jump straight to `done`, which the server always rejects.
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        <button
          type="button" className="btn btn-primary"
          disabled={update.isPending || !canWork}
          onClick={() => patch({ status: 'in_progress' })}
        >
          <PlayCircle size={14} style={{ marginRight: 6 }} /> {update.isPending ? 'Starting…' : 'Start Work'}
        </button>
      </div>
    );
  } else if (t.status === 'blocked') {
    // Blocked can only return to todo or in_progress — same "not legal to
    // complete yet" reasoning as todo, so it gets the same resume action.
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        <button
          type="button" className="btn btn-primary"
          disabled={update.isPending || !canWork}
          onClick={() => patch({ status: 'in_progress' })}
        >
          <RotateCcw size={14} style={{ marginRight: 6 }} /> {update.isPending ? 'Resuming…' : 'Resume Work'}
        </button>
      </div>
    );
  } else {
    // in_progress (and legacy `review`) — the only statuses LEGAL_TASK_TRANSITIONS
    // actually allows to move to `done`.
    footerActions = (
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle" disabled={!canWork} onClick={startEdit}>
          <Pencil size={14} style={{ marginRight: 6 }} /> Edit Task
        </button>
        <button
          type="button" className="btn btn-subtle" style={{ color: 'var(--success)' }}
          disabled={update.isPending || !canWork}
          onClick={() => patch({ status: 'done' })}
        >
          <CheckCircle2 size={14} style={{ marginRight: 6 }} /> {update.isPending ? 'Completing…' : 'Mark as Complete'}
        </button>
      </div>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <button className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            {/* Clamped to two lines by default and expandable in place. Titles
                are free text and are routinely whole paragraphs; rendered raw
                at 21px/700 this overflowed the topbar and painted across the
                page beneath it. This page is where the full title belongs, so
                it expands here rather than hiding behind a tooltip. */}
            <span
              className={`page-title-text${titleExpanded ? ' page-title-text--full' : ''}`}
              title={t.title}
            >
              {t.title}
            </span>
            {isLongTitle && (
              <button
                type="button"
                className="page-title-more"
                onClick={() => setTitleExpanded((v) => !v)}
              >
                {titleExpanded ? 'Show less' : 'Show full title'}
              </button>
            )}
            {fromExecution ? (
              <Badge color={executed ? 'var(--success)' : 'var(--warning)'} soft={executed ? 'var(--success-soft)' : 'var(--warning-soft)'} dot>
                {executed ? 'Executed' : 'Pending'}
              </Badge>
            ) : (
              <Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge>
            )}
            {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
            {delayed && <Badge color="var(--danger)">Delayed</Badge>}
          </span>
        }
        subtitle={
          <span className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{t.code} · {dm.label || t.stageName || 'Execution'}</span>
            {dLeft != null && t.status !== 'done' && (
              <span style={{ color: dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)', fontWeight: 600 }}>
                {dLeft < 0 ? `Overdue by ${Math.abs(dLeft)}d` : dLeft === 0 ? 'Due today' : `${dLeft}d left`}
              </span>
            )}
            <span>· {progress}% complete</span>
          </span>
        }
      />
      <div className="content page-compact">
        <div className="content-narrow col gap-4 fade-in">
          <div className="row" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="tabs">
              {TABS.map((tb) => {
                const count = {
                  updates: updates.length, attachments: files.length, images: images.length,
                  videos: videos.length, comments: plainComments.length,
                }[tb.key];
                const label = fromExecution && tb.key === 'updates' ? 'Daily Log' : tb.label;
                return (
                  <button key={tb.key} type="button" className={`tab${tab === tb.key ? ' active' : ''}`} onClick={() => setTab(tb.key)}>
                    {label}{count != null ? ` (${count})` : ''}
                  </button>
                );
              })}
            </div>
            <div className="row gap-2" style={{ flexShrink: 0 }}>{footerActions}</div>
          </div>

          {fromExecution && <KpiStrip cards={executionKpis} />}

          {tab === 'overview' && (
            <div className="col gap-4">
              {(overdue || blocked || blockingDeps.length > 0) && (
                <div className="col gap-2" style={{ padding: '10px 12px', borderRadius: 8, background: overdue ? 'var(--danger)0F' : 'var(--warning)0F', border: `1px solid ${overdue ? 'var(--danger)' : 'var(--warning)'}33` }}>
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

              {!fromExecution && t.status === 'approved' && (
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

              {t.status === 'rejected' && (
                <div className="col gap-1" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--danger)0F', border: '1px solid var(--danger)33' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--danger)', fontWeight: 600 }}>
                    <ShieldAlert size={15} /> Rejected — {t.rejectReason}
                  </span>
                  <span className="tiny muted">
                    {t.rejectedBy?.name ? `By ${t.rejectedBy.name}` : ''}{t.rejectedAt ? ` · ${fmtDateTime(t.rejectedAt)}` : ''}
                  </span>
                </div>
              )}

              {!fromDepartmentPlanning && !fromExecution && t.status === 'waiting_approval' && (
                <div className="col gap-1" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--text)', fontWeight: 600 }}>
                    <Clock size={15} /> Waiting on department manager approval
                  </span>
                  <span className="tiny muted">
                    Submitted{t.submittedForApprovalBy?.name ? ` by ${t.submittedForApprovalBy.name}` : ''}{t.submittedForApprovalAt ? ` · ${fmtDateTime(t.submittedForApprovalAt)}` : ''}
                  </span>
                </div>
              )}

              {editing ? (
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
              ) : (
                <>
                  <div className="row gap-3 wrap">
                    <div className="col gap-2" style={{ flex: '1 1 260px', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                      <span className="label" style={{ marginBottom: 0 }}>Description</span>
                      {t.description ? (
                        <>
                          <p
                            className="sm muted"
                            style={{
                              margin: 0,
                              ...(descExpanded ? {} : { overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }),
                            }}
                          >
                            {t.description}
                          </p>
                          {t.description.length > 110 && (
                            <button
                              type="button"
                              onClick={() => setDescExpanded((v) => !v)}
                              className="tiny"
                              style={{ color: 'var(--primary)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}
                            >
                              {descExpanded ? 'Show less' : 'Show more'}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="tiny muted">No description added.</span>
                      )}
                    </div>

                    <div className="col gap-2" style={{ flex: '1 1 260px', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                      <span className="label" style={{ marginBottom: 0 }}>Assignee</span>
                      {t.assignee ? (
                        <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                          <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={36} />
                          <div className="col" style={{ gap: 2, minWidth: 0 }}>
                            <span className="sm" style={{ fontWeight: 700 }}>{t.assignee.name}</span>
                            {(t.assignee.title || t.assignee.role) && <span className="tiny muted">{t.assignee.title || t.assignee.role}</span>}
                            {t.assignee.phone && <span className="tiny muted">{t.assignee.phone}</span>}
                            {t.assignee.email && <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.assignee.email}</span>}
                          </div>
                        </div>
                      ) : (
                        <span className="tiny muted">Unassigned — use Edit Task to assign someone.</span>
                      )}
                    </div>
                  </div>

                  <div className="row" style={{ border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap' }}>
                    <InfoStripCell label="Department" value={t.department ? dm.label : '—'} />
                    <InfoStripCell label="Priority" value={pr.label || t.priority} valueColor={pr.color} />
                    <InfoStripCell label="Start Date" value={fmtDate(t.plannedStart)} />
                    <InfoStripCell
                      label="Due Date"
                      value={fmtDate(t.plannedEnd)}
                      valueColor={overdue ? 'var(--danger)' : undefined}
                      sub={t.status !== 'done' && dLeft != null ? (dLeft < 0 ? `${Math.abs(dLeft)} days overdue` : dLeft === 0 ? 'Due today' : `${dLeft} days left`) : null}
                      subColor={dLeft != null ? (dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)') : undefined}
                      last
                    />
                  </div>
                </>
              )}

              {fromDepartmentPlanning ? (
                // Department Planning only needs to confirm allocation happened —
                // work progress/approval tiers are Execution & Approval Workflow's
                // own story, not something to track from here.
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <span className="list-row-icon" style={{ width: 28, height: 28, background: 'var(--success-soft)', color: 'var(--success)' }}>
                    <CheckCircle2 size={14} />
                  </span>
                  <div className="col">
                    <span className="sm" style={{ fontWeight: 650 }}>Assigned</span>
                    <span className="tiny muted">{fmtDate(t.createdAt)} · tracked in Execution from here on</span>
                  </div>
                </div>
              ) : fromExecution ? (
                // Execution's job is doing the work, not tracking which tier
                // of the approval pipeline a submitted task sits in — so this
                // collapses to a plain done/not-done signal instead of the
                // full 5-step approval stepper.
                <>
                  <div className="col gap-1">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="label" style={{ marginBottom: 0 }}>Progress</span>
                      <span className="tiny muted">{progress}%{checklist.length ? ` · ${doneCount}/${checklist.length} checklist` : ''}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-primary)' }} />
                    </div>
                  </div>
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <span className="list-row-icon" style={{ width: 28, height: 28, background: executed ? 'var(--success-soft)' : 'var(--warning-soft)', color: executed ? 'var(--success)' : 'var(--warning)' }}>
                      {executed ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                    </span>
                    <div className="col">
                      <span className="sm" style={{ fontWeight: 650 }}>{executed ? 'Executed' : 'Pending'}</span>
                      <span className="tiny muted">
                        {executed
                          ? `${fmtDate(t.actualEnd || t.submittedForApprovalAt || t.createdAt)} · handed off for approval`
                          : (t.status === 'rejected' ? 'Sent back — needs rework' : 'Work not yet marked complete')}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="col gap-1">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="label" style={{ marginBottom: 0 }}>Progress</span>
                      <span className="tiny muted">{progress}%{checklist.length ? ` · ${doneCount}/${checklist.length} checklist` : ''}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-primary)' }} />
                    </div>
                  </div>

                  {/* Where the task is, and every move it can legally make —
                      visible, not hidden behind one contextual footer button.
                      The page showed a status badge plus a single primary
                      action, so "put this back to In Progress" or "flag it
                      Blocked" had no visible answer at all. */}
                  <StatusControl
                    task={t}
                    canWork={canWork}
                    pending={update.isPending}
                    onChange={(status) => patch({ status })}
                  />

                  <div className="col gap-2">
                    <span className="label" style={{ marginBottom: 0 }}>Progress Timeline</span>
                    <ProgressTimeline task={t} />
                  </div>
                </>
              )}

              <div className="row gap-4 wrap">
                <PreviewCol title="Recent Updates" count={updates.length} onViewAll={() => setTab('updates')} empty="No updates posted yet.">
                  {updates.slice(0, 3).map((u) => (
                    <div key={u._id} className="col gap-1" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                      <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                        <Avatar name={u.author?.name} color={u.author?.avatarColor} size={24} />
                        <div className="col" style={{ minWidth: 0 }}>
                          <span className="row gap-2" style={{ alignItems: 'center' }}>
                            <span className="tiny" style={{ fontWeight: 600 }}>{u.author?.name || 'Someone'}</span>
                            <span className="tiny muted">{fmtDateTime(u.createdAt)}</span>
                          </span>
                          {u.body && (
                            <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{u.body}</span>
                          )}
                        </div>
                      </div>
                      {u.photos?.length > 0 && (
                        <div className="row gap-1" style={{ marginLeft: 32 }}>
                          {u.photos.slice(0, 3).map((p) => (
                            <img key={p._id} src={p.url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </PreviewCol>
                <PreviewCol title="Attachments" count={files.length} onViewAll={() => setTab('attachments')} empty="No files uploaded yet.">
                  {files.slice(0, 4).map((a) => {
                    const fm = fileMeta(a.originalName);
                    return (
                      <div key={a._id} className="row gap-2" style={{ alignItems: 'center' }}>
                        <span className="center" style={{ width: 30, height: 30, borderRadius: 6, background: `${fm.color}1A`, color: fm.color, flexShrink: 0 }}>
                          <fm.Icon size={14} />
                        </span>
                        <div className="col" style={{ minWidth: 0 }}>
                          <span className="tiny" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.originalName}</span>
                          <span className="tiny muted">{a.bytes ? fmtFileSize(a.bytes) : ''}{a.createdAt ? ` · ${fmtDate(a.createdAt)}` : ''}</span>
                        </div>
                      </div>
                    );
                  })}
                </PreviewCol>
                <PreviewCol title="Videos" count={videos.length} onViewAll={() => setTab('videos')} empty="No videos uploaded yet.">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {videos.slice(0, 2).map((a) => <VideoCard key={a._id} a={a} compact />)}
                  </div>
                </PreviewCol>
              </div>

              <div className="row gap-4 wrap">
                <PreviewCol title="Dependencies" count={deps.length} empty="No dependencies — this task can start independently.">
                  {deps.map((d) => {
                    const ds = TASK_STATUS_META[d.status] || {};
                    const isBlocking = d.status && d.status !== 'done';
                    return (
                      <div key={d._id} className="row gap-2" style={{ alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: 'var(--surface-2)' }}>
                        {d.status === 'done' ? <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} /> : <Clock size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
                        <span className="tiny" style={{ fontWeight: 600 }}>{d.code}</span>
                        <span className="tiny grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || ''}</span>
                        {d.status && <Badge color={ds.color} soft={ds.soft} dot>{ds.label || d.status}</Badge>}
                        {isBlocking && <span className="tiny" style={{ color: 'var(--warning)', fontWeight: 600, flexShrink: 0 }}>Blocking</span>}
                      </div>
                    );
                  })}
                </PreviewCol>

                <PreviewCol title="Comments" count={plainComments.length} onViewAll={() => setTab('comments')} empty="No comments yet.">
                  {plainComments.slice(0, 3).map((c) => (
                    <div key={c._id} className="row gap-2" style={{ alignItems: 'flex-start' }}>
                      <Avatar name={c.author?.name} color={c.author?.avatarColor} size={24} />
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="row gap-2" style={{ alignItems: 'center' }}>
                          <span className="tiny" style={{ fontWeight: 600 }}>{c.author?.name || 'Someone'}</span>
                          <span className="tiny muted">{fmtDateTime(c.createdAt)}</span>
                        </span>
                        <span className="tiny muted">{c.body}</span>
                      </div>
                    </div>
                  ))}
                </PreviewCol>

                <PreviewCol title="Activity Log" count={taskActivity.length} onViewAll={() => setTab('activity')} empty="No activity yet.">
                  {taskActivity.slice(0, 3).map((a) => (
                    <div key={a._id} className="row gap-2" style={{ alignItems: 'flex-start' }}>
                      <Avatar name={a.actor?.name} color={a.actor?.avatarColor} size={24} />
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="tiny" style={{ fontWeight: 600 }}>{a.actor?.name || 'System'}</span>
                        <span className="tiny muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.message}</span>
                        <span className="tiny muted">{fmtDateTime(a.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </PreviewCol>
              </div>

              {checklist.length > 0 && (
                <div className="col gap-2">
                  <span className="label" style={{ marginBottom: 0 }}>Checklist</span>
                  {checklist.map((c, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <label key={i} className="row gap-2 sm" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox" checked={!!c.done}
                        disabled={locked || !canWork}
                        title={!locked && !canWork ? 'Only the assigned doer (or a manager) can tick this off' : undefined}
                        onChange={() => toggleCheck(i)}
                      />
                      <span style={{ textDecoration: c.done ? 'line-through' : 'none', color: c.done ? 'var(--text-subtle)' : 'var(--text)' }}>
                        {c.label}{c.required && <span style={{ color: 'var(--danger)' }}> *</span>}
                      </span>
                    </label>
                  ))}
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
            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv"
            style={{ display: 'none' }}
            onChange={onPickFiles}
          />
        </div>
      </div>
    </>
  );
}

export default TaskDetailPage;
