import dayjs from 'dayjs';
import { Project } from './project.model.js';
import { Template } from '../templates/template.model.js';
import { Task } from '../tasks/task.model.js';
import { Record } from '../records/record.model.js';
import { activityService } from '../activity/activity.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  STAGE_STATUS,
  TASK_STATUS,
  TASK_STATUS_LABELS,
  ACTIVITY_ACTIONS,
  RECORD_STATUS,
  CLOSURE_MODULES,
  CLOSURE_MODULE_VALUES,
  CLOSURE_AUDIT_EVENTS,
} from '../../../core/constants/index.js';

// A task counts toward "done" (project/stage progress, no-longer-overdue)
// once the assignee's own work is finished — Waiting Approval (either tier)
// and Approved all qualify; Rejected does not (it explicitly needs more work).
const WORK_DONE_STATUSES = [
  TASK_STATUS.DONE, TASK_STATUS.WAITING_APPROVAL, TASK_STATUS.WAITING_MANAGEMENT_APPROVAL, TASK_STATUS.APPROVED,
];

/**
 * Stages that only ever complete through completeStage()'s own gate — never
 * auto-derived by recompute()'s "all this stage's tasks are done" rollup.
 * Marking a task Done here must move that task and nothing else.
 *
 *   p6 Execution          — gated on every task clearing department sign-off,
 *                           dependencies resolved, required checklists ticked.
 *   p7 Approval Workflow  — gated on p6's tasks being fully Approved at the
 *                           management tier. Its own three template tasks are
 *                           a working checklist, NOT the gate — rolling them
 *                           up would complete the phase behind that gate's back.
 *   p9 Store Launch       — the Launch Store action, a one-way door; must
 *                           never fire silently.
 */
const MANUAL_ONLY_STAGES = ['p6', 'p7', 'p9'];

/** Shared rich-detail populate chain, used by both getById (by ObjectId) and
 * getByCode (by the human-readable code) so the two lookups can't drift. */
function populateProjectDetail(query) {
  return query
    .populate('owner', 'name role avatarColor title')
    .populate('members', 'name role avatarColor title')
    .populate('template.ref', 'name code')
    .populate('stages.completedBy', 'name role avatarColor title')
    .populate('stages.reopenedBy', 'name role avatarColor title')
    // Phase 10's Archive panel and closure certificate name whoever archived
    // the project, so the reference is resolved here rather than by a second
    // lookup on the client.
    .populate('archivedBy', 'name role avatarColor title');
}

/** Build a city-scoped human code, e.g. MR-PUN-003. */
async function generateProjectCode(city) {
  const cityCode = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const count = await Project.countDocuments({ city });
  return `MR-${cityCode}-${String(count + 1).padStart(3, '0')}`;
}

/**
 * Instantiate a template into concrete project stages + task documents,
 * cascading a realistic planned timeline from the project start date.
 */
async function materializeFromTemplate(template, project) {
  const stages = [];
  const taskDocs = [];
  let cursor = dayjs(project.plannedStartDate);

  const orderedStages = [...template.stages].sort((a, b) => a.order - b.order);

  orderedStages.forEach((stage, stageIdx) => {
    const stagePlannedStart = cursor.toDate();
    const stagePlannedEnd = cursor.add(stage.slaDays || 7, 'day').toDate();

    stages.push({
      key: stage.key,
      name: stage.name,
      order: stage.order ?? stageIdx,
      color: stage.color,
      slaDays: stage.slaDays,
      ownerDepartment: stage.ownerDepartment,
      captureMode: stage.captureMode,
      recordNoun: stage.recordNoun,
      status: STAGE_STATUS.NOT_STARTED,
      plannedStart: stagePlannedStart,
      plannedEnd: stagePlannedEnd,
      captureMode: stage.captureMode || 'single',
      recordNoun: stage.recordNoun || 'Record',
      requiresApproval: stage.requiresApproval || false,
      approverRoles: stage.approverRoles || [],
    });

    // Cascade tasks sequentially inside the stage window.
    let taskCursor = dayjs(stagePlannedStart);
    const orderedTasks = [...(stage.tasks || [])].sort((a, b) => a.order - b.order);
    orderedTasks.forEach((task, taskIdx) => {
      const plannedStart = taskCursor.toDate();
      const plannedEnd = taskCursor.add(task.estimatedDays || 1, 'day').toDate();
      taskCursor = dayjs(plannedEnd);

      taskDocs.push({
        project: project._id,
        code: `${project.code}-T${String(taskDocs.length + 1).padStart(3, '0')}`,
        templateTaskKey: task.key,
        stageKey: stage.key,
        stageName: stage.name,
        title: task.title,
        description: task.description,
        priority: task.priority,
        department: task.department || stage.ownerDepartment,
        taskCategory: task.taskCategory,
        assignees: task.assignees || [],
        primaryAssignee: task.primaryAssignee || null,
        backupAssignee: task.backupAssignee || null,
        // Auto-fallback: flag for reassignment if primary was unavailable at template design time
        reassignNeeded: task.primaryAssigneeUnavailable === true && !!task.primaryAssignee,
        estimatedHours: (task.estimatedDays || 1) * 8,
        plannedStart,
        plannedEnd,
        order: task.order ?? taskIdx,
        checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
        createdBy: project.createdBy,
      });
    });

    cursor = dayjs(stagePlannedEnd);
  });

  project.stages = stages;
  project.targetEndDate = project.targetEndDate || cursor.toDate();
  project.currentStageKey = stages[0]?.key;

  await project.save();
  if (taskDocs.length) await Task.insertMany(taskDocs);
  return project;
}

export const projectService = {
  async list(query = {}) {
    const { page, limit, skip } = getPagination(query);
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.health) filter.health = query.health;
    if (query.city) filter.city = query.city;
    if (query.owner) filter.owner = query.owner;
    if (query.search) filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
    ];

    const [items, total] = await Promise.all([
      Project.find(filter)
        .sort(parseSort(query.sort))
        .skip(skip)
        .limit(limit)
        .populate('owner', 'name role avatarColor')
        .populate('members', 'name role avatarColor'),
      Project.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  async getById(id) {
    const project = await populateProjectDetail(Project.findById(id));
    if (!project) throw ApiError.notFound('Project not found');
    return project;
  },

  /**
   * Same rich detail as getById, looked up by the human-readable `code`
   * (e.g. MR-BHO-001) instead of the raw ObjectId — for a URL-friendly
   * /projects/:code route. Not yet wired into any route/page; added ahead
   * of the client-side URL change so that work can land without a backend
   * dependency once it's safe to touch the shared routing files.
   */
  async getByCode(code) {
    const project = await populateProjectDetail(Project.findOne({ code }));
    if (!project) throw ApiError.notFound('Project not found');
    return project;
  },

  async create(data, userId) {
    const template = await Template.findById(data.templateId);
    if (!template) throw ApiError.notFound('Template not found');

    const code = data.code || (await generateProjectCode(data.city));
    const project = new Project({
      name: data.name,
      code,
      description: data.description,
      template: { ref: template._id, name: template.name, version: template.version },
      city: data.city,
      address: data.address,
      areaSqft: data.areaSqft,
      priority: data.priority,
      owner: data.owner,
      members: data.members || [],
      plannedStartDate: data.plannedStartDate,
      targetEndDate: data.targetEndDate,
      budget: data.budget,
      broker: data.broker,
      tags: data.tags || [],
      status: PROJECT_STATUS.PLANNING,
      createdBy: userId,
    });

    await materializeFromTemplate(template, project);
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: userId,
      message: `Project "${project.name}" created from template "${template.name}"`,
    });
    return this.getById(project._id);
  },

  async update(id, data, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    const editable = [
      'name', 'description', 'address', 'areaSqft', 'status', 'priority',
      'owner', 'members', 'targetEndDate', 'budget', 'broker', 'tags',
    ];
    for (const key of editable) if (data[key] !== undefined) project[key] = data[key];
    await project.save();
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `Project "${project.name}" updated`,
    });
    return this.getById(id);
  },

  /** Save master data captured for a stage (merged, not replaced). */
  async updateMasterData(id, stageKey, values, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    if (!project.stages.some((s) => s.key === stageKey)) {
      throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);
    }
    const merged = { ...(project.masterData || {}) };
    merged[stageKey] = { ...(merged[stageKey] || {}), ...values };
    project.masterData = merged;
    project.markModified('masterData');
    await project.save();
    await activityService.log({
      project: project._id,
      entityType: 'stage',
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: userId,
      message: `Master data updated for stage "${stageKey}"`,
      meta: { stageKey },
    });
    return this.getById(id);
  },

  /**
   * Explicit "Mark Done" action for a stage. Collection-mode stages (e.g.
   * Property Identification) require at least one record — the business rule
   * is derived from `captureMode`, never hardcoded to a specific stage key.
   */
  async completeStage(projectId, stageKey, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    const stage = project.stages.find((s) => s.key === stageKey);
    if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);
    if (stage.status === STAGE_STATUS.COMPLETED) return this.getById(projectId); // idempotent

    // p7 (Approval Workflow) is validated entirely below, against p6's Task
    // documents — it no longer creates Records, so the generic
    // collection-mode/record-count rule doesn't apply to it.
    if (stage.captureMode === 'collection' && stageKey !== 'p7') {
      const count = await Record.countDocuments({ project: projectId, stageKey });
      if (count < 1) {
        const noun = (stage.recordNoun || 'record').toLowerCase();
        throw ApiError.badRequest(`Create at least one ${noun} before completing this stage.`, {
          code: 'NO_RECORDS',
        });
      }
    }

    // Execution (p6) never trusts the frontend: every task must have at least
    // cleared its own department manager's approval (Phase 7 handles the
    // second, management tier — see below), every dependency resolved to the
    // same bar, every required checklist item ticked. All real conditions
    // derived from the task data itself, nothing fabricated.
    if (stageKey === 'p6') {
      const tasks = await Task.find({ project: projectId, stageKey })
        .populate('dependencies', 'status');
      if (!tasks.length) {
        throw ApiError.badRequest('There are no tasks to complete in Execution.', { code: 'EXECUTION_NOT_READY' });
      }

      const DEPT_CLEARED = [TASK_STATUS.WAITING_MANAGEMENT_APPROVAL, TASK_STATUS.APPROVED];
      const reasons = [];
      const statusCounts = {};
      for (const t of tasks) {
        if (!DEPT_CLEARED.includes(t.status)) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        reasons.push(`${count} task${count === 1 ? '' : 's'} ${TASK_STATUS_LABELS[status] || status}`);
      }

      const unresolvedDeps = tasks.filter((t) => (t.dependencies || []).some(
        (d) => !DEPT_CLEARED.includes(d.status),
      )).length;
      if (unresolvedDeps > 0) {
        reasons.push(`${unresolvedDeps} task${unresolvedDeps === 1 ? '' : 's'} with unresolved dependencies`);
      }

      const pendingChecklist = tasks.filter(
        (t) => (t.checklist || []).some((c) => c.required && !c.done),
      ).length;
      if (pendingChecklist > 0) {
        reasons.push(`${pendingChecklist} task${pendingChecklist === 1 ? '' : 's'} with mandatory checklist items incomplete`);
      }

      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'EXECUTION_NOT_READY', reasons });
      }
    }

    // Approval Workflow (p7) reviews the SAME p6 tasks at the second,
    // management tier — it has no tasks of its own. Every one must be fully
    // Approved (management sign-off cleared, not just the department tier)
    // before Phase 8 unlocks.
    if (stageKey === 'p7') {
      const tasks = await Task.find({ project: projectId, stageKey: 'p6' });
      if (!tasks.length) {
        throw ApiError.badRequest('There are no Execution tasks to approve.', { code: 'APPROVAL_NOT_READY' });
      }

      const reasons = [];
      const statusCounts = {};
      for (const t of tasks) {
        if (t.status !== TASK_STATUS.APPROVED) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        reasons.push(`${count} task${count === 1 ? '' : 's'} ${TASK_STATUS_LABELS[status] || status}`);
      }
      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'APPROVAL_NOT_READY', reasons });
      }
    }

    // Store Launch (p9) — the final Go-Live gate. This is Launch Store's
    // actual server-side execution point: every earlier phase must already
    // be Completed, every Go-Live checklist Task must be fully Approved, and
    // no open critical issue may remain. Re-validated here (not just in the
    // client's pre-check) because this is a one-way door — see
    // PROJECT_STATUS.STORE_LIVE's doc comment.
    let justWentLive = false;
    if (stageKey === 'p9') {
      const incompletePriorStages = project.stages.filter(
        (s) => s.key !== 'p9' && s.status !== STAGE_STATUS.COMPLETED,
      );
      const tasks = await Task.find({ project: projectId, stageKey: 'p9' });

      const reasons = [];
      if (incompletePriorStages.length) {
        reasons.push(`${incompletePriorStages.length} earlier phase(s) not yet completed (${incompletePriorStages.map((s) => s.name).join(', ')})`);
      }
      if (!tasks.length) {
        reasons.push('No Go-Live checklist items exist yet');
      } else {
        const statusCounts = {};
        for (const t of tasks) {
          if (t.status !== TASK_STATUS.APPROVED) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
        }
        for (const [status, count] of Object.entries(statusCounts)) {
          reasons.push(`${count} checklist item${count === 1 ? '' : 's'} ${TASK_STATUS_LABELS[status] || status}`);
        }
        const criticalOpen = tasks.filter(
          (t) => ['critical', 'high'].includes(t.priority)
            && (t.status === TASK_STATUS.BLOCKED || t.status === TASK_STATUS.REJECTED),
        ).length;
        if (criticalOpen > 0) reasons.push(`${criticalOpen} critical issue${criticalOpen === 1 ? '' : 's'} still open`);
      }
      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'LAUNCH_NOT_READY', reasons });
      }

      project.status = PROJECT_STATUS.STORE_LIVE;
      project.storeLiveAt = new Date();
      project.storeLiveBy = userId;
      justWentLive = true;
    }

    stage.status = STAGE_STATUS.COMPLETED;
    stage.completedAt = new Date();
    stage.completedBy = userId;
    stage.completedManually = true;
    // This completion supersedes any earlier reopen — clear its markers so the
    // Stage Overview reflects the current cycle (the reopen event itself is
    // still permanently preserved in the Activity Timeline).
    stage.reopenedBy = undefined;
    stage.reopenedAt = undefined;
    await project.save();

    await activityService.log({
      project: project._id,
      entityType: 'stage',
      action: ACTIVITY_ACTIONS.COMPLETED,
      actor: userId,
      message: justWentLive ? 'Store went live — Launch Store completed' : `marked the "${stage.name}" stage as Completed`,
      meta: { stageKey, storeLive: justWentLive },
    });

    if (justWentLive) {
      await notificationService.notifyForProject(project._id, {
        type: 'launch_completed',
        title: 'Store is live',
        message: `${project.name} (${project.code}) has gone live.`,
        link: `/projects/${project._id}/store-launch`,
        actorId: userId,
      });
    }
    return this.getById(projectId);
  },

  /** Reverse an explicit completion — manager/admin only (enforced at the route). */
  async reopenStage(projectId, stageKey, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    const stage = project.stages.find((s) => s.key === stageKey);
    if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);

    stage.completedManually = false;
    stage.status = STAGE_STATUS.IN_PROGRESS;
    // Intentionally do NOT clear completedBy/completedAt here — the prior
    // completion's audit trail must survive a reopen, not be overwritten.
    stage.reopenedBy = userId;
    stage.reopenedAt = new Date();
    await project.save();

    await activityService.log({
      project: project._id,
      entityType: 'stage',
      action: ACTIVITY_ACTIONS.STATUS_CHANGED,
      actor: userId,
      message: `reopened the "${stage.name}" stage`,
      meta: { stageKey },
    });
    return this.getById(projectId);
  },

  /**
   * The six Archive Project gates, each evaluated against real data and
   * returned whether or not they pass — the client's Archive panel renders the
   * exact same list as a pre-flight checklist, so the rule lives here once and
   * both surfaces agree by construction.
   *
   * Returns `[{ key, label, passed, detail }]` in the order the checklist reads.
   */
  async closureReadiness(projectId) {
    const project = await Project.findById(projectId).lean();
    if (!project) throw ApiError.notFound('Project not found');

    const [tasks, records] = await Promise.all([
      Task.find({ project: projectId }).select('status priority stageKey').lean(),
      Record.find({ project: projectId, stageKey: 'p10' })
        .select('assessmentType status values')
        .lean(),
    ]);

    const approvedOf = (moduleKey) =>
      records.filter((r) => r.assessmentType === moduleKey && r.status === RECORD_STATUS.APPROVED);

    // 1. Every phase (including p10 itself) marked Completed.
    const incompleteStages = (project.stages || []).filter((s) => s.status !== STAGE_STATUS.COMPLETED);

    // 2. Every closure module approved, and nothing still awaiting a decision.
    const missingModules = CLOSURE_MODULE_VALUES.filter((k) => approvedOf(k).length === 0);
    const awaitingDecision = records.filter((r) => r.status === RECORD_STATUS.SUBMITTED).length;

    // 3. No blocked / rework task anywhere in the project.
    const openIssues = tasks.filter(
      (t) => t.status === TASK_STATUS.BLOCKED || t.status === TASK_STATUS.REJECTED,
    );

    // 4. Document Archive approved with a non-zero archived-document count.
    const archiveRecords = approvedOf(CLOSURE_MODULES.DOCUMENT_ARCHIVE);
    const documentsArchived = archiveRecords.reduce(
      (sum, r) => sum + (Number(r.values?.documents_count) || 0), 0,
    );

    // 5. Financial Closure approved with nothing left pending.
    const financialRecords = approvedOf(CLOSURE_MODULES.FINANCIAL_CLOSURE);
    const latestFinancial = financialRecords.at(-1);
    const pendingPayment = Number(latestFinancial?.values?.pending_payment) || 0;

    // 6. Every evaluated vendor's payment settled (vendor_performance's
    //    `payment_status` field — "Paid" is the only settled value).
    const vendorRecords = approvedOf(CLOSURE_MODULES.VENDOR_PERFORMANCE);
    const unpaidVendors = vendorRecords.filter((r) => r.values?.payment_status !== 'Paid');

    return [
      {
        key: 'phases_complete',
        label: 'All phases complete',
        passed: (project.stages || []).length > 0 && incompleteStages.length === 0,
        detail: incompleteStages.length
          ? `${incompleteStages.length} phase(s) still open: ${incompleteStages.map((s) => s.name).join(', ')}`
          : 'Every phase of the lifecycle is marked Completed',
      },
      {
        key: 'approvals_complete',
        label: 'All approvals complete',
        passed: missingModules.length === 0 && awaitingDecision === 0,
        detail: missingModules.length || awaitingDecision
          ? [
            missingModules.length ? `${missingModules.length} closure module(s) not yet approved` : null,
            awaitingDecision ? `${awaitingDecision} submission(s) awaiting a decision` : null,
          ].filter(Boolean).join(' · ')
          : 'Every closure module is approved and nothing is awaiting review',
      },
      {
        key: 'no_pending_issues',
        label: 'No pending issues',
        passed: openIssues.length === 0,
        detail: openIssues.length
          ? `${openIssues.length} task(s) still blocked or awaiting rework`
          : 'No blocked or rework tasks anywhere in the project',
      },
      {
        key: 'documents_uploaded',
        label: 'All documents uploaded',
        passed: archiveRecords.length > 0 && documentsArchived > 0,
        detail: archiveRecords.length && documentsArchived > 0
          ? `${documentsArchived} document(s) archived`
          : 'Document Archive has no approved submission with an archived-document count',
      },
      {
        key: 'financial_closure',
        label: 'Financial closure completed',
        passed: financialRecords.length > 0 && pendingPayment === 0,
        detail: financialRecords.length === 0
          ? 'Financial Closure has no approved submission yet'
          : pendingPayment > 0
            ? `₹${pendingPayment.toLocaleString('en-IN')} still pending`
            : 'All invoices reconciled and payments released',
      },
      {
        key: 'vendor_payments',
        label: 'Vendor payments completed',
        passed: vendorRecords.length > 0 && unpaidVendors.length === 0,
        detail: vendorRecords.length === 0
          ? 'No vendor has been evaluated yet'
          : unpaidVendors.length
            ? `${unpaidVendors.length} vendor payment(s) not marked Paid`
            : `All ${vendorRecords.length} vendor payment(s) settled`,
      },
    ];
  },

  /**
   * Archive Project — Phase 10's final action and the last one-way door of the
   * lifecycle. Re-validates all six closure gates server-side (never trusting
   * the client's pre-flight checklist) before flipping the project to ARCHIVED,
   * after which the whole project is read-only.
   */
  async archiveProject(projectId, userId, remarks) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    if (project.status === PROJECT_STATUS.ARCHIVED) return this.getById(projectId); // idempotent

    const gates = await this.closureReadiness(projectId);
    const failed = gates.filter((g) => !g.passed);
    if (failed.length) {
      throw ApiError.badRequest(failed.map((g) => g.detail).join(' · '), {
        code: 'ARCHIVE_NOT_READY',
        reasons: failed.map((g) => g.detail),
        gates,
      });
    }

    project.status = PROJECT_STATUS.ARCHIVED;
    project.archivedAt = new Date();
    project.archivedBy = userId;
    if (remarks) project.archiveRemarks = remarks;
    project.actualEndDate = project.actualEndDate || project.archivedAt;
    await project.save();

    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.ARCHIVED,
      actor: userId,
      message: 'archived the project — Phase 10 Project Closure completed',
      meta: { stageKey: 'p10', remarks: remarks || undefined },
    });

    await notificationService.notifyForProject(project._id, {
      type: 'project_archived',
      title: 'Project archived',
      message: `${project.name} (${project.code}) has been formally closed and archived.`,
      link: `/projects/${project._id}/project-closure`,
      actorId: userId,
    });

    return this.getById(projectId);
  },

  /**
   * Record one closure-audit event raised in the browser (a report generated,
   * an export downloaded). The message comes from the CLOSURE_AUDIT_EVENTS
   * whitelist, never from the request body — see that constant's doc comment.
   */
  async logClosureAudit(projectId, event, userId) {
    const project = await Project.findById(projectId).select('_id');
    if (!project) throw ApiError.notFound('Project not found');
    const message = CLOSURE_AUDIT_EVENTS[event];
    if (!message) throw ApiError.badRequest(`Unknown closure audit event "${event}"`);

    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.EXPORTED,
      actor: userId,
      message,
      meta: { stageKey: 'p10', closureEvent: event },
    });
    return { event, message };
  },

  /**
   * Recompute stage statuses, progress %, current stage and health from the
   * project's live tasks. Called after any task mutation.
   */
  async recompute(projectId, userId) {
    const project = await Project.findById(projectId);
    if (!project) return null;

    const tasks = await Task.find({ project: projectId }).select(
      'stageKey status plannedEnd actualStart',
    );
    const total = tasks.length;
    const doneCount = tasks.filter((t) => WORK_DONE_STATUSES.includes(t.status)).length;
    const now = new Date();
    const overdue = tasks.filter(
      (t) => !WORK_DONE_STATUSES.includes(t.status) && t.plannedEnd && t.plannedEnd < now,
    ).length;

    // Per-stage rollup.
    for (const stage of project.stages) {
      // A stage marked done via the explicit "Mark Done" action stays completed
      // — task activity must not silently reopen or re-derive its status.
      if (stage.completedManually) continue;
      // Stages whose completion is a deliberate act, never a side effect of a
      // task's status changing — see MANUAL_ONLY_STAGES.
      if (MANUAL_ONLY_STAGES.includes(stage.key)) continue;
      const stageTasks = tasks.filter((t) => t.stageKey === stage.key);
      if (!stageTasks.length) continue;
      const allDone = stageTasks.every((t) => WORK_DONE_STATUSES.includes(t.status));
      const anyBlocked = stageTasks.some((t) => t.status === TASK_STATUS.BLOCKED);
      const anyActive = stageTasks.some((t) => t.status !== TASK_STATUS.TODO);

      if (allDone) {
        if (stage.status !== STAGE_STATUS.COMPLETED) {
          stage.status = STAGE_STATUS.COMPLETED;
          stage.completedAt = now;
          if (userId) stage.completedBy = userId;
        } else {
          stage.completedAt = stage.completedAt || now;
          if (userId && !stage.completedBy) stage.completedBy = userId;
        }
        stage.startedAt = stage.startedAt || now;
      } else if (anyBlocked) {
        stage.status = STAGE_STATUS.BLOCKED;
        stage.startedAt = stage.startedAt || now;
        stage.completedAt = undefined;
        stage.completedBy = undefined;
      } else if (anyActive) {
        stage.status = STAGE_STATUS.IN_PROGRESS;
        stage.startedAt = stage.startedAt || now;
        stage.completedAt = undefined;
        stage.completedBy = undefined;
      } else {
        stage.status = STAGE_STATUS.NOT_STARTED;
        stage.startedAt = undefined;
        stage.completedAt = undefined;
        stage.completedBy = undefined;
      }
    }

    project.progress = total ? Math.round((doneCount / total) * 100) : 0;

    const currentStage = [...project.stages]
      .sort((a, b) => a.order - b.order)
      .find((s) => s.status !== STAGE_STATUS.COMPLETED);
    project.currentStageKey = currentStage?.key || project.stages.at(-1)?.key;

    // Lifecycle + health. Task progress hitting 100% is not enough on its own
    // to call the whole PROJECT complete — e.g. every Execution task could be
    // sitting in Waiting Approval, which already counts toward `doneCount`
    // for the progress bar but must not flip the project to Completed before
    // every stage (Execution included) has actually been marked Completed.
    const allStagesComplete = project.stages.length > 0
      && project.stages.every((s) => s.status === STAGE_STATUS.COMPLETED);
    // STORE_LIVE (completeStage's p9 branch), ARCHIVED (archiveProject) and
    // CANCELLED are terminal — this rollup must never silently overwrite any of
    // them back to COMPLETED just because every stage/task happens to look done.
    const TERMINAL_STATUSES = [
      PROJECT_STATUS.STORE_LIVE, PROJECT_STATUS.ARCHIVED, PROJECT_STATUS.CANCELLED,
    ];
    if (!TERMINAL_STATUSES.includes(project.status) && project.progress === 100 && allStagesComplete) {
      project.status = PROJECT_STATUS.COMPLETED;
      project.health = PROJECT_HEALTH.ON_TRACK;
      project.actualEndDate = project.actualEndDate || now;
    } else if (!TERMINAL_STATUSES.includes(project.status)) {
      if (project.status === PROJECT_STATUS.PLANNING && doneCount + overdue > 0) {
        project.status = PROJECT_STATUS.ACTIVE;
        project.actualStartDate = project.actualStartDate || now;
      }
      const pastDeadline = project.targetEndDate && project.targetEndDate < now;
      if (pastDeadline) project.health = PROJECT_HEALTH.DELAYED;
      else if (overdue > 0) project.health = PROJECT_HEALTH.AT_RISK;
      else project.health = PROJECT_HEALTH.ON_TRACK;
    }

    await project.save();
    return project;
  },

  async remove(id) {
    const project = await Project.findByIdAndDelete(id);
    if (!project) throw ApiError.notFound('Project not found');
    await Task.deleteMany({ project: id });
    return project;
  },
};

export default projectService;
