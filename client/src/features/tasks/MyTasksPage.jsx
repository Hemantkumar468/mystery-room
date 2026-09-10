/**
 * My Tasks — one person's desk.
 *
 * Every other page is organised around a project; this one answers a single
 * question — "what do I have to do?" — and is the landing page for Employees.
 *
 * A plain numbered table, deliberately: a serial number, the task, where it
 * belongs, when it is due, its state, and a Done button. No grouped sections
 * with headings to decode — the chips up top answer "what is late / due today /
 * waiting" as a filter, and the Due column carries the same signal in colour.
 *
 * Filtering and paging are client-side: `/pms/tasks/mine` returns one person's
 * work — tens of rows, not thousands — so a round trip per keystroke would buy
 * nothing and cost the instant feel that makes a filter worth using.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass,
  Search, X, RotateCcw, Inbox, ChevronLeft, ChevronRight, ListTodo,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { StatusBadge, PriorityBadge, EmptyState, ErrorState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useMyTasks, useUpdateTaskStatusMutation } from '../../app/api/tasksApi.js';
import { ChecklistWarningModal } from './ChecklistWarningModal.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import dayjs from '../../lib/dayjs.js';
import { fmtDate, fromNow } from '../../lib/format.js';

/**
 * Sign-off states that mean the work has left this person's desk.
 *
 * These are `approvalState` values, not statuses. They were read off `status`,
 * which since the three-state migration can only be pending/processing/
 * complete -- so nothing ever landed in the Waiting view.
 */
const AWAITING_APPROVALS = ['waiting_department', 'waiting_management'];

/**
 * Urgency views. `key` is the chip value; a task belongs to exactly one. These
 * are FILTERS, not section headings — the list itself stays one flat table.
 */
const VIEWS = [
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'var(--danger)' },
  { key: 'today', label: 'Due today', icon: Clock, tone: 'var(--warning)' },
  { key: 'week', label: 'This week', icon: CalendarClock, tone: 'var(--info)' },
  { key: 'upcoming', label: 'Upcoming', icon: ListTodo, tone: 'var(--text-subtle)' },
  { key: 'awaiting', label: 'Waiting', icon: Hourglass, tone: 'var(--info)' },
  { key: 'done', label: 'Completed', icon: CheckCircle2, tone: 'var(--success)' },
];

const SORTS = [
  { key: 'due', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'project', label: 'Project' },
  { key: 'title', label: 'Title (A–Z)' },
];

const PAGE_SIZES = [10, 20, 25, 50, 100];

/** High-to-low, so "sort by priority" puts the urgent work at the top. */
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** Which view a task belongs to, evaluated once per task. */
function viewFor(task, now) {
  const approval = task.approvalState || 'none';
  if (approval === 'approved') return 'done';
  if (AWAITING_APPROVALS.includes(approval)) return 'awaiting';
  if (task.status === 'complete') return 'done';
  if (!task.plannedEnd) return 'upcoming';
  const due = dayjs(task.plannedEnd);
  if (due.isBefore(now, 'day')) return 'overdue';
  if (due.isSame(now, 'day')) return 'today';
  if (due.isBefore(now.add(7, 'day'), 'day')) return 'week';
  return 'upcoming';
}

const EMPTY_FILTERS = { project: '', priority: '', status: '' };

export function MyTasksPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError, refetch } = useMyTasks();
  const [updateStatus, statusReq] = useUpdateTaskStatusMutation();

  const [view, setView] = useState('all');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('due');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  /** Every task with its view resolved — the single list everything derives from. */
  const tagged = useMemo(() => {
    const now = dayjs();
    return [...(data?.open || []), ...(data?.recentlyDone || [])]
      .map((task) => ({ ...task, view: viewFor(task, now) }));
  }, [data]);

  /** Dropdown options come from the data, so no filter can select an empty set. */
  const options = useMemo(() => {
    const projects = new Map();
    const priorities = new Set();
    const statuses = new Set();
    for (const t of tagged) {
      if (t.project?._id) projects.set(t.project._id, t.project.name || 'Untitled project');
      if (t.priority) priorities.add(t.priority);
      if (t.status) statuses.add(t.status);
    }
    return {
      projects: [...projects].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      priorities: [...priorities].sort((a, b) => (PRIORITY_RANK[a] ?? 9) - (PRIORITY_RANK[b] ?? 9)),
      statuses: [...statuses].sort(),
    };
  }, [tagged]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = tagged.filter((t) => {
      if (view !== 'all' && t.view !== view) return false;
      if (filters.project && t.project?._id !== filters.project) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (!q) return true;
      return [t.title, t.code, t.project?.name, t.stageName, t.description]
        .some((v) => (v || '').toLowerCase().includes(q));
    });

    const byDue = (a, b) => {
      if (!a.plannedEnd && !b.plannedEnd) return 0;
      if (!a.plannedEnd) return 1;
      if (!b.plannedEnd) return -1;
      return new Date(a.plannedEnd) - new Date(b.plannedEnd);
    };
    const cmp = {
      due: byDue,
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byDue(a, b),
      project: (a, b) => (a.project?.name || '').localeCompare(b.project?.name || '') || byDue(a, b),
      title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    }[sort] || byDue;
    return [...rows].sort(cmp);
  }, [tagged, view, filters, sort, search]);

  const counts = useMemo(() => {
    const c = { all: tagged.length };
    for (const v of VIEWS) c[v.key] = 0;
    for (const t of tagged) c[t.view] += 1;
    return c;
  }, [tagged]);

  /* Paging — reset to page 1 whenever the result set changes shape, so a
     filter can never leave the reader stranded on an empty page 4. */
  useEffect(() => { setPage(1); }, [view, filters, sort, search, pageSize]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstIndex = (safePage - 1) * pageSize;

  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const resetAll = () => { setView('all'); setFilters(EMPTY_FILTERS); setSearch(''); setSort('due'); };
  const isFiltered = view !== 'all' || search || filters.project || filters.priority || filters.status;

  /**
   * Completing from the list warns about an open checklist exactly as the task
   * page does — same dialog, same wording. The server no longer refuses a
   * pending checklist (task.service.js#assertCompletable), so without this the
   * row button would silently close a task over items its owner still meant to
   * tick, which is the opposite failure from the old hard refusal.
   */
  const [confirmTask, setConfirmTask] = useState(null);
  const complete = (task) => updateStatus({ id: task._id, status: 'complete', projectId: task.project?._id });
  const markDone = (task) => {
    const openItems = (task.checklist || []).filter((c) => !c.done);
    if (openItems.length) { setConfirmTask({ task, items: openItems }); return; }
    complete(task);
  };

  const firstName = (user?.name || '').split(' ')[0];
  const actionable = tagged.filter((t) => !['awaiting', 'done'].includes(t.view)).length;
  const subtitle = actionable
    ? `${actionable} task${actionable === 1 ? '' : 's'} need${actionable === 1 ? 's' : ''} your attention`
    : 'Nothing needs your attention right now';

  return (
    <>
      <Topbar title={firstName ? `${firstName}’s tasks` : 'My Tasks'} subtitle={subtitle} />
      <div className="content mytasks-content">
        {isLoading ? <SkTable /> : isError ? (
          <ErrorState title="Couldn’t load your tasks" onRetry={refetch} />
        ) : tagged.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No tasks assigned to you"
            hint="When a project assigns you work, it appears here automatically."
          />
        ) : (
          <>
            {/* ── Chips: one click = one urgency view ── */}
            <div className="mytasks-toolbar">
              <div className="mytasks-chips">
                <button type="button" className={`mytasks-chip${view === 'all' ? ' active' : ''}`} onClick={() => setView('all')}>
                  All <span className="mytasks-chip-count">{counts.all}</span>
                </button>
                {VIEWS.map((v) => (
                  <button
                    type="button"
                    key={v.key}
                    className={`mytasks-chip${view === v.key ? ' active' : ''}`}
                    style={{ '--chip-accent': v.tone }}
                    onClick={() => setView(view === v.key ? 'all' : v.key)}
                    disabled={counts[v.key] === 0}
                  >
                    <v.icon size={13} /> {v.label} <span className="mytasks-chip-count">{counts[v.key]}</span>
                  </button>
                ))}
              </div>

              <div className="mytasks-tools">
                <div className="mytasks-search">
                  <Search size={14} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title, code, project…"
                    aria-label="Search tasks"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="mytasks-search-clear">
                      <X size={13} />
                    </button>
                  )}
                </div>
                <select className="mytasks-select" value={filters.project} onChange={setFilter('project')} aria-label="Filter by project">
                  <option value="">All projects</option>
                  {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="mytasks-select" value={filters.priority} onChange={setFilter('priority')} aria-label="Filter by priority">
                  <option value="">Any priority</option>
                  {options.priorities.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
                <select className="mytasks-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tasks">
                  {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
                </select>
                {isFiltered && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
                    <RotateCcw size={13} /> Reset
                  </button>
                )}
              </div>
            </div>

            {/* ── One flat, numbered table ── */}
            {filtered.length === 0 ? (
              <EmptyState
                icon={Search}
                title="Nothing matches"
                hint="Try another view or clear the filters."
                action={<button type="button" className="btn btn-subtle btn-sm" onClick={resetAll}><RotateCcw size={14} /> Reset</button>}
              />
            ) : (
              <div className="card mytasks-card">
                <div className="mytasks-tablewrap">
                  <table className="table mytasks-table">
                    <thead>
                      <tr>
                        <th className="mt-col-no">No.</th>
                        <th>Task</th>
                        <th className="mt-col-where">Project · Phase</th>
                        <th className="mt-col-due">Due</th>
                        <th className="mt-col-status">Status</th>
                        <th className="mt-col-action"><span className="sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((task, i) => {
                        const to = task.project?._id && task.code ? `/projects/${task.project._id}/tasks/${task.code}` : null;
                        const meta = VIEWS.find((v) => v.key === task.view);
                        const canDone = !['awaiting', 'done'].includes(task.view);
                        const busy = statusReq.isLoading && statusReq.originalArgs?.id === task._id;
                        return (
                          <tr
                            key={task._id}
                            className={`mytasks-tr is-${task.view}${to ? ' is-clickable' : ''}`}
                            onClick={to ? (e) => {
                              if (e.target.closest('a, button, input, label, [role="button"]')) return;
                              navigate(to);
                            } : undefined}
                          >
                            <td className="mt-col-no mono">{firstIndex + i + 1}</td>
                            <td className="mt-col-task">
                              {to ? <Link to={to} className="mytasks-title">{task.title}</Link> : <span className="mytasks-title">{task.title}</span>}
                              <div className="mytasks-sub">
                                {task.priority && task.view !== 'done' && <PriorityBadge value={task.priority} />}
                                {task.code && <span className="mono tiny muted">{task.code}</span>}
                              </div>
                            </td>
                            <td className="mt-col-where">
                              <span className="mytasks-where">
                                <span className="truncate">{task.project?.name || '—'}</span>
                                {/* The city belongs on the row: someone with six
                                    tasks across three cities plans their day from
                                    this list, not by opening each one. */}
                                <span className="tiny muted truncate">
                                  {[task.project?.city, task.stageName].filter(Boolean).join(' · ')}
                                </span>
                              </span>
                            </td>
                            <td className="mt-col-due">
                              {task.view === 'done' ? (
                                <span className="tiny muted nowrap">{fromNow(task.completedAt || task.actualEnd)}</span>
                              ) : (
                                <span className="mytasks-due nowrap" style={{ color: meta?.tone }}>
                                  {task.plannedEnd ? fmtDate(task.plannedEnd) : 'No date'}
                                  {task.view === 'overdue' && <span className="mytasks-due-tag">Overdue</span>}
                                  {task.view === 'today' && <span className="mytasks-due-tag">Today</span>}
                                </span>
                              )}
                            </td>
                            <td className="mt-col-status"><StatusBadge value={task.status} /></td>
                            <td className="mt-col-action">
                              {canDone && (
                                <button
                                  type="button"
                                  className="btn btn-outline-success btn-sm mytasks-done"
                                  onClick={() => markDone(task)}
                                  disabled={busy}
                                  title="Mark this task complete"
                                >
                                  {busy ? <span className="spinner" /> : <CheckCircle2 size={14} />} Done
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Paging ── */}
                <div className="mytasks-pager">
                  <span className="tiny muted">
                    Showing {firstIndex + 1}–{Math.min(firstIndex + pageSize, filtered.length)} of {filtered.length}
                  </span>
                  <span className="mytasks-pager-ctl">
                    <label className="tiny muted" htmlFor="mt-pagesize">Rows</label>
                    <select id="mt-pagesize" className="mytasks-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                      {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
                      <ChevronLeft size={14} />
                    </button>
                    <span className="tiny nowrap">Page {safePage} of {totalPages}</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} aria-label="Next page">
                      <ChevronRight size={14} />
                    </button>
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ChecklistWarningModal
        open={!!confirmTask}
        items={confirmTask?.items || []}
        taskTitle={confirmTask?.task?.title}
        busy={statusReq.isLoading}
        onConfirm={() => { const { task } = confirmTask; setConfirmTask(null); complete(task); }}
        onCancel={() => setConfirmTask(null)}
      />
    </>
  );
}

export default MyTasksPage;
