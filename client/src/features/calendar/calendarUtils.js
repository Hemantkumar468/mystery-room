/**
 * Pure helpers behind the calendar: date-range maths, the per-day triage
 * grouping that drives the dossier, month-load density, filter predicates,
 * and an .ics serializer.
 */
import dayjs from '../../lib/dayjs.js';
import { TASK_STATUS_META, PRIORITY_META, DEPT_META } from '../../lib/ui.js';
import { TASK_STATUS } from '../../lib/taskStatus.js';

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Tones resolve to theme tokens, never raw hex, so they track light/dark. */
export const MILESTONE_TONE = {
  color: 'var(--primary-strong)',
  soft: 'var(--primary-soft)',
  label: 'Go-Live',
};
export const OVERDUE_TONE = {
  color: 'var(--danger)',
  soft: 'var(--danger-soft)',
  label: 'Overdue',
};

export const EMPTY_FILTERS = {
  q: '',
  types: [],
  statuses: [],
  priorities: [],
  departments: [],
  projects: [],
  assignees: [],
  overdueOnly: false,
};

/** Colour a bar takes: milestones are always gold, tasks follow their status. */
export function eventTone(ev) {
  if (ev.type === 'milestone') return MILESTONE_TONE;
  const m = TASK_STATUS_META[ev.status];
  return m
    ? { color: m.color, soft: m.soft, label: m.label }
    : { color: '#6366f1', soft: 'rgba(99,102,241,0.14)', label: ev.status || 'Task' };
}

export const isDone = (ev) => ev.type === 'task' && ev.status === TASK_STATUS.COMPLETE;

export function isOverdue(ev, now = dayjs()) {
  if (ev.type !== 'task' || isDone(ev)) return false;
  return dayjs(ev.end || ev.start).endOf('day').isBefore(now);
}

export const startOf = (ev) => dayjs(ev.start || ev.end).startOf('day');
export const endOf = (ev) => dayjs(ev.end || ev.start).startOf('day');
export const spanDays = (ev) => Math.max(1, endOf(ev).diff(startOf(ev), 'day') + 1);
export const assigneeName = (ev) => ev.assignee?.name || null;

export function eventSubtitle(ev) {
  const bits = [];
  if (ev.project?.code) bits.push(ev.project.code);
  if (ev.stageName) bits.push(ev.stageName);
  return bits.join(' · ');
}

/**
 * The 42-day window the month grid draws — and exactly what we ask the server
 * for. Always six weeks, so the grid never changes height between months and
 * the density we paint on leading/trailing cells is backed by real data.
 */
export function monthWindow(cursor) {
  const start = cursor.startOf('month').startOf('isoWeek');
  return [start, start.add(41, 'day').endOf('day')];
}

/** Inclusive list of days between two dates. */
export function daysBetween(from, to) {
  const out = [];
  let d = from.startOf('day');
  const last = to.startOf('day');
  while (d.isSameOrBefore(last, 'day')) {
    out.push(d);
    d = d.add(1, 'day');
  }
  return out;
}

export const occursOn = (ev, day) =>
  day.isSameOrAfter(startOf(ev), 'day') && day.isSameOrBefore(endOf(ev), 'day');

export const eventsOn = (events, day) => events.filter((ev) => occursOn(ev, day));

/** Which day of a multi-day span the given day is — 0-based. */
export const dayIndexOf = (ev, day) => day.startOf('day').diff(startOf(ev), 'day');

/* ---------------- Per-day triage grouping ---------------- */

/** Render order. `passing` is last because it is the group that folds away. */
export const DAY_GROUPS = ['golive', 'overdue', 'due', 'starting', 'passing'];

export const DAY_GROUP_META = {
  golive: { label: 'Go-Live', tone: 'var(--primary-strong)' },
  overdue: { label: 'Overdue', tone: 'var(--danger)' },
  due: { label: 'Due today', tone: 'var(--warning)' },
  starting: { label: 'Starting today', tone: 'var(--secondary)' },
  passing: { label: 'In progress', tone: 'var(--text-subtle)' },
};

/**
 * Every event lands in exactly one group, first match wins. The point is that
 * a day's *edges* — what lands, what slipped, what kicks off — sit above the
 * long spans merely passing through it.
 */
export function assignDayGroup(ev, day) {
  if (ev.type === 'milestone') return 'golive';
  if (isOverdue(ev)) return 'overdue';
  if (endOf(ev).isSame(day, 'day')) return 'due';
  if (startOf(ev).isSame(day, 'day')) return 'starting';
  return 'passing';
}

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

const compareInGroup = (a, b) => {
  const pa = PRIORITY_RANK[a.priority] ?? 9;
  const pb = PRIORITY_RANK[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (a.title || '').localeCompare(b.title || '');
};

export function groupSelectedDay(events, day) {
  const out = { golive: [], overdue: [], due: [], starting: [], passing: [] };
  eventsOn(events, day).forEach((ev) => out[assignDayGroup(ev, day)].push(ev));
  DAY_GROUPS.forEach((k) => out[k].sort(compareInGroup));
  return out;
}

/**
 * The five triage buckets folded into what a reader actually decides between:
 * work that needs them today, and work merely running through the day.
 *
 * Overdue and due-today both demand a decision now, and splitting them across
 * two headed sections made a two-item day look like a wall. "Starting" and
 * "passing" are both just in-flight, distinguished by the day counter on the
 * card rather than by a section of their own. Go-lives stay separate — a
 * launch landing is not a task.
 */
export function dayPanelSections(events, day) {
  const g = groupSelectedDay(events, day);
  return {
    golive: g.golive,
    needsAction: [...g.overdue, ...g.due],
    running: [...g.starting, ...g.passing],
  };
}

/** "day 7 of 10" — where `day` sits inside a multi-day span. */
export function spanPosition(ev, day) {
  const total = spanDays(ev);
  const index = Math.min(Math.max(dayIndexOf(ev, day) + 1, 1), total);
  return { index, total };
}

/**
 * Why a card is in Needs Action, in the words the row uses: "overdue 2 days"
 * or "due today". Returns null for anything that is neither.
 */
export function urgencyLabel(ev, day) {
  if (ev.type === 'milestone') return null;
  if (isOverdue(ev)) {
    const late = dayjs().startOf('day').diff(endOf(ev), 'day');
    return late <= 0 ? 'overdue' : `overdue ${late} day${late === 1 ? '' : 's'}`;
  }
  if (endOf(ev).isSame(day, 'day')) return 'due today';
  return null;
}

/**
 * Nearest day that actually holds work, searched outward from `day` and biased
 * forward — an empty day should offer "what's next", not "what you missed".
 * Bounded by the loaded window, so it never promises a day we have no data for.
 */
export function nearestDayWithEvents(events, day, from, to) {
  if (!events.length) return null;
  const reach = Math.max(day.diff(from, 'day'), to.diff(day, 'day'));
  for (let i = 1; i <= reach; i += 1) {
    const ahead = day.add(i, 'day');
    if (ahead.isSameOrBefore(to, 'day') && eventsOn(events, ahead).length) return ahead;
    const behind = day.subtract(i, 'day');
    if (behind.isSameOrAfter(from, 'day') && eventsOn(events, behind).length) return behind;
  }
  return null;
}

/**
 * One pass over the visible window producing every cell's signal, so 42 cells
 * don't each re-scan the event list. `max` normalises the load meter: the
 * busiest day fills the bar, everything else is read relative to it.
 */
export function monthLoad(events, days) {
  const byDay = new Map();
  let max = 0;

  days.forEach((d) => {
    const items = eventsOn(events, d);
    if (items.length > max) max = items.length;
    // Milestones are kept as events, not counted: a cell names the go-lives
    // that land on it ("Bhopal"), and a bare number cannot do that.
    const milestones = items.filter((ev) => ev.type === 'milestone');
    byDay.set(d.format('YYYY-MM-DD'), {
      count: items.length,
      overdue: items.filter((ev) => isOverdue(ev)).length,
      tasks: items.filter((ev) => ev.type === 'task').length,
      milestones,
      hasOverdue: items.some((ev) => isOverdue(ev)),
      hasMilestone: milestones.length > 0,
    });
  });

  return { max, byDay };
}

/** What a go-live chip is called in a month cell — the city, else the code. */
export const milestoneChipLabel = (ev) =>
  ev.project?.city || ev.project?.code || ev.title || 'Go-live';

/**
 * Three buckets rather than a continuous fraction. A day is only ever "quiet,
 * busy, or heavy" at a glance, and normalising against the busiest day keeps
 * that true whether the month holds 6 events or 69.
 */
export function loadTier(count, max) {
  if (count === 0) return 'none';
  const share = count / Math.max(max, 1);
  if (share >= 0.66) return 'high';
  if (share >= 0.33) return 'med';
  return 'low';
}

/**
 * Task-only dimensions (status, priority, department, assignee) don't exist on
 * milestones, so narrowing by one of them hides milestones too — otherwise
 * "status: Done" would still surface every go-live and read as a bug.
 */
const TASK_ONLY_KEYS = ['statuses', 'priorities', 'departments', 'assignees'];
const hasTaskOnlyFilter = (f) => TASK_ONLY_KEYS.some((k) => f[k].length > 0) || f.overdueOnly;

export function filterEvents(events, filters) {
  const q = filters.q.trim().toLowerCase();

  return events.filter((ev) => {
    if (filters.types.length && !filters.types.includes(ev.type)) return false;
    if (filters.projects.length && !filters.projects.includes(ev.project?.id)) return false;

    if (q) {
      const haystack = [ev.title, ev.code, ev.stageName, ev.project?.name, ev.project?.code, assigneeName(ev)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    if (ev.type !== 'task') return !hasTaskOnlyFilter(filters);

    if (filters.statuses.length && !filters.statuses.includes(ev.status)) return false;
    if (filters.priorities.length && !filters.priorities.includes(ev.priority)) return false;
    if (filters.departments.length && !filters.departments.includes(ev.department)) return false;
    if (filters.assignees.length && !filters.assignees.includes(assigneeName(ev))) return false;
    if (filters.overdueOnly && !isOverdue(ev)) return false;

    return true;
  });
}

export const activeFilterCount = (f) =>
  (f.q.trim() ? 1 : 0) +
  (f.overdueOnly ? 1 : 0) +
  f.types.length +
  f.statuses.length +
  f.priorities.length +
  f.departments.length +
  f.projects.length +
  f.assignees.length;

/** Distinct filter options, derived from the events actually in range. */
export function deriveFacets(events) {
  const projects = new Map();
  const assignees = new Map();
  const departments = new Set();

  events.forEach((ev) => {
    if (ev.project?.id) projects.set(ev.project.id, ev.project);
    const name = assigneeName(ev);
    if (name) assignees.set(name, ev.assignee);
    if (ev.department) departments.add(ev.department);
  });

  return {
    projects: [...projects.values()].sort((a, b) => (a.code || '').localeCompare(b.code || '')),
    assignees: [...assignees.values()].sort((a, b) => a.name.localeCompare(b.name)),
    departments: [...departments].sort((a, b) => (DEPT_META[a] || a).localeCompare(DEPT_META[b] || b)),
  };
}

/** Headline counts for the toolbar's live summary. */
export function summarize(events) {
  return {
    total: events.length,
    milestones: events.filter((e) => e.type === 'milestone').length,
    overdue: events.filter((e) => isOverdue(e)).length,
    done: events.filter(isDone).length,
  };
}

export const priorityLabel = (p) => PRIORITY_META[p]?.label || p;
export const deptLabel = (d) => DEPT_META[d] || d;

/* ---------------- .ics export ---------------- */

const icsEscape = (s = '') => String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const icsDate = (d) => dayjs(d).format('YYYYMMDD');
const icsStamp = (d) => dayjs(d).format('YYYYMMDD[T]HHmmss[Z]');

/**
 * All-day VEVENTs. DTEND is exclusive in RFC 5545, hence the +1 day, otherwise
 * every event would import one day short.
 */
export function toIcs(events, calendarName = 'Mystery Rooms') {
  const now = icsStamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mystery Rooms ERP//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];

  events.forEach((ev) => {
    const description = [eventSubtitle(ev), assigneeName(ev) && `Owner: ${assigneeName(ev)}`]
      .filter(Boolean)
      .join(' — ');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.id}@mysteryrooms`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(startOf(ev))}`,
      `DTEND;VALUE=DATE:${icsDate(endOf(ev).add(1, 'day'))}`,
      `SUMMARY:${icsEscape(ev.type === 'milestone' ? `🎯 ${ev.title}` : ev.title)}`,
      description ? `DESCRIPTION:${icsEscape(description)}` : null,
      `CATEGORIES:${ev.type === 'milestone' ? 'MILESTONE' : 'TASK'}`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).join('\r\n');
}

export function downloadIcs(events, filename) {
  const blob = new Blob([toIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
