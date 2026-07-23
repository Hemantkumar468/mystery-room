import { Task } from './task.model.js';
import { Project } from '../projects/project.model.js';
import { projectService } from '../projects/project.service.js';
import { activityService } from '../activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import { logger } from '../../../config/logger.js';
import {
  uploadBuffer,
  destroyAsset,
  isCloudinaryConfigured,
} from '../../../config/cloudinary.js';
import {
  TASK_STATUS,
  TASK_STATUS_VALUES,
  TASK_STATUS_LABELS,
  ACTIVITY_ACTIONS,
  ROLES,
} from '../../../core/constants/index.js';

/**
 * A user may change a task's status only if they are its "doer" — the assigned
 * User, or a login account whose employeeId matches the task's roster
 * primary/backup/assignees — or a manager/admin (who oversee and own the board).
 */
function canChangeStatus(actor, task) {
  if (!actor) return false;
  if (actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER) return true;
  const isAssignee = task.assignee && String(task.assignee) === String(actor.id);
  const emp = actor.employeeId;
  const isRosterDoer = Boolean(
    emp
      && (emp === task.primaryAssignee
        || emp === task.backupAssignee
        || (task.assignees || []).includes(emp)),
  );
  return isAssignee || isRosterDoer;
}

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
        .populate('assignee', 'name role avatarColor title')
        .populate('project', 'name code city')
        .populate('dependencies', 'code title')
        .populate('createdBy', 'name avatarColor'),
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
      meta: { stageKey: task.stageKey },
    });
    return this.getById(task._id);
  },

  async update(id, data, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    const statusChanged = data.status && data.status !== task.status;
    const assigneeChanged =
      data.assignee !== undefined && String(data.assignee) !== String(task.assignee || '');

    // Only the task's doer (or a manager/admin) may move its status.
    if (statusChanged && !canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can change this task’s status');
    }

    const userId = actor?.id;
    const editable = [
      'title', 'description', 'priority', 'department', 'assignee',
      'assignees', 'primaryAssignee', 'backupAssignee',
      'plannedStart', 'plannedEnd', 'estimatedHours', 'actualHours',
      'checklist', 'dependencies', 'tags', 'order', 'status',
    ];

    for (const key of editable) if (data[key] !== undefined) task[key] = data[key];
    await task.save();
    await projectService.recompute(task.project, userId);

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
        message: `changed status of "${task.title}" to ${TASK_STATUS_LABELS[data.status] || data.status}`,
        meta: { status: data.status, stageKey: task.stageKey },
      });
    } else if (assigneeChanged) {
      await activityService.log({
        project: task.project,
        entityType: 'task',
        entityId: task._id,
        action: ACTIVITY_ACTIONS.ASSIGNED,
        actor: userId,
        message: `Task "${task.title}" reassigned`,
        meta: { stageKey: task.stageKey },
      });
    }
    return this.getById(id);
  },

  /** Focused status transition used by the board's drag-and-drop. */
  async updateStatus(id, status, actor) {
    return this.update(id, { status }, actor);
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
      meta: { stageKey: task.stageKey },
    });
    return this.getById(id);
  },

  /** Upload a file buffer to Cloudinary and attach it to the task. */
  async addAttachment(id, file, actor) {
    if (!file) throw ApiError.badRequest('No file provided');
    if (!isCloudinaryConfigured) {
      throw new ApiError(503, 'File uploads are not configured', {
        code: 'CLOUDINARY_NOT_CONFIGURED',
      });
    }
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can upload attachments to this task');
    }

    const userId = actor?.id;
    const result = await uploadBuffer(file.buffer, {
      folder: `mysteryrooms/tasks/${task._id}`,
    });

    task.attachments.push({
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      originalName: file.originalname,
      mimetype: file.mimetype,
      bytes: result.bytes,
      uploadedBy: userId,
    });
    await task.save();

    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `uploaded "${file.originalname}" to "${task.title}"`,
      meta: { stageKey: task.stageKey, publicId: result.public_id },
    });
    return this.getById(id);
  },

  /** Remove an attachment from the task and delete it from Cloudinary. */
  async removeAttachment(id, attachmentId, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can delete attachments from this task');
    }

    const attachment = task.attachments.id(attachmentId);
    if (!attachment) throw ApiError.notFound('Attachment not found');

    // Delete the remote asset first so nothing is orphaned on Cloudinary. A
    // failure here is logged but doesn't block removing the DB reference.
    try {
      await destroyAsset(attachment.publicId, attachment.resourceType);
    } catch (err) {
      logger.warn('Failed to delete Cloudinary asset', {
        publicId: attachment.publicId,
        error: err.message,
      });
    }

    const { originalName, publicId } = attachment;
    const userId = actor?.id;
    task.attachments.pull(attachmentId);
    await task.save();

    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `deleted "${originalName || publicId}" from "${task.title}"`,
      meta: { stageKey: task.stageKey, publicId },
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
      meta: { stageKey: task.stageKey },
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
