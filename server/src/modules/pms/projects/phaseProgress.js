import { TASK_STATUS } from '../../../core/constants/index.js';

/**
 * How far a phase has got, worked out from its tasks every time it is asked.
 *
 * NEVER STORED. A stored phase status is a second opinion about something the
 * tasks already answer, and the two drift: a stage marked complete whose tasks
 * are half open, or a stage stuck at "not started" because nobody pressed the
 * button. There is one source of truth now, and it is the tasks.
 *
 * The rule, in full:
 *
 *     every task complete              → complete
 *     any task processing or complete  → processing
 *     otherwise (including no tasks)   → pending
 *
 * An empty phase is `pending`, not `complete`. "Nothing to do" and "everything
 * done" look identical to a counter and are opposite to a person.
 */
export function phaseProgress(tasks = []) {
  if (!tasks.length) return TASK_STATUS.PENDING;

  let complete = 0;
  let started = 0;
  for (const t of tasks) {
    if (t?.status === TASK_STATUS.COMPLETE) { complete += 1; started += 1; continue; }
    if (t?.status === TASK_STATUS.PROCESSING) started += 1;
  }

  if (complete === tasks.length) return TASK_STATUS.COMPLETE;
  return started > 0 ? TASK_STATUS.PROCESSING : TASK_STATUS.PENDING;
}

/**
 * The same answer plus the counts behind it, for anything that wants to show
 * "3 of 8" beside the chip without counting a second time — and, more to the
 * point, without a caller inventing its own slightly different tally.
 */
export function phaseProgressDetail(tasks = []) {
  const counts = {
    [TASK_STATUS.PENDING]: 0,
    [TASK_STATUS.PROCESSING]: 0,
    [TASK_STATUS.COMPLETE]: 0,
  };
  for (const t of tasks) {
    if (counts[t?.status] !== undefined) counts[t.status] += 1;
    else counts[TASK_STATUS.PENDING] += 1; // unknown/legacy value reads as not started
  }
  return { progress: phaseProgress(tasks), counts, total: tasks.length };
}

export default phaseProgress;
