import dayjs from './dayjs.js';

/**
 * THE RULE ENGINE. Every colour on the Data Explorer comes from here, and
 * from nowhere else — one task, one phase, one launch, all judged by the same
 * five-state rule, so the green on a Phase 3 tab means exactly what the green
 * on one of its task rows means.
 *
 *   on_time    green   done, on or before its date
 *   late       amber   done, but after it — carries how many days
 *   overdue    red     the date has passed and it is still not done
 *   waiting    blue    sitting in someone's approval queue
 *   open       grey    not due yet
 *
 * The order those are tested in is deliberate. OVERDUE BEATS WAITING: a task
 * parked in an approval queue three days past its date is late, and colouring
 * it blue would let a queue hide a slipped deadline, which is the one thing
 * this page exists to prevent.
 *
 * Colours are the semantic tokens' literal values rather than var(--success)
 * so they can be handed to an inline style, a CSS custom property or a chart
 * without the caller knowing which form a given consumer accepts.
 */
export const DELIVERY_META = {
  on_time: { label: 'Done on time', legend: 'Green', gloss: 'done on time', color: '#1E7A52', soft: '#E6F2EC' },
  late: { label: 'Done late', legend: 'Amber', gloss: 'done, but late', color: '#AC6F0C', soft: '#FBF0DC' },
  overdue: { label: 'Past its date', legend: 'Red', gloss: 'date passed, still not done', color: '#B32E24', soft: '#FBE9E7' },
  waiting: { label: 'Waiting for approval', legend: 'Blue', gloss: 'waiting on an approval', color: '#35618F', soft: '#E8F0F8' },
  open: { label: 'Not due yet', legend: 'Grey', gloss: 'not due yet', color: '#9AA1AE', soft: '#EFF1F4' },
};

/** Legend order: worst news last, so the eye lands on green first. */
export const DELIVERY_ORDER = ['on_time', 'late', 'overdue', 'waiting', 'open'];

/** How bad each state is, for sorting a column by it. */
export const DELIVERY_RANK = { overdue: 0, waiting: 1, open: 2, late: 3, on_time: 4 };

/** The approval states that mean "somebody has to press a button". */
const AWAITING = new Set(['waiting_department', 'waiting_management']);

/** Whole days between two dates, both truncated to midnight — so a task
 *  completed at 4pm on its due date is 0 days late, not part of a day. */
const dayDiff = (to, from) => dayjs(to).startOf('day').diff(dayjs(from).startOf('day'), 'day');

const latest = (dates) => {
  const real = dates.filter(Boolean).map((d) => +new Date(d)).filter(Number.isFinite);
  return real.length ? new Date(Math.max(...real)) : null;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One task's verdict.
 *
 * `slip` is the number of days lost — positive on `late` and `overdue`, zero
 * everywhere else — and it is what a phase and a launch roll up.
 *
 * `viewerDecides` only changes the WORDS: someone who can approve reads
 * "With you", everyone else reads "Waiting for approval". The colour and the
 * state are identical either way, so two people never see the same task in
 * two different colours.
 */
export function taskDelivery(task, { now = new Date(), viewerDecides = false } = {}) {
  const due = task?.plannedEnd || task?.dueAt || null;
  const done = task?.status === 'complete' ? (task.completedAt || null) : null;

  if (task?.status === 'complete') {
    if (!due || !done) return { state: 'on_time', slip: 0, label: 'Done', due, done };
    const slip = dayDiff(done, due);
    if (slip > 0) return { state: 'late', slip, label: `Done ${plural(slip, 'day')} late`, due, done };
    return {
      state: 'on_time',
      slip: 0,
      label: slip < 0 ? `Done ${plural(-slip, 'day')} early` : 'Done on time',
      due,
      done,
    };
  }

  const over = due ? dayDiff(now, due) : null;
  // Overdue first, always — an approval queue must never mask a missed date.
  if (over > 0) return { state: 'overdue', slip: over, label: `Past its date by ${plural(over, 'day')}`, due, done: null };

  if (AWAITING.has(task?.approvalState)) {
    return {
      state: 'waiting',
      slip: 0,
      label: viewerDecides ? 'With you to approve' : 'Waiting for approval',
      due,
      done: null,
    };
  }

  if (over === null) return { state: 'open', slip: 0, label: 'No date set', due: null, done: null };
  return { state: 'open', slip: 0, label: over === 0 ? 'Due today' : `${plural(-over, 'day')} left`, due, done: null };
}

/**
 * One phase, rolled up from its own tasks — never from `stage.status`, which
 * does not exist: the project stage snapshot stores no status at all, because
 * progress is derived from the tasks on every read (server phaseProgress.js).
 * Reading a field that was never there is what made every phase on this page
 * report "Not started" however finished it was.
 *
 * A phase with no tasks is "not scheduled", not "done". Nothing-to-do and
 * everything-done look identical to a counter and are opposite to a person.
 */
export function phaseDelivery(tasks = [], opts) {
  const list = Array.isArray(tasks) ? tasks : [];
  const total = list.length;
  if (!total) return { state: 'open', slip: 0, label: 'Not scheduled', done: 0, total: 0, overdue: 0, waiting: 0 };

  const each = list.map((t) => taskDelivery(t, opts));
  const slip = each.reduce((a, s) => Math.max(a, s.slip), 0);
  const done = each.filter((s) => s.state === 'on_time' || s.state === 'late').length;
  const overdue = each.filter((s) => s.state === 'overdue').length;
  const waiting = each.filter((s) => s.state === 'waiting').length;
  const counts = { done, total, overdue, waiting };

  if (done === total) {
    return slip > 0
      ? { state: 'late', slip, label: `Finished ${plural(slip, 'day')} late`, ...counts }
      : { state: 'on_time', slip: 0, label: 'Finished on time', ...counts };
  }
  if (overdue) return { state: 'overdue', slip, label: `Running ${plural(slip, 'day')} late`, ...counts };
  if (waiting) {
    return {
      state: 'waiting',
      slip: 0,
      label: opts?.viewerDecides ? `${waiting} with you to approve` : `${waiting} waiting for approval`,
      ...counts,
    };
  }
  if (done) return { state: 'open', slip: 0, label: 'In progress, on time', ...counts };
  return { state: 'open', slip: 0, label: 'Not started', ...counts };
}

/**
 * The whole launch: the worst slip anywhere in it, and the counts behind the
 * fact strip. `projectedOpening` pushes the target date out by that slip —
 * the number a director actually wants, rather than a target everyone can
 * see has already been missed.
 */
export function projectDelivery(project, phases = [], tasks = [], opts) {
  const list = Array.isArray(tasks) ? tasks : [];
  const each = list.map((t) => taskDelivery(t, opts));
  const perPhase = phases.map((p) => p.verdict).filter(Boolean);
  const slip = perPhase.reduce((a, s) => Math.max(a, s.slip), 0);

  const overdue = each.filter((s) => s.state === 'overdue').length;
  const waiting = each.filter((s) => s.state === 'waiting').length;
  const done = each.filter((s) => s.state === 'on_time' || s.state === 'late').length;
  const phasesDone = perPhase.filter((s) => s.total > 0 && s.done === s.total).length;

  const target = project?.targetEndDate || null;
  let state = 'on_time';
  let label = 'On schedule';
  if (overdue) { state = 'overdue'; label = `${plural(slip, 'day')} late`; }
  else if (waiting) { state = 'waiting'; label = opts?.viewerDecides ? `${waiting} with you` : `${waiting} waiting for approval`; }
  else if (slip > 0) { state = 'late'; label = `${plural(slip, 'day')} late`; }
  else if (!done) { state = 'open'; label = 'Not started'; }

  return {
    state,
    slip,
    label,
    done,
    total: list.length,
    overdue,
    waiting,
    phasesDone,
    phases: phases.length,
    target,
    projectedOpening: target ? dayjs(target).add(slip, 'day').toDate() : latest(each.map((s) => s.due)),
  };
}

export default taskDelivery;
