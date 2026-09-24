import { Task } from '../../tasks/task.model.js';

/**
 * Was this on time, and is anything waiting behind it?
 *
 * Applies to every task, because every task has a plan and an actual — this is
 * the one block that is never irrelevant.
 *
 * "Blocks downstream" is a reverse dependency lookup: `Task.dependencies` holds
 * the tasks THIS one waits on, so the tasks waiting on this one are found by
 * querying for documents that name it. That matters to an approver in a way the
 * date comparison does not — a task three days late that nothing depends on is
 * a note, and the same task with four tasks queued behind it is the reason the
 * phase has not moved.
 */
export const scheduleBlock = {
  key: 'schedule',
  title: 'Schedule',

  applies: () => true,

  async build(task) {
    const planned = task.plannedEnd ? new Date(task.plannedEnd) : null;
    const actual = task.actualEnd ? new Date(task.actualEnd) : null;

    let varianceDays = null;
    if (planned && actual) {
      varianceDays = Math.round((actual - planned) / 86_400_000);
    }

    /* Only unfinished dependents are worth naming. A completed task that once
       depended on this one is not blocked by it — listing it would inflate the
       count with work that already happened. */
    const dependents = await Task.find({ dependencies: task._id })
      .select('code title status')
      .lean();
    const blocking = dependents.filter((d) => !['complete', 'approved'].includes(d.status));

    return {
      plannedEnd: planned,
      actualEnd: actual,
      varianceDays,
      // Named separately from the number so the client never has to decide
      // what a negative variance means.
      verdict: varianceDays === null ? 'unknown'
        : varianceDays > 0 ? 'late'
          : varianceDays < 0 ? 'early' : 'on_time',
      estimatedDays: task.estimatedDays ?? null,
      blocking: blocking.map((d) => ({ id: String(d._id), code: d.code, title: d.title })),
      blockingCount: blocking.length,
    };
  },
};

export default scheduleBlock;
