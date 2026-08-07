import { cloneElement, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, AlertTriangle,
  Search, ChevronUp, ChevronDown, CalendarDays, ListTodo, Download, Plus,
  MessageCircle, Paperclip, FileUp, Flag, Link2, Timer,
  Send, XCircle, ArrowRight, ShieldCheck, Ban, RotateCcw,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, Avatar } from '../../components/ui/primitives.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { StageExplainer } from '../../components/ui/StageExplainer.jsx';
import { ClampText } from '../../components/ui/ClampText.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { DonutChart, TrendArea } from '../../components/charts/chartkit.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { resolveP4ApprovedProperty } from './records/recordUi.js';
import { useProject, useCompleteStage } from '../../app/api/projectsApi.js';
import {
  useTasks, useUpdateTaskStatus, useDeleteTask, useCreateTask,
} from '../../app/api/tasksApi.js';
import { fmtDateTime, fmtDate, daysUntil } from '../../lib/format.js';
import {
  TASK_STATUS_META, TASK_STATUS_ORDER, TASK_STATUS_SELECTABLE, PRIORITY_META, DEPT_META, deptMeta,
  isTaskDelayed, TASK_WORK_DONE_STATUSES,
} from '../../lib/ui.js';
import { DeadlinesPanel, ActivityPanel, AllocateTaskModal } from './DepartmentPlanningPage.jsx';
import { RowActionsMenu } from './DepartmentTasksPage.jsx';
import { TaskBoard } from '../tasks/TaskBoard.jsx';
import { ApprovalQueue } from '../tasks/ApprovalQueue.jsx';
import { MonthCalendar } from '../calendar/MonthCalendar.jsx';
import { DayDossier } from '../calendar/DayDossier.jsx';
import { monthWindow } from '../calendar/calendarUtils.js';
import { getStagePath } from './stagesConfig.jsx';
import dayjs from '../../lib/dayjs.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';

const EXEC_STAGE = 'p6';
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const EMPTY_FILTERS = { search: '', department: '', status: '', priority: '', assignee: '', dueBefore: '', sortBy: 'dueDate' };

/** Client-side CSV export of the tasks currently loaded — real data, no server round trip. */
function exportTasksCsv(tasks, projectCode) {
  const header = ['Code', 'Title', 'Department', 'Priority', 'Status', 'Assignee', 'Due Date', 'Progress %'];
  const rows = tasks.map((t) => [
    t.code || '', t.title || '', DEPT_META[t.department] || t.department || '', PRIORITY_META[t.priority]?.label || t.priority || '',
    TASK_STATUS_META[t.status]?.label || t.status || '', t.assignee?.name || 'Unassigned',
    t.plannedEnd ? fmtDate(t.plannedEnd) : '', t.checklistProgress ?? 0,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${projectCode || 'execution'}-tasks.csv`;
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

/**
 * Execution Records — every allocated task across every department. Reads
 * the same `Task` documents Department Planning's "Allocate Task" creates
 * (stageKey 'p6') — a task shows up here the instant it's allocated.
 * Same rich table/filter/bulk-action pattern as the Department drill-down
 * page (DepartmentTasksPage) — reuses its FilterField/RowActionsMenu rather
 * than a second copy — plus a Department column, since this spans all of them.
 */
/** One compact filter control — small label and value sharing a single bordered box. */
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

function ExecutionRecordsTable({ tasks, projectId, projectCode, onOpenTask, onNewTask, currentUser }) {
  const navigate = useNavigate();
  const updateStatus = useUpdateTaskStatus(projectId);
  const deleteTask = useDeleteTask(projectId);
  // Server: `DELETE /pms/tasks/:id` requires `canManage` (admin|manager).
  // This table used to render Delete Task / bulk-delete for every role.
  const canDeleteTasks = can.decide(currentUser?.role);
  // The Approval Queue is the one place inside Execution where a department
  // manager actually decides a task — unlike every other view here, it must
  // NOT carry ?from=execution, or TaskDetailPage hides Approve/Reject entirely.
  const openTaskForApproval = (t) => navigate(`/projects/${projectId}/tasks/${encodeURIComponent(t.code)}`);

  const [tab, setTab] = useState('list');
  const [f, setF] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [selected, setSelected] = useState(() => new Set());
  const setField = (k) => (e) => { setPage(1); setF((old) => ({ ...old, [k]: e.target.value })); };

  const deptOptions = useMemo(() => [...new Set(tasks.map((t) => t.department).filter(Boolean))].sort(), [tasks]);
  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    for (const t of tasks) if (t.assignee?._id) seen.set(t.assignee._id, t.assignee.name);
    return [...seen.entries()];
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const filtered = tasks.filter((t) => {
      if (q && !t.title?.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
      if (f.department && t.department !== f.department) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      if (f.assignee && String(t.assignee?._id || '') !== f.assignee) return false;
      if (f.dueBefore && (!t.plannedEnd || new Date(t.plannedEnd) > new Date(`${f.dueBefore}T23:59:59`))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (f.sortBy === 'priority') return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (f.sortBy === 'status') return TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status);
      if (f.sortBy === 'title') return (a.title || '').localeCompare(b.title || '');
      return new Date(a.plannedEnd || 0) - new Date(b.plannedEnd || 0);
    });
  }, [tasks, f]);

  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTasks = visibleTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  /** Windowed page numbers with "…" gaps — first, last, and a run around the current page. */
  const pageList = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([1, 2, pageCount - 1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
    const nums = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < nums.length; i += 1) {
      if (i > 0 && nums[i] - nums[i - 1] > 1) out.push('…');
      out.push(nums[i]);
    }
    return out;
  }, [pageCount, currentPage]);
  const allPagedSelected = pagedTasks.length > 0 && pagedTasks.every((t) => selected.has(t._id));
  const toggleSelectAll = () => setSelected((s) => {
    const next = new Set(s);
    if (allPagedSelected) pagedTasks.forEach((t) => next.delete(t._id));
    else pagedTasks.forEach((t) => next.add(t._id));
    return next;
  });
  const toggleSelected = (taskId) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
    return next;
  });

  const onDelete = (task) => {
    if (!window.confirm(`Delete "${task.title}"? This can't be undone.`)) return;
    deleteTask.mutate(task._id, { onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete this task — try again.') });
  };
  const bulkSetStatus = (status) => { for (const taskId of selected) updateStatus.mutate({ id: taskId, status }); setSelected(new Set()); };
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selected.size} selected task${selected.size === 1 ? '' : 's'}? This can't be undone.`)) return;
    for (const taskId of selected) deleteTask.mutate(taskId, { onError: (err) => window.alert(err?.response?.data?.message || 'Could not delete one of the selected tasks — try again.') });
    setSelected(new Set());
  };

  return (
    <div className="col gap-3">
      {tab === 'list' && tasks.length > 0 && (
        <div className="filter-toolbar">
          <div className="filter-search">
            <Search size={14} className="muted" />
            <input value={f.search} onChange={setField('search')} placeholder="Search tasks by name, ID…" />
          </div>
          <FilterBox label="Department" icon={ChevronDown}>
            <select value={f.department} onChange={setField('department')}>
              <option value="">All</option>
              {deptOptions.map((d) => <option key={d} value={d}>{DEPT_META[d] || d}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Status" icon={ChevronDown}>
            <select value={f.status} onChange={setField('status')}>
              <option value="">All</option>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Priority" icon={ChevronDown}>
            <select value={f.priority} onChange={setField('priority')}>
              <option value="">All</option>
              {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Assignee" icon={ChevronDown}>
            <select value={f.assignee} onChange={setField('assignee')}>
              <option value="">All</option>
              {assigneeOptions.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Due Date" icon={CalendarDays}>
            <input type="date" value={f.dueBefore} onChange={setField('dueBefore')} />
          </FilterBox>

          <button type="button" className="btn-new-task" onClick={onNewTask}>
            <Plus size={15} /> New Task
          </button>
        </div>
      )}

      <ExecutionToolbar projectId={projectId} tasks={tasks} exportTasks={visibleTasks} projectCode={projectCode} activeTab={tab} onTabChange={setTab} />

      {tab === 'approvals' && (
        <SectionCard title="Approval Queue" subtitle="Every task Waiting Approval — actionable by that task's department manager (or an Admin)">
          <ApprovalQueue tier="department" tasks={tasks} onOpenTask={openTaskForApproval} projectId={projectId} currentUser={currentUser} />
        </SectionCard>
      )}

      {tab === 'gantt' && (
        <SectionCard title="Gantt Chart" subtitle="Planned start → due date for every scheduled task" bodyClass="card-body exec-gantt-card-body">
          <ExecutionGanttView tasks={tasks} onOpenTask={onOpenTask} />
        </SectionCard>
      )}

      {tab === 'workload' && (
        <SectionCard title="Workload" subtitle="Task load per assignee across this project">
          <ExecutionWorkloadView tasks={tasks} onOpenTask={onOpenTask} />
        </SectionCard>
      )}

      {tab === 'timeline' && (
        <SectionCard title="Timeline" subtitle="Every task, grouped by how soon it's due">
          <ExecutionTimelineView tasks={tasks} onOpenTask={onOpenTask} />
        </SectionCard>
      )}

      {tab === 'kanban' && (
        <SectionCard title="Kanban Board" subtitle="Drag a task into another column to change its status">
          {tasks.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />
          ) : (
            <TaskBoard projectId={projectId} tasks={tasks} />
          )}
        </SectionCard>
      )}

      {tab === 'calendar' && (
        <SectionCard title="Calendar" subtitle="Every task on this project, laid out by due date" bodyClass="card-body exec-cal-card-body">
          {tasks.length === 0 ? (
            <div style={{ padding: 'var(--space-5)' }}>
              <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />
            </div>
          ) : (
            <ExecutionCalendarView tasks={tasks} onOpenTask={onOpenTask} />
          )}
        </SectionCard>
      )}

      {tab === 'list' && (
      <SectionCard title={`Task List (${visibleTasks.length})`} subtitle={`${tasks.length} tasks filed in total`}>
        {tasks.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />
        ) : visibleTasks.length === 0 ? (
          <EmptyState title="No tasks match these filters" hint="Try clearing a filter." />
        ) : (
          <div className="col gap-2">
            {selected.size > 0 && (
              <div className="row gap-2" style={{ alignItems: 'center', padding: '8px 10px', background: 'var(--surface-hover)', borderRadius: 'var(--radius-sm)' }}>
                <span className="sm grow" style={{ fontWeight: 600 }}>{selected.size} selected</span>
                <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) bulkSetStatus(e.target.value); e.target.value = ''; }} style={{ padding: '4px 8px', fontSize: 13 }}>
                  <option value="" disabled>Set status to…</option>
                  {TASK_STATUS_SELECTABLE.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
                </select>
                {canDeleteTasks && (
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={bulkDelete}>Delete selected</button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}><input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAll} /></th>
                    <th>Task Details</th><th>Department</th><th>Priority</th><th>Status</th>
                    <th>Assignee</th><th>Due Date</th><th>Progress</th><th>Dependencies</th><th>Updated</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTasks.map((t) => {
                    const pr = PRIORITY_META[t.priority] || {};
                    // Execution's own list only needs to say whether the work
                    // itself is done or not — the approval pipeline a task
                    // moves through afterward is Approval Workflow's story.
                    const executed = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'].includes(t.status);
                    const dm = deptMeta(t.department);
                    const overdue = t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date();
                    const escalated = t.priority === 'high' || t.priority === 'critical';
                    const progress = t.checklistProgress ?? 0;
                    const dLeft = t.plannedEnd ? daysUntil(t.plannedEnd) : null;
                    return (
                      <tr
                        key={t._id}
                        onClick={() => onOpenTask?.(t)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t._id)} onChange={() => toggleSelected(t._id)} /></td>
                        <td>
                          <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                            <div className="list-row-icon" style={{ width: 30, height: 30, borderRadius: 'var(--radius-sm)', background: `${pr.color || 'var(--text-subtle)'}1A`, color: pr.color || 'var(--text-subtle)', flexShrink: 0 }}>
                              <ClipboardList size={14} />
                            </div>
                            {/* Bounded width + a two-line clamp. Titles here are
                                free text and people paste whole paragraphs into
                                them; unclamped, one such task grew its row to
                                the height of the viewport and pushed every
                                other task off screen. "Read more" opens the
                                task rather than expanding in place — the full
                                text belongs on the detail page, not in a cell
                                that would shove the rest of the table down. */}
                            <div className="col task-title-cell">
                              <ClampText
                                lines={2}
                                as="span"
                                className="task-title-text"
                                title={t.title}
                                onMore={() => onOpenTask?.(t)}
                              >
                                {t.title}
                              </ClampText>
                              <span className="tiny muted">{t.code}</span>
                              <span className="row gap-3" style={{ alignItems: 'center', marginTop: 2 }}>
                                <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><MessageCircle size={11} /> {t.comments?.length || 0}</span>
                                <span className="tiny muted row gap-1" style={{ alignItems: 'center' }}><Paperclip size={11} /> {t.attachments?.length || 0}</span>
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{t.department ? <Badge color={dm.color}>{dm.label}</Badge> : <span className="tiny muted">—</span>}</td>
                        <td>
                          {pr.label && (
                            <Badge color={pr.color} soft={pr.soft}>
                              {escalated && <ChevronUp size={11} style={{ marginRight: 2, verticalAlign: '-1px' }} />}
                              {pr.label}
                            </Badge>
                          )}
                        </td>
                        <td>
                          <Badge color={executed ? 'var(--success)' : 'var(--warning)'} soft={executed ? 'var(--success-soft)' : 'var(--warning-soft)'} dot>
                            {executed ? 'Executed' : 'Pending'}
                          </Badge>
                        </td>
                        <td>
                          {t.assignee?.name ? (
                            <div className="row gap-2" style={{ alignItems: 'center' }}>
                              <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={26} />
                              <div className="col">
                                <span className="sm">{t.assignee.name}</span>
                                {t.assignee.title && <span className="tiny muted">{t.assignee.title}</span>}
                              </div>
                            </div>
                          ) : <span className="tiny muted">Unassigned</span>}
                        </td>
                        <td>
                          <div className="col">
                            <span className="row gap-1 sm" style={{ alignItems: 'center', whiteSpace: 'nowrap' }}><CalendarDays size={13} className="muted" /> {fmtDate(t.plannedEnd)}</span>
                            {dLeft != null && t.status !== 'done' && (
                              <span className="tiny" style={{ color: dLeft < 0 ? 'var(--danger)' : dLeft <= 2 ? 'var(--warning)' : 'var(--success)' }}>
                                {dLeft < 0
                                  ? `Overdue by ${Math.abs(dLeft)} day${Math.abs(dLeft) === 1 ? '' : 's'}`
                                  : dLeft === 0 ? 'Due today' : `${dLeft} day${dLeft === 1 ? '' : 's'} left`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ minWidth: 90 }}>
                          <div className="col gap-1">
                            <span className="tiny muted">{progress}%</span>
                            <div style={{ height: 5, borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-primary)' }} />
                            </div>
                          </div>
                        </td>
                        <td>
                          {t.dependencies?.length ? (
                            <div className="row gap-1 wrap">
                              {t.dependencies.map((d) => (
                                <span key={d._id || d.code} className="tiny" style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap' }}>
                                  {d.code}
                                </span>
                              ))}
                            </div>
                          ) : <span className="tiny muted">—</span>}
                        </td>
                        <td className="tiny muted">{fmtDate(t.updatedAt)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <RowActionsMenu task={t} onStatusChange={(s) => updateStatus.mutate({ id: t._id, status: s })} onDelete={() => onDelete(t)} canDelete={canDeleteTasks} deleting={deleteTask.isPending} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="tiny muted">
                Showing {visibleTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, visibleTasks.length)} of {visibleTasks.length} tasks
              </span>
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>‹</button>
                {pageList.map((p, i) => (
                  p === '…'
                    ? <span key={`gap-${i}`} className="tiny muted" style={{ padding: '0 4px' }}>…</span>
                    : (
                      <button
                        key={p}
                        className={`btn btn-icon btn-sm ${p === currentPage ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    )
                ))}
                <button className="btn btn-ghost btn-icon btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
                <select className="select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ padding: '4px 8px', fontSize: 13, marginLeft: 6 }}>
                  {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}/page</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
      </SectionCard>
      )}
    </div>
  );
}

/**
 * Non-blocking banner for a project that hasn't met Execution's upstream
 * prerequisites yet. Deliberately NOT an EmptyState that replaces the page —
 * the tasks exist and stay workable; only the Phase 7 hand-off waits.
 */
function ExecutionReadinessNotice({ reason }) {
  return (
    <div
      className="row gap-2"
      style={{
        alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8,
        background: 'var(--warning)0F', border: '1px solid var(--warning)33',
      }}
    >
      <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
      <div className="col" style={{ gap: 2 }}>
        <span className="sm" style={{ fontWeight: 650 }}>Not ready to hand off to Phase 7</span>
        <span className="tiny muted">{reason}</span>
      </div>
    </div>
  );
}

/**
 * Bottom-of-page gate for Phase 6 → Phase 7. Every condition here is a
 * client-side preview only, computed from the same `tasks` already loaded —
 * "Proceed to Phase 7" always calls the real, server-validated
 * completeStage() (see project.service.js's p6 branch) and surfaces whatever
 * it says, rather than trusting this preview as the actual gate.
 */
function ExecutionCompletionCard({ tasks, stage, projectId, completeStage, navigate, blockedReason }) {
  const [error, setError] = useState('');
  const total = tasks.length;
  const approved = tasks.filter((t) => t.status === 'approved').length;
  const pendingApproval = tasks.filter((t) => t.status === 'waiting_approval').length;
  const rejected = tasks.filter((t) => t.status === 'rejected').length;
  const notCompleted = tasks.filter((t) => !TASK_WORK_DONE_STATUSES.includes(t.status)).length;

  const byId = useMemo(() => {
    const m = new Map();
    for (const t of tasks) m.set(String(t._id), t);
    return m;
  }, [tasks]);
  // A dependency counts as cleared once its own department manager has
  // signed it off — the same DEPT_CLEARED bar completeStage()'s p6 branch
  // uses. (This previously required full `approved`, which is Phase 7's bar,
  // so the panel could report work as unresolved that the server considered
  // fine.)
  const DEPT_CLEARED = ['done', 'waiting_management_approval', 'approved'];
  const unresolvedDeps = tasks.filter((t) => (t.dependencies || []).some((d) => {
    const depStatus = byId.get(String(d._id || d))?.status;
    return depStatus && !DEPT_CLEARED.includes(depStatus);
  })).length;
  const pendingChecklist = tasks.filter((t) => (t.checklist || []).some((c) => c.required && !c.done)).length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;

  const isCompleted = stage?.status === 'completed';

  // The readiness rule lives on the SERVER (project.service.js's p6 branch).
  // This panel reports state; it doesn't decide. The button stays live and
  // the server's own reasons are surfaced verbatim if it refuses — the old
  // client-side `allReady` was stricter than the real gate, so it could hide
  // a hand-off the server would happily have accepted.
  const onProceed = () => {
    setError('');
    completeStage.mutate(stage.key, {
      onSuccess: () => navigate(getStagePath(projectId, 'p7')),
      onError: (err) => setError(err?.response?.data?.message || 'Execution is not ready to complete yet.'),
    });
  };

  if (isCompleted) {
    return (
      <SectionCard title="Execution Completion Status">
        <div className="col gap-2" style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
          <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 700 }}>
            <CheckCircle2 size={16} /> Execution Completed Successfully
          </span>
          <span className="tiny muted">All Tasks Approved · All Documents Verified · Dependencies Cleared</span>
        </div>
      </SectionCard>
    );
  }

  const conditions = [
    ...(blockedReason ? [{ label: 'Upstream Phases', ok: false, value: 'Not ready' }] : []),
    { label: 'Tasks Completed', ok: notCompleted === 0, value: `${total - notCompleted}/${total}` },
    { label: 'Approvals Approved', ok: total > 0 && approved === total, value: `${approved}/${total}` },
    { label: 'Pending Approval', ok: pendingApproval === 0, value: pendingApproval },
    { label: 'Rejected', ok: rejected === 0, value: rejected },
    { label: 'Dependencies', ok: unresolvedDeps === 0, value: unresolvedDeps === 0 ? 'Cleared' : `${unresolvedDeps} unresolved` },
    { label: 'Required Checklist', ok: pendingChecklist === 0, value: pendingChecklist === 0 ? 'Completed' : `${pendingChecklist} pending` },
    { label: 'Blocked', ok: blocked === 0, value: blocked },
  ];

  return (
    <SectionCard title="Execution Completion Status">
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
            <ArrowRight size={14} style={{ marginRight: 6 }} /> {completeStage.isPending ? 'Completing…' : 'Proceed to Phase 7'}
          </button>
          {blockedReason && <span className="tiny muted">{blockedReason}</span>}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * Project-scoped Kanban and Calendar reuse the same board/calendar building
 * blocks as their standalone pages (TaskBoard, MonthCalendar, DayDossier)
 * instead of duplicating that UI — they just get fed this project's `tasks`
 * instead of a fresh fetch, and render inline instead of taking over the page.
 */
function ExecutionCalendarView({ tasks, onOpenTask }) {
  const [selectedDay, setSelectedDay] = useState(() => dayjs().startOf('day'));
  const [shownMonth, setShownMonth] = useState(() => dayjs().startOf('month'));
  const [dir, setDir] = useState('next');

  const events = useMemo(() => tasks
    .filter((t) => t.plannedEnd || t.plannedStart)
    .map((t) => ({
      id: t._id,
      type: 'task',
      title: t.title,
      code: t.code,
      status: t.status,
      priority: t.priority,
      department: t.department,
      assignee: t.assignee,
      stageName: t.stageName,
      start: t.plannedStart || t.plannedEnd,
      end: t.plannedEnd || t.plannedStart,
    })), [tasks]);

  const [windowFrom, windowTo] = useMemo(() => monthWindow(shownMonth), [shownMonth.valueOf()]);

  const selectDay = (day) => {
    const d = day.startOf('day');
    setDir(d.isBefore(selectedDay) ? 'prev' : 'next');
    setSelectedDay(d);
    setShownMonth((m) => (d.isSame(m, 'month') ? m : d.startOf('month')));
  };
  const stepMonth = (delta) => {
    const next = shownMonth.add(delta, 'month');
    const today = dayjs().startOf('day');
    setDir(delta > 0 ? 'next' : 'prev');
    setShownMonth(next);
    setSelectedDay(today.isSame(next, 'month') ? today : next.startOf('month'));
  };
  const jumpMonth = (month) => {
    const today = dayjs().startOf('day');
    setDir(month.isBefore(shownMonth) ? 'prev' : 'next');
    setShownMonth(month.startOf('month'));
    setSelectedDay(today.isSame(month, 'month') ? today : month.startOf('month'));
  };
  const goToday = () => {
    const today = dayjs().startOf('day');
    setDir(today.isBefore(selectedDay) ? 'prev' : 'next');
    setSelectedDay(today);
    setShownMonth(today.startOf('month'));
  };

  const onSelectEvent = (ev) => {
    const task = tasks.find((t) => t._id === ev.id);
    if (task) onOpenTask?.(task);
  };

  return (
    <div className="exec-cal-body">
      <aside className="cal-monthpane" aria-label="Month calendar">
        <MonthCalendar
          shownMonth={shownMonth}
          selectedDay={selectedDay}
          events={events}
          onSelectDay={selectDay}
          onStepMonth={stepMonth}
          onJumpMonth={jumpMonth}
          onToday={goToday}
        />
      </aside>
      <section className="cal-stage">
        <DayDossier
          day={selectedDay}
          events={events}
          windowFrom={windowFrom}
          windowTo={windowTo}
          dir={dir}
          isLoading={false}
          onSelect={onSelectEvent}
          onSelectDay={selectDay}
        />
      </section>
    </div>
  );
}

const GANTT_DAY_WIDTH = 32;

/**
 * A day-resolution bar chart from each task's planned start to its due date.
 * Tasks with neither date are skipped — there is no honest place to draw
 * them. The visible range is derived from the tasks themselves (plus a
 * little padding) rather than a fixed month, since a project's schedule
 * rarely lines up with calendar-month boundaries.
 */
function ExecutionGanttView({ tasks, onOpenTask }) {
  const rows = useMemo(() => tasks
    .filter((t) => t.plannedStart || t.plannedEnd)
    .map((t) => {
      const start = dayjs(t.plannedStart || t.plannedEnd).startOf('day');
      const endRaw = dayjs(t.plannedEnd || t.plannedStart).startOf('day');
      return { task: t, start, end: endRaw.isBefore(start) ? start : endRaw };
    })
    .sort((a, b) => a.start.valueOf() - b.start.valueOf()), [tasks]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Nothing scheduled yet"
        hint="Set a planned start and due date on a task to see it on the timeline."
      />
    );
  }

  const rangeStart = rows.reduce((min, r) => (r.start.isBefore(min) ? r.start : min), rows[0].start).subtract(2, 'day');
  const rangeEnd = rows.reduce((max, r) => (r.end.isAfter(max) ? r.end : max), rows[0].end).add(2, 'day');
  const dayCount = rangeEnd.diff(rangeStart, 'day') + 1;
  const days = Array.from({ length: dayCount }, (_, i) => rangeStart.add(i, 'day'));
  const today = dayjs().startOf('day');
  const todayIndex = today.isBefore(rangeStart) || today.isAfter(rangeEnd) ? null : today.diff(rangeStart, 'day');

  const monthGroups = [];
  days.forEach((d) => {
    const key = d.format('YYYY-MM');
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.key === key) last.count += 1;
    else monthGroups.push({ key, label: d.format('MMM YYYY'), count: 1 });
  });

  return (
    <div className="gantt-wrap">
      <div className="gantt-labels">
        <div className="gantt-labels-head">Task</div>
        {rows.map(({ task: t }) => (
          <button key={t._id} type="button" className="gantt-label-row" onClick={() => onOpenTask?.(t)} title={t.title}>
            <span className="gantt-label-title">{t.title}</span>
            <span className="tiny muted">{t.code}</span>
          </button>
        ))}
      </div>

      <div className="gantt-timeline-scroll">
        <div className="gantt-timeline" style={{ width: dayCount * GANTT_DAY_WIDTH }}>
          <div className="gantt-timeline-head">
            <div className="gantt-month-row">
              {monthGroups.map((m, i) => (
                <div key={`${m.key}-${i}`} className="gantt-month-cell" style={{ width: m.count * GANTT_DAY_WIDTH }}>
                  {m.label}
                </div>
              ))}
            </div>
            <div className="gantt-day-row">
              {days.map((d) => (
                <div
                  key={d.format('YYYY-MM-DD')}
                  className={`gantt-day-cell${[0, 6].includes(d.day()) ? ' weekend' : ''}${d.isSame(today, 'day') ? ' today' : ''}`}
                  style={{ width: GANTT_DAY_WIDTH }}
                >
                  {d.date()}
                </div>
              ))}
            </div>
          </div>

          {todayIndex != null && (
            <div className="gantt-today-line" style={{ left: todayIndex * GANTT_DAY_WIDTH + GANTT_DAY_WIDTH / 2 }} />
          )}

          {rows.map(({ task: t, start, end }) => {
            const st = TASK_STATUS_META[t.status] || {};
            const left = start.diff(rangeStart, 'day') * GANTT_DAY_WIDTH;
            const width = (end.diff(start, 'day') + 1) * GANTT_DAY_WIDTH;
            return (
              <div className="gantt-timeline-row" key={t._id}>
                <button
                  type="button"
                  className="gantt-bar"
                  style={{ left, width, background: st.color || 'var(--text-subtle)' }}
                  onClick={() => onOpenTask?.(t)}
                  title={`${t.title} · ${start.format('D MMM')} → ${end.format('D MMM')}`}
                >
                  <span className="gantt-bar-label">{t.title}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Per-assignee load: total/open/overdue counts, estimated hours, and a status mix bar. */
function ExecutionWorkloadView({ tasks, onOpenTask }) {
  const groups = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => {
      const key = t.assignee?._id || 'unassigned';
      if (!map.has(key)) {
        map.set(key, { key, name: t.assignee?.name || 'Unassigned', title: t.assignee?.title || '', avatarColor: t.assignee?.avatarColor, tasks: [] });
      }
      map.get(key).tasks.push(t);
    });
    return [...map.values()].sort((a, b) => b.tasks.length - a.tasks.length);
  }, [tasks]);

  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />;
  }

  return (
    <div className="col gap-3">
      {groups.map((g) => {
        const total = g.tasks.length;
        const open = g.tasks.filter((t) => t.status !== 'done').length;
        const overdue = g.tasks.filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date()).length;
        const hours = g.tasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
        const statusCounts = TASK_STATUS_ORDER
          .map((s) => ({ status: s, count: g.tasks.filter((t) => t.status === s).length, meta: TASK_STATUS_META[s] }))
          .filter((s) => s.count > 0);

        return (
          <div key={g.key} className="workload-row">
            <div className="workload-person">
              <Avatar name={g.name} color={g.avatarColor} size={36} />
              <div className="col">
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                {g.title && <span className="tiny muted">{g.title}</span>}
              </div>
            </div>

            <div className="workload-stats">
              <div className="workload-stat"><span className="workload-stat-n">{total}</span><span className="workload-stat-l">Total</span></div>
              <div className="workload-stat"><span className="workload-stat-n">{open}</span><span className="workload-stat-l">Open</span></div>
              <div className="workload-stat"><span className="workload-stat-n" style={{ color: overdue ? 'var(--danger)' : undefined }}>{overdue}</span><span className="workload-stat-l">Overdue</span></div>
              <div className="workload-stat"><span className="workload-stat-n">{hours}h</span><span className="workload-stat-l">Est. Hours</span></div>
            </div>

            <div className="workload-bar">
              {statusCounts.map((s) => (
                <span
                  key={s.status}
                  style={{ width: `${(s.count / total) * 100}%`, background: s.meta?.color || 'var(--text-subtle)' }}
                  title={`${s.meta?.label || s.status}: ${s.count}`}
                />
              ))}
            </div>

            <div className="workload-tasks">
              {g.tasks.slice(0, 6).map((t) => (
                <button key={t._id} type="button" className="workload-task-chip" onClick={() => onOpenTask?.(t)} title={t.title}>
                  {t.title}
                </button>
              ))}
              {g.tasks.length > 6 && <span className="tiny muted">+{g.tasks.length - 6} more</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const TIMELINE_SECTIONS = [
  { key: 'overdue', label: 'Overdue', tone: 'var(--danger)' },
  { key: 'today', label: 'Due Today', tone: 'var(--warning)' },
  { key: 'thisWeek', label: 'This Week', tone: 'var(--primary)' },
  { key: 'nextWeek', label: 'Next Week', tone: 'var(--secondary)' },
  { key: 'later', label: 'Later', tone: 'var(--text-subtle)' },
  { key: 'noDate', label: 'No Due Date', tone: 'var(--text-subtle)' },
];

/** Every task grouped by how soon it's due — a chronological read of the same data the Gantt chart plots as bars. */
function ExecutionTimelineView({ tasks, onOpenTask }) {
  const buckets = useMemo(() => {
    const today = dayjs().startOf('day');
    const endOfWeek = today.endOf('isoWeek');
    const endOfNextWeek = endOfWeek.add(1, 'week');
    const groups = { overdue: [], today: [], thisWeek: [], nextWeek: [], later: [], noDate: [] };

    tasks.forEach((t) => {
      if (!t.plannedEnd) { groups.noDate.push(t); return; }
      const due = dayjs(t.plannedEnd).startOf('day');
      if (t.status !== 'done' && due.isBefore(today)) groups.overdue.push(t);
      else if (due.isSame(today, 'day')) groups.today.push(t);
      else if (due.isSameOrBefore(endOfWeek)) groups.thisWeek.push(t);
      else if (due.isSameOrBefore(endOfNextWeek)) groups.nextWeek.push(t);
      else groups.later.push(t);
    });
    Object.values(groups).forEach((arr) => arr.sort((a, b) => new Date(a.plannedEnd || 0) - new Date(b.plannedEnd || 0)));
    return groups;
  }, [tasks]);

  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardList} title="No tasks filed yet" hint="Allocate tasks from Department Planning — they show up here automatically." />;
  }

  const visible = TIMELINE_SECTIONS.filter((s) => buckets[s.key].length > 0);

  return (
    <div className="timeline-wrap">
      {visible.map((s) => (
        <section key={s.key} className="timeline-section">
          <div className="timeline-section-head">
            <span className="timeline-section-dot" style={{ background: s.tone }} />
            <span className="timeline-section-label">{s.label}</span>
            <span className="timeline-section-count">{buckets[s.key].length}</span>
          </div>
          <div className="timeline-list">
            {buckets[s.key].map((t) => {
              const st = TASK_STATUS_META[t.status] || {};
              const pr = PRIORITY_META[t.priority] || {};
              return (
                <button key={t._id} type="button" className="timeline-item" onClick={() => onOpenTask?.(t)}>
                  <span className="timeline-item-dot" style={{ background: st.color || s.tone }} />
                  <span className="timeline-item-body">
                    <span className="timeline-item-title">{t.title}</span>
                    <span className="row gap-2" style={{ alignItems: 'center' }}>
                      <span className="tiny muted">{t.code}</span>
                      {t.plannedEnd && <span className="tiny muted">· {fmtDate(t.plannedEnd)}</span>}
                      {t.assignee?.name && <span className="tiny muted">· {t.assignee.name}</span>}
                    </span>
                  </span>
                  {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
                  <Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * Cumulative completion % over the trailing 7 days, ending today — read off
 * each task's real `actualEnd` (set server-side the moment a task is marked
 * done). No fabricated trend line: days with no completions just repeat the
 * prior day's cumulative %.
 */
function ProgressOverviewPanel({ tasks }) {
  const totalTasks = tasks.length;
  const data = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(23, 59, 59, 999);
      return d;
    });
    return days.map((d) => {
      const doneBy = tasks.filter((t) => t.actualEnd && new Date(t.actualEnd) <= d).length;
      return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), pct: totalTasks ? Math.round((doneBy / totalTasks) * 100) : 0 };
    });
  }, [tasks, totalTasks]);

  return (
    <SectionCard title="Progress Overview" subtitle="This Week">
      {totalTasks === 0 ? (
        <EmptyState title="No tasks yet" hint="The trend line fills in once tasks start completing." />
      ) : (
        <TrendArea data={data} dataKey="pct" name="Complete" height={180} suffix="%" />
      )}
    </SectionCard>
  );
}

/** Real status counts across every allocated task — no fabricated trend, just today's actual mix. */
function TaskStatusBreakdown({ tasks }) {
  const data = TASK_STATUS_ORDER
    .map((s) => ({ name: TASK_STATUS_META[s]?.label || s, value: tasks.filter((t) => t.status === s).length, color: TASK_STATUS_META[s]?.color }))
    .filter((d) => d.value > 0);

  return (
    <SectionCard title="Task Status Breakdown">
      {tasks.length === 0 ? (
        <EmptyState title="No tasks yet" hint="Allocate tasks to see the status mix here." />
      ) : (
        <>
          <DonutChart data={data} height={180} innerRadius={50} outerRadius={72} centerLabel={{ value: tasks.length, label: 'TASKS' }} />
          <div className="col gap-2" style={{ marginTop: 8 }}>
            {data.map((d) => (
              <div key={d.name} className="row gap-2" style={{ alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                <span className="sm grow">{d.name}</span>
                <span className="sm muted">{d.value} ({Math.round((d.value / tasks.length) * 100)}%)</span>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * Task List / Gantt / Kanban / Calendar view switcher, plus Export. New Task
 * lives in the filter toolbar below (ExecutionRecordsTable) instead of here.
 * Task List is this page; Kanban and Calendar hand off to the real pages that
 * already implement them (no second copy of that UI). Gantt has no real
 * implementation anywhere in the app yet, so it's disabled rather than faked.
 */
function ExecutionToolbar({ projectId, tasks, exportTasks, projectCode, activeTab, onTabChange }) {
  const pendingApprovalCount = tasks.filter((t) => t.status === 'waiting_approval').length;
  const TABS = [
    { key: 'list', label: 'Task List' },
    { key: 'approvals', label: `Approval Queue${pendingApprovalCount ? ` (${pendingApprovalCount})` : ''}` },
    { key: 'gantt', label: 'Gantt Chart' },
    { key: 'kanban', label: 'Kanban Board' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'workload', label: 'Workload' },
    { key: 'timeline', label: 'Timeline' },
  ];
  return (
    <div className="row gap-3" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', overflowX: 'auto' }}>
      <div className="tabs" style={{ flexShrink: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab${activeTab === t.key ? ' active' : ''}`}
            disabled={t.disabled}
            title={t.hint}
            onClick={t.disabled ? undefined : () => onTabChange(t.key)}
            style={t.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="row gap-2">
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => exportTasksCsv(exportTasks, projectCode)}>
          <Download size={14} style={{ marginRight: 6 }} /> Export
        </button>
      </div>
    </div>
  );
}

/** Real overdue tasks, worst-first. */
function DelayedTasksPanel({ tasks, onOpen }) {
  const delayed = useMemo(() => (
    tasks
      .filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date())
      .map((t) => ({ ...t, daysLate: Math.abs(daysUntil(t.plannedEnd)) }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 5)
  ), [tasks]);

  return (
    <SectionCard title="Delayed Tasks">
      {delayed.length === 0 ? (
        <EmptyState title="Nothing delayed" hint="No overdue tasks right now." />
      ) : (
        <div className="col">
          {delayed.map((t) => (
            <div
              key={t._id}
              className="row gap-2"
              style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={() => onOpen(t.department)}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: 'var(--danger)' }} />
              <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
              <span className="tiny" style={{ color: 'var(--danger)', flexShrink: 0 }}>{t.daysLate} day{t.daysLate === 1 ? '' : 's'} late</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** Bottom-row overdue list — same data as the sidebar's Delayed Tasks, with
 * a priority badge alongside each row (richer, wider layout has room for it). */
function TopOverdueTasksPanel({ tasks, onOpen }) {
  const delayed = useMemo(() => (
    tasks
      .filter((t) => t.status !== 'done' && t.plannedEnd && new Date(t.plannedEnd) < new Date())
      .map((t) => ({ ...t, daysLate: Math.abs(daysUntil(t.plannedEnd)) }))
      .sort((a, b) => b.daysLate - a.daysLate)
      .slice(0, 5)
  ), [tasks]);

  return (
    <SectionCard title="Top Overdue Tasks">
      {delayed.length === 0 ? (
        <EmptyState title="Nothing overdue" hint="No overdue tasks right now." />
      ) : (
        <div className="col">
          {delayed.map((t) => {
            const pr = PRIORITY_META[t.priority] || {};
            return (
              <div
                key={t._id}
                className="row gap-2"
                style={{ alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => onOpen(t.department)}
              >
                <AlertTriangle size={14} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span className="sm grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                <span className="tiny" style={{ color: 'var(--danger)', flexShrink: 0 }}>{t.daysLate} day{t.daysLate === 1 ? '' : 's'} overdue</span>
                {pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

/** Real, working actions only — no dead buttons. Icon-grid layout for the bottom row. */
function ExecQuickActions({ onNewTask }) {
  const ACTIONS = [
    { icon: Plus, label: 'Add New Task', color: 'var(--success)', onClick: onNewTask },
    { icon: FileUp, label: 'Upload Document', color: 'var(--info)', disabled: true, hint: 'Attach files from a task instead — there’s no project-level document store yet' },
    { icon: Flag, label: 'Create Milestone', color: 'var(--warning)', disabled: true, hint: 'Coming soon — milestones aren’t a modeled concept yet' },
    { icon: Link2, label: 'Add Dependency', color: 'var(--text-subtle)', disabled: true, hint: 'Set dependencies while creating or editing a task' },
  ];
  return (
    <SectionCard title="Quick Actions">
      <div className="row gap-2 wrap">
        {ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            className="col gap-2"
            disabled={a.disabled}
            title={a.hint}
            onClick={a.onClick}
            style={{
              flex: '1 1 110px', alignItems: 'center', padding: '14px 8px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'var(--surface)', cursor: a.disabled ? 'not-allowed' : 'pointer',
              opacity: a.disabled ? 0.5 : 1,
            }}
          >
            <div className="list-row-icon" style={{ width: 32, height: 32, background: `${a.color}1A`, color: a.color }}>
              <a.icon size={16} />
            </div>
            <span className="tiny" style={{ textAlign: 'center', fontWeight: 600 }}>{a.label}</span>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * Execution — tracks the same Task documents Department Planning (p5)
 * allocates (stageKey 'p6'). Dashboard layout: stats, filter/sort, a
 * List/Gantt/Kanban/Calendar view switcher, the task table, then a sidebar
 * (progress trend, status mix, deadlines, overdue) plus a bottom row
 * (recent activity, top overdue, quick actions) — all reading the real
 * Task model, no separate Record-based copy of this data.
 */
export function ExecutionPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading, isError, refetch } = useProject(id);

  const stageKey = EXEC_STAGE;

  // Property resolution is unchanged — Project Creation (p4) is still a
  // Record-based stage, so this part of the pipeline is untouched.
  const { data: shortlisted, isLoading: propertiesLoading } = useStageRecords(id, 'p1', { status: 'shortlisted' });
  const { data: projectCreationRecords } = useStageRecords(id, 'p4');

  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey, limit: 500 });
  const tasks = tasksResp?.data || tasksResp || [];

  const completeStage = useCompleteStage(id);
  const currentUser = useAppSelector(selectCurrentUser);

  // Department options for the "New Task" modal — same template lookup
  // Department Planning uses (departments live on the p5 stage template,
  // even though the tasks these create are tagged stageKey 'p6').
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const departments = (template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [])
    .map((t) => ({ key: t.key, name: t.name, subtitle: t.subtitle }));
  const createTask = useCreateTask(id);
  const [modal, setModal] = useState(null);
  // Task detail opens as its own page (/projects/:id/tasks/:taskId), not a drawer.
  const openTaskDetail = (t) => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}?from=execution`);
  const createNewTask = async (payload) => { await createTask.mutateAsync(payload); setModal(null); };

  // Eligibility: Department Planning (p5) complete, and a shortlisted property
  // that already has a submitted Project Creation record. Read p5 straight from
  // the project's own stage status (what "Mark Done"/the p5 baseline sets), not
  // from p5 Records, which the current Department Planning flow never creates.
  //
  // This is a *readiness* signal, not an access lock: the page always renders
  // its tasks and dashboard so the work is visible and editable. Only the
  // Phase 7 hand-off is gated, and that gate is enforced server-side by
  // completeStage() regardless of what this preview says.
  const p5Stage = project?.stages?.find((s) => s.key === 'p5');
  const isPlanningComplete = p5Stage?.status === 'completed';

  const property = isPlanningComplete ? resolveP4ApprovedProperty(shortlisted, projectCreationRecords) : null;
  const blockedReason = !isPlanningComplete
    ? 'Department Planning (Phase 5) is not complete yet — submit and get both approvals on the baseline before handing off to Phase 7.'
    : !property
      ? 'No shortlisted property has an approved Project Creation record yet, so this Execution stage has nothing to hand off to Phase 7.'
      : null;

  const totalTasks = tasks.length;
  // "Completed" = the assignee's own work is finished, regardless of where it
  // sits in the approval pipeline (Waiting Approval / Approved both count —
  // Rejected doesn't, it explicitly needs more work). Distinct from "Approved",
  // which is the narrower, fully-signed-off count the Completion card gates on.
  const completedTasks = tasks.filter((t) => TASK_WORK_DONE_STATUSES.includes(t.status)).length;
  const approvedTasks = tasks.filter((t) => t.status === 'approved').length;
  const waitingApprovalTasks = tasks.filter((t) => t.status === 'waiting_approval').length;
  const rejectedTasks = tasks.filter((t) => t.status === 'rejected').length;
  const overdueTasks = tasks.filter(isTaskDelayed).length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
  const todoTasks = tasks.filter((t) => t.status === 'todo').length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  // Delayed = tasks that finished behind their planned end date (task.model.js
  // sets completedOnTime once, at first completion, and it survives the
  // approval pipeline) — distinct from Overdue, which is tasks still actively
  // open past their due date.
  const delayedTasks = tasks.filter((t) => TASK_WORK_DONE_STATUSES.includes(t.status) && t.completedOnTime === false).length;
  const completedPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const approvedPct = totalTasks ? Math.round((approvedTasks / totalTasks) * 100) : 0;
  const inProgressPct = totalTasks ? Math.round((inProgressTasks / totalTasks) * 100) : 0;
  const todoPct = totalTasks ? Math.round((todoTasks / totalTasks) * 100) : 0;
  const overduePct = totalTasks ? Math.round((overdueTasks / totalTasks) * 100) : 0;

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const isCompleted = stage?.status === 'completed';

  if (isLoading) {
    return (<><Topbar title="Execution" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (isError || !project) {
    return (
      <>
        <Topbar title="Execution" />
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
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Execution</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Execution stage" hint="This project has no Execution stage." />
        </div>
      </>
    );
  }

  const loading = propertiesLoading || tasksLoading;

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
        <div
          className={`se-page se-page--tight-top content-wide fade-in exec-detail-grid${loading ? '' : ' exec-detail-grid--split'}`}
        >
        <div className="col gap-3">
          {loading ? (
            <SectionCard title="Project Summary">
              <InfoTile label="Loading…" value="…" />
            </SectionCard>
          ) : (
            <>
              {/* Readiness notice — informational only. The tasks below stay
                  fully visible and editable; it's the Phase 7 hand-off at the
                  bottom of the page that waits on these prerequisites. */}
              {blockedReason && <ExecutionReadinessNotice reason={blockedReason} />}
              {/* Overview stats — shared KpiStrip carrying the same 10 status
                  metrics the old ExecStatCard row showed — no data changed,
                  just the shared enterprise KPI-card look every other phase
                  now uses. */}
              <StageExplainer
                stageKey="p6"
                project={project}
                fallback="Do the work the departments were given, and keep its status honest. Every task here was allocated in Department Planning; when one is finished it goes for department sign-off, then management approval in Phase 7."
                todo={
                  overdueTasks > 0
                    ? `${overdueTasks} task${overdueTasks === 1 ? '' : 's'} past due — those need attention first.`
                    : 'Open a task to update its status, add evidence, or submit it for approval.'
                }
              />

              <div className="row gap-2" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 520px', minWidth: 0 }}>
                  <KpiStrip cards={[
                    {
                      key: 'total', label: 'Total Tasks', value: totalTasks, sub: 'Across all departments',
                      icon: ClipboardList, color: 'var(--chart-3)', soft: 'color-mix(in srgb, var(--chart-3) 14%, transparent)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/total`),
                    },
                    {
                      key: 'completed', label: 'Completed', value: completedTasks, sub: `${completedPct}% of total`,
                      icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/completed`),
                    },
                    {
                      key: 'inProgress', label: 'In Progress', value: inProgressTasks, sub: `${inProgressPct}% of total`,
                      icon: Clock, color: 'var(--warning)', soft: 'var(--warning-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/inProgress`),
                    },
                    {
                      key: 'assigned', label: 'Assigned', value: todoTasks, sub: `${todoPct}% of total`,
                      icon: ListTodo, color: 'var(--chart-2)', soft: 'color-mix(in srgb, var(--chart-2) 14%, transparent)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/assigned`),
                    },
                    {
                      key: 'waitingApproval', label: 'Waiting Approval', value: waitingApprovalTasks, sub: 'Needs sign-off',
                      icon: Send, color: 'var(--chart-7)', soft: 'color-mix(in srgb, var(--chart-7) 14%, transparent)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/waitingApproval`),
                    },
                    {
                      key: 'approved', label: 'Approved', value: approvedTasks, sub: `${approvedPct}% of total`,
                      icon: ShieldCheck, color: 'var(--success)', soft: 'var(--success-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/approved`),
                    },
                    {
                      key: 'rejected', label: 'Rejected', value: rejectedTasks, sub: 'Needs rework',
                      icon: XCircle, color: 'var(--danger)', soft: 'var(--danger-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/rejected`),
                    },
                    {
                      key: 'blocked', label: 'Blocked', value: blockedTasks, sub: 'Needs unblocking',
                      icon: Ban, color: 'var(--danger)', soft: 'var(--danger-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/blocked`),
                    },
                    {
                      key: 'overdue', label: 'Overdue', value: overdueTasks, sub: `${overduePct}% of total`,
                      icon: AlertTriangle, color: 'var(--danger)', soft: 'var(--danger-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/overdue`),
                    },
                    {
                      key: 'delayed', label: 'Delayed', value: delayedTasks, sub: 'Finished late',
                      icon: Timer, color: 'var(--warning)', soft: 'var(--warning-soft)',
                      onClick: () => navigate(`/projects/${id}/execution/kpi/delayed`),
                    },
                  ]} />
                </div>
              </div>

              <ExecutionRecordsTable tasks={tasks} projectId={id} projectCode={project.code} onOpenTask={openTaskDetail} onNewTask={() => setModal(true)} currentUser={currentUser} />

              <div className="row gap-3" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}><ActivityPanel projectId={id} title="Recent Activity" /></div>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}>
                  <TopOverdueTasksPanel tasks={tasks} onOpen={(dept) => navigate(`/projects/${id}/department-planning/${dept}`)} />
                </div>
                <div style={{ flex: '1 1 320px', minWidth: 280 }}><ExecQuickActions onNewTask={() => setModal(true)} /></div>
              </div>

              <ExecutionCompletionCard tasks={tasks} stage={stage} projectId={id} completeStage={completeStage} navigate={navigate} blockedReason={blockedReason} />
            </>
          )}
        </div>

        {!loading && (
          <div className="col gap-3">
            <ProgressOverviewPanel tasks={tasks} />
            <TaskStatusBreakdown tasks={tasks} />
            <DeadlinesPanel tasks={tasks} onOpen={() => navigate('/calendar')} />
            <DelayedTasksPanel tasks={tasks} onOpen={(dept) => navigate(`/projects/${id}/department-planning/${dept}`)} />
          </div>
        )}
        </div>
      </div>

      <AllocateTaskModal
        open={!!modal}
        onClose={() => setModal(null)}
        projectId={id}
        departments={departments}
        presetDept=""
        onCreate={createNewTask}
        creating={createTask.isPending}
      />
    </>
  );
}

export default ExecutionPage;
