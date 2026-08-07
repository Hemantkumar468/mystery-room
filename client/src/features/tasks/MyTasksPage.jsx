/**
 * My Tasks — one person's desk.
 *
 * Every other page in this app is organised around a *project*: to find their
 * own work someone had to open each project and scan its board. This page
 * inverts that. It answers one question — "what do I have to do?" — and is the
 * landing page for the Employee role.
 *
 * Ordered by when it needs attention, not by project or status, because that
 * is the order the reader actually works in: what is late, what is due today,
 * what is coming, what is off my desk, what I finished.
 *
 * Filtering is all client-side and deliberately so. `/pms/tasks/mine` returns
 * one person's open work — tens of rows, not thousands — so a round trip per
 * keystroke would buy nothing and cost the instant feel that makes a filter
 * worth using.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock, Hourglass,
  Search, X, RotateCcw, Inbox,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, StatusBadge, PriorityBadge, EmptyState, ErrorState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useMyTasks, useUpdateTaskStatusMutation } from '../../app/api/tasksApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { TASK_STATUS_META, PRIORITY_META } from '../../lib/ui.js';
import dayjs from '../../lib/dayjs.js';
import { fmtDate, fromNow } from '../../lib/format.js';

/** Statuses that mean the work has left this person's desk and is with someone else. */
const AWAITING_STATUSES = ['waiting_approval', 'waiting_management_approval', 'approved'];

/**
 * The buckets, in the order they matter. `key` doubles as the view-chip value,
 * so selecting a chip is just "show only this bucket" — one rendering path for
 * both the grouped overview and a single-bucket view.
 */
const BUCKETS = [
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'var(--danger)', hint: 'Past their due date' },
  { key: 'today', label: 'Due today', icon: Clock, tone: 'var(--warning)', hint: 'Needs finishing today' },
  { key: 'week', label: 'This week', icon: CalendarClock, tone: 'var(--info)', hint: 'Due in the next seven days' },
  { key: 'later', label: 'Later', icon: CalendarDays, tone: 'var(--text-subtle)', hint: 'Further out, or no date set' },
  { key: 'awaiting', label: 'Waiting', icon: Hourglass, tone: 'var(--info)', hint: 'Submitted — no action needed from you' },
  { key: 'done', label: 'Completed', icon: CheckCircle2, tone: 'var(--success)', hint: 'Finished in the last seven days' },
];

const SORTS = [
  { key: 'due', label: 'Due date' },
  { key: 'priority', label: 'Priority' },
  { key: 'project', label: 'Project' },
  { key: 'title', label: 'Title (A–Z)' },
];

/** High-to-low, so "sort by priority" puts the urgent work at the top. */
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const BLANK_FILTERS = { project: '', priority: '', status: '' };

/** Which bucket a task belongs to, evaluated once per task. */
function bucketFor(task, now) {
  if (task.status === 'done') return 'done';
  if (AWAITING_STATUSES.includes(task.status)) return 'awaiting';
  if (!task.plannedEnd) return 'later';
  const due = dayjs(task.plannedEnd);
  if (due.isBefore(now.startOf('day'))) return 'overdue';
  if (due.isBefore(now.endOf('day'))) return 'today';
  if (due.isBefore(now.add(7, 'day').endOf('day'))) return 'week';
  return 'later';
}

export function MyTasksPage() {
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError, refetch } = useMyTasks();
  const [updateStatus, statusReq] = useUpdateTaskStatusMutation();

  const [view, setView] = useState('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [sort, setSort] = useState('due');

  /** Every task with its bucket resolved — the single list everything derives from. */
  const tagged = useMemo(() => {
    const now = dayjs();
    return [
      ...(data?.open || []),
      ...(data?.recentlyDone || []),
    ].map((task) => ({ ...task, bucket: bucketFor(task, now) }));
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
      if (filters.project && t.project?._id !== filters.project) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (!q) return true;
      // Everything visible on the row is searchable — someone hunting a task
      // reaches for whichever of these they happen to remember.
      return [t.title, t.code, t.project?.name, t.stageName, t.description]
        .some((v) => (v || '').toLowerCase().includes(q));
    });

    const byDue = (a, b) => {
      // No date sorts last rather than first: an undated task is the least
      // urgent thing on the list, and null would otherwise lead every group.
      if (!a.plannedEnd && !b.plannedEnd) return 0;
      if (!a.plannedEnd) return 1;
      if (!b.plannedEnd) return -1;
      return new Date(a.plannedEnd) - new Date(b.plannedEnd);
    };

    const comparators = {
      due: byDue,
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byDue(a, b),
      project: (a, b) => (a.project?.name || '').localeCompare(b.project?.name || '') || byDue(a, b),
      title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    };

    return [...rows].sort(comparators[sort] || byDue);
  }, [tagged, search, filters, sort]);

  /** Counts come from the filtered set, so a chip never promises rows a filter has already removed. */
  const counts = useMemo(() => {
    const c = { all: filtered.length };
    for (const b of BUCKETS) c[b.key] = 0;
    for (const t of filtered) c[t.bucket] += 1;
    return c;
  }, [filtered]);

  const markDone = (task) => updateStatus({ id: task._id, status: 'done', projectId: task.project?._id });

  const filtersActive = Boolean(search || filters.project || filters.priority || filters.status);
  const clearAll = () => { setSearch(''); setFilters(BLANK_FILTERS); };
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));

  // The headline counts only actionable work — waiting and completed are on the
  // page for context, not because they need doing.
  const actionable = tagged.filter((t) => !['awaiting', 'done'].includes(t.bucket)).length;
  const firstName = user?.name?.split(' ')[0];
  const subtitle = actionable
    ? `${actionable} ${actionable === 1 ? 'task needs' : 'tasks need'} your attention`
    : 'Nothing outstanding — you are all caught up';

  const visibleBuckets = BUCKETS.filter((b) => (view === 'all' || view === b.key) && counts[b.key] > 0);

  return (
    <>
      <Topbar title={firstName ? `${firstName}’s tasks` : 'My Tasks'} subtitle={subtitle} />
      <div className="content">
        {isError ? (
          <ErrorState title="Couldn’t load your tasks" onRetry={refetch} />
        ) : isLoading || !data ? (
          <SkTable rows={6} />
        ) : (
          <div className="content-narrow col gap-4 fade-in">
            {tagged.length === 0 ? (
              <SectionCard>
                <EmptyState
                  icon={CheckCircle2}
                  title="No tasks assigned to you"
                  hint="When someone assigns you work it will appear here automatically."
                />
              </SectionCard>
            ) : (
              <>
                <div className="mytasks-toolbar">
                  {/* Chips are the primary filter: counts and selection in one
                      control, so the reader sees the shape of their workload
                      before deciding what to narrow to. */}
                  <div className="mytasks-chips">
                    <button
                      type="button"
                      className={`mytasks-chip${view === 'all' ? ' active' : ''}`}
                      style={{ '--chip-accent': 'var(--primary)' }}
                      onClick={() => setView('all')}
                    >
                      All
                      <span className="mytasks-chip-count">{counts.all}</span>
                    </button>
                    {BUCKETS.map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        className={`mytasks-chip${view === b.key ? ' active' : ''}`}
                        style={{ '--chip-accent': b.tone }}
                        onClick={() => setView(view === b.key ? 'all' : b.key)}
                        disabled={!counts[b.key]}
                        title={b.hint}
                      >
                        <b.icon size={13} />
                        {b.label}
                        <span className="mytasks-chip-count">{counts[b.key]}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mytasks-tools">
                    <div className="mytasks-search">
                      <Search size={15} className="subtle" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search title, code, project…"
                        aria-label="Search my tasks"
                      />
                      {search && (
                        <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="mytasks-search-clear">
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Only offered when there is something to choose between —
                        a one-project dropdown is a control that cannot do
                        anything. */}
                    {options.projects.length > 1 && (
                      <select className="mytasks-select" value={filters.project} onChange={setFilter('project')} aria-label="Filter by project">
                        <option value="">All projects</option>
                        {options.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}

                    {options.priorities.length > 1 && (
                      <select className="mytasks-select" value={filters.priority} onChange={setFilter('priority')} aria-label="Filter by priority">
                        <option value="">Any priority</option>
                        {options.priorities.map((p) => (
                          <option key={p} value={p}>{PRIORITY_META[p]?.label || p}</option>
                        ))}
                      </select>
                    )}

                    {options.statuses.length > 1 && (
                      <select className="mytasks-select" value={filters.status} onChange={setFilter('status')} aria-label="Filter by status">
                        <option value="">Any status</option>
                        {options.statuses.map((s) => (
                          <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>
                        ))}
                      </select>
                    )}

                    <select className="mytasks-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tasks">
                      {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
                    </select>

                    {filtersActive && (
                      <button type="button" className="btn btn-subtle btn-sm" onClick={clearAll}>
                        <RotateCcw size={13} /> Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Guards on `visibleBuckets`, not `filtered`: selecting the
                    Overdue chip and then filtering every overdue task away
                    leaves other buckets populated, so a `filtered.length`
                    check would pass and render an empty page with no
                    explanation. */}
                {visibleBuckets.length === 0 ? (
                  <SectionCard>
                    <EmptyState
                      icon={Inbox}
                      title="Nothing matches those filters"
                      hint={
                        view === 'all'
                          ? 'Try a different search term, or clear the filters to see everything again.'
                          : `No tasks in “${BUCKETS.find((b) => b.key === view)?.label}” match. Try another view or clear the filters.`
                      }
                      action={
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm"
                          onClick={() => { clearAll(); setView('all'); }}
                        >
                          <RotateCcw size={14} /> Reset
                        </button>
                      }
                    />
                  </SectionCard>
                ) : (
                  visibleBuckets.map((bucket) => (
                    <SectionCard
                      key={bucket.key}
                      title={
                        <span className="row gap-2" style={{ alignItems: 'center' }}>
                          <bucket.icon size={16} style={{ color: bucket.tone }} />
                          {bucket.label}
                          <span className="mytasks-count" style={{ color: bucket.tone }}>{counts[bucket.key]}</span>
                        </span>
                      }
                      subtitle={bucket.hint}
                    >
                      <TaskList
                        tasks={filtered.filter((t) => t.bucket === bucket.key)}
                        onDone={['awaiting', 'done'].includes(bucket.key) ? null : markDone}
                        busyId={statusReq.isLoading ? statusReq.originalArgs?.id : null}
                        tone={bucket.tone}
                        overdue={bucket.key === 'overdue'}
                        done={bucket.key === 'done'}
                      />
                    </SectionCard>
                  ))
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * One bucket's rows. Deliberately a list rather than a table: a doer needs the
 * title, where it belongs and when it is due — five sortable columns would be
 * a project manager's view of the same data.
 */
function TaskList({ tasks, onDone, busyId, tone, overdue = false, done = false }) {
  return (
    <div className="col">
      {tasks.map((task) => {
        const to = task.project?._id && task.code
          ? `/projects/${task.project._id}/tasks/${task.code}`
          : null;

        const row = (
          <>
            <div className="col gap-1 grow" style={{ minWidth: 0 }}>
              <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
                <span className={`mytasks-title truncate${done ? ' mytasks-title--done' : ''}`}>
                  {task.title}
                </span>
                {task.priority && !done && <PriorityBadge value={task.priority} />}
              </div>
              <div className="row gap-2 tiny muted wrap">
                {task.project?.name && <span className="truncate">{task.project.name}</span>}
                {task.stageName && <><span aria-hidden>·</span><span className="truncate">{task.stageName}</span></>}
                {task.code && <><span aria-hidden>·</span><span className="mono">{task.code}</span></>}
              </div>
            </div>

            <div className="row gap-3 mytasks-meta">
              {done ? (
                <span className="tiny muted nowrap">{fromNow(task.actualEnd)}</span>
              ) : (
                <span className={`tiny nowrap${overdue ? ' mytasks-due--late' : ' muted'}`}>
                  {task.plannedEnd ? fmtDate(task.plannedEnd) : 'No date'}
                </span>
              )}
              <StatusBadge value={task.status} />
            </div>
          </>
        );

        return (
          <div key={task._id} className="mytasks-row" style={{ '--row-accent': tone }}>
            {to ? (
              <Link to={to} className="mytasks-link">{row}</Link>
            ) : (
              <div className="mytasks-link">{row}</div>
            )}
            {/* Mark done sits outside the link so clicking it completes the
                task instead of navigating into it. */}
            {onDone && (
              <button
                type="button"
                className="btn btn-outline-success btn-sm mytasks-done"
                onClick={() => onDone(task)}
                disabled={busyId === task._id}
                title="Mark this task complete"
              >
                {busyId === task._id ? <span className="spinner" /> : <CheckCircle2 size={14} />}
                Done
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default MyTasksPage;
