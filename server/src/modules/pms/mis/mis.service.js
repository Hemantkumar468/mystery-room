import mongoose from 'mongoose';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { Task } from '../tasks/task.model.js';
import { Project } from '../projects/project.model.js';
import { TASK_STATUS, TASK_STATUS_VALUES } from '../../../core/constants/index.js';

dayjs.extend(isoWeek);

const DAY_MS = 86_400_000;
const toId = (v) => new mongoose.Types.ObjectId(v);

/**
 * The MIS (Management Information System) layer. Everything here is derived
 * on-read via aggregation — no separate collection — so numbers are always live.
 */
export const misService = {
  async report(scope = {}) {
    const match = scope.projectId ? { project: toId(scope.projectId) } : {};
    const now = new Date();

    const [
      kpis,
      statusDistribution,
      onTime,
      stageCycleTime,
      plannedVsActual,
      assigneeLoad,
      throughput,
      healthDistribution,
    ] = await Promise.all([
      this.kpis(match, scope),
      this.statusDistribution(match),
      this.onTimeRate(match),
      this.stageCycleTime(match),
      this.plannedVsActual(match),
      this.assigneeLoad(match, now),
      this.throughput(match),
      scope.projectId ? Promise.resolve([]) : this.healthDistribution(),
    ]);

    return {
      generatedAt: now,
      scope: scope.projectId ? 'project' : 'portfolio',
      kpis,
      statusDistribution,
      onTimeRate: onTime,
      stageCycleTime,
      plannedVsActual,
      assigneeLoad,
      throughput,
      healthDistribution,
    };
  },

  async kpis(match, scope) {
    const now = new Date();
    const [taskAgg] = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTasks: { $sum: 1 },
          doneTasks: { $sum: { $cond: [{ $eq: ['$status', TASK_STATUS.DONE] }, 1, 0] } },
          overdueTasks: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$status', TASK_STATUS.DONE] }, { $lt: ['$plannedEnd', now] }] },
                1,
                0,
              ],
            },
          },
          estimatedHours: { $sum: '$estimatedHours' },
          actualHours: { $sum: '$actualHours' },
        },
      },
    ]);

    const projectMatch = scope.projectId ? { _id: toId(scope.projectId) } : {};
    const [projAgg] = await Project.aggregate([
      { $match: projectMatch },
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
    return {
      totalProjects: p.totalProjects || 0,
      activeProjects: p.activeProjects || 0,
      completedProjects: p.completedProjects || 0,
      avgProgress: Math.round(p.avgProgress || 0),
      totalTasks: t.totalTasks || 0,
      doneTasks: t.doneTasks || 0,
      overdueTasks: t.overdueTasks || 0,
      completionRate: t.totalTasks ? Math.round((t.doneTasks / t.totalTasks) * 100) : 0,
      estimatedHours: Math.round(t.estimatedHours || 0),
      actualHours: Math.round(t.actualHours || 0),
    };
  },

  /** Task counts per status — for the donut/status chart. Zero-filled. */
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

  /** Planned vs actual working days rolled up per stage — the core MIS bar chart. */
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
        },
      },
    ]);
    return rows.map((r) => ({
      stage: r._id || 'Unassigned',
      planned: Math.round((r.planned || 0) * 10) / 10,
      actual: Math.round((r.actual || 0) * 10) / 10,
    }));
  },

  /** Open workload per assignee (top 8) with overdue split — the load chart. */
  async assigneeLoad(match, now) {
    return Task.aggregate([
      { $match: { ...match, status: { $ne: TASK_STATUS.DONE }, assignee: { $ne: null } } },
      {
        $group: {
          _id: '$assignee',
          open: { $sum: 1 },
          overdue: { $sum: { $cond: [{ $lt: ['$plannedEnd', now] }, 1, 0] } },
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

  async healthDistribution() {
    const rows = await Project.aggregate([
      { $group: { _id: '$health', count: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    return ['on_track', 'at_risk', 'delayed'].map((health) => ({ health, count: map[health] || 0 }));
  },
};

export default misService;
