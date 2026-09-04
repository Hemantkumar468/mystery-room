/**
 * The new equivalent of "complete this phase".
 *
 * `projectService.completeStage()` is gone: a phase is complete when its tasks
 * are, computed on read. Suites written against the old model called that
 * method to move a project forward, and stubbing it would have left them
 * asserting nothing while still printing PASS — the worst outcome available.
 *
 * So this does what the product now does: it sets the phase's tasks to
 * complete. A phase with no tasks is a real state (`pending`), and saying so
 * here is more honest than inventing one.
 */
import { Task } from '../../src/modules/pms/tasks/task.model.js';
import { TASK_STATUS } from '../../src/core/constants/index.js';

/**
 * @returns {Promise<number>} how many tasks were moved — 0 means the phase was
 *   empty, and the caller's expectation of "completed" cannot hold.
 */
export async function completePhase(projectId, stageKey) {
  const res = await Task.updateMany(
    { project: projectId, stageKey },
    { $set: { status: TASK_STATUS.COMPLETE, completedAt: new Date() } },
  );
  return res.modifiedCount ?? res.nModified ?? 0;
}

/** Set every task in a phase back to pending — the new "reopen". */
export async function reopenPhase(projectId, stageKey) {
  const res = await Task.updateMany(
    { project: projectId, stageKey },
    { $set: { status: TASK_STATUS.PENDING, completedAt: null } },
  );
  return res.modifiedCount ?? res.nModified ?? 0;
}

export default completePhase;

/**
 * Get a task into the approval queue.
 *
 * Completing a task no longer submits it — sign-off is a separate, deliberate
 * action on a separate field. Suites written against the old model completed a
 * task and went straight to decide(), which now answers "this task isn't
 * waiting on any approval decision". This is the missing step, in one place so
 * the suites do not each grow their own copy.
 */
export async function submitForApproval(taskId) {
  /* Writes the fields directly rather than calling the service. This is a
     FIXTURE helper: its job is to put a task in the approval queue so the
     assertion under test can run, not to re-test submitForApproval's own
     permission rules — which have their own assertions elsewhere, and which
     would otherwise make every fixture need a correctly-shaped doer. */
  await Task.updateOne({ _id: taskId }, {
    $set: {
      status: TASK_STATUS.COMPLETE,
      approvalState: 'waiting_department',
      submittedForApprovalAt: new Date(),
    },
  });
}
