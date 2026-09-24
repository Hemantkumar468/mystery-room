import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { CityChip, EmptyState } from '../../components/ui/primitives.jsx';
import dayjs from '../../lib/dayjs.js';

/**
 * Approvals, one row per launch — as a table, so city, launch code, due date
 * and delay line up down the page and can be sorted.
 *
 * The stacked-card layout this replaced carried the same facts on three lines
 * each, and stacked facts cannot be compared: finding the worst-delayed launch
 * meant reading every card in turn. In a column you read one column.
 *
 * Still a derived VIEW over the items the page already loaded, not a second
 * fetch. It takes the same filtered arrays the flat tab renders, so both tabs
 * always agree, the search/city/person/phase filters apply to both, and a
 * decision taken anywhere updates these counts with no extra invalidation.
 */

/**
 * When a pending item is due.
 *
 * `dueAt || plannedEnd` is the model's OWN resolution — see Task's isOverdue
 * virtual. Project instantiation writes `plannedEnd` and leaves `dueAt` null,
 * so reading `dueAt` alone would report "no due date" on very nearly every
 * task in the system.
 *
 * Records carry no due date in the schema at all, so they cannot contribute.
 * A launch whose queue is only records shows "—" here rather than a date
 * invented out of when it happened to be submitted.
 */
const dueOf = (task) => task.dueAt || task.plannedEnd || null;

/** Whole days between two instants, comparing dates rather than clock times. */
const dayDiff = (from, to) => dayjs(to).startOf('day').diff(dayjs(from).startOf('day'), 'day');

/**
 * The delay verdict for a launch: how far past the EARLIEST pending due date
 * we are today. A launch has many approvals, each with its own date, so one
 * row cannot show "the" due date — it shows the soonest, because that is the
 * one about to be missed.
 */
function delayOf(earliestDue) {
  if (!earliestDue) return { days: null, label: '—', tone: 'none' };
  const late = dayDiff(earliestDue, Date.now());
  if (late > 0) return { days: late, label: `${late} day${late === 1 ? '' : 's'} late`, tone: 'late' };
  const inDays = -late;
  if (inDays === 0) return { days: 0, label: 'due today', tone: 'soon' };
  if (inDays <= 7) return { days: late, label: `due in ${inDays} day${inDays === 1 ? '' : 's'}`, tone: 'soon' };
  return { days: late, label: 'On time', tone: 'ok' };
}

/** Every column, what it sorts on, and which direction answers its question. */
const COLUMNS = [
  { key: 'project', label: 'Project', value: (g) => g.name.toLowerCase(), worstFirst: 'asc' },
  { key: 'city', label: 'City', value: (g) => (g.city || '').toLowerCase(), worstFirst: 'asc' },
  { key: 'code', label: 'Launch code', value: (g) => (g.code || '').toLowerCase(), worstFirst: 'asc' },
  { key: 'waiting', label: 'Waiting', value: (g) => g.total, numeric: true, worstFirst: 'desc' },
  // The oldest item is the one waiting longest — the smallest timestamp.
  { key: 'oldest', label: 'Oldest item', value: (g) => g.oldestAt, numeric: true, worstFirst: 'asc' },
  { key: 'due', label: 'Earliest due', value: (g) => g.earliestDue, numeric: true, worstFirst: 'asc' },
  { key: 'delay', label: 'Delay', value: (g) => g.delay.days, numeric: true, worstFirst: 'desc' },
];

export function ApprovalsByProject({ tasks, records, onOpenProject }) {
  const navigate = useNavigate();

  /* Delay, worst first. This screen exists to surface what is rotting, and any
     other default buries exactly that. */
  const [sort, setSort] = useState({ key: 'delay', dir: 'desc' });

  const groups = useMemo(() => {
    const byProject = new Map();
    /* Counted from the two arrays as given. Merging them first and then trying
       to tell a task from a record by which fields it happens to carry is a
       guess that silently miscounts the moment either shape changes. */
    const add = (item, kind) => {
      const id = String(item.project?._id || item.project?.id || item.project || '');
      if (!id) return;
      if (!byProject.has(id)) {
        byProject.set(id, {
          id,
          name: item.project?.name || item.project?.code || 'Untitled',
          code: item.project?.code || null,
          city: item.project?.city || null,
          tasks: 0,
          records: 0,
          oldestAt: null,
          earliestDue: null,
        });
      }
      const g = byProject.get(id);
      g[kind] += 1;

      const since = kind === 'tasks'
        ? (item.submittedForApprovalAt || item.actualEnd || item.updatedAt)
        : (item.submittedAt || item.updatedAt);
      const at = since ? new Date(since).getTime() : null;
      if (at && (g.oldestAt === null || at < g.oldestAt)) g.oldestAt = at;

      // Only tasks carry a due date — see dueOf above.
      if (kind === 'tasks') {
        const due = dueOf(item);
        const dueMs = due ? new Date(due).getTime() : null;
        if (dueMs && (g.earliestDue === null || dueMs < g.earliestDue)) g.earliestDue = dueMs;
      }
    };
    for (const t of tasks) add(t, 'tasks');
    for (const r of records) add(r, 'records');

    return [...byProject.values()].map((g) => ({
      ...g,
      total: g.tasks + g.records,
      delay: delayOf(g.earliestDue),
    }));
  }, [tasks, records]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[COLUMNS.length - 1];
    const factor = sort.dir === 'desc' ? -1 : 1;
    return [...groups].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      /* A launch with no due date has no delay to rank, so it sorts last in
         BOTH directions rather than winning "worst" on a value it lacks. */
      const aMissing = av === null || av === undefined || av === '';
      const bMissing = bv === null || bv === undefined || bv === '';
      if (aMissing && bMissing) return a.name.localeCompare(b.name);
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (av === bv) return a.name.localeCompare(b.name);
      return (av < bv ? -1 : 1) * factor;
    });
  }, [groups, sort]);

  /* First click on a column gives its worst-first direction, because that is
     the question being asked of it; clicking the same one again reverses. */
  const toggleSort = (col) => setSort((prev) => (
    prev.key === col.key
      ? { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key: col.key, dir: col.worstFirst }
  ));

  const open = (id) => (onOpenProject ? onOpenProject(id) : navigate(`/approvals/project/${id}`));

  if (groups.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={CheckCircle2}
          title="All caught up"
          hint="Nothing is waiting on your decision."
        />
      </div>
    );
  }

  const Arrow = sort.dir === 'asc' ? ChevronUp : ChevronDown;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="pi-table-wrap">
        <table className="table apr-ptable">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={`apr-pth${active ? ' active' : ''}${c.numeric ? ' num' : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" onClick={() => toggleSort(c)}>
                      {c.label}
                      {active && <Arrow size={12} strokeWidth={2.8} />}
                    </button>
                  </th>
                );
              })}
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => {
              const waitingDays = g.oldestAt === null ? null : dayDiff(g.oldestAt, Date.now());
              return (
                <tr key={g.id} className="apr-prow" onClick={() => open(g.id)}>
                  <td className="apr-pname">{g.name}</td>
                  <td>{g.city ? <CityChip city={g.city} /> : <span className="tiny muted">—</span>}</td>
                  <td><span className="proj-code">{g.code || '—'}</span></td>
                  <td className="num apr-pcount">{g.total}</td>
                  {/* Tinted only when this launch is actually late. An age on a
                      launch with time still in hand is not a warning. */}
                  <td className={`num${g.delay.tone === 'late' ? ' apr-pdanger' : ''}`}>
                    {waitingDays === null ? '—'
                      : waitingDays === 0 ? 'today'
                        : `${waitingDays} day${waitingDays === 1 ? '' : 's'}`}
                  </td>
                  <td className="num">
                    {g.earliestDue ? dayjs(g.earliestDue).format('DD MMM YYYY') : '—'}
                  </td>
                  <td className="num">
                    <span className={`apr-delay ${g.delay.tone}`}>{g.delay.label}</span>
                  </td>
                  <td className="apr-pchev"><ChevronRight size={15} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ApprovalsByProject;
