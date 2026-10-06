import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, Check, Clock, AlertCircle, Star, Search, MoreVertical, ChevronLeft, ChevronRight, ListTodo,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useMyTasks } from '../../app/api/tasksApi.js';
import dayjs from '../../lib/dayjs.js';
import { fmtDate } from '../../lib/format.js';
import { calculateTaskScore, SCORE_WEIGHT } from './taskScoring.js';
import '../../styles/my-tasks-v2.css';

/**
 * MY TASKS — everything on one person's desk, in one list.
 *
 * Three sources, one table: FMS work (project phases and the New Games FMS),
 * jobs delegated to them, and checklist routines due today. The server merges
 * them (task.service#myTasks); each row says where it came from in the Source
 * column and opens its own page. Laid out to the design the client signed off:
 * five figures, one filter bar, the table.
 */

/* ── shared helpers (TaskFocusCard and the New Games task page use these) ── */

/**
 * How long is left, said the way somebody would say it out loud. Red from two
 * days out, amber for the rest of the week, quiet beyond it. Whole days.
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
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} left`;
  if (days <= 14) return { days, tone: 'far', text: plural(days, 'day') };
  if (days <= 70) return { days, tone: 'far', text: plural(Math.round(days / 7), 'week') };
  return { days, tone: 'far', text: plural(Math.round(days / 30), 'month') };
}

/** Two letters for the avatar dot beside a name. "Priya Menon" -> "PM". */
export const initialsOf = (name) => String(name || '')
  .trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const SOURCES = {
  fms: { label: 'FMS', cls: 'is-fms' },
  delegation: { label: 'Delegation', cls: 'is-dlg' },
  checklist: { label: 'Checklist', cls: 'is-chk' },
};
const sourceOf = (t) => (t.source === 'delegation' || t.source === 'checklist' ? t.source : 'fms');

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/** Where a task stands, in one word the doer understands. */
function stateOf(t) {
  const a = t.approvalState || 'none';
  if (a === 'approved' || t.status === 'complete') return a === 'waiting_department' || a === 'waiting_management' ? 'waiting' : 'completed';
  if (a === 'waiting_department' || a === 'waiting_management') return 'waiting';
  if (a === 'rejected') return 'rework';
  if (t.status === 'processing') return 'progress';
  return 'pending';
}
const STATE = {
  pending: { label: 'Pending', cls: 'is-pending' },
  progress: { label: 'In progress', cls: 'is-progress' },
  waiting: { label: 'Waiting approval', cls: 'is-waiting' },
  rework: { label: 'Sent back', cls: 'is-rework' },
  completed: { label: 'Completed', cls: 'is-done' },
};

const linkOf = (t) => t.link || (t.project?._id && t.code ? `/my-tasks/projects/${t.project._id}/tasks/${t.code}` : null);

const PAGE_SIZES = [10, 20, 50, 100];

export function MyTasksPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useMyTasks(undefined, { refetchOnMountOrArgChange: 15 });

  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('active');
  const [due, setDue] = useState('');
  const [project, setProject] = useState('');
  const [sort, setSort] = useState('latest');
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState(null);

  /* Every task once, with what each column needs worked out a single time. */
  const tasks = useMemo(() => {
    const now = dayjs();
    const seen = new Set();
    return [...(data?.open || []), ...(data?.awaiting || []), ...(data?.recentlyDone || [])]
      .filter((t) => (seen.has(t._id) ? false : seen.add(t._id)))
      .map((t) => {
        const state = stateOf(t);
        const left = state === 'completed' ? null : timeLeft(t.plannedEnd, now);
        return {
          ...t,
          src: sourceOf(t),
          state,
          left,
          overdue: !['completed', 'waiting'].includes(state)
            && Boolean(t.plannedEnd) && dayjs(t.plannedEnd).isBefore(now, 'day'),
          by: typeof t.createdBy === 'object' ? t.createdBy?.name || '' : '',
          to: linkOf(t),
        };
      });
  }, [data]);

  /**
   * The score only deducts from 100: in-progress work costs 10, not-started
   * work 25, late completion 25, and overdue open work 100. On-time work and
   * tasks waiting for approval do not lose points. See taskScoring.js.
   */
  const kpi = useMemo(() => {
    const score = calculateTaskScore(tasks);
    const completed = tasks.filter((t) => t.state === 'completed').length;
    return {
      ...score,
      completed,
      pending: tasks.length - completed,
    };
  }, [tasks]);


  const projects = useMemo(() => [...new Map(tasks.filter((t) => t.project?.name)
    .map((t) => [t.project.name, t.project.name])).values()].sort(), [tasks]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = dayjs();
    const list = tasks.filter((t) => {
      if (source && t.src !== source) return false;
      if (priority && t.priority !== priority) return false;
      if (status === 'active' && t.state === 'completed') return false;
      if (status && status !== 'active' && status !== 'all' && t.state !== status) return false;
      if (project && t.project?.name !== project) return false;
      if (due) {
        const d = t.plannedEnd ? dayjs(t.plannedEnd) : null;
        if (due === 'overdue' && !t.overdue) return false;
        if (due === 'today' && !(d && d.isSame(now, 'day'))) return false;
        if (due === 'week' && !(d && !d.isBefore(now, 'day') && d.isBefore(now.add(7, 'day'), 'day'))) return false;
        if (due === 'later' && !(d && !d.isBefore(now.add(7, 'day'), 'day'))) return false;
      }
      if (!q) return true;
      /* `by` is gone from the table, so searching it would match rows on a
         word the reader cannot see. */
      return [t.title, t.code, t.project?.name, t.project?.city].some((v) => (v || '').toLowerCase().includes(q));
    });
    const byDue = (a, b) => (a.plannedEnd ? new Date(a.plannedEnd) : Infinity) - (b.plannedEnd ? new Date(b.plannedEnd) : Infinity);
    /**
     * "LATEST" MEANS THE DAY IT ARRIVED, NOT THE MILLISECOND.
     *
     * This was the raw `createdAt` timestamp, and creating a project writes
     * every one of its tasks in a single burst, in template order — phase 1
     * first, the closing phases last. So "Latest first" sorted a project's
     * own tasks BACKWARDS through its life: the go-live checks and the
     * lessons-learned write-up, created a few milliseconds after everything
     * else and due in eighteen months, came out above the assessment due in
     * three weeks.
     *
     * The effect on a real list was total. Shishir's first page read
     * "Lessons learned documentation · 04 Apr 2027", "Go-live: Emergency
     * Contacts · 18 Apr 2027", "Go-live: Security" — while the operational
     * assessment he was actually being chased for, due 27 Oct, was not on
     * the page at all. It was assigned, it was in the list, and it was
     * invisible, which is indistinguishable from missing.
     *
     * Rounded to the day, every task from one burst ties, and the `byDue`
     * tiebreak below decides them — soonest first, which is the order
     * somebody reads a to-do list in. Across days it still means what it
     * says: what landed today sits above what landed last week.
     */
    const landed = (t) => dayjs(t.createdAt || 0).startOf('day').valueOf();
    const cmp = {
      latest: (a, b) => landed(b) - landed(a) || byDue(a, b),
      due: byDue,
      priority: (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || byDue(a, b),
      title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    }[sort];
    return [...list].sort(cmp);
  }, [tasks, search, source, priority, status, due, project, sort]);

  useEffect(() => { setPage(1); }, [search, source, priority, status, due, project, sort, pageSize]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * pageSize, current * pageSize);
  const from = rows.length ? (current - 1) * pageSize + 1 : 0;
  const to = Math.min(current * pageSize, rows.length);

  /* Close the row menu on any outside click. */
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const off = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(null); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  const tiles = [
    { key: 'total', icon: ClipboardCheck, tone: 'blue', label: 'Total tasks', n: kpi.total, sub: 'All assigned tasks', go: () => setStatus('all') },
    { key: 'done', icon: Check, tone: 'green', label: 'Completed', n: kpi.completed, sub: 'Finished successfully', go: () => setStatus('completed') },
    { key: 'pending', icon: Clock, tone: 'amber', label: 'Pending', n: kpi.pending, sub: 'Awaiting action', go: () => setStatus('active') },
    { key: 'over', icon: AlertCircle, tone: 'red', label: 'Overdue', n: kpi.overdue, sub: 'Past due date', go: () => { setStatus('active'); setDue('overdue'); } },
    {
      key: 'score',
      icon: Star,
      tone: 'purple',
      label: 'Your score',
      n: kpi.score == null ? '—' : `${kpi.score}%`,
      sub: kpi.score == null ? 'No tasks yet' : `${kpi.doneOnTime} on time · ${kpi.doneLate} late · ${kpi.overdue} overdue`,
      /* The formula, on the tile that prints the number. A score nobody can
         reproduce is one people argue with instead of acting on. */
      tip: [
        'Everyone starts at 100. Each task takes points off by how it is going:',
        `· Done on time — 0 (${kpi.doneOnTime})`,
        `· In progress, still in time — ${SCORE_WEIGHT.inProgress} (${kpi.inProgress})`,
        `· Not started, still in time — ${SCORE_WEIGHT.notStarted} (${kpi.notStarted})`,
        `· Done late — ${SCORE_WEIGHT.late} (${kpi.doneLate})`,
        `· Overdue — ${SCORE_WEIGHT.overdue} (${kpi.overdue})`,
        `· Waiting for approval or without a usable deadline — 0 (${kpi.neutral})`,
        `Your score = −(total points off ÷ ${kpi.total} task${kpi.total === 1 ? '' : 's'}).`,
      ].join('\n'),
    },
  ];

  return (
    <>
      <Topbar title="My Tasks" />
      <div className="content mt2">
        <div className="mt2-kpis">
          {tiles.map((k) => (
            <button key={k.key} type="button" className={`mt2-kpi t-${k.tone}`} onClick={k.go} disabled={!k.go && !k.tip} title={k.tip || undefined}>
              <span className="mt2-kpi-ico"><k.icon size={22} strokeWidth={2.4} aria-hidden /></span>
              <span className="mt2-kpi-body">
                <span className="mt2-kpi-label">{k.label}</span>
                <b className="mt2-kpi-n">{isLoading ? '—' : k.n}</b>
                <span className="mt2-kpi-sub">{k.sub}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt2-filters">
          <label className="mt2-search">
            <Search size={18} aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search task, project, location" aria-label="Search tasks" />
          </label>
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Task source">
            <option value="">Task source</option>
            <option value="fms">FMS</option>
            <option value="delegation">Delegation</option>
            <option value="checklist">Checklist</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
            <option value="">Priority</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="active">Status: Open</option>
            <option value="all">All statuses</option>
            {Object.entries(STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date">
            <option value="">Due date</option>
            <option value="overdue">Overdue</option>
            <option value="today">Due today</option>
            <option value="week">This week</option>
            <option value="later">Later</option>
          </select>
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">Project</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="latest">Sort: Latest first</option>
            <option value="due">Sort: Due date</option>
            <option value="priority">Sort: Priority</option>
            <option value="title">Sort: Title (A–Z)</option>
          </select>
        </div>

        <div className="mt2-card">
          <div className="mt2-tablewrap">
            <table className="mt2-table">
              <thead>
                <tr>
                  <th className="c-no">No.</th>
                  <th>Task</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Priority</th>
                  <th>Due date</th>
                  <th>Time left</th>
                  <th>Status</th>
                  <th className="c-menu" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {isError ? (
                  <tr><td colSpan={9} className="mt2-empty">Could not load your tasks. <button type="button" onClick={refetch}>Try again</button></td></tr>
                ) : isLoading ? (
                  <tr><td colSpan={9} className="mt2-empty"><span className="spinner" /> Loading…</td></tr>
                ) : shown.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="mt2-empty">
                      <ListTodo size={28} aria-hidden />
                      <b>{tasks.length ? 'No tasks match these filters' : 'Nothing on your desk'}</b>
                      {tasks.length > 0 && (
                        <button type="button" onClick={() => { setSearch(''); setSource(''); setPriority(''); setStatus('active'); setDue(''); setProject(''); }}>Clear filters</button>
                      )}
                    </td>
                  </tr>
                ) : shown.map((t, i) => (
                  <tr
                    key={t._id}
                    className={t.to ? 'is-link' : undefined}
                    onClick={(e) => { if (t.to && !e.target.closest('a,button')) navigate(t.to); }}
                  >
                    <td className="c-no" data-label="No.">{from + i}</td>
                    <td className="c-task" data-label="Task">
                      {t.to ? <Link to={t.to} className="mt2-title">{t.title}</Link> : <span className="mt2-title">{t.title}</span>}
                    </td>
                    <td data-label="Location">{t.project?.city || <span className="mt2-muted">—</span>}</td>
                    <td data-label="Source"><span className={`mt2-src ${SOURCES[t.src].cls}`}>{SOURCES[t.src].label}</span></td>
                    <td data-label="Priority">
                      {t.priority ? <span className={`mt2-prio p-${t.priority}`}><i />{PRIORITY_LABEL[t.priority] || t.priority}</span> : <span className="mt2-muted">—</span>}
                    </td>
                    <td data-label="Due date" className="c-nowrap">{t.plannedEnd ? fmtDate(t.plannedEnd) : <span className="mt2-muted">No date</span>}</td>
                    <td data-label="Time left">
                      {t.left ? <span className={`mt2-left t-${t.left.tone}`}>{t.left.text}</span> : <span className="mt2-muted">{t.state === 'completed' ? 'Done' : '—'}</span>}
                    </td>
                    <td data-label="Status"><span className={`mt2-state ${STATE[t.state].cls}`}><i />{STATE[t.state].label}</span></td>
                    <td className="c-menu">
                      <div className="mt2-menuwrap" ref={menu === t._id ? menuRef : undefined}>
                        <button type="button" className="mt2-dots" aria-label="Task actions" onClick={() => setMenu(menu === t._id ? null : t._id)}>
                          <MoreVertical size={18} />
                        </button>
                        {menu === t._id && (
                          <div className="mt2-menu" role="menu">
                            {t.to && <Link role="menuitem" to={t.to}>Open task</Link>}
                            {t.src === 'delegation' && <Link role="menuitem" to="/delegation/my-work">All my delegations</Link>}
                            {t.src === 'checklist' && <Link role="menuitem" to="/checklist">Open checklist</Link>}
                            {t.src === 'fms' && t.project?._id && !String(t.project._id).startsWith('ng-') && (
                              <Link role="menuitem" to={`/projects/${t.project._id}`}>Open project</Link>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt2-foot">
            <span>Showing {from}-{to} of {rows.length} task{rows.length === 1 ? '' : 's'}</span>
            <span className="mt2-pager">
              <label>
                Rows
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {pages > 1 && (
                <button type="button" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
              )}
              {Array.from({ length: pages }, (_, n) => n + 1)
                .filter((n) => pages <= 7 || n === 1 || n === pages || Math.abs(n - current) <= 1)
                .map((n) => (
                  <button key={n} type="button" className={n === current ? 'is-on' : undefined} onClick={() => setPage(n)}>{n}</button>
                ))}
              {pages > 1 && (
                <button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
              )}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default MyTasksPage;
