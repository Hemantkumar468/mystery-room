/**
 * My Tasks — one person's desk.
 *
 * Every other page is organised around a project; this one answers a single
 * question — "what do I have to do?" — and is the landing page for Employees.
 *
 * A plain numbered table, deliberately: a serial number, the task, how urgent
 * it is, who handed it over, when it is due and how long is left. No grouped
 * sections with headings to decode — the chips up top answer "what is late /
 * due today / waiting" as a filter, and Time left carries the same signal in
 * colour on every row.
 *
 * NOTHING IS COMPLETED FROM THIS LIST. There was a Done button on every row,
 * one click from finishing a job while reading a list of forty — with no sight
 * of what the job actually was, whether a form still had to be filled in, or
 * what the checklist on it still wanted. Completing is a decision, and it is
 * taken on the task's own page where the job is in front of you. The row opens
 * that page, and the button is there.
 *
 * "All" is the desk: only work still to do. The moment a task is completed it
 * leaves that list — into Waiting while an approver has it, or Completed once
 * nothing is left — so the list gets shorter as the day's work gets done. Both
 * are still one click away on their chips.
 *
 * Filtering and paging are client-side: `/pms/tasks/mine` returns one person's
 * work — tens of rows, not thousands — so a round trip per keystroke would buy
 * nothing and cost the instant feel that makes a filter worth using.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass,
  PenLine,
  Search, X, RotateCcw, Inbox, ChevronLeft, ChevronRight, ListTodo,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { StatusBadge, PriorityBadge, EmptyState, ErrorState, Badge } from '../../components/ui/primitives.jsx';
import { TASK_APPROVAL_META } from '../../lib/ui.js';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useMyTasks } from '../../app/api/tasksApi.js';
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

/** Views that are off the desk: shown on their own chips, never under "All". */
const OFF_DESK = ['awaiting', 'done'];

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
  /* The new column is sortable too. "Due date" and "Time left" order the same
     rows identically — they are one fact in two wordings — but people reach
     for the name of the column they are reading, and an option that is not
     offered reads as a thing the screen cannot do. */
  { key: 'left', label: 'Time left' },
  { key: 'project', label: 'Project' },
  { key: 'assignedBy', label: 'Assigned by' },
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

/**
 * HOW LONG IS LEFT, said the way somebody would say it out loud.
 *
 * "26 Sep 2026" is a fact you have to do arithmetic on; "2 days left" is the
 * thing people actually act on, and on a desk of thirty-four jobs it is the
 * only column that sorts the day out. The date stays beside it — a deadline
 * you cannot quote is no use when you are asking for an extension.
 *
 * TONE IS THE MESSAGE. Red from two days out, because that is the point at
 * which a job still has time to be rescued and stops having it if nobody
 * looks. Amber for the rest of the week, quiet grey beyond it: a column where
 * everything shouts says nothing.
 *
 * Whole days, counted from midnight, NOT hours. A task due tomorrow at 9am
 * and one due tomorrow at 6pm are both "tomorrow" to the person doing them,
 * and 0.6 of a day is not a sentence anybody says.
 */
export function timeLeft(plannedEnd, now) {
  if (!plannedEnd) return null;
  const due = dayjs(plannedEnd).startOf('day');
  if (!due.isValid()) return null;
  const days = due.diff(now.startOf('day'), 'day');

  if (days < 0) {
    const over = Math.abs(days);
    return { days, tone: 'over', text: over === 1 ? '1 day over' : `${over} days over`, urgent: true };
  }
  if (days === 0) return { days, tone: 'over', text: 'Due today', urgent: true };
  if (days === 1) return { days, tone: 'soon', text: '1 day left', urgent: true };
  if (days === 2) return { days, tone: 'soon', text: '2 days left', urgent: true };
  if (days <= 7) return { days, tone: 'near', text: `${days} days left` };
  /* Days stay exact out to a fortnight, because "13 days left" is still a
     number anybody can plan against. Past that it stops being readable —
     "47 days left" is arithmetic, not an answer — so it rounds to weeks and
     then months. Plurals are spelled out rather than left to an `s`: "1 weeks
     left" is the kind of thing that makes a screen look unfinished. */
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} left`;
  if (days <= 14) return { days, tone: 'far', text: plural(days, 'day') };
  if (days <= 70) return { days, tone: 'far', text: plural(Math.round(days / 7), 'week') };
  return { days, tone: 'far', text: plural(Math.round(days / 30), 'month') };
}

/** Two letters for the avatar dot beside a name. "Priya Menon" -> "PM". */
export const initialsOf = (name) => String(name || '')
  .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/**
 * Whoever put this on the reader's desk.
 *
 * `createdBy` arrives populated from /pms/tasks/mine, but an older cached
 * payload (or a task whose creator's account is gone) hands back a bare id,
 * and printing a Mongo id at somebody is worse than printing nothing.
 */
const assignerName = (task) => {
  const by = task?.createdBy;
  if (!by || typeof by === 'string') return '';
  return by.name || '';
};

const EMPTY_FILTERS = { project: '', priority: '', status: '' };

/**
 * The status CELL tells the whole journey, not just the work-state axis.
 *
 * It used to print `task.status` alone, so a task its doer had completed and
 * sent for sign-off still read "Complete" — and to the doer scanning the
 * list, nothing distinguished "done and waiting on the MD" from "done, signed,
 * finished". Approval wins when it has something to say; the plain work state
 * only shows while the task is still on the desk.
 */
function JourneyBadge({ task }) {
  const approval = task.approvalState || 'none';
  if (approval !== 'none' && TASK_APPROVAL_META[approval]) {
    const m = TASK_APPROVAL_META[approval];
    return <Badge color={m.color} soft={m.soft} dot>{approval === 'approved' ? 'Approved ✓' : m.label}</Badge>;
  }
  return <StatusBadge value={task.status} />;
}

export function MyTasksPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  /* Refetch whenever the page is (re)entered and the cache is over 15s old.
     Completing a task on its detail page invalidates this cache too, but the
     belt-and-braces read here is what guarantees the list can never show a
     task as still Processing after its own page said it was done. */
  const { data, isLoading, isError, refetch } = useMyTasks(undefined, { refetchOnMountOrArgChange: 15 });

  const [view, setView] = useState('all');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('due');
  const [search, setSearch] = useState('');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  /** Every task with its view resolved — the single list everything derives from. */
  const tagged = useMemo(() => {
    const now = dayjs();
    /* `awaiting` overlaps the other two (a waiting task finished this week is
       also "recently done"), so each task is kept once. */
    const seen = new Set();
    return [...(data?.open || []), ...(data?.awaiting || []), ...(data?.recentlyDone || [])]
      .filter((task) => {
        if (seen.has(task._id)) return false;
        seen.add(task._id);
        return true;
      })
      /* Resolved once here rather than in the row: `now` is fixed for the
         whole render, so every row's countdown is measured from the same
         instant, and sorting by time left cannot disagree with the column. */
      .map((task) => ({
        ...task,
        view: viewFor(task, now),
        left: timeLeft(task.plannedEnd, now),
        assignedByName: assignerName(task),
      }));
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
      if (view === 'all' ? OFF_DESK.includes(t.view) : t.view !== view) return false;
      if (filters.project && t.project?._id !== filters.project) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (!q) return true;
      return [t.title, t.code, t.project?.name, t.stageName, t.description, t.assignedByName]
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
      left: byDue,
      project: (a, b) => (a.project?.name || '').localeCompare(b.project?.name || '') || byDue(a, b),
      assignedBy: (a, b) => (a.assignedByName || '\uffff').localeCompare(b.assignedByName || '\uffff') || byDue(a, b),
      title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    }[sort] || byDue;
    return [...rows].sort(cmp);
  }, [tagged, view, filters, sort, search]);

  const counts = useMemo(() => {
    const c = { all: 0 };
    for (const v of VIEWS) c[v.key] = 0;
    for (const t of tagged) {
      c[t.view] += 1;
      if (!OFF_DESK.includes(t.view)) c.all += 1;
    }
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

  const firstName = (user?.name || '').split(' ')[0];
  const actionable = counts.all;
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
            {filtered.length === 0 && view === 'all' && !isFiltered ? (
              /* The desk is clear, but finished work still exists — say so,
                 and point at it, rather than "Nothing matches". */
              <EmptyState
                icon={CheckCircle2}
                title="You’re all caught up"
                hint="Everything assigned to you is done. Completed work and anything waiting for approval is on its own tab."
                action={(
                  <span className="row gap-2">
                    {counts.awaiting > 0 && (
                      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setView('awaiting')}>
                        <Hourglass size={14} /> Waiting ({counts.awaiting})
                      </button>
                    )}
                    {counts.done > 0 && (
                      <button type="button" className="btn btn-subtle btn-sm" onClick={() => setView('done')}>
                        <CheckCircle2 size={14} /> Completed ({counts.done})
                      </button>
                    )}
                  </span>
                )}
              />
            ) : filtered.length === 0 ? (
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
                        {/* PRIORITY GETS A COLUMN. It was a chip tucked under
                            the title, which is where the eye goes last — so on
                            a desk of thirty-four jobs the one field that says
                            which to pick up first could only be read one row
                            at a time. In its own column it reads down. */}
                        <th className="mt-col-prio">Priority</th>
                        {/* WHO HANDED IT OVER, in place of Project · Phase.
                            Every row here is the reader's own work, so naming
                            the assignee would print their own name forty
                            times; the name worth having is the other one. The
                            project has not been lost — it is the line under the
                            task title, where it explains the title rather than
                            competing with it for a column. */}
                        <th className="mt-col-by">Assigned by</th>
                        <th className="mt-col-due">Due</th>
                        <th className="mt-col-left">Time left</th>
                        <th className="mt-col-status">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((task, i) => {
                        /**
                         * THE ROW OPENS THE TASK, never the form directly.
                         *
                         * The task page is where the job is explained — who
                         * assigned it, when, by when, the four brief lines,
                         * the checklist, the history. Sending the row
                         * straight to the form skipped all of that and
                         * dropped somebody into a blank form with no idea
                         * what was being asked of them or by whom. The form
                         * is one button away from there, next to Mark as
                         * Complete, which is also where the job ends.
                         */
                        const to = task.project?._id && task.code ? `/projects/${task.project._id}/tasks/${task.code}` : null;
                        /* Flagged on the row so somebody scanning the list can
                           see which of their jobs is a form to fill in. */
                        const isForm = Boolean(task.appPath);
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
                              {to
                                ? <Link to={to} className="mytasks-title">{task.title}</Link>
                                : <span className="mytasks-title">{task.title}</span>}
                              <div className="mytasks-sub">
                                {/* WHERE THIS JOB LIVES, as the title's own
                                    second line rather than a column of its
                                    own. Half these titles are the bare verb
                                    — "Do the Feasibility assessment" — and
                                    without the project they name no particular
                                    piece of work at all. The city rides along:
                                    somebody with six jobs across three cities
                                    plans the day from this list rather than by
                                    opening each one. */}
                                {task.project?.name && (
                                  <span
                                    className="mytasks-place truncate"
                                    title={[task.project?.name, task.project?.city, task.stageName].filter(Boolean).join(' · ')}
                                  >
                                    {[task.project.name, task.project.city].filter(Boolean).join(' · ')}
                                  </span>
                                )}
                                {task.code && <span className="mono tiny muted">{task.code}</span>}
                                {isForm && task.view !== 'done' && (
                                  <span className="mytasks-formtag" title="This job is a form. Open the task to fill it in.">
                                    <PenLine size={11} /> Form
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="mt-col-prio">
                              {task.priority
                                ? <PriorityBadge value={task.priority} />
                                : <span className="tiny muted">—</span>}
                            </td>
                            <td className="mt-col-by">
                              {task.assignedByName ? (
                                <span className="mytasks-by" title={`${task.assignedByName} put this on your desk`}>
                                  <span className="mytasks-by-dot" aria-hidden="true">{initialsOf(task.assignedByName)}</span>
                                  <span className="truncate">{task.assignedByName}</span>
                                </span>
                              ) : (
                                /* Said rather than dashed. A dash reads as a
                                   name we failed to load; this one genuinely
                                   has nobody behind it. */
                                <span className="tiny muted nowrap">The flow</span>
                              )}
                            </td>
                            <td className="mt-col-due">
                              {task.view === 'done' ? (
                                <span className="tiny muted nowrap">{fromNow(task.completedAt || task.actualEnd)}</span>
                              ) : (
                                <span className="mytasks-due nowrap">
                                  {task.plannedEnd ? fmtDate(task.plannedEnd) : 'No date'}
                                </span>
                              )}
                            </td>
                            <td className="mt-col-left">
                              {task.view === 'done'
                                ? <span className="tiny muted nowrap">Done</span>
                                : task.left
                                  ? (
                                    <span className={`mytasks-left t-${task.left.tone}`}>
                                      {task.left.urgent && <AlertTriangle size={11} />}
                                      {task.left.text}
                                    </span>
                                  )
                                  : <span className="tiny muted nowrap">No deadline</span>}
                            </td>
                            <td className="mt-col-status"><JourneyBadge task={task} /></td>
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


    </>
  );
}

export default MyTasksPage;
