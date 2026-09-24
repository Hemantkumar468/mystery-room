import dayjs from 'dayjs';
import { Task } from '../tasks/task.model.js';
import { Project } from '../projects/project.model.js';

/**
 * Projects tasks and project milestones into a flat list of calendar events for
 * a date range — powers the Google-Calendar-style month/week view in the client.
 */
export const calendarService = {
  async events({ from, to, projectId } = {}) {
    const start = from ? dayjs(from).startOf('day') : dayjs().startOf('month');
    const end = to ? dayjs(to).endOf('day') : dayjs().endOf('month').add(1, 'week');

    /**
     * Overlap, not containment: a task belongs on the calendar if any part of
     * its planned span intersects the range. Matching only on `plannedEnd`
     * dropped multi-day tasks that ran past the last visible day, which made
     * their bars vanish from the month grid.
     */
    const taskFilter = {
      $or: [
        { plannedStart: { $ne: null, $lte: end.toDate() }, plannedEnd: { $gte: start.toDate() } },
        { plannedStart: null, plannedEnd: { $gte: start.toDate(), $lte: end.toDate() } },
      ],
    };
    if (projectId) taskFilter.project = projectId;

    const [tasks, projects] = await Promise.all([
      Task.find(taskFilter)
        .select('title code stageName plannedStart plannedEnd status priority department primaryAssignee project assignee')
        .populate('project', 'name code city')
        .populate('assignee', 'name avatarColor')
        .sort({ plannedEnd: 1 }),
      Project.find({
        ...(projectId ? { _id: projectId } : {}),
        targetEndDate: { $gte: start.toDate(), $lte: end.toDate() },
      }).select('name code city targetEndDate health'),
    ]);

    const taskEvents = tasks.map((t) => ({
      id: `task:${t._id}`,
      type: 'task',
      title: t.title,
      code: t.code,
      start: t.plannedStart || t.plannedEnd,
      end: t.plannedEnd,
      allDay: true,
      status: t.status,
      priority: t.priority,
      stageName: t.stageName,
      department: t.department || null,
      project: t.project ? { id: t.project._id, name: t.project.name, code: t.project.code, city: t.project.city } : null,
      assignee: t.assignee
        ? { name: t.assignee.name, avatarColor: t.assignee.avatarColor }
        : t.primaryAssignee
          ? { name: t.primaryAssignee, avatarColor: null }
          : null,
    }));

    const milestoneEvents = projects.map((p) => ({
      id: `milestone:${p._id}`,
      type: 'milestone',
      title: `Go-Live: ${p.name}`,
      start: p.targetEndDate,
      end: p.targetEndDate,
      allDay: true,
      status: p.health,
      project: { id: p._id, name: p.name, code: p.code, city: p.city },
    }));

    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      events: [...taskEvents, ...milestoneEvents],
    };
  },
};

export default calendarService;
