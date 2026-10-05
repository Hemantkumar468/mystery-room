import dayjs from '../../lib/dayjs.js';

export const SCORE_WEIGHT = {
  inProgress: 10,
  notStarted: 25,
  late: 25,
  overdue: 100,
};

/** Return the negative average penalty percentage for each task outcome. */
export function calculateTaskScore(tasks, now = dayjs()) {
  const counts = {
    total: tasks.length,
    doneOnTime: 0,
    doneLate: 0,
    inProgress: 0,
    notStarted: 0,
    overdue: 0,
    neutral: 0,
  };
  const today = now.startOf('day');

  for (const task of tasks) {
    if (task.state === 'waiting') {
      counts.neutral += 1;
      continue;
    }

    if (task.state === 'completed') {
      const finishedAt = task.actualEnd || task.completedAt;
      if (!task.plannedEnd || !finishedAt) {
        counts.neutral += 1;
      } else if (dayjs(finishedAt).isAfter(dayjs(task.plannedEnd), 'day')) {
        counts.doneLate += 1;
      } else {
        counts.doneOnTime += 1;
      }
      continue;
    }

    if (task.plannedEnd && dayjs(task.plannedEnd).startOf('day').isBefore(today)) {
      counts.overdue += 1;
    } else if (task.state === 'progress') {
      counts.inProgress += 1;
    } else {
      counts.notStarted += 1;
    }
  }

  const penalty = counts.inProgress * SCORE_WEIGHT.inProgress
    + counts.notStarted * SCORE_WEIGHT.notStarted
    + counts.doneLate * SCORE_WEIGHT.late
    + counts.overdue * SCORE_WEIGHT.overdue;
  const averagePenalty = Math.round(penalty / counts.total);

  return {
    ...counts,
    score: counts.total ? (averagePenalty ? -averagePenalty : 0) : null,
  };
}