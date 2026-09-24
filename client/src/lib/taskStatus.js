/**
 * What a task's state actually is — the client's half of the three-state
 * migration the server finished and this side did not.
 *
 * A task has TWO independent axes:
 *
 *   status        pending → processing → complete     (has the work been done?)
 *   approvalState none / waiting_department / waiting_management
 *                 / approved / rejected               (has it been signed off?)
 *
 * The old model mixed them into one list — 'todo', 'in_progress', 'done',
 * 'review', 'waiting_approval', 'approved'. The server dropped that; its
 * validation now rejects anything else outright, which is why pressing
 * "Mark as Complete" answered:
 *
 *     status: Invalid enum value.
 *     Expected 'pending' | 'processing' | 'complete', received 'done'
 *
 * Sixty-one places in this app still spoke the old vocabulary. Reading with
 * the wrong word is quieter than writing with it but not harmless: a
 * completed task compared against 'done' is never equal, so it stays in the
 * overdue count, keeps its red chip, and goes on being chased.
 *
 * Everything that asks "is this finished?" goes through here, so there is one
 * place to be right and no literal left to drift.
 */

export const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
});

export const TASK_APPROVAL = Object.freeze({
  NONE: 'none',
  WAITING_DEPARTMENT: 'waiting_department',
  WAITING_MANAGEMENT: 'waiting_management',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/** The work is finished. The only correct test for "done". */
export const isDone = (task) => task?.status === TASK_STATUS.COMPLETE;

/** Still to do — the complement of `isDone`, named so the negation reads. */
export const isOpen = (task) => !isDone(task);

/**
 * The doer has handed it over: either it is complete, or it is sitting in
 * somebody's approval queue, which it can only reach by being finished.
 *
 * This is what the old `['done','waiting_approval','waiting_management_approval',
 * 'approved'].includes(t.status)` was reaching for. That test could never
 * match anything: three of those four were never statuses, and the fourth had
 * been renamed — so work waiting on a signature counted as not started.
 */
export const isExecuted = (task) => isDone(task) || [
  TASK_APPROVAL.WAITING_DEPARTMENT,
  TASK_APPROVAL.WAITING_MANAGEMENT,
  TASK_APPROVAL.APPROVED,
].includes(task?.approvalState);

/** Unfinished and past its date. Overdue is a date question, not a status one. */
export const isOverdue = (task, now = new Date()) => {
  if (isDone(task)) return false;
  const due = task?.plannedEnd || task?.dueAt;
  return Boolean(due) && new Date(due) < now;
};

/** Signed off, whoever signed it. */
export const isApproved = (task) => task?.approvalState === TASK_APPROVAL.APPROVED;

/** Waiting on somebody's signature right now. */
export const isAwaitingSignoff = (task) => [
  TASK_APPROVAL.WAITING_DEPARTMENT,
  TASK_APPROVAL.WAITING_MANAGEMENT,
].includes(task?.approvalState);

export default {
  TASK_STATUS, TASK_APPROVAL, isDone, isOpen, isExecuted, isOverdue, isApproved, isAwaitingSignoff,
};
