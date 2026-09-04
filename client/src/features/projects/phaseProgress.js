/**
 * How far a phase has got, from its tasks. The client's copy of the server's
 * `pms/projects/phaseProgress.js`, and deliberately identical.
 *
 * Why a copy rather than trusting the server's number: the tree lets you change
 * a task's state and must re-colour its phase in the same frame, before any
 * request comes back. A screen that waits for the server to tell it what it
 * already knows feels broken. The server still computes the same value for
 * every other consumer — the two must never be allowed to drift, so if you
 * change one, change the other.
 *
 *     every task complete              → complete
 *     any task processing or complete  → processing
 *     otherwise (including no tasks)   → pending
 *
 * An empty phase is `pending`, not `complete`. "Nothing to do" and "everything
 * done" look the same to a counter and are opposites to a person.
 */
export const TASK_STATE = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
});

export function phaseProgress(tasks = []) {
  if (!tasks.length) return TASK_STATE.PENDING;
  let complete = 0;
  let started = 0;
  for (const t of tasks) {
    if (t?.status === TASK_STATE.COMPLETE) { complete += 1; started += 1; continue; }
    if (t?.status === TASK_STATE.PROCESSING) started += 1;
  }
  if (complete === tasks.length) return TASK_STATE.COMPLETE;
  return started > 0 ? TASK_STATE.PROCESSING : TASK_STATE.PENDING;
}

/** The same answer plus the counts, so "3 of 8" is not tallied twice. */
export function phaseCounts(tasks = []) {
  const counts = { pending: 0, processing: 0, complete: 0 };
  for (const t of tasks) {
    if (counts[t?.status] !== undefined) counts[t.status] += 1;
    else counts.pending += 1;
  }
  return { progress: phaseProgress(tasks), counts, total: tasks.length };
}

/**
 * RED IS A DATE, NOT A STATE.
 *
 * Nothing about the three states says "overdue". A task past its deadline is
 * still exactly whatever its owner last set it to — the clock beside it turns
 * red and the chip does not move. A card reading `Pending` with a red clock is
 * a correct card, and the most useful one on the screen.
 */
export function isPastDue(task, now = Date.now()) {
  if (!task || task.status === TASK_STATE.COMPLETE) return false;
  const due = task.dueAt || task.plannedEnd;
  if (!due) return false;
  const t = new Date(due).getTime();
  return !Number.isNaN(t) && t < now;
}

export default phaseProgress;
