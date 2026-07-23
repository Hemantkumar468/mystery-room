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

/**
 * Who may Approve/Reject a task waiting for sign-off: an Admin (anything),
 * or a Manager whose own department matches the task's — approval is
 * department-scoped, unlike every other role check in this file. A task with
 * no department set can only be decided by an Admin (no manager "owns" it).
 */
function canApprove(actor, task) {
  if (!actor) return false;
  if (actor.role === ROLES.ADMIN) return true;
  return Boolean(actor.role === ROLES.MANAGER && task.department && actor.department === task.department);
}

/**
 * Who may decide the second, cross-department "Management Approval" tier
 * (Phase 7): any Manager or Admin — deliberately NOT department-scoped like
 * canApprove(), since management sign-off sits above a single department.
 */
function canManagementApprove(actor) {
  if (!actor) return false;
  return actor.role === ROLES.ADMIN || actor.role === ROLES.MANAGER;
}

/** An approved task is locked — read-only for everyone except an Admin. */
function assertNotLocked(task, actor) {
  if (task.status === TASK_STATUS.APPROVED && actor?.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('This task is approved and locked — only an Admin can edit it.');
  }
}

/** Shared rich-detail populate chain for a single task, used by both
 * getById (by ObjectId) and getByCode (by the human-readable code) so the
 * two lookups can never drift out of sync. */
function populateTaskDetail(query) {
  return query
    .populate('assignee', 'name role avatarColor title phone email')
    .populate('project', 'name code city')
    .populate('comments.author', 'name role avatarColor')
    .populate('submittedForApprovalBy', 'name avatarColor')
    .populate('approvedBy', 'name avatarColor')
    .populate('managementApprovedBy', 'name avatarColor')
    .populate('rejectedBy', 'name avatarColor');
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
    const task = await populateTaskDetail(Task.findById(id));
    if (!task) throw ApiError.notFound('Task not found');
    return task;
  },

  /** Same rich detail as getById, looked up by the human-readable `code`
   * (e.g. MR-BHO-001-T052) instead of the raw ObjectId — backs the
   * URL-friendly /projects/:id/tasks/:code route (no Mongo id in the URL). */
  async getByCode(code) {
    const task = await populateTaskDetail(Task.findOne({ code }));
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

    assertNotLocked(task, actor);

    // The approval pipeline statuses only ever change via submitForApproval()/
    // decide() — never this generic PATCH, no matter what the client sends.
    const APPROVAL_ONLY_STATUSES = [
      TASK_STATUS.WAITING_APPROVAL, TASK_STATUS.WAITING_MANAGEMENT_APPROVAL,
      TASK_STATUS.APPROVED, TASK_STATUS.REJECTED,
    ];
    if (data.status && APPROVAL_ONLY_STATUSES.includes(data.status)) {
      throw ApiError.badRequest('Use Submit for Approval / Approve / Reject instead of setting this status directly.');
    }

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

  /** Assignee hands a Completed task off for department-manager sign-off. */
  async submitForApproval(id, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can submit this task for approval');
    }
    if (task.status !== TASK_STATUS.DONE) {
      throw ApiError.badRequest('Only a Completed task can be submitted for approval.');
    }

    const userId = actor?.id;
    task.status = TASK_STATUS.WAITING_APPROVAL;
    task.submittedForApprovalBy = userId;
    task.submittedForApprovalAt = new Date();
    await task.save();
    await projectService.recompute(task.project, userId);

    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.SUBMITTED_FOR_APPROVAL,
      actor: userId,
      message: `submitted "${task.title}" for approval`,
      meta: { stageKey: task.stageKey },
    });
    return this.getById(id);
  },

  /**
   * Decide a task waiting on either approval tier — branches on the task's
   * *current* status, since the same endpoint drives both:
   *  - waiting_approval (Phase 6, department tier): that department's
   *    manager (or Admin). Approve moves it to waiting_management_approval
   *    (not fully approved yet); reject sends it to `rejected`.
   *  - waiting_management_approval (Phase 7, management tier): any Manager
   *    or Admin. Approve makes it fully `approved` (locks it); reject sends
   *    it to `rejected`.
   * Reject always requires a reason so the assignee knows what to fix.
   */
  async decide(id, decision, { reason, remarks } = {}, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    const tier = task.status === TASK_STATUS.WAITING_APPROVAL ? 'department'
      : task.status === TASK_STATUS.WAITING_MANAGEMENT_APPROVAL ? 'management'
        : null;
    if (!tier) {
      throw ApiError.badRequest('This task isn’t waiting on any approval decision right now.');
    }
    if (tier === 'department' && !canApprove(actor, task)) {
      throw ApiError.forbidden('Only that task’s department manager (or an Admin) can decide it');
    }
    if (tier === 'management' && !canManagementApprove(actor)) {
      throw ApiError.forbidden('Only a Manager or Admin can give management approval');
    }

    const userId = actor?.id;
    if (decision === 'reject') {
      if (!reason?.trim()) throw ApiError.badRequest('A reason is required to reject this task.');
      task.status = TASK_STATUS.REJECTED;
      task.rejectedBy = userId;
      task.rejectedAt = new Date();
      task.rejectReason = reason.trim();
    } else if (tier === 'department') {
      task.status = TASK_STATUS.WAITING_MANAGEMENT_APPROVAL;
      task.approvedBy = userId;
      task.approvedAt = new Date();
      task.approvalRemarks = remarks?.trim() || undefined;
    } else {
      task.status = TASK_STATUS.APPROVED;
      task.managementApprovedBy = userId;
      task.managementApprovedAt = new Date();
      task.managementApprovalRemarks = remarks?.trim() || undefined;
    }
    await task.save();
    await projectService.recompute(task.project, userId);

    const actionMessage = decision === 'reject'
      ? `rejected "${task.title}" at ${tier === 'department' ? 'department' : 'management'} approval — ${task.rejectReason}`
      : tier === 'department'
        ? `approved "${task.title}" at department level — awaiting management approval`
        : `gave final management approval on "${task.title}" — fully approved`;
    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: decision === 'reject' ? ACTIVITY_ACTIONS.REJECTED : ACTIVITY_ACTIONS.APPROVED,
      actor: userId,
      message: actionMessage,
      meta: { stageKey: task.stageKey, tier },
    });
    return this.getById(id);
  },

  async addComment(id, body, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    const userId = actor?.id ?? actor;
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

  /**
   * Post a progress "update" — a comment (`kind: 'update'`) with zero or more
   * photos uploaded straight to Cloudinary, same pipeline as `addAttachment`
   * but stored on the comment itself rather than the task's `attachments[]`.
   */
  async addUpdate(id, { body, files }, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    if (!body?.trim() && !files?.length) {
      throw ApiError.badRequest('An update needs some text or at least one photo');
    }
    if (files?.length && !isCloudinaryConfigured) {
      throw new ApiError(503, 'File uploads are not configured', { code: 'CLOUDINARY_NOT_CONFIGURED' });
    }

    const userId = actor?.id;
    const photos = [];
    for (const file of files || []) {
      // eslint-disable-next-line no-await-in-loop
      const result = await uploadBuffer(file.buffer, { folder: `mysteryrooms/tasks/${task._id}` });
      photos.push({
        url: result.secure_url,
        publicId: result.public_id,
        resourceType: result.resource_type,
        originalName: file.originalname,
        mimetype: file.mimetype,
        bytes: result.bytes,
        uploadedBy: userId,
      });
    }

    task.comments.push({ author: userId, body: body || '', kind: 'update', photos });
    await task.save();
    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.COMMENTED,
      actor: userId,
      message: `posted an update on "${task.title}"`,
      meta: { stageKey: task.stageKey, photoCount: photos.length },
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
    assertNotLocked(task, actor);

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
    assertNotLocked(task, actor);

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
