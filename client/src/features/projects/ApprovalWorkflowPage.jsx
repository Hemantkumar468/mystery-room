import { cloneElement, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, AlertTriangle, ClipboardList, CheckCircle2, XCircle, Clock, RotateCcw,
  Download, Activity, Search, ChevronDown, MoreVertical, Eye, Check, X,
  Image as ImageIcon, FileText, ShieldAlert, ChevronUp,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, Avatar, ProgressBar } from '../../components/ui/primitives.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject, useCompleteStage, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks, useTaskDecision } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  deptMeta, PRIORITY_META, TASK_STATUS_META, canManagementApprove, isOwnTaskWork,
} from '../../lib/ui.js';
import { ActivityLog } from '../tasks/taskDetailShared.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RejectDialog } from './records/RejectDialog.jsx';
import { getStagePath } from './stagesConfig.jsx';
import { ClampText } from '../../components/ui/ClampText.jsx';

/**
 * Time remaining until the management-tier SLA deadline for a task waiting
 * on management approval — the clock starts the moment its department
 * manager approved it (`approvedAt`), running for the stage's own
 * `slaDays` window (the same field every other stage's due-date math uses).
 * Real, derived data; not a stored field. Null once a task has no department
 * approval timestamp yet (shouldn't happen for anything in this queue).
 */
function slaInfo(task, slaDays) {
  if (!task.approvedAt) return null;
  const due = new Date(new Date(task.approvedAt).getTime() + (slaDays || 5) * 86400000);
  const msLeft = due - new Date();
  const overdue = msLeft < 0;
  const abs = Math.abs(msLeft);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  return {
    due,
    overdue,
    atRisk: !overdue && abs < 24 * 3600000,
    text: overdue ? `Overdue by ${h}h ${m}m` : `${h}h ${m}m Left`,
  };
}

/** Split a task's attachments into images vs everything else, by resourceType. */
function attachmentCounts(task) {
  const atts = task.attachments || [];
  const images = atts.filter((a) => a.resourceType === 'image').length;
  const documents = atts.length - images;
  return { images, documents };
}

/** Client-side CSV export of the pending-approval task list. */
function exportApprovalTasksCsv(tasks, projectCode) {
  const header = ['Code', 'Title', 'Department', 'Assignee', 'Submitted On', 'Status', 'Priority'];
  const rows = tasks.map((t) => [
    t.code || '', t.title || '', deptMeta(t.department).label, t.assignee?.name || 'Unassigned',
    t.approvedAt ? fmtDateTime(t.approvedAt) : '', TASK_STATUS_META[t.status]?.label || t.status,
    PRIORITY_META[t.priority]?.label || t.priority,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectCode || 'approval-workflow'}-pending-approvals.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** One compact filter control — matches ExecutionPage's FilterBox pattern. */
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

/**
 * Rich, dense table for the tasks actually waiting on a decision right now —
 * search, department/priority filters, per-row Approve/Reject/View, bulk
 * approve/reject, pagination. Every action calls the same `useTaskDecision`
 * mutation (and the same server-side permission checks) as everywhere else
 * a task gets decided in this app; this is a denser shell around identical
 * business logic, not a second implementation of it.
 */
function PendingTasksTable({
  tasks, projectId, currentUser, slaDays, onSelectTask, onOpenTask, selectedTaskId,
}) {
  const decide = useTaskDecision(projectId);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dept, setDept] = useState('');
  const [priority, setPriority] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [rejectTarget, setRejectTarget] = useState(null); // { mode: 'single', task } | { mode: 'bulk', ids }
  const PAGE_SIZE = 10;

  const deptOptions = useMemo(() => [...new Set(tasks.map((t) => t.department).filter(Boolean))].sort(), [tasks]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.title?.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
      if (dept && t.department !== dept) return false;
      if (priority && t.priority !== priority) return false;
      return true;
    });
  }, [tasks, search, dept, priority]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const eligible = (t) => canManagementApprove(currentUser) && !isOwnTaskWork(currentUser, t, 'management');
  const allPagedSelectable = paged.filter(eligible);
  const allPagedSelected = allPagedSelectable.length > 0 && allPagedSelectable.every((t) => selected.has(t._id));
  const toggleSelectAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allPagedSelected) allPagedSelectable.forEach((t) => next.delete(t._id));
    else allPagedSelectable.forEach((t) => next.add(t._id));
    return next;
  });
  const toggleSelected = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const doApprove = (task) => decide.mutate({ taskId: task._id, decision: 'approve' });
  const confirmReject = (reason) => {
    if (rejectTarget.mode === 'single') {
      decide.mutate({ taskId: rejectTarget.task._id, decision: 'reject', reason }, { onSuccess: () => setRejectTarget(null) });
    } else {
      rejectTarget.ids.forEach((id) => decide.mutate({ taskId: id, decision: 'reject', reason }));
      setSelected(new Set());
      setRejectTarget(null);
    }
  };
  const bulkApprove = () => {
    [...selected].forEach((id) => decide.mutate({ taskId: id, decision: 'approve' }));
    setSelected(new Set());
  };

  if (tasks.length === 0) {
    return <EmptyState icon={CheckCircle2} title="Nothing waiting for approval" hint="Tasks show up here once their department manager approves them in Execution." />;
  }

  return (
    <div className="col gap-3">
      <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
        <div className="filter-search" style={{ flex: '1 1 220px' }}>
          <Search size={14} className="muted" />
          <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Search tasks…" />
        </div>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setFiltersOpen((o) => !o)}>
          Filters <ChevronDown size={13} style={{ marginLeft: 6, transform: filtersOpen ? 'rotate(180deg)' : undefined }} />
        </button>
        <div style={{ position: 'relative' }}>
          <button
            type="button" className="btn btn-primary btn-sm"
            disabled={selected.size === 0}
            onClick={() => document.getElementById('aw-bulk-menu')?.classList.toggle('open')}
          >
            Bulk Actions ({selected.size}) <ChevronDown size={13} style={{ marginLeft: 6 }} />
          </button>
          <div id="aw-bulk-menu" className="card aw-bulk-menu" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 20, minWidth: 180, padding: 6, boxShadow: 'var(--shadow-2)', display: 'none' }}>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--aw-green)' }} onClick={() => { document.getElementById('aw-bulk-menu')?.classList.remove('open'); bulkApprove(); }}>
              <Check size={14} style={{ marginRight: 6 }} /> Approve Selected
            </button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', color: 'var(--aw-red)' }} onClick={() => { document.getElementById('aw-bulk-menu')?.classList.remove('open'); setRejectTarget({ mode: 'bulk', ids: [...selected] }); }}>
              <X size={14} style={{ marginRight: 6 }} /> Reject Selected
            </button>
          </div>
        </div>
      </div>

      {filtersOpen && (
        <div className="row gap-2 wrap">
          <FilterBox label="Department" icon={ChevronDown}>
            <select value={dept} onChange={(e) => { setPage(1); setDept(e.target.value); }}>
              <option value="">All</option>
              {deptOptions.map((d) => <option key={d} value={d}>{deptMeta(d).label}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Priority" icon={ChevronDown}>
            <select value={priority} onChange={(e) => { setPage(1); setPriority(e.target.value); }}>
              <option value="">All</option>
              {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </FilterBox>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState title="No tasks match these filters" hint="Try clearing a filter." />
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}><input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAll} /></th>
                  <th>Task</th><th>Department</th><th>Assignee</th><th>Submitted On</th>
                  <th>SLA</th><th>Status</th><th>Priority</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((t) => {
                  const dm = deptMeta(t.department);
                  const st = TASK_STATUS_META[t.status] || {};
                  const pr = PRIORITY_META[t.priority] || {};
                  const sla = slaInfo(t, slaDays);
                  const selfWork = isOwnTaskWork(currentUser, t, 'management');
                  const canDecide = canManagementApprove(currentUser) && !selfWork;
                  const disabledTitle = selfWork
                    ? "You can't approve or reject your own task — it needs a second person to sign off."
                    : !canDecide ? 'Only a Manager or Admin can decide it' : '';
                  return (
                    <tr key={t._id} style={{ background: String(selectedTaskId) === String(t._id) ? 'var(--surface-hover)' : undefined }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t._id)} disabled={!canDecide} onChange={() => toggleSelected(t._id)} />
                      </td>
                      <td style={{ cursor: 'pointer' }} onClick={() => onSelectTask(t)}>
                        <div className="col task-title-cell">
                          <ClampText
                            lines={2}
                            as="span"
                            className="task-title-text"
                            title={t.title}
                            onMore={() => onSelectTask(t)}
                          >
                            {t.title}
                          </ClampText>
                          <span className="tiny muted">{t.code}</span>
                        </div>
                      </td>
                      <td>{t.department ? <Badge color={dm.color}>{dm.label}</Badge> : <span className="tiny muted">—</span>}</td>
                      <td>
                        {t.assignee?.name ? (
                          <div className="row gap-2" style={{ alignItems: 'center' }}>
                            <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={24} />
                            <span className="sm">{t.assignee.name}</span>
                          </div>
                        ) : <span className="tiny muted">Unassigned</span>}
                      </td>
                      <td className="sm">{t.approvedAt ? fmtDateTime(t.approvedAt) : '—'}</td>
                      <td>
                        {sla ? (
                          <span className="row gap-1 sm" style={{ alignItems: 'center', color: sla.overdue ? 'var(--danger)' : sla.atRisk ? 'var(--warning)' : 'var(--text-muted)' }}>
                            <Clock size={13} /> {sla.text}
                          </span>
                        ) : <span className="tiny muted">—</span>}
                      </td>
                      <td>{st.label && <Badge color={st.color} soft={st.soft} dot>{st.label}</Badge>}</td>
                      <td>
                        {pr.label && (
                          <Badge color={pr.color} soft={pr.soft}>
                            {(t.priority === 'high' || t.priority === 'critical') && <ChevronUp size={11} style={{ marginRight: 2, verticalAlign: '-1px' }} />}
                            {pr.label}
                          </Badge>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row gap-1" style={{ alignItems: 'center' }}>
                          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="View" onClick={() => onSelectTask(t)}><Eye size={14} /></button>
                          <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--aw-green)' }} disabled={!canDecide || decide.isPending} title={disabledTitle || 'Approve'} onClick={() => doApprove(t)}><Check size={15} /></button>
                          <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ color: 'var(--aw-red)' }} disabled={!canDecide || decide.isPending} title={disabledTitle || 'Reject'} onClick={() => setRejectTarget({ mode: 'single', task: t })}><X size={15} /></button>
                          <button type="button" className="btn btn-ghost btn-icon btn-sm" title="More" onClick={() => onOpenTask(t)}><MoreVertical size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="tiny muted">Showing {(currentPage - 1) * PAGE_SIZE + 1} to {Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length} task{visible.length === 1 ? '' : 's'}</span>
            {pageCount > 1 && (
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <button key={p} className={`btn btn-icon btn-sm ${p === currentPage ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
              </div>
            )}
          </div>
        </>
      )}

      <RejectDialog
        open={!!rejectTarget}
        title={rejectTarget?.mode === 'bulk' ? `Reject ${rejectTarget.ids.length} tasks` : `Reject ${rejectTarget?.task?.title || ''}`}
        onClose={() => setRejectTarget(null)}
        onConfirm={confirmReject}
        pending={decide.isPending}
        placeholder="Why is this being rejected?"
      />
    </div>
  );
}

/**
 * A simple, read-only row for a task that's already been decided (Approved or
 * Rejected) — no actions, since the decision is already made; "View Details"
 * is the row click itself, matching every other task list in the app.
 */
function DecidedTaskRow({ task, tone, onOpen }) {
  const dm = deptMeta(task.department);
  const decidedAt = tone === 'approved' ? task.managementApprovedAt : task.rejectedAt;
  const decidedBy = tone === 'approved' ? task.managementApprovedBy?.name : task.rejectedBy?.name;
  return (
    <div
      className="row gap-3"
      style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
      onClick={() => onOpen(task)}
    >
      {tone === 'approved'
        ? <CheckCircle2 size={15} style={{ color: 'var(--aw-green)', flexShrink: 0 }} />
        : <XCircle size={15} style={{ color: 'var(--aw-red)', flexShrink: 0 }} />}
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="sm" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
        <span className="tiny muted">{task.code}{tone === 'rejected' && task.rejectReason ? ` · ${task.rejectReason}` : ''}</span>
      </div>
      {task.department && <Badge color={dm.color}>{dm.label}</Badge>}
      {task.assignee?.name && (
        <div className="row gap-2" style={{ alignItems: 'center', flexShrink: 0 }}>
          <Avatar name={task.assignee.name} color={task.assignee.avatarColor} size={22} />
          <span className="tiny muted">{task.assignee.name}</span>
        </div>
      )}
      <span className="tiny muted" style={{ flexShrink: 0 }}>
        {decidedBy ? `${decidedBy} · ` : ''}{decidedAt ? fmtDate(decidedAt) : '—'}
      </span>
    </div>
  );
}

/** Approved Tasks / Rejected Tasks / Audit Log — one card, three tabs. */
function TaskTabsCard({ approvedTasks, rejectedTasks, selectedTask, projectId, onOpenTask, navigate }) {
  const [tab, setTab] = useState('approved');
  const { data: activity } = useProjectActivity(projectId);
  const taskActivity = selectedTask
    ? (activity || []).filter((a) => a.entityType === 'task' && String(a.entityId) === String(selectedTask._id))
    : [];

  return (
    <SectionCard>
      <div className="tabs" style={{ padding: '0 0 4px' }}>
        <button type="button" className={`tab${tab === 'approved' ? ' active' : ''}`} onClick={() => setTab('approved')}>Approved Tasks ({approvedTasks.length})</button>
        <button type="button" className={`tab${tab === 'rejected' ? ' active' : ''}`} onClick={() => setTab('rejected')}>Rejected Tasks ({rejectedTasks.length})</button>
        <button type="button" className={`tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>Audit Log</button>
      </div>
      <div style={{ padding: '14px 16px' }}>
        {tab === 'approved' && (
          approvedTasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No execution tasks approved yet" hint="Tasks approved here will show up as they clear management sign-off." />
          ) : (
            <div className="col">{approvedTasks.map((t) => <DecidedTaskRow key={t._id} task={t} tone="approved" onOpen={onOpenTask} />)}</div>
          )
        )}
        {tab === 'rejected' && (
          rejectedTasks.length === 0 ? (
            <EmptyState icon={XCircle} title="No execution tasks rejected" hint="Rejected tasks will show up here until they're resubmitted." />
          ) : (
            <div className="col">{rejectedTasks.map((t) => <DecidedTaskRow key={t._id} task={t} tone="rejected" onOpen={onOpenTask} />)}</div>
          )
        )}
        {tab === 'audit' && (
          !selectedTask ? (
            <EmptyState icon={Activity} title="Select a task" hint="Pick a task above to see its own activity timeline." />
          ) : (
            <div className="col gap-2">
              <ActivityLog activity={taskActivity.slice(0, 6)} />
              {taskActivity.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => navigate(`/projects/${projectId}/tasks/${encodeURIComponent(selectedTask.code)}?tab=activity`)}>
                  View full activity log <ArrowRight size={13} style={{ marginLeft: 4 }} />
                </button>
              )}
            </div>
          )
        )}
      </div>
    </SectionCard>
  );
}

/** Task Details side panel for whichever task is currently selected. */
function TaskDetailsPanel({ task, onClose }) {
  if (!task) {
    return (
      <SectionCard title="Task Details">
        <EmptyState title="Nothing selected" hint="Pick a task from the table to see its details here." />
      </SectionCard>
    );
  }
  const dm = deptMeta(task.department);
  const { images, documents } = attachmentCounts(task);
  const checklist = task.checklist || [];
  const checklistDone = checklist.filter((c) => c.done).length;

  return (
    <SectionCard
      title="Task Details"
      action={<button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={15} /></button>}
    >
      <div className="col gap-3">
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <div className="list-row-icon" style={{ width: 32, height: 32, background: 'var(--aw-purple-soft)', color: 'var(--aw-purple)' }}>
            <ClipboardList size={16} />
          </div>
          <div className="col">
            <span className="sm" style={{ fontWeight: 650 }}>{task.title}</span>
            <span className="tiny muted">{task.code}</span>
          </div>
          {task.department && <Badge color={dm.color}>{dm.label}</Badge>}
        </div>

        <div className="col gap-1">
          <span className="tiny subtle upper">Assignee</span>
          <span className="sm">{task.assignee?.name || 'Unassigned'}</span>
        </div>

        <div className="col gap-1">
          <span className="tiny subtle upper">Completed On</span>
          <span className="sm">{task.actualEnd ? fmtDateTime(task.actualEnd) : '—'}</span>
        </div>

        <div className="col gap-1">
          <span className="tiny subtle upper">Department Approved By</span>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span className="sm">{task.approvedBy?.name || '—'}{task.approvedAt ? `, ${fmtDateTime(task.approvedAt)}` : ''}</span>
            {task.approvedBy && <Badge color="var(--aw-green)" soft="rgba(34,197,94,0.12)">Approved</Badge>}
          </div>
        </div>

        <div className="col gap-1">
          <span className="tiny subtle upper">Attachments</span>
          <div className="col gap-1">
            <span className="sm row gap-2" style={{ alignItems: 'center' }}><ImageIcon size={14} className="muted" /> {images} Images</span>
            <span className="sm row gap-2" style={{ alignItems: 'center' }}><FileText size={14} className="muted" /> {documents} Documents</span>
          </div>
        </div>

        {checklist.length > 0 && (
          <div className="col gap-1">
            <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
              <span className="tiny subtle upper">Checklist Progress</span>
              <span className="tiny muted">{checklistDone}/{checklist.length} Completed</span>
            </div>
            <ProgressBar value={Math.round((checklistDone / checklist.length) * 100)} height={6} gradient="#059669" />
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * Bottom-of-page gate for Phase 7 -> Phase 8. Every condition here is a
 * client-side preview computed from the same `execTasks` already loaded —
 * "Proceed to Phase 8" always calls the real, server-validated completeStage()
 * (see project.service.js's p7 branch) and surfaces whatever it says, rather
 * than trusting this preview as the gate. Phase 7 completes purely on
 * Execution's tasks being fully Approved at the management tier — it has no
 * tasks or records of its own.
 */
function ApprovalCompletionCard({
  execTasks, stage, projectId, completeStage, navigate, error, setError, blockedReason,
}) {
  const total = execTasks.length;
  const approved = execTasks.filter((t) => t.status === 'approved').length;
  const pending = execTasks.filter((t) => t.status === 'waiting_management_approval').length;
  const rejected = execTasks.filter((t) => t.status === 'rejected').length;

  const isCompleted = stage?.status === 'completed';

  const onProceed = () => {
    setError('');
    completeStage.mutate(stage.key, {
      onSuccess: () => navigate(getStagePath(projectId, 'p8')),
      onError: (err) => setError(err?.response?.data?.message || 'Approval Workflow is not ready to complete yet.'),
    });
  };

  if (isCompleted) {
    return (
      <SectionCard title="Approval Completion Status">
        <div className="col gap-2" style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
          <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 700 }}>
            <CheckCircle2 size={16} /> Approval Workflow Completed
          </span>
          <span className="tiny muted">All Execution Tasks Approved</span>
        </div>
      </SectionCard>
    );
  }

  const conditions = [
    ...(blockedReason ? [{ label: 'Upstream Phases', ok: false, value: 'Not ready' }] : []),
    { label: 'Tasks Approved', ok: total > 0 && approved === total, value: `${approved}/${total}` },
    { label: 'Pending Approval', ok: pending === 0, value: pending },
    { label: 'Rejected', ok: rejected === 0, value: rejected },
  ];

  return (
    <SectionCard title="Approval Completion Status">
      <div className="col gap-3">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          {conditions.map((c) => (
            <div key={c.label} className="row gap-2" style={{ alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
              {c.ok ? <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} /> : <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
              <div className="col">
                <span className="tiny subtle upper">{c.label}</span>
                <span className="sm" style={{ fontWeight: 650 }}>{c.value}</span>
              </div>
            </div>
          ))}
        </div>
        {error && <span className="sm" style={{ color: 'var(--danger)' }}>{error}</span>}
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={completeStage.isPending} onClick={onProceed}>
            <ArrowRight size={14} style={{ marginRight: 6 }} /> {completeStage.isPending ? 'Completing…' : 'Proceed to Phase 8'}
          </button>
          {blockedReason && <span className="tiny muted">{blockedReason}</span>}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * Approval Workflow — Phase 7's entire job is reviewing Execution's (P6)
 * tasks at the second, management tier. It has no tasks or records of its
 * own: every task shown here already exists as a P6 Task document, reviewed
 * here only once its department manager has cleared it.
 */
export function ApprovalWorkflowPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading, isError, refetch } = useProject(id);
  const { data: execTasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey: 'p6', limit: 500 });
  const execTasks = execTasksResp?.data || execTasksResp || [];

  const completeStage = useCompleteStage(id);
  const user = useAppSelector(selectCurrentUser);

  const [completeError, setCompleteError] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const tabsRef = useRef(null);

  const stageKey = 'p7';
  const stage = project?.stages?.find((s) => s.key === stageKey);
  const slaDays = stage?.slaDays || 5;

  const p6Stage = project?.stages?.find((s) => s.key === 'p6');
  const isExecutionComplete = p6Stage?.status === 'completed';

  const pendingTasks = execTasks.filter((t) => t.status === 'waiting_management_approval');
  const approvedTasks = execTasks.filter((t) => t.status === 'approved');
  const rejectedTasks = execTasks.filter((t) => t.status === 'rejected');
  // `total` (every p6 task, including ones still todo/in_progress/blocked
  // and never yet submitted) is what the real completion gate needs — the
  // server won't unlock Phase 8 until literally all of them are Approved, so
  // ApprovalCompletionCard below deliberately keeps using it verbatim.
  // Display-only counts (the progress bar, the KPI percentages) should not
  // count a task that hasn't even reached this phase's story yet, so they
  // use `reachedApproval` instead — only tasks that have actually been
  // submitted for approval at least once (pending + approved + rejected).
  const total = execTasks.length;
  const reachedApproval = pendingTasks.length + approvedTasks.length + rejectedTasks.length;

  const blockedReason = !isExecutionComplete
    ? 'Execution (Phase 6) is not completed yet — finish and approve every task there first.'
    : total === 0
      ? 'There are no Execution tasks to review yet.'
      : null;

  const selectedTask = execTasks.find((t) => String(t._id) === String(selectedTaskId))
    || (selectedTaskId === null ? pendingTasks[0] : null);

  const openTaskDetail = (t) => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`);
  const selectTask = (t) => setSelectedTaskId(t._id);

  if (isLoading || tasksLoading) {
    return (<><Topbar title="Approval Workflow" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (isError || !project) {
    return (
      <>
        <Topbar title="Approval Workflow" />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><AlertTriangle size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Couldn’t load this project</span>
                <span className="sm muted">The project service didn’t respond. Please try again.</span>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => refetch()}><RotateCcw size={15} style={{ marginRight: 6 }} /> Retry</button>
            </div>
          </div>
        </div>
      </>
    );
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

  const slaAtRiskCount = pendingTasks.filter((t) => {
    const s = slaInfo(t, slaDays);
    return s && (s.overdue || s.atRisk);
  }).length;

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
        actions={(
          <>
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => exportApprovalTasksCsv(pendingTasks, project.code)}>
              <Download size={14} style={{ marginRight: 6 }} /> Export
            </button>
            <button type="button" className="btn btn-subtle btn-sm" onClick={() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <Activity size={14} style={{ marginRight: 6 }} /> Activity Log
            </button>
          </>
        )}
      />
      <div className="content approval-workflow-page">
        <div className="se-page se-page--tight-top col gap-3 fade-in">
          {blockedReason && (
            <div
              className="row gap-2"
              style={{
                alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8,
                background: 'var(--warning)0F', border: '1px solid var(--warning)33',
              }}
            >
              <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
              <div className="col" style={{ gap: 2 }}>
                <span className="sm" style={{ fontWeight: 650 }}>Not ready yet</span>
                <span className="tiny muted">{blockedReason}</span>
              </div>
            </div>
          )}

          <div className="col gap-3">
              {/* What this phase is for, in the words the business uses.
                  "Approval Workflow" is the one phase name that describes a
                  mechanism rather than an outcome, so without this the page
                  gives a reader no way to work out why it exists or what it
                  wants from them. The second line is role-aware: an approver
                  needs to know whether the queue is theirs to clear. */}
              <div className="stage-explain">
                <div className="stage-explain-main">
                  <span className="stage-explain-step">Step 7 of 10 · the gate before launch</span>
                  <p className="stage-explain-text">
                    Nobody signs off their own work, and no single department can clear the
                    project on its own. Every task finished in Execution is approved twice —
                    once by the department that owns it, then once here by management.
                    This page is the second signature, and the one place anything stuck is visible.
                  </p>

                  {/* The two-tier rule stated as a sequence. "Approval Workflow"
                      names a mechanism, not an outcome, so a reader arriving
                      cold cannot infer where this sits without being shown. */}
                  <div className="stage-flow">
                    <span>Doer finishes task</span>
                    <span className="stage-flow-arrow">→</span>
                    <span>Dept. manager approves</span>
                    <span className="stage-flow-arrow">→</span>
                    <span className="is-here">Management approves · you are here</span>
                    <span className="stage-flow-arrow">→</span>
                    <span>Counts toward Store Readiness</span>
                  </div>
                  <p className="stage-explain-text" style={{ marginTop: 6, color: 'var(--text-subtle)' }}>
                    {/* `canManagementApprove` is the same rule the server
                        enforces in task.service.js — not a role string test,
                        so it stays correct as roles change. */}
                    {canManagementApprove(user)
                      ? pendingTasks.length === 0
                        ? 'Nothing is waiting on you right now.'
                        : `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} waiting on your decision.`
                      : 'You can follow progress here. Approving is a Manager, EA or MD decision.'}
                  </p>
                </div>
              </div>

              <KpiStrip
                cards={[
                  {
                    key: 'pending', label: 'Pending Approval', value: pendingTasks.length, sub: 'Tasks waiting for you',
                    icon: Clock, color: 'var(--warning)', soft: 'var(--warning-soft)',
                    onClick: () => navigate(`/projects/${id}/approval-workflow/kpi/pending`),
                  },
                  {
                    key: 'approved', label: 'Approved', value: approvedTasks.length,
                    sub: reachedApproval ? `${Math.round((approvedTasks.length / reachedApproval) * 100)}% of total` : '—',
                    icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)',
                    onClick: () => navigate(`/projects/${id}/approval-workflow/kpi/approved`),
                  },
                  {
                    key: 'rejected', label: 'Rejected', value: rejectedTasks.length,
                    sub: reachedApproval ? `${Math.round((rejectedTasks.length / reachedApproval) * 100)}% of total` : '0% of total',
                    icon: XCircle, color: 'var(--danger)', soft: 'var(--danger-soft)',
                    onClick: () => navigate(`/projects/${id}/approval-workflow/kpi/rejected`),
                  },
                  {
                    key: 'slaRisk', label: 'SLA Risk', value: slaAtRiskCount,
                    sub: slaAtRiskCount === 0 ? 'No tasks at risk' : 'Due within 24h or overdue',
                    icon: ShieldAlert, color: 'var(--aw-purple, #8b5cf6)', soft: 'rgba(139,92,246,0.12)',
                  },
                ]}
              />

              <SectionCard>
                <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
                  <div className="col gap-1" style={{ flex: '2 1 320px', minWidth: 240 }}>
                    <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                      <span className="sm" style={{ fontWeight: 650 }}>Execution Progress</span>
                      <span className="sm muted">{approvedTasks.length} / {reachedApproval} Tasks Fully Approved</span>
                    </div>
                    <ProgressBar value={reachedApproval ? Math.round((approvedTasks.length / reachedApproval) * 100) : 0} height={8} gradient="#059669" />
                  </div>
                  <div className="row gap-2" style={{ alignItems: 'center', flex: '1 1 260px' }}>
                    <div className="list-row-icon" style={{ width: 34, height: 34, background: 'var(--info-soft)', color: 'var(--info)' }}>
                      <ClipboardList size={16} />
                    </div>
                    <div className="col">
                      <span className="tiny subtle upper">Remaining to Complete Phase 7</span>
                      <span className="sm" style={{ fontWeight: 600 }}>
                        {pendingTasks.length + rejectedTasks.length === 0
                          ? 'Nothing left — ready to proceed'
                          : `${pendingTasks.length} task${pendingTasks.length === 1 ? '' : 's'} waiting for your management approval`}
                      </span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title={`Pending Approval Tasks (${pendingTasks.length})`}
                subtitle="Execution tasks cleared by department and waiting for management approval"
              >
                <PendingTasksTable
                  tasks={pendingTasks}
                  projectId={id}
                  currentUser={user}
                  slaDays={slaDays}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={selectTask}
                  onOpenTask={openTaskDetail}
                />
              </SectionCard>

              <div className="row gap-3 wrap" style={{ alignItems: 'stretch' }} ref={tabsRef}>
                <div style={{ flex: '1 1 340px', minWidth: 300 }}>
                  <TaskTabsCard
                    approvedTasks={approvedTasks}
                    rejectedTasks={rejectedTasks}
                    selectedTask={selectedTask}
                    projectId={id}
                    onOpenTask={openTaskDetail}
                    navigate={navigate}
                  />
                </div>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <TaskDetailsPanel task={selectedTask} onClose={() => setSelectedTaskId(undefined)} />
                </div>
              </div>

              <ApprovalCompletionCard
                execTasks={execTasks}
                stage={stage}
                projectId={id}
                completeStage={completeStage}
                navigate={navigate}
                error={completeError}
                setError={setCompleteError}
                blockedReason={blockedReason}
              />
          </div>
        </div>
      </div>
    </>
  );
}

export default ApprovalWorkflowPage;
