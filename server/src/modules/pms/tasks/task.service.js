import { Task, NOT_OVERDUE_STATUSES } from './task.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { User } from '../../auth/auth.model.js';
import { projectService } from '../projects/project.service.js';
import { activityService } from '../activity/activity.service.js';
import { notificationService } from '../notifications/notification.service.js';
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
  PROJECT_STATUS,
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

/** Department Planning (p5) allocates its work as Execution (p6) tasks. */
const EXEC_STAGE_KEY = 'p6';
/** Store Readiness (p8) files its checklist as tasks of its own stage. */
const READINESS_STAGE_KEY = 'p8';

/**
 * Legal work-status transitions for the generic PATCH. The approval tiers
 * (waiting_approval → waiting_management_approval → approved) are NOT here:
 * they're owned exclusively by submitForApproval()/decide(), and this method
 * rejects them outright (see APPROVAL_ONLY_STATUSES in update()).
 *
 *   todo ──▶ in_progress ──▶ done ──▶ (auto) waiting_approval ──▶ …
 *     ▲          ▲   │
 *     └──────────┘   └──▶ blocked ──▶ in_progress
 *
 * `review` is legacy — reachable only from data that already holds it, never
 * a new destination. `rejected` → in_progress is the "Resume Work" path.
 * Re-saving the same status is always allowed (a no-op edit).
 */
const LEGAL_TASK_TRANSITIONS = Object.freeze({
  [TASK_STATUS.TODO]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.BLOCKED],
  [TASK_STATUS.IN_PROGRESS]: [TASK_STATUS.TODO, TASK_STATUS.BLOCKED, TASK_STATUS.DONE],
  [TASK_STATUS.BLOCKED]: [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS],
  [TASK_STATUS.REVIEW]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.DONE],
  // Marking Done immediately submits for approval, so `done` is transient —
  // a task normally leaves it via the approval pipeline, not this PATCH.
  [TASK_STATUS.DONE]: [TASK_STATUS.IN_PROGRESS],
  // Sent back by a reviewer — the assignee picks the work back up.
  [TASK_STATUS.REJECTED]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.TODO],
  // Terminal for this endpoint; only an Admin can edit an approved task at
  // all (assertNotLocked), and never back into the work statuses.
  [TASK_STATUS.APPROVED]: [],
  [TASK_STATUS.WAITING_APPROVAL]: [],
  [TASK_STATUS.WAITING_MANAGEMENT_APPROVAL]: [],
});

function assertLegalStatusTransition(from, to) {
  if (from === to) return;
  const allowed = LEGAL_TASK_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw ApiError.badRequest(
      `A task that is ${TASK_STATUS_LABELS[from] || from} can’t move to ${TASK_STATUS_LABELS[to] || to}.`,
      { code: 'ILLEGAL_TASK_TRANSITION', details: { from, to, allowed } },
    );
  }
}

/**
 * Execution work can't start before Department Planning is closed out — the
 * plan (departments, owners, due dates, dependencies) has to be settled
 * before anyone works against it. Only blocks *starting*: a task already
 * mid-flight is unaffected, and allocation itself is gated separately on p4.
 */
async function assertExecutionMayBegin(task, toStatus) {
  if (task.stageKey !== EXEC_STAGE_KEY) return;
  if (toStatus !== TASK_STATUS.IN_PROGRESS) return;
  if (task.actualStart) return; // already under way — not a fresh start
  const project = await Project.findById(task.project).select('stages');
  const p5 = project?.stages?.find((s) => s.key === 'p5');
  if (p5 && p5.status !== 'completed') {
    throw ApiError.badRequest(
      'Department Planning (Phase 5) must be completed before Execution work can begin.',
      { code: 'P5_NOT_COMPLETE' },
    );
  }
}

/**
 * A task can only be Completed once the work it declares is actually done:
 * every required checklist item ticked, and every blocking dependency
 * cleared. Both are exactly what completeStage()'s p6 gate measures later —
 * enforcing them here stops a task reaching the approval queue in a state
 * that would deadlock the phase.
 */
async function assertCompletable(task) {
  const pendingChecklist = (task.checklist || []).filter((c) => c.required && !c.done);
  if (pendingChecklist.length) {
    throw ApiError.badRequest(
      `${pendingChecklist.length} required checklist item${pendingChecklist.length === 1 ? '' : 's'} still open: ${pendingChecklist.map((c) => c.label).join(', ')}`,
      { code: 'CHECKLIST_INCOMPLETE', details: pendingChecklist.map((c) => c.label) },
    );
  }
  if (task.dependencies?.length) {
    const CLEARED = [TASK_STATUS.DONE, TASK_STATUS.WAITING_APPROVAL, TASK_STATUS.WAITING_MANAGEMENT_APPROVAL, TASK_STATUS.APPROVED];
    const blocking = await Task.find({ _id: { $in: task.dependencies }, status: { $nin: CLEARED } }).select('code title');
    if (blocking.length) {
      throw ApiError.badRequest(
        `${blocking.length} blocking dependenc${blocking.length === 1 ? 'y is' : 'ies are'} not finished yet: ${blocking.map((t) => t.code).join(', ')}`,
        { code: 'DEPENDENCIES_UNRESOLVED', details: blocking.map((t) => t.code) },
      );
    }
  }
}

/**
 * Validate a Department Planning allocation (and any other task write that
 * carries these fields) against real data — the server-side half of the
 * Allocate Task modal's own rules, so an API caller can't file a task the
 * UI would never let a user create.
 *
 * `existing` is passed on update so partial edits validate against the
 * task's current values rather than treating every absent field as cleared.
 */
async function assertValidAllocation(data, project, { existing = null } = {}) {
  const stageKey = data.stageKey ?? existing?.stageKey;
  const department = data.department !== undefined ? data.department : existing?.department;
  const plannedStart = data.plannedStart !== undefined ? data.plannedStart : existing?.plannedStart;
  const plannedEnd = data.plannedEnd !== undefined ? data.plannedEnd : existing?.plannedEnd;

  // ── Required fields (mirrors AllocateTaskModal's own submit gate:
  //    title + department + due date) ──
  if (stageKey === EXEC_STAGE_KEY) {
    if (!department) {
      throw ApiError.badRequest('A department is required when allocating work.', { code: 'DEPARTMENT_REQUIRED' });
    }
    if (!plannedEnd) {
      throw ApiError.badRequest('A due date is required when allocating work.', { code: 'DUE_DATE_REQUIRED' });
    }
  }

  // ── Department must be one this project's template actually plans for ──
  if (department) {
    const templateId = project.template?.ref;
    const template = templateId ? await Template.findById(templateId).select('stages') : null;
    const planned = template?.stages?.find((s) => s.key === 'p5')?.assessmentTypes || [];
    if (planned.length && !planned.some((d) => d.key === department)) {
      throw ApiError.badRequest(
        `"${department}" isn’t one of this project’s planning departments.`,
        { code: 'UNKNOWN_DEPARTMENT', details: planned.map((d) => d.key) },
      );
    }
  }

  // ── Store Readiness (p8): a checklist item must belong to one of the
  //    readiness modules THIS project's template defines. Sourced from the
  //    template, never a hardcoded list. ──
  if (stageKey === READINESS_STAGE_KEY && data.taskCategory) {
    const templateId = project.template?.ref;
    const template = templateId ? await Template.findById(templateId).select('stages') : null;
    const p8 = template?.stages?.find((s) => s.key === 'p8');
    const categories = [...new Set((p8?.tasks || []).map((t) => t.taskCategory).filter(Boolean))];
    if (categories.length && !categories.includes(data.taskCategory)) {
      throw ApiError.badRequest(
        `"${data.taskCategory}" isn’t one of this project’s readiness modules.`,
        { code: 'UNKNOWN_READINESS_MODULE', details: categories },
      );
    }
  }

  // ── Assignee must be a real, active user in that department (the modal's
  //    assignee dropdown is filtered by department, so this matches it) ──
  if (data.assignee) {
    const user = await User.findById(data.assignee).select('department status name');
    if (!user) throw ApiError.badRequest('That assignee no longer exists.', { code: 'UNKNOWN_ASSIGNEE' });
    if (department && user.department && user.department !== department) {
      throw ApiError.badRequest(
        `${user.name} isn’t in the ${department} department.`,
        { code: 'ASSIGNEE_WRONG_DEPARTMENT' },
      );
    }
  }

  // ── Dates must be coherent ──
  if (plannedStart && plannedEnd && new Date(plannedEnd) < new Date(plannedStart)) {
    throw ApiError.badRequest('The due date can’t be earlier than the start date.', { code: 'INVALID_DATE_RANGE' });
  }
}

/**
 * Dependencies must be real tasks in the SAME project, never the task
 * itself, and never a cycle (A blocks B blocks A — which would deadlock
 * Execution's completion gate, since it requires every dependency resolved).
 */
async function assertValidDependencies(ids, projectId, selfId = null) {
  const unique = [...new Set((ids || []).map(String))];
  if (!unique.length) return unique;

  if (selfId && unique.includes(String(selfId))) {
    throw ApiError.badRequest('A task can’t depend on itself.', { code: 'SELF_DEPENDENCY' });
  }

  const found = await Task.find({ _id: { $in: unique }, project: projectId }).select('_id dependencies title code');
  if (found.length !== unique.length) {
    const ok = new Set(found.map((t) => String(t._id)));
    throw ApiError.badRequest(
      'One or more dependencies don’t exist in this project.',
      { code: 'UNKNOWN_DEPENDENCY', details: unique.filter((id) => !ok.has(id)) },
    );
  }

  // Walk the graph forward from each dependency; reaching selfId means the
  // new edge would close a loop.
  if (selfId) {
    const seen = new Set();
    const queue = [...unique];
    while (queue.length) {
      const cur = queue.shift();
      if (seen.has(cur)) continue;
      seen.add(cur);
      if (cur === String(selfId)) {
        throw ApiError.badRequest(
          'That would create a circular dependency.',
          { code: 'CIRCULAR_DEPENDENCY' },
        );
      }
      // eslint-disable-next-line no-await-in-loop
      const node = await Task.findById(cur).select('dependencies');
      for (const d of node?.dependencies || []) queue.push(String(d));
    }
  }
  return unique;
}

async function assertProjectNotArchived(projectId) {
  const project = await Project.findById(projectId).select('status');
  if (project?.status === PROJECT_STATUS.ARCHIVED) {
    throw ApiError.badRequest('This project is archived and read-only.');
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

/**
 * Fires a `critical_issue_found` notification the moment a Go-Live (p9) task
 * newly transitions into blocked/rejected while flagged critical/high
 * priority — only on the transition *into* that state (guarded by
 * fromStatus), never on every save, so re-saving an already-blocked task
 * doesn't re-notify. Fire-and-forget, same resilience contract as the
 * activity log.
 */
async function notifyIfCriticalIssue(task, fromStatus, actorId) {
  if (task.stageKey !== 'p9') return;
  if (!['critical', 'high'].includes(task.priority)) return;
  const enteringIssueState = ['blocked', 'rejected'].includes(task.status) && fromStatus !== task.status;
  if (!enteringIssueState) return;
  await notificationService.notifyForProject(task.project, {
    type: 'critical_issue_found',
    title: 'Critical Go-Live issue found',
    message: `"${task.title}" is now ${task.status} and needs attention before launch.`,
    link: `/projects/${task.project}/store-launch`,
    actorId,
  });
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
    // Same rule as the isOverdue virtual — delivered work (submitted for
    // approval, approved) and rejected work are not "overdue".
    filter.status = { $nin: NOT_OVERDUE_STATUSES };
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
    // `template` is needed too — assertValidAllocation resolves the project's
    // planning departments from it.
    const project = await Project.findById(data.project).select('code stages status template');
    if (!project) throw ApiError.notFound('Project not found');
    const stage = project.stages.find((s) => s.key === data.stageKey);
    if (!stage) throw ApiError.badRequest(`Unknown stage "${data.stageKey}"`);
    if (project.status === PROJECT_STATUS.ARCHIVED) {
      throw ApiError.badRequest('This project is archived and read-only.');
    }

    // Allocating the first Execution (p6) task is how Department Planning
    // (p5) actually begins — and p5 plans against the budget, timeline and
    // manager that Project Creation's approval establishes. So p5 cannot
    // start until p4 is genuinely complete (which now means genuinely
    // approved — see completeStage's p4 branch).
    if (data.stageKey === 'p6') {
      const p4 = project.stages.find((s) => s.key === 'p4');
      if (p4 && p4.status !== 'completed') {
        throw ApiError.badRequest(
          'Project Creation (Phase 4) must be approved and completed before work can be allocated to departments.',
          { code: 'P4_NOT_COMPLETE' },
        );
      }
    }

    // Every allocation rule the UI enforces, enforced here too.
    await assertValidAllocation(data, project);
    const dependencies = await assertValidDependencies(data.dependencies, project._id);

    // ── Duplicate guard ──
    // The same work allocated twice to the same stage is a mis-click, not a
    // plan. Compared case-insensitively on the trimmed title, scoped to this
    // project + stage.
    const title = String(data.title || '').trim();
    const duplicate = await Task.findOne({
      project: project._id,
      stageKey: data.stageKey,
      title: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).select('code');
    if (duplicate) {
      throw ApiError.badRequest(
        `"${title}" has already been allocated in this phase (${duplicate.code}).`,
        { code: 'DUPLICATE_TASK' },
      );
    }

    const count = await Task.countDocuments({ project: project._id });
    const task = await Task.create({
      ...data,
      title,
      dependencies,
      stageName: stage.name,
      code: `${project.code}-T${String(count + 1).padStart(3, '0')}`,
      createdBy: userId,
    });

    await projectService.recompute(project._id);
    // Department Planning (p5) files no Task documents of its own — its real
    // output is allocating Execution's (p6) task list. There's no manual
    // "Mark Done" button for it anymore, so the first p6 task ever allocated
    // is what completes p5 (completeStage's own p5 gate re-checks the same
    // "at least one task" condition, and is a no-op if already completed).
    if (data.stageKey === 'p6') {
      await projectService.completeStage(project._id, 'p5', userId).catch(() => {});
    }
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
    await assertProjectNotArchived(task.project);

    // Every field below drives real business outcomes — checklist and
    // dependencies are exactly what completeStage()'s p6 gate measures, and
    // assignee/dates decide who owns the work and whether it's overdue. They
    // were previously writable by ANY authenticated user, which let anyone
    // silently manufacture the conditions needed to clear a phase gate. Same
    // doer-or-manager rule the status change already used.
    const OWNERSHIP_GATED_FIELDS = [
      'checklist', 'dependencies', 'assignee', 'assignees',
      'primaryAssignee', 'backupAssignee', 'plannedStart', 'plannedEnd',
      'estimatedHours', 'actualHours', 'priority', 'department', 'order',
    ];
    const touchesGatedField = OWNERSHIP_GATED_FIELDS.some((k) => data[k] !== undefined);
    if (touchesGatedField && !canChangeStatus(actor, task)) {
      throw ApiError.forbidden(
        'Only the assigned doer (or a manager/admin) can change this task’s assignment, schedule, checklist or dependencies',
      );
    }

    // An edit must satisfy the same allocation rules creation does —
    // otherwise a task could be filed validly and then edited into an
    // invalid state (wrong-department assignee, inverted dates, a
    // dependency on another project's task, or a dependency cycle).
    const ALLOCATION_FIELDS = ['department', 'assignee', 'plannedStart', 'plannedEnd', 'dependencies'];
    if (ALLOCATION_FIELDS.some((k) => data[k] !== undefined)) {
      const project = await Project.findById(task.project).select('template');
      await assertValidAllocation(data, project || {}, { existing: task });
      if (data.dependencies !== undefined) {
        data.dependencies = await assertValidDependencies(data.dependencies, task.project, task._id);
      }
    }

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

    if (statusChanged) {
      assertLegalStatusTransition(task.status, data.status);
      await assertExecutionMayBegin(task, data.status);
      if (data.status === TASK_STATUS.DONE) {
        // Validate against the task as it will be AFTER this save — the same
        // request often ticks the last checklist item and marks it done.
        await assertCompletable({
          ...task.toObject(),
          checklist: data.checklist !== undefined ? data.checklist : task.checklist,
          dependencies: data.dependencies !== undefined ? data.dependencies : task.dependencies,
        });
      }
    }

    const userId = actor?.id;
    const fromStatus = task.status; // captured before the editable-fields loop reassigns it
    // Execution's job ends the moment work is marked Done — there's no
    // separate "submit for approval" click left anywhere in the app.
    // Wherever a task is marked Done (task detail, a row action, Kanban
    // drag), it's handed straight to the department-manager approval tier
    // (Phase 7) in the same save.
    const autoSubmitting = statusChanged && data.status === TASK_STATUS.DONE;
    const editable = [
      'title', 'description', 'priority', 'department', 'assignee',
      'assignees', 'primaryAssignee', 'backupAssignee',
      'plannedStart', 'plannedEnd', 'estimatedHours', 'actualHours',
      'checklist', 'dependencies', 'tags', 'order', 'status',
    ];

    for (const key of editable) if (data[key] !== undefined) task[key] = data[key];

    // ── Execution timestamps are derived, never client-supplied ──
    // actualStart/actualEnd are what Schedule Variance, delay tracking and
    // the Progress Timeline all read, so they're stamped here from the real
    // transition rather than trusted from the request body.
    if (statusChanged) {
      const now = new Date();
      if (data.status === TASK_STATUS.IN_PROGRESS && !task.actualStart) task.actualStart = now;
      if (data.status === TASK_STATUS.DONE) {
        task.actualStart = task.actualStart || now; // completed without ever being started
        task.actualEnd = now;
        // Was it delivered by its own due date? Recorded once, at completion.
        task.completedOnTime = task.plannedEnd ? now <= new Date(task.plannedEnd) : undefined;
      }
      // Reopening clears the completion stamps — leaving a stale actualEnd
      // behind would make an in-flight task read as finished in every
      // variance/delay calculation downstream.
      if (fromStatus === TASK_STATUS.DONE && data.status === TASK_STATUS.IN_PROGRESS) {
        task.actualEnd = undefined;
        task.completedOnTime = undefined;
      }
    }

    if (autoSubmitting) {
      task.status = TASK_STATUS.WAITING_APPROVAL;
      task.submittedForApprovalBy = userId;
      task.submittedForApprovalAt = new Date();
    }
    await task.save();
    await projectService.recompute(task.project, userId);

    if (statusChanged) {
      await activityService.log({
        project: task.project,
        entityType: 'task',
        entityId: task._id,
        action: autoSubmitting ? ACTIVITY_ACTIONS.SUBMITTED_FOR_APPROVAL : ACTIVITY_ACTIONS.STATUS_CHANGED,
        actor: userId,
        message: autoSubmitting
          ? `marked "${task.title}" complete and submitted it for approval`
          : `changed status of "${task.title}" to ${TASK_STATUS_LABELS[data.status] || data.status}`,
        meta: { status: task.status, fromStatus, toStatus: task.status, stageKey: task.stageKey },
      });
      await notifyIfCriticalIssue(task, fromStatus, userId);
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
    await assertProjectNotArchived(task.project);

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
  async decide(id, decision, { reason, remarks, signature } = {}, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');

    const tier = task.status === TASK_STATUS.WAITING_APPROVAL ? 'department'
      : task.status === TASK_STATUS.WAITING_MANAGEMENT_APPROVAL ? 'management'
        : null;
    if (!tier) {
      throw ApiError.badRequest('This task isn’t waiting on any approval decision right now.');
    }
    await assertProjectNotArchived(task.project);

    if (tier === 'department' && !canApprove(actor, task)) {
      throw ApiError.forbidden('Only that task’s department manager (or an Admin) can decide it');
    }
    if (tier === 'management' && !canManagementApprove(actor)) {
      throw ApiError.forbidden('Only a Manager or Admin can give management approval');
    }
    // Separation of duties. Two approval tiers only mean something if two
    // different people clear them, and nobody may sign off on their own work
    // — without this a manager who is also the assignee could mark their own
    // task done, approve it at their department tier, then approve it again
    // at the management tier, locking it with no second person involved.
    const actorId = actor?.id ? String(actor.id) : null;
    if (actorId) {
      const isOwnWork = [task.assignee, task.submittedForApprovalBy]
        .some((ref) => ref && String(ref) === actorId);
      if (isOwnWork) {
        throw ApiError.forbidden('You can’t approve or reject your own task — it needs a second person to sign off.');
      }
      if (tier === 'management' && task.approvedBy && String(task.approvedBy) === actorId) {
        throw ApiError.forbidden('You already cleared this task at the department tier — management approval needs a different approver.');
      }
    }
    // Go-Live Checklist (Phase 9) approvals require a typed-name signature —
    // enforced here, not just in the UI, since client-side-only enforcement
    // is spoofable for a compliance-flavored gate.
    if (task.stageKey === 'p9' && decision === 'approve' && !signature?.trim()) {
      throw ApiError.badRequest('A typed signature is required to approve a Go-Live checklist item.');
    }

    const fromStatus = task.status;
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
      task.approvalSignature = signature?.trim() || undefined;
    } else {
      task.status = TASK_STATUS.APPROVED;
      task.managementApprovedBy = userId;
      task.managementApprovedAt = new Date();
      task.managementApprovalRemarks = remarks?.trim() || undefined;
      task.managementApprovalSignature = signature?.trim() || undefined;
    }
    await task.save();
    await projectService.recompute(task.project, userId);
    if (decision === 'reject') await notifyIfCriticalIssue(task, fromStatus, userId);

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
    await assertProjectNotArchived(task.project);
    // Authorship is taken from the authenticated actor, never the request
    // body — a caller can't post a comment as somebody else. `createdAt` is
    // stamped by the sub-document's own timestamps for the same reason.
    const userId = actor?.id ?? actor;
    if (!userId) throw ApiError.unauthorized('A signed-in user is required to comment.');
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
    await assertProjectNotArchived(task.project);
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
    await assertProjectNotArchived(task.project);

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can upload attachments to this task');
    }

    // Metadata sanity — type/size ceilings are enforced by the route's
    // enforceTypeSizeLimits middleware; this guards the degenerate cases it
    // can't see (an empty buffer, a nameless part) before we spend a
    // round-trip to Cloudinary storing something unusable.
    if (!file.buffer?.length) {
      throw ApiError.badRequest('That file is empty.', { code: 'EMPTY_FILE' });
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
    await assertProjectNotArchived(task.project);

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can delete attachments from this task');
    }

    const attachment = task.attachments.id(attachmentId);
    if (!attachment) throw ApiError.notFound('Attachment not found');

    // Upload ownership: whoever attached the evidence (or a manager/admin)
    // may remove it — a doer can't quietly delete a colleague's upload.
    const isOwner = attachment.uploadedBy && String(attachment.uploadedBy) === String(actor?.id);
    const isManager = actor?.role === ROLES.ADMIN || actor?.role === ROLES.MANAGER;
    if (attachment.uploadedBy && !isOwner && !isManager) {
      throw ApiError.forbidden('Only whoever uploaded this file (or a manager) can delete it.');
    }

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
