import dayjs from 'dayjs';
import { Project } from '../projects/project.model.js';
import { Task } from '../tasks/task.model.js';
import { activityService } from '../activity/activity.service.js';
import { misService } from '../mis/mis.service.js';
import { PROJECT_STATUS, TASK_STATUS } from '../../../core/constants/index.js';

/** Tasks not-yet-done falling due on each of the next 7 days. */
async function dueByDay(from) {
  const start = dayjs(from).startOf('day');
  const tasks = await Task.find({
    status: { $ne: TASK_STATUS.DONE },
    plannedEnd: { $gte: start.toDate(), $lt: start.add(7, 'day').toDate() },
  }).select('plannedEnd');
  const buckets = Array.from({ length: 7 }, (_, i) => ({
    label: start.add(i, 'day').format('ddd'),
    count: 0,
  }));
  for (const t of tasks) {
    const idx = dayjs(t.plannedEnd).startOf('day').diff(start, 'day');
    if (idx >= 0 && idx < 7) buckets[idx].count += 1;
  }
  return buckets;
}

/**
 * The master dashboard aggregation. Today it surfaces PMS stats; as more ERP
 * modules land, their headline metrics slot into the same summary payload.
 */
export const dashboardService = {
  async summary() {
    const now = new Date();
    const weekAhead = dayjs().add(7, 'day').toDate();

    const [
      statusRows,
      healthRows,
      cityRows,
      projectTotals,
      overdueTasks,
      dueThisWeek,
      activeProjects,
      upcomingMilestones,
      recentActivity,
      throughput,
      dueTrend,
    ] = await Promise.all([
      // Drafts count toward `total` (the "All Projects" KPI/lens on
      // ProjectsPage literally lists them, so the tile must match the row
      // count), but never toward `cityDistribution` (a draft may have no
      // city yet — a phantom bucket) or `avgProgress` (a draft's progress is
      // always 0, which would drag the average toward 0 for something that
      // hasn't started, not something behind schedule). `statusRows` is
      // deliberately left unfiltered: drafts show up as their own status
      // bucket there, letting a future "N Drafts" KPI consume it for free.
      Project.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Project.aggregate([{ $group: { _id: '$health', count: { $sum: 1 } } }]),
      Project.aggregate([
        { $match: { status: { $ne: PROJECT_STATUS.DRAFT } } },
        { $group: { _id: '$city', count: { $sum: 1 }, avgProgress: { $avg: '$progress' } } },
        { $sort: { count: -1 } },
      ]),
      Project.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            // $avg ignores nulls, so mapping a draft's progress to null here
            // excludes it from the average without excluding it from `total`.
            avgProgress: {
              $avg: { $cond: [{ $eq: ['$status', PROJECT_STATUS.DRAFT] }, null, '$progress'] },
            },
          },
        },
      ]),
      Task.countDocuments({ status: { $ne: TASK_STATUS.DONE }, plannedEnd: { $lt: now } }),
      Task.countDocuments({
        status: { $ne: TASK_STATUS.DONE },
        plannedEnd: { $gte: now, $lte: weekAhead },
      }),
      Project.find({ status: { $in: [PROJECT_STATUS.ACTIVE, PROJECT_STATUS.PLANNING] } })
        .sort({ health: -1, targetEndDate: 1 })
        .limit(6)
        .select('name code city status health progress currentStageKey targetEndDate owner')
        .populate('owner', 'name avatarColor'),
      Task.find({ status: { $ne: TASK_STATUS.DONE }, plannedEnd: { $gte: now, $lte: weekAhead } })
        .sort({ plannedEnd: 1 })
        .limit(8)
        .select('title code stageName plannedEnd priority project')
        .populate('project', 'name code city'),
      activityService.recent(12),
      misService.throughput({}),
      dueByDay(now),
    ]);

    const byStatus = Object.fromEntries(statusRows.map((r) => [r._id, r.count]));
    const byHealth = Object.fromEntries(healthRows.map((r) => [r._id, r.count]));

    return {
      kpis: {
        totalProjects: projectTotals[0]?.total || 0,
        activeProjects: byStatus[PROJECT_STATUS.ACTIVE] || 0,
        planningProjects: byStatus[PROJECT_STATUS.PLANNING] || 0,
        completedProjects: byStatus[PROJECT_STATUS.COMPLETED] || 0,
        avgProgress: Math.round(projectTotals[0]?.avgProgress || 0),
        overdueTasks,
        dueThisWeek,
        cities: cityRows.length,
      },
      statusDistribution: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      healthDistribution: ['on_track', 'at_risk', 'delayed'].map((health) => ({
        health,
        count: byHealth[health] || 0,
      })),
      cityDistribution: cityRows.map((r) => ({
        city: r._id,
        count: r.count,
        avgProgress: Math.round(r.avgProgress || 0),
      })),
      activeProjects,
      upcomingMilestones,
      recentActivity,
      // Trend series for KPI sparklines
      throughput: throughput.map((t) => t.completed),
      dueTrend: dueTrend.map((d) => d.count),
      cityProgress: cityRows.map((r) => Math.round(r.avgProgress || 0)),
    };
  },
};

export default dashboardService;
