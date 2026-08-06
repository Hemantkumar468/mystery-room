import mongoose from 'mongoose';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { Task, NOT_OVERDUE_STATUSES } from '../tasks/task.model.js';
import { Project } from '../projects/project.model.js';
import { TASK_STATUS, TASK_STATUS_VALUES, DEPARTMENT_VALUES } from '../../../core/constants/index.js';

dayjs.extend(isoWeek);

const DAY_MS = 86_400_000;
const toId = (v) => new mongoose.Types.ObjectId(v);

/** Allowed values for `?range=` — days of history, or `all` for no window. */
export const MIS_RANGES = Object.freeze(['7', '30', '90', '180', '365', 'all']);

/**
 * Statuses that mean "the work is moving" for the four-way task mix. Anything
 * delivered-but-not-closed (submitted for approval, approved) counts as in
 * flight rather than pending — it is off the doer's desk.
 */
const IN_FLIGHT_STATUSES = [
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.REVIEW,
  TASK_STATUS.WAITING_APPROVAL,
  TASK_STATUS.WAITING_MANAGEMENT_APPROVAL,
  TASK_STATUS.APPROVED,
];

/**
 * Aggregation predicate mirroring Task's `isOverdue` virtual (and the
 * `?overdue=true` list filter) so the number on this dashboard is the same
 * number the Overdue Tasks page shows when you click through from the alert.
 * The explicit null guard matters: BSON orders null below Date, so without it
 * every task with no due date would compare as overdue.
 */
const overdueExpr = (now) => ({
  $and: [
    { $not: [{ $in: ['$status', NOT_OVERDUE_STATUSES] }] },
    { $ne: ['$plannedEnd', null] },
    { $lt: ['$plannedEnd', now] },
  ],
});

/**
 * The MIS (Management Information System) layer. Everything here is derived
 * on-read via aggregation — no separate collection — so numbers are always live.
 *
 * Scoping model. Two kinds of metric live side by side and they window
 * differently on purpose:
 *
 *  - Cohort metrics (KPIs, task mix, planned-vs-actual, cycle time) cover the
 *    tasks *in play during* the selected range — created on or before the
 *    window ends and not already finished when it began. Windowing on
 *    `createdAt` alone would empty the page on any range shorter than the
 *    project's age, since a project mints its whole task list up front.
 *  - State metrics (team workload, project health, throughput) are always
 *    "as of now" — a snapshot has no meaningful history to slice, and the
 *    throughput trend carries its own eight-week window.
 *
 * Deltas compare a metric against the same metric over the *previous* window
 * of equal length. Since there is no historical snapshot collection, that is a
 * cohort-to-cohort comparison (both evaluated as of now), not a replay of what
 * the dashboard showed 30 days ago. The client labels it "vs previous period".
 */
export const misService = {
  async report(scope = {}) {
    const now = new Date();
    const days = scope.days || null; // null === all time
    const department = scope.department || null;

    const base = {};
    if (scope.projectId) base.project = toId(scope.projectId);
    if (department) base.department = department;

    const since = days ? dayjs(now).subtract(days, 'day').toDate() : null;
    const prevSince = days ? dayjs(now).subtract(days * 2, 'day').toDate() : null;

    const match = inPlayMatch(base, since, now);
    const prevMatch = days ? inPlayMatch(base, prevSince, since) : null;

    const projectScope = await this.projectScope(scope, department);

    const [
      kpis,
      prevKpis,
      taskMix,
      statusDistribution,
      onTime,
      prevOnTime,
      stageCycleTime,
      plannedVsActual,
      assigneeLoad,
      throughput,
      healthDistribution,
      departments,
    ] = await Promise.all([
      this.kpis(match, projectScope, now),
      prevMatch ? this.kpis(prevMatch, projectScope, now) : Promise.resolve(null),
      this.taskMix(match, now),
      this.statusDistribution(match),
      this.onTimeRate(match),
      prevMatch ? this.onTimeRate(prevMatch) : Promise.resolve(null),
      this.stageCycleTime(match),
      this.plannedVsActual(match),
      this.assigneeLoad(base, now),
      this.throughput(base),
      scope.projectId ? Promise.resolve([]) : this.healthDistribution(projectScope),
      this.departments(scope),
    ]);

    const deltas = buildDeltas(kpis, prevKpis, onTime, prevOnTime);

    return {
      generatedAt: now,
      scope: scope.projectId ? 'project' : 'portfolio',
      filters: { range: days ? String(days) : 'all', department: department || 'all' },
      departments,
      kpis,
      deltas,
      taskMix,
      statusDistribution,
      onTimeRate: onTime,
      stageCycleTime,
      plannedVsActual,
      assigneeLoad,
      throughput,
      healthDistribution,
      alerts: buildAlerts({ kpis, onTime, healthDistribution, plannedVsActual }),
    };
  },

  /**
   * Which projects the portfolio-level numbers cover. A team filter narrows it
   * to the projects that actually have work for that department — otherwise
   * "Marketing" would still claim every project in the business.
   */
  async projectScope(scope, department) {
    if (scope.projectId) return { _id: toId(scope.projectId) };
    if (!department) return {};
    const ids = await Task.distinct('project', { department });
    return { _id: { $in: ids } };
  },

  /** Departments that actually have tasks — drives the team filter's options. */
  async departments(scope) {
    const filter = scope.projectId ? { project: toId(scope.projectId) } : {};
    const values = await Task.distinct('department', filter);
    return DEPARTMENT_VALUES.filter((d) => values.includes(d));
  },

  async kpis(match, projectScope, now = new Date()) {
    const [taskAgg] = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          doneTasks: { $sum: { $cond: [{ $eq: ['$status', TASK_STATUS.DONE] }, 1, 0] } },
          overdueTasks: { $sum: { $cond: [overdueExpr(now), 1, 0] } },
          estimatedHours: { $sum: '$estimatedHours' },
          actualHours: { $sum: '$actualHours' },
        },
      },
    ]);

    const [projAgg] = await Project.aggregate([
      { $match: projectScope },
      {
        $group: {
          _id: null,
          totalProjects: { $sum: 1 },
          activeProjects: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          completedProjects: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          avgProgress: { $avg: '$progress' },
        },
      },
    ]);

    const t = taskAgg || {};
    const p = projAgg || {};
    const estimatedHours = Math.round(t.estimatedHours || 0);
    const actualHours = Math.round(t.actualHours || 0);
    return {
      totalProjects: p.totalProjects || 0,
      activeProjects: p.activeProjects || 0,
      completedProjects: p.completedProjects || 0,
      avgProgress: Math.round(p.avgProgress || 0),
      totalTasks: t.totalTasks || 0,
      doneTasks: t.doneTasks || 0,
      overdueTasks: t.overdueTasks || 0,
      completionRate: t.totalTasks ? Math.round((t.doneTasks / t.totalTasks) * 100) : 0,
      overdueRate: t.totalTasks ? Math.round((t.overdueTasks / t.totalTasks) * 100) : 0,
      estimatedHours,
      actualHours,
      /** Logged effort as a share of planned effort — >100 means we overran. */
      effortRatio: estimatedHours ? Math.round((actualHours / estimatedHours) * 100) : null,
    };
  },

  /**
   * The four-way mix the dashboard's segmented bar renders. Buckets are
   * mutually exclusive and sum to `totalTasks`; overdue is evaluated before
   * in-flight/pending so a late task is only ever counted as late.
   */
  async taskMix(match, now) {
    const [row] = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', TASK_STATUS.DONE] }, 1, 0] } },
          overdue: { $sum: { $cond: [overdueExpr(now), 1, 0] } },
          inFlight: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', TASK_STATUS.DONE] },
                    { $not: [overdueExpr(now)] },
                    { $in: ['$status', IN_FLIGHT_STATUSES] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const total = row?.total || 0;
    const completed = row?.completed || 0;
    const overdue = row?.overdue || 0;
    const inProgress = row?.inFlight || 0;
    return {
      total,
      buckets: [
        { key: 'completed', label: 'Completed', count: completed, color: '#059669' },
        { key: 'overdue', label: 'Overdue', count: overdue, color: '#DC2626' },
        { key: 'pending', label: 'Pending', count: Math.max(0, total - completed - overdue - inProgress), color: '#6B7280' },
        { key: 'in_progress', label: 'In progress', count: inProgress, color: '#4F46E5' },
      ],
    };
  },

  /** Task counts per status — for the detailed status breakdown. Zero-filled. */
  async statusDistribution(match) {
    const rows = await Task.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    return TASK_STATUS_VALUES.map((status) => ({ status, count: map[status] || 0 }));
  },

  async onTimeRate(match) {
    const [row] = await Task.aggregate([
      { $match: { ...match, status: TASK_STATUS.DONE } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          onTime: { $sum: { $cond: ['$completedOnTime', 1, 0] } },
        },
      },
    ]);
    const total = row?.total || 0;
    const onTime = row?.onTime || 0;
    return { total, onTime, late: total - onTime, rate: total ? Math.round((onTime / total) * 100) : 0 };
  },

  /** Average time-in-progress per stage (completed tasks only). */
  async stageCycleTime(match) {
    const rows = await Task.aggregate([
      {
        $match: {
          ...match,
          status: TASK_STATUS.DONE,
          actualStart: { $ne: null },
          actualEnd: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$stageName',
          avgDays: { $avg: { $divide: [{ $subtract: ['$actualEnd', '$actualStart'] }, DAY_MS] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);
    return rows.map((r) => ({
      stage: r._id || 'Unassigned',
      avgDays: Math.round((r.avgDays || 0) * 10) / 10,
      count: r.count,
    }));
  },

  /**
   * Planned vs actual working days rolled up per stage — the core MIS chart.
   * Sorted by slip (actual minus planned) descending so the worst offender is
   * the first row the eye lands on, which is what the chart is for.
   */
  async plannedVsActual(match) {
    const rows = await Task.aggregate([
      {
        $match: {
          ...match,
          status: TASK_STATUS.DONE,
          actualStart: { $ne: null },
          actualEnd: { $ne: null },
          plannedStart: { $ne: null },
          plannedEnd: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$stageName',
          planned: { $sum: { $divide: [{ $subtract: ['$plannedEnd', '$plannedStart'] }, DAY_MS] } },
          actual: { $sum: { $divide: [{ $subtract: ['$actualEnd', '$actualStart'] }, DAY_MS] } },
          tasks: { $sum: 1 },
        },
      },
    ]);
    return rows
      .map((r) => {
        const planned = Math.round((r.planned || 0) * 10) / 10;
        const actual = Math.round((r.actual || 0) * 10) / 10;
        return {
          stage: r._id || 'Unassigned',
          planned,
          actual,
          slip: Math.round((actual - planned) * 10) / 10,
          tasks: r.tasks,
        };
      })
      .sort((a, b) => b.slip - a.slip);
  },

  /** Open workload per assignee (top 8) with overdue split — the load chart. */
  async assigneeLoad(match, now) {
    return Task.aggregate([
      { $match: { ...match, status: { $ne: TASK_STATUS.DONE }, assignee: { $ne: null } } },
      {
        $group: {
          _id: '$assignee',
          open: { $sum: 1 },
          overdue: { $sum: { $cond: [overdueExpr(now), 1, 0] } },
        },
      },
      { $sort: { open: -1 } },
      { $limit: 8 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: '$user.name',
          avatarColor: '$user.avatarColor',
          open: 1,
          overdue: 1,
        },
      },
    ]);
  },

  /** Tasks completed per ISO week over the last 8 weeks — throughput trend line. */
  async throughput(match) {
    // Key weeks by isoWeekYear+isoWeek methods (not format tokens, which would
    // need the advancedFormat plugin and otherwise collapse to one bucket).
    const weekKey = (d) => `${d.isoWeekYear()}-W${String(d.isoWeek()).padStart(2, '0')}`;
    const since = dayjs().subtract(7, 'week').startOf('isoWeek');
    const done = await Task.find({
      ...match,
      status: TASK_STATUS.DONE,
      actualEnd: { $gte: since.toDate() },
    }).select('actualEnd');

    const buckets = new Map();
    for (let i = 0; i < 8; i += 1) {
      const wk = since.add(i, 'week');
      buckets.set(weekKey(wk), { week: wk.format('DD MMM'), completed: 0 });
    }
    for (const t of done) {
      const key = weekKey(dayjs(t.actualEnd));
      if (buckets.has(key)) buckets.get(key).completed += 1;
    }
    return [...buckets.values()];
  },

  async healthDistribution(projectScope = {}) {
    const rows = await Project.aggregate([
      { $match: projectScope },
      { $group: { _id: '$health', count: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    return ['on_track', 'at_risk', 'delayed'].map((health) => ({ health, count: map[health] || 0 }));
  },
};

/**
 * Tasks "in play" across [since, until]: already created by the time the
 * window closed, and not already finished before it opened. `since === null`
 * means the all-time range, which matches everything.
 */
function inPlayMatch(base, since, until) {
  if (!since) return { ...base };
  return {
    ...base,
    createdAt: { $lte: until },
    $or: [{ actualEnd: null }, { actualEnd: { $gte: since } }],
  };
}

/**
 * Period-over-period movement for the headline KPIs. `good` says which
 * direction is the healthy one, so the client colours the arrow without
 * re-deriving intent.
 *
 * A metric is null — chip hidden rather than rendered — whenever there is no
 * baseline to move away from: the all-time range has no previous window at
 * all, an empty previous cohort would turn "0% → 75%" into a bogus +75pt jump,
 * and a rate needs completed tasks on both sides before it means anything.
 * Counts (overdue, hours) survive an empty baseline because zero really is
 * their previous value.
 */
function buildDeltas(kpis, prevKpis, onTime, prevOnTime) {
  if (!prevKpis) return null;
  const hadTasks = prevKpis.totalTasks > 0;
  return {
    completionRate: hadTasks
      ? { change: kpis.completionRate - prevKpis.completionRate, unit: 'pt', good: 'up' }
      : null,
    onTimeRate: onTime.total && prevOnTime?.total
      ? { change: onTime.rate - prevOnTime.rate, unit: 'pt', good: 'up' }
      : null,
    overdueTasks: hadTasks
      ? { change: kpis.overdueTasks - prevKpis.overdueTasks, unit: '', good: 'down' }
      : null,
    actualHours: hadTasks
      ? { change: kpis.actualHours - prevKpis.actualHours, unit: 'h', good: 'up' }
      : null,
  };
}

/**
 * The "worth a look first" banner. Rules are ordered by how much they should
 * interrupt someone; the client shows the top one or two. Each alert carries
 * its own destination so the banner's button lands on the list that explains
 * the number rather than a generic page.
 */
function buildAlerts({ kpis, onTime, healthDistribution, plannedVsActual }) {
  const alerts = [];

  if (kpis.overdueTasks > 0) {
    const clauses = [`${kpis.overdueTasks} ${kpis.overdueTasks === 1 ? 'task is' : 'tasks are'} overdue`];
    // Only call out effort when it is a real overrun, and only when there is a
    // plan to overrun — a project with no estimates would otherwise read as
    // infinitely over budget.
    if (kpis.effortRatio != null && kpis.effortRatio >= 150) {
      const times = Math.round(kpis.effortRatio / 100);
      clauses.push(`actual effort is ${times}× the plan`);
    }
    alerts.push({
      key: 'overdue',
      tone: kpis.overdueRate >= 15 ? 'danger' : 'warning',
      message: `${clauses.join(' and ')} — worth a look first`,
      actionLabel: 'Review',
      actionTo: '/tasks/overdue',
    });
  }

  if (onTime.total >= 5 && onTime.rate < 70) {
    alerts.push({
      key: 'on_time',
      tone: 'warning',
      message: `On-time delivery is ${onTime.rate}% — ${onTime.late} of ${onTime.total} completed tasks missed their deadline`,
      actionLabel: 'See tasks',
      actionTo: '/tasks',
    });
  }

  const delayed = healthDistribution.find((h) => h.health === 'delayed')?.count || 0;
  if (delayed > 0) {
    alerts.push({
      key: 'health',
      tone: 'danger',
      message: `${delayed} ${delayed === 1 ? 'project is' : 'projects are'} flagged delayed`,
      actionLabel: 'Open projects',
      actionTo: '/projects',
    });
  }

  const worst = plannedVsActual[0];
  if (worst && worst.slip > 0) {
    alerts.push({
      key: 'slip',
      tone: 'warning',
      message: `${worst.stage} is running ${worst.slip}d over plan — the biggest slip in the portfolio`,
      actionLabel: null,
      actionTo: null,
    });
  }

  return alerts;
}

export default misService;
