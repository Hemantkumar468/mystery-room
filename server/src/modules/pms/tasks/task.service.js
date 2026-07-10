import { Task } from './task.model.js';
import { Project } from '../projects/project.model.js';
import { projectService } from '../projects/project.service.js';
import { activityService } from '../activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import { TASK_STATUS, TASK_STATUS_VALUES, ACTIVITY_ACTIONS } from '../../../core/constants/index.js';

function buildFilter(query = {}) {
  const filter = {};
  if (query.project) filter.project = query.project;
  if (query.status) filter.status = query.status;
  if (query.assignee) filter.assignee = query.assignee;
  if (query.stageKey) filter.stageKey = query.stageKey;
  if (query.priority) filter.priority = query.priority;
  if (query.department) filter.department = query.department;
  if (query.search) filter.$or = [
    { title: new RegExp(query.search, 'i') },
    { code: new RegExp(query.search, 'i') },
  ];
  if (query.overdue === 'true' || query.overdue === true) {
    filter.status = { $ne: TASK_STATUS.DONE };
    filter.plannedEnd = { $lt: new Date() };
  }
  return filter;
}

export const taskService = {
  async list(query = {}) {
    const { page, limit, skip } = getPagination(query);
    const filter = buildFilter(query);
    const [items, total] = await Promise.all([
      Task.find(filter)
        .sort(parseSort(query.sort, { plannedEnd: 1 }))
        .skip(skip)
        .limit(limit)
        .populate('assignee', 'name role avatarColor')
        .populate('project', 'name code city'),
      Task.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  /** Kanban view: one column per status, ordered for a single project. */
  async board(projectId) {
    if (!projectId) throw ApiError.badRequest('projectId is required for the board view');
    const tasks = await Task.find({ project: projectId })
      .sort({ order: 1, plannedEnd: 1 })
      .populate('assignee', 'name role avatarColor');

    const columns = TASK_STATUS_VALUES.map((status) => ({
      status,
      tasks: tasks.filter((t) => t.status === status),
    }));
    return { columns, total: tasks.length };
  },

  async getById(id) {
    const task = await Task.findById(id)
      .populate('assignee', 'name role avatarColor title')
      .populate('project', 'name code city')
      .populate('comments.author', 'name role avatarColor');
    if (!task) throw ApiError.notFound('Task not found');
    return task;
  },

  async create(data, userId) {
    const project = await Project.findById(data.project).select('code stages');
    if (!project) throw ApiError.notFound('Project not found');
    const stage = project.stages.find((s) => s.key === data.stageKey);
    if (!stage) throw ApiError.badRequest(`Unknown stage "${data.stageKey}"`);

    const count = await Task.countDocuments({ project: project._id });
    const task = await Task.create({
      ...data,
      stageName: stage.name,
      code: `${project.code}-T${String(count + 1).padStart(3, '0')}`,
      createdBy: userId,
    });

    await projectService.recompute(project._id);
    await activityService.log({
      project: project._id,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: userId,
      message: `Task "${task.title}" created`,
    });
    return this.getById(task._id);
  },

  async update(id, data, userId) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    const editable = [
      'title', 'description', 'priority', 'department', 'assignee',
      'assignees', 'primaryAssignee', 'backupAssignee',
      'plannedStart', 'plannedEnd', 'estimatedHours', 'actualHours',
      'checklist', 'dependencies', 'tags', 'order', 'status',
    ];
    const statusChanged = data.status && data.status !== task.status;
    const assigneeChanged =
      data.assignee !== undefined && String(data.assignee) !== String(task.assignee || '');

    for (const key of editable) if (data[key] !== undefined) task[key] = data[key];
    await task.save();
    await projectService.recompute(task.project);

    if (statusChanged) {
      await activityService.log({
        project: task.project,
        entityType: 'task',
        entityId: task._id,
        action:
          data.status === TASK_STATUS.DONE
            ? ACTIVITY_ACTIONS.COMPLETED
            : ACTIVITY_ACTIONS.STATUS_CHANGED,
        actor: userId,
        message: `Task "${task.title}" → ${data.status.replace('_', ' ')}`,
        meta: { status: data.status },
      });
    } else if (assigneeChanged) {
      await activityService.log({
        project: task.project,
        entityType: 'task',
        entityId: task._id,
        action: ACTIVITY_ACTIONS.ASSIGNED,
        actor: userId,
        message: `Task "${task.title}" reassigned`,
      });
    }
    return this.getById(id);
  },

  /** Focused status transition used by the board's drag-and-drop. */
  async updateStatus(id, status, userId) {
    return this.update(id, { status }, userId);
  },

  async addComment(id, body, userId) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    task.comments.push({ author: userId, body });
    await task.save();
    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.COMMENTED,
      actor: userId,
      message: `Commented on "${task.title}"`,
    });
    return this.getById(id);
  },

  async remove(id, userId) {
    const task = await Task.findByIdAndDelete(id);
    if (!task) throw ApiError.notFound('Task not found');
    await projectService.recompute(task.project);
    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.DELETED,
      actor: userId,
      message: `Task "${task.title}" deleted`,
    });
    return task;
  },

  /** "My Work" — open tasks for a user, soonest deadline first. */
  async myTasks(userId, limit = 50) {
    return Task.find({ assignee: userId, status: { $ne: TASK_STATUS.DONE } })
      .sort({ plannedEnd: 1 })
      .limit(limit)
      .populate('project', 'name code city');
  },
};

export default taskService;
