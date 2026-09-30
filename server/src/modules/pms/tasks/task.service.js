import { Task } from './task.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { User } from '../../auth/auth.model.js';
import { projectService } from '../projects/project.service.js';
import { activityService } from '../activity/activity.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import { logger } from '../../../config/logger.js';
import { newGameService } from '../../newGames/newGame.service.js';
import {
  uploadBuffer,
  destroyAsset,
  isS3Configured,
} from '../../../config/s3.js';
import {
  TASK_STATUS,
  TASK_STATUS_VALUES,
  TASK_STATUS_LABELS,
  TASK_APPROVAL,
  ACTIVITY_ACTIONS,
  ROLES,
  can,
  PROJECT_STATUS,
  PRE_LAUNCH_STAGE_KEYS,
} from '../../../core/constants/index.js';

/**
 * A user may change a task's status only if they are its "doer" — the assigned
 * User, or a login account whose employeeId matches the task's roster
 * primary/backup/assignees — or a manager/admin (who oversee and own the board).
 */
function canChangeStatus(actor, task) {
  if (!actor) return false;
  if (can.manage(actor.role)) return true;
  const me = String(actor.id);
  const isAssignee = (task.assignee && String(task.assignee) === me)
    || (task.assigneeRefs || []).some((ref) => String(ref?._id || ref) === me);
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
  // MD and EA sign off anywhere; a Manager only inside their own department.
  if (can.actForLeadership(actor.role)) return true;
  return Boolean(actor.role === ROLES.MANAGER && task.department && actor.department === task.department);
}

/**
 * Who may decide the second, cross-department "Management Approval" tier
 * (Phase 7): any Manager or Admin — deliberately NOT department-scoped like
 * canApprove(), since management sign-off sits above a single department.
 */
function canManagementApprove(actor) {
  if (!actor) return false;
  return can.decide(actor.role);
}

/** An approved task is locked — read-only for everyone except an Admin. */
function assertNotLocked(task, actor) {
  // MD only, deliberately not the EA: editing an approved task rewrites a
  // sign-off that already happened, which is the destructive class of action
  /* Reads `approval`, not `status`: sign-off moved to its own field. This is
     a SIGN-OFF rule, not an ordering one — rule 4 removed the gates that made
     tasks wait for each other, and left "a signed task is not silently
     rewritten" alone. */
  // the EA is excluded from.
  if (task.approvalState === TASK_APPROVAL.APPROVED && !can.administer(actor?.role)) {
    throw ApiError.forbidden('This task is approved and locked — only the MD can edit it.');
  }
}

/** Department Planning (p5) allocates its work as Execution (p6) tasks. */
const EXEC_STAGE_KEY = 'p6';
/** Store Readiness (p8) files its checklist as tasks of its own stage. */
const READINESS_STAGE_KEY = 'p8';

/* THE TRANSITION TABLE IS GONE.

   Any of the three states may follow any other, set by a person, at any
   time. There is no legal-move check because there are no illegal moves —
   a task pushed back from complete to pending is somebody correcting a
   mistake, not an error to refuse. */

/* assertExecutionMayBegin IS GONE.

   It refused to let a Phase 6 task start until Phase 5 was closed out. Rule
   4: no phase waits for the phase before it. Any task, in any phase, can be
   set to any state on day one. */

/** Checklist items still unticked, in checklist order. Reported at completion
 *  rather than enforced — see assertCompletable. */
function pendingChecklist(task) {
  return (task.checklist || []).filter((c) => !c.done);
}

/* assertCompletable IS GONE, dependencies and all.

   A dependency used to refuse completion outright. Rule 4: no task waits for
   another. `dependencies` survives as INFORMATION — the tree and the task
   drawer still show what this work follows on from — but it no longer stops
   anybody, because the person doing the work decides when it is done.

   The checklist warning it used to carry moved with it: an open checklist was
   already only warned about, and that warning is written into the activity
   log at completion (see update()). */

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

/**
 * Blocks mutation once the project has reached a state that's meant to
 * freeze it. `stageKey`, when passed, additionally enforces the Store
 * Launch Lock: a pre-launch-phase task (p1-p8) becomes read-only the moment
 * project.status hits STORE_LIVE, matching the Confirm Launch modal's own
 * "Phases 1-8 become read-only" promise — previously only a UI claim, never
 * enforced here. p9/p10 tasks are deliberately exempt (p9 drives go-live
 * itself; p10's whole job happens after it) — see PRE_LAUNCH_STAGE_KEYS.
 */
async function assertProjectNotArchived(projectId, stageKey) {
  const project = await Project.findById(projectId).select('status');
  if (project?.status === PROJECT_STATUS.ARCHIVED) {
    throw ApiError.badRequest('This project is archived and read-only.');
  }
  if (
    stageKey
    && PRE_LAUNCH_STAGE_KEYS.includes(stageKey)
    && project?.status === PROJECT_STATUS.STORE_LIVE
  ) {
    throw ApiError.badRequest(
      'The store has gone live — earlier-phase work is now read-only history and can no longer be edited.',
      { code: 'PROJECT_LIVE_READ_ONLY' },
    );
  }
}

/** Shared rich-detail populate chain for a single task, used by both
 * getById (by ObjectId) and getByCode (by the human-readable code) so the
 * two lookups can never drift out of sync. */
function populateTaskDetail(query) {
  return query
    .populate('assignee', 'name role avatarColor title phone email')
    .populate('assigneeRefs', 'name role avatarColor title')
    .populate('watchers', 'name role avatarColor')
    .populate('completedBy', 'name avatarColor')
    .populate('project', 'name code city')
    /* WHO PUT THIS ON SOMEBODY'S DESK, and therefore who to go back to about
       it. The task page's first question — "who assigned this, and when" —
       could only be answered with a raw id before this. */
    .populate('createdBy', 'name role avatarColor title')
    // The property a per-property task is for (Phase 2 assessments).
    .populate('subjectRecord', 'title status stageKey values.property_name values.locality')
    .populate('comments.author', 'name role avatarColor')
    .populate('submittedForApprovalBy', 'name avatarColor')
    .populate('approvedBy', 'name avatarColor')
    .populate('managementApprovedBy', 'name avatarColor')
    .populate('rejectedBy', 'name avatarColor');
}

/**
 * The two pre-launch stages where a blocked/rejected critical-priority task
 * is urgent enough to page someone rather than just sit in the Activity Log —
 * Store Readiness (p8) and Go-Live (p9). Each maps to its own workspace link
 * and wording; every other stage stays silent (a P1-P7 task going Blocked is
 * ordinary Execution churn, not a launch-readiness emergency).
 */
const CRITICAL_ISSUE_STAGES = {
  p8: {
    title: 'Critical Store Readiness issue found',
    message: (task) => `"${task.title}" is now ${task.status} and needs attention before Store Readiness can be signed off.`,
    link: (projectId) => `/projects/${projectId}/store-readiness`,
  },
  p9: {
    title: 'Critical Go-Live issue found',
    message: (task) => `"${task.title}" is now ${task.status} and needs attention before launch.`,
    link: (projectId) => `/projects/${projectId}/store-launch`,
  },
};

/**
 * Fires a `critical_issue_found` notification the moment a Store Readiness
 * (p8) or Go-Live (p9) task newly transitions into blocked/rejected while
 * flagged critical/high priority — only on the transition *into* that state
 * (guarded by fromStatus), never on every save, so re-saving an
 * already-blocked task doesn't re-notify. Fire-and-forget, same resilience
 * contract as the activity log.
 */
async function notifyIfCriticalIssue(task, fromStatus, actorId) {
  const cfg = CRITICAL_ISSUE_STAGES[task.stageKey];
  if (!cfg) return;
  if (!['critical', 'high'].includes(task.priority)) return;
  const enteringIssueState = ['blocked', 'rejected'].includes(task.status) && fromStatus !== task.status;
  if (!enteringIssueState) return;
  await notificationService.notifyForProject(task.project, {
    type: 'critical_issue_found',
    title: cfg.title,
    message: cfg.message(task),
    link: cfg.link(task.project),
    actorId,
  });
}


/**
 * Tell the people a task has just landed on.
 *
 * WHY THIS EXISTS. Assigning a task wrote an activity-log line and nothing
 * else. The activity feed is a project AUDIT LOG — you read it when you are
 * already looking at the project, which is precisely not the situation of
 * someone who does not yet know they have been given work. So a task could be
 * allocated on Monday and sit untouched until somebody asked about it on
 * Friday, with no error, no gap in any report, and nobody at fault.
 *
 * Deliberately NOT notifyForProject: that fans out to the owner, every member
 * and every admin. The person who needs to know is the doer. Copying the whole
 * project on every allocation is how a notification bell becomes something
 * people mute.
 *
 * `previous` lets an update notify only whoever is NEW. Re-saving a task to
 * change its due date must not re-announce it to the doer who has had it for
 * a week.
 */
async function notifyAssigned(task, { actorId, previous = [] } = {}) {
  const before = new Set((previous || []).map(String));
  const now = [...new Set([
    ...(task.assigneeRefs || []).map(String),
    ...(task.assignee ? [String(task.assignee)] : []),
  ])];

  const fresh = now.filter((id) => !before.has(id) && String(id) !== String(actorId || ''));
  if (!fresh.length) return;

  const where = task.stageName ? ` · ${task.stageName}` : '';
  await notificationService.notify({
    recipients: fresh,
    project: task.project,
    type: 'task_assigned',
    title: 'A task is yours',
    message: `${task.title}${where}${task.plannedEnd ? ` — due ${new Date(task.plannedEnd).toLocaleDateString('en-IN')}` : ''}`,
    // The task's own page, by code — the same link the approvals list and the
    // Gantt use, so one format is wrong or right everywhere at once.
    link: `/projects/${task.project}/tasks/${encodeURIComponent(task.code)}`,
    // Handing the task itself to the WhatsApp channel, which is the only
    // extra line this file needs: a template can then name the phase, the
    // property and the due date, none of which survive in `message` as
    // separate fields. Everything else about that channel — whether it is on,
    // who it reaches, when it may send — lives in the dispatcher.
    whatsapp: { task, actorId },
  });
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.project) filter.project = query.project;
  if (query.status) filter.status = query.status;
  // Sign-off axis — see listTasksSchema. Independent of `status`, so both may
  // be supplied together ("complete AND waiting on the department").
  if (query.approvalState) filter.approvalState = query.approvalState;
  if (query.assignee) filter.assignee = query.assignee;
  if (query.stageKey) filter.stageKey = query.stageKey;
  if (query.priority) filter.priority = query.priority;
  if (query.department) filter.department = query.department;
  if (query.search) filter.$or = [
    { title: new RegExp(query.search, 'i') },
    { code: new RegExp(query.search, 'i') },
  ];
  if (query.overdue === 'true' || query.overdue === true) {
      /* Same rule as the isOverdue virtual: overdue is a DATE question.
         Anything unfinished, past its deadline. No status is exempt — a
         pending task past its date is exactly what "overdue" means. */
      filter.status = { $ne: TASK_STATUS.COMPLETE };
      filter.dueAt = { $lt: new Date() };
  }
  return filter;
}

/**
 * Turn whatever someone pasted into a usable http(s) URL, or explain why it
 * cannot be one.
 *
 * Requiring a typed "https://" was too strict to survive contact with real
 * use: people paste `drive.google.com/file/...` from the address bar, or a
 * Windows path to a drawing sitting on their own machine. The first is a
 * perfectly good link missing four characters; the second can never work for
 * anyone else and deserves to be told so, not handed a generic refusal.
 *
 * The security rule is unchanged — only http and https reach the database,
 * because this value is rendered into an anchor and `javascript:`/`data:`
 * there is stored XSS.
 */
const NON_WEB_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'mailto:', 'tel:', 'blob:'];

function normaliseLinkUrl(raw) {
  // Strip the angle brackets some mail clients wrap URLs in, and any stray
  // surrounding quotes from a copy-paste.
  const clean = String(raw || '').trim().replace(/^[<"']+|[>"']+$/g, '');
  if (!clean) throw ApiError.badRequest('Paste a link first.', { code: 'EMPTY_URL' });

  const lower = clean.toLowerCase();

  // A path on one person's computer. Real enough to name specifically: a
  // drawing "attached" this way is invisible to everyone else.
  if (/^[a-z]:[\\/]/i.test(clean) || clean.startsWith('\\\\') || lower.startsWith('file:')) {
    throw ApiError.badRequest(
      'That is a file on your own computer, so nobody else could open it. Upload it under Attachments, or paste a shared link (Drive, SharePoint, Figma).',
      { code: 'LOCAL_FILE_PATH' },
    );
  }

  if (NON_WEB_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    throw ApiError.badRequest(
      'Only web links can be attached here — the address needs to start with http:// or https://.',
      { code: 'INVALID_URL_SCHEME' },
    );
  }

  // Treat it as already-schemed only when it carries "://". A bare
  // "localhost:5173/x" or "example.com:8080" looks like a scheme to a naive
  // regex but is really host:port, and prefixing it is the right reading.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(clean);
  const candidate = hasScheme ? clean : `https://${clean}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw ApiError.badRequest(
      `"${clean.slice(0, 60)}" is not a web address. Paste the full link, e.g. https://drive.google.com/…`,
      { code: 'INVALID_URL' },
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw ApiError.badRequest(
      `Links must be http:// or https:// — "${parsed.protocol.replace(':', '')}" is not supported.`,
      { code: 'INVALID_URL_SCHEME' },
    );
  }
  if (!parsed.hostname) {
    throw ApiError.badRequest('That link has no website address in it.', { code: 'INVALID_URL' });
  }

  return parsed;
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
        /* Every doer of a multi-doer task, and who actually finished it. The
           list screens already read `completedBy.name` (Approvals, the Data
           Explorer's "Done on · by"); left as raw ids here, those lines were
           silently blank for every task. */
        .populate('assigneeRefs', 'name role avatarColor title')
        .populate('completedBy', 'name role avatarColor')
        .populate('project', 'name code city')
        .populate('dependencies', 'code title')
        .populate('createdBy', 'name avatarColor title')
        .populate('approvedBy', 'name role avatarColor')
        .populate('managementApprovedBy', 'name role avatarColor')
        .populate('rejectedBy', 'name role avatarColor'),
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

    /* THE LAST GATE, and the one that would have bitten hardest.
    
       Allocating an Execution task used to require Phase 4 to be completed.
       It read `p4.status`, a field that no longer exists — so the comparison
       became `undefined !== "completed"`, which is always true, and EVERY
       Phase 6 allocation would have been refused with a message about an
       approval nobody could give. Removed for the same reason as the rest:
       no phase waits for the phase before it. */

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
    /* Same invariant the update path enforces: `assignee` is the first of
       `assigneeRefs`. The allocation form sends only `assignee`, and a task
       created with an empty assigneeRefs would later gain a second doer
       whose list did not contain the first. */
    const assigneeRefs = data.assigneeRefs?.length
      ? data.assigneeRefs
      : (data.assignee ? [data.assignee] : []);
    const task = await Task.create({
      ...data,
      assigneeRefs,
      assignee: assigneeRefs[0] || undefined,
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
      /* The phase completes by arithmetic — see phaseProgress(). There is
         no stage status left to set, so nothing is called here. */
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
      /* Fire-and-forget, same contract as the activity log above: a task
         that was allocated must not fail to save because a notification
         could not be written. */
      await notifyAssigned(task, { actorId: userId });
    return this.getById(task._id);
  },

  async update(id, data, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    /* Captured BEFORE the save so the notification can tell a genuinely
       new doer from one who has had this task all along. */
    const doersBefore = [...new Set([
      ...(task.assigneeRefs || []).map(String),
      ...(task.assignee ? [String(task.assignee)] : []),
    ])];

    /* A task several people hold is finished by whoever gets there first. A
       second doer pressing Done afterwards must not overwrite who did it —
       they get told, by name, that it is already done.
       BEFORE assertNotLocked on purpose: a task with no approval step goes
       straight to APPROVED when the first doer finishes it, so the lock check
       would otherwise answer the second doer with "approved and locked — only
       the MD can edit it", which tells a colleague nothing about what actually
       happened. */
    if (data.status === TASK_STATUS.COMPLETE && task.completedBy && String(task.completedBy) !== String(actor?.id)
      && task.status === TASK_STATUS.COMPLETE) {
      const who = await User.findById(task.completedBy).select('name');
      throw ApiError.badRequest(
        `${who?.name || 'Another doer'} already completed this task${task.completedAt ? ` on ${task.completedAt.toLocaleString('en-IN')}` : ''}.`,
        { code: 'ALREADY_COMPLETED' },
      );
    }

    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);

    // Every field below drives real business outcomes — checklist and
    // dependencies are exactly what completeStage()'s p6 gate measures, and
    // assignee/dates decide who owns the work and whether it's overdue. They
    // were previously writable by ANY authenticated user, which let anyone
    // silently manufacture the conditions needed to clear a phase gate. Same
    // doer-or-manager rule the status change already used.
    const OWNERSHIP_GATED_FIELDS = [
      'checklist', 'dependencies', 'assignee', 'assignees', 'assigneeRefs',
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

    /* No approval-status trap is needed any more: sign-off lives on
       `approvalState`, which is not in the `editable` allow-list below, so
       this endpoint physically cannot write it however hard a client tries. */

    const statusChanged = data.status && data.status !== task.status;
    const assigneeChanged =
      data.assignee !== undefined && String(data.assignee) !== String(task.assignee || '');

    // Only the task's doer (or a manager/admin) may move its status.
    if (statusChanged && !canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can change this task’s status');
    }

    /* There is nothing left to check on a status change. Any state may
       follow any state, no phase gates the next, and a dependency informs
       rather than refuses. */

    const userId = actor?.id;
    const fromStatus = task.status; // captured before the editable-fields loop reassigns it

    /* COMPLETING A TASK STARTS NOTHING, and submits nothing.

       Marking Done used to hand the task straight to the approval queue in
       the same save. Sign-off is now its own action on its own field: a task
       can sit complete and unsigned for a week, which is what actually
       happens, and the queue is entered deliberately via /submit-approval. */
    const editable = [
      'title', 'description', 'priority', 'department', 'assignee',
      'assignees', 'assigneeRefs', 'primaryAssignee', 'backupAssignee',
      'plannedStart', 'plannedEnd', 'estimatedHours', 'actualHours',
      'checklist', 'dependencies', 'tags', 'order', 'status', 'dueAt', 'parentTaskRef',
    ];

    for (const key of editable) if (data[key] !== undefined) task[key] = data[key];

      /* KEEP THE TWO DOER FIELDS IN STEP.
         `assignee` is the first of `assigneeRefs` (see buildTaskDoc), and My
         Tasks queries BOTH. Until this existed, reassigning through `assignee`
         left the previous doer sitting in `assigneeRefs`, so a task taken off
         somebody never left their list — they and the new doer both believed
         it was theirs, and nothing anywhere said otherwise. */
      if (data.assigneeRefs !== undefined) {
        // An explicit list wins; `assignee` follows it.
        task.assignee = task.assigneeRefs?.[0] || null;
      } else if (data.assignee !== undefined) {
        // Reassigning through the single field means one doer: that person.
        task.assigneeRefs = data.assignee ? [data.assignee] : [];
      }

    /* MIS still reads actualStart/actualEnd for schedule variance, so they
       are kept in step with the three states. startedAt/completedAt are
       stamped by the model hook — one place, so a task written any other
       way gets them too. */
    if (statusChanged) {
      const now = new Date();
      if (task.status === TASK_STATUS.PROCESSING && !task.actualStart) task.actualStart = now;
      if (task.status === TASK_STATUS.COMPLETE) {
        task.actualStart = task.actualStart || now;
        task.actualEnd = task.actualEnd || now;
        /* Who finished it — the audit answer on a shared task, and what
           takes it off the other doers' My Tasks. */
        task.completedBy = userId;
      } else {
        /* Reopened. A stale actualEnd would make in-flight work read as
           finished in every variance and delay calculation downstream. */
        task.actualEnd = undefined;
        task.completedBy = undefined;
      }
    }

    await task.save();
    await projectService.recompute(task.project, userId);

    if (statusChanged) {
      /* An open checklist never refused completion, and now nothing does.
         The audit trail is the only thing that records it happened — named
         rather than counted, because "2 items pending" tells a reviewer to
         go looking and the labels tell them what for. */
      const stillPending = task.status === TASK_STATUS.COMPLETE ? pendingChecklist(task) : [];
      const pendingNote = stillPending.length
        ? ` — ${stillPending.length} checklist item${stillPending.length === 1 ? '' : 's'} left pending: ${stillPending.map((c) => c.label).join(', ')}`
        : '';
      await activityService.log({
        project: task.project,
        entityType: 'task',
        entityId: task._id,
        action: ACTIVITY_ACTIONS.STATUS_CHANGED,
        actor: userId,
        message: `set "${task.title}" to ${TASK_STATUS_LABELS[task.status] || task.status}${pendingNote}`,
        meta: {
          status: task.status, fromStatus, toStatus: task.status, stageKey: task.stageKey,
          ...(stillPending.length ? { pendingChecklist: stillPending.map((c) => c.label) } : {}),
        },
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

    /* AFTER the whole branch above, not inside it: `assigneeChanged`
       only watches `data.assignee`, and a save that moves assigneeRefs
       alone would notify nobody. notifyAssigned filters to whoever is
       genuinely new, so calling it on every save is safe and is the
       only version that cannot miss one. */
    await notifyAssigned(task, { actorId: userId, previous: doersBefore });
    return this.getById(id);
  },

  /** Focused status transition used by the board's drag-and-drop. */
  async updateStatus(id, status, actor) {
    return this.update(id, { status }, actor);
  },

  /**
   * Kept as a name existing callers use; there is no graph to walk now.
   *
   * It existed because the old table had no todo → done edge, so ticking
   * "complete" on an untouched item had to hop through in_progress. With
   * three states and no illegal moves the hop is meaningless — this is a
   * straight set, and the alias stays so the checklist and bulk callers
   * did not all have to change in the same commit.
   */
  async setStatusThroughLegalPath(id, status, actor) {
    return this.updateStatus(id, status, actor);
  },

  /**
   * Move many tasks to the same status in one request.
   *
   * Partial success is the expected outcome, not a failure: a checklist row
   * someone else already completed, or one whose dependencies are still open,
   * must not stop the other ninety-nine. So this collects per-id outcomes and
   * the controller answers 200 with the breakdown — the same contract as
   * records' bulk-decision.
   *
   * Sequential, not Promise.all: every status change recomputes the project's
   * stage progress, and firing a hundred of those at one project document
   * concurrently is how you get lost updates.
   */
  async bulkStatus(ids, status, actor) {
    const succeeded = [];
    const failed = [];

    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop -- see above
        await this.setStatusThroughLegalPath(id, status, actor);
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          code: err.details?.code || err.code || 'STATUS_CHANGE_FAILED',
          message: err.message || 'Could not update this task',
        });
      }
    }
    return { succeeded, failed };
  },

  /** Assignee hands a Completed task off for department-manager sign-off. */
  async submitForApproval(id, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can submit this task for approval');
    }
    if (task.status !== TASK_STATUS.COMPLETE) {
      throw ApiError.badRequest('Only a Complete task can be submitted for approval.');
    }
    await assertProjectNotArchived(task.project, task.stageKey);

    const userId = actor?.id;
    /* The STATE is untouched — the task stays complete. Submitting moves it
       along the sign-off axis only. */
    task.approvalState = TASK_APPROVAL.WAITING_DEPARTMENT;
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

    const tier = task.approvalState === TASK_APPROVAL.WAITING_DEPARTMENT ? 'department'
      : task.approvalState === TASK_APPROVAL.WAITING_MANAGEMENT ? 'management'
        : null;
    if (!tier) {
      throw ApiError.badRequest('This task isn’t waiting on any approval decision right now.');
    }
    await assertProjectNotArchived(task.project, task.stageKey);

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
    // Separation of duties: nobody signs off work they did or submitted.
    //
    // The MD is exempt, by explicit business decision. In a franchise business
    // the MD is the final authority and frequently also the person who raised
    // the work — with no exemption, a single-person action can deadlock a
    // phase with nobody able to clear it. Every other role still needs a
    // second signer, and the MD's decision is recorded in the audit trail
    // exactly like anyone else's, so the exemption is visible rather than
    // silent.
    if (actorId && !can.administer(actor?.role)) {
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
    // is spoofable for a compliance-flavored gate. The signature must match
    // the actual approver's own name (the client already enforces this on
    // typing, but only a server-side check makes it authoritative) — a
    // non-empty signature that could be *anyone's* name would already have
    // satisfied the old check, defeating the point of a named attestation.
    if (task.stageKey === 'p9' && decision === 'approve') {
      if (!signature?.trim()) {
        throw ApiError.badRequest('A typed signature is required to approve a Go-Live checklist item.');
      }
      if (signature.trim().toLowerCase() !== (actor?.name || '').trim().toLowerCase()) {
        throw ApiError.badRequest('The typed signature must match your own name exactly.');
      }
    }

    const fromStatus = task.status;
    const userId = actor?.id;
    const update = {};
    if (decision === 'reject') {
      if (!reason?.trim()) throw ApiError.badRequest('A reason is required to reject this task.');
      /* Rejecting does NOT reopen the task. Its state is whatever its owner
         last set; this records only that the sign-off was refused. */
      update.approvalState = TASK_APPROVAL.REJECTED;
      update.rejectedBy = userId;
      update.rejectedAt = new Date();
      update.rejectReason = reason.trim();
    } else if (tier === 'department') {
      /* ONE approval, not two. This used to forward to a second
         "management approval" tier, so every task crossed three states and two
         people's queues before it counted — for work like "select the games",
         pure ceremony. One qualified sign-off now fully approves. The
         management branch below survives only to drain tasks already sitting
         in the old second tier; nothing routes into it any more. */
      update.approvalState = TASK_APPROVAL.APPROVED;
      update.approvedBy = userId;
      update.approvedAt = new Date();
      update.approvalRemarks = remarks?.trim() || undefined;
      update.approvalSignature = signature?.trim() || undefined;
      update.managementApprovedBy = userId;
      update.managementApprovedAt = new Date();
    } else {
      update.approvalState = TASK_APPROVAL.APPROVED;
      update.managementApprovedBy = userId;
      update.managementApprovedAt = new Date();
      update.managementApprovalRemarks = remarks?.trim() || undefined;
      update.managementApprovalSignature = signature?.trim() || undefined;
    }
    // Atomic, condition-on-read-state update instead of mutate-then-save —
    // closes the narrow double-decision race where two decisions on the same
    // tier land near-simultaneously: whichever commits second finds the
    // document no longer at `fromStatus` and is told plainly to refresh,
    // instead of silently overwriting the first decision's stamp fields.
    const decided = await Task.findOneAndUpdate(
      { _id: id, status: fromStatus },
      { $set: update },
      { new: true },
    );
    if (!decided) {
      throw ApiError.badRequest(
        'This task was just decided by someone else — refresh to see the latest status before deciding again.',
        { code: 'TASK_ALREADY_DECIDED' },
      );
    }
    await projectService.recompute(decided.project, userId);
    if (decision === 'reject') await notifyIfCriticalIssue(decided, fromStatus, userId);

    const actionMessage = decision === 'reject'
      ? `rejected "${decided.title}" at ${tier === 'department' ? 'department' : 'management'} approval — ${decided.rejectReason}`
      : tier === 'department'
        ? `approved "${decided.title}" at department level — awaiting management approval`
        : `gave final management approval on "${decided.title}" — fully approved`;
    await activityService.log({
      project: decided.project,
      entityType: 'task',
      entityId: decided._id,
      action: decision === 'reject' ? ACTIVITY_ACTIONS.REJECTED : ACTIVITY_ACTIONS.APPROVED,
      actor: userId,
      message: actionMessage,
      meta: { stageKey: decided.stageKey, tier },
    });
    return this.getById(id);
  },

  async addComment(id, body, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);
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
   * photos uploaded straight to S3, same pipeline as `addAttachment`
   * but stored on the comment itself rather than the task's `attachments[]`.
   */
  async addUpdate(id, { body, files }, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);
    if (!body?.trim() && !files?.length) {
      throw ApiError.badRequest('An update needs some text or at least one photo');
    }
    if (files?.length && !isS3Configured) {
      throw new ApiError(503, 'File uploads are not configured', { code: 'S3_NOT_CONFIGURED' });
    }

    const userId = actor?.id;
    const photos = [];
    for (const file of files || []) {
      // eslint-disable-next-line no-await-in-loop
      const result = await uploadBuffer(file.buffer, {
        folder: `tasks/${task._id}`,
        filename: file.originalname,
        contentType: file.mimetype,
      });
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
  /**
   * Attach a reference URL to a task — a drawing set, a Drive folder, a spec.
   *
   * Deliberately separate from attachments: nothing is uploaded, nothing is
   * stored on S3, and there is nothing to delete remotely. A drawing lives in
   * the design team's own tool and is revised there; copying a PDF into this
   * task would freeze it at the moment of upload and quietly go stale. A link
   * always resolves to the current version.
   *
   * Same doer/manager rule as attachments, and the same archived/locked
   * guards — a link is task content, not metadata.
   */
  async addLink(id, { url, label }, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);

    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer (or a manager) can add links to this task');
    }

    const parsed = normaliseLinkUrl(url);
    // Store the normalised form, so a pasted "drive.google.com/…" is saved as
    // the https URL it actually resolves to rather than as typed.
    const clean = parsed.toString();

    const trimmedLabel = String(label || '').trim().slice(0, 120);
    task.links.push({ url: clean, label: trimmedLabel || parsed.hostname, addedBy: actor?.id });
    await task.save();

    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: actor?.id,
      message: `linked "${trimmedLabel || parsed.hostname}" on "${task.title}"`,
      meta: { stageKey: task.stageKey, url: clean },
    });
    return this.getById(id);
  },

  /** Remove a link. Ownership mirrors attachments: whoever added it, or a manager. */
  async removeLink(id, linkId, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);

    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer (or a manager) can remove links from this task');
    }

    const link = task.links.id(linkId);
    if (!link) throw ApiError.notFound('Link not found');

    const isOwner = link.addedBy && String(link.addedBy) === String(actor?.id);
    if (link.addedBy && !isOwner && !can.manage(actor?.role)) {
      throw ApiError.forbidden('Only whoever added this link (or a manager) can remove it.');
    }

    const removedLabel = link.label || link.url;
    link.deleteOne();
    await task.save();

    await activityService.log({
      project: task.project,
      entityType: 'task',
      entityId: task._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: actor?.id,
      message: `removed the link "${removedLabel}" from "${task.title}"`,
      meta: { stageKey: task.stageKey },
    });
    return this.getById(id);
  },



  /** Upload a file buffer to S3 and attach it to the task. */
  async addAttachment(id, file, actor) {
    if (!file) throw ApiError.badRequest('No file provided');
    if (!isS3Configured) {
      throw new ApiError(503, 'File uploads are not configured', {
        code: 'S3_NOT_CONFIGURED',
      });
    }
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can upload attachments to this task');
    }

    // Metadata sanity — type/size ceilings are enforced by the route's
    // enforceTypeSizeLimits middleware; this guards the degenerate cases it
    // can't see (an empty buffer, a nameless part) before we spend a
    // round-trip to S3 storing something unusable.
    if (!file.buffer?.length) {
      throw ApiError.badRequest('That file is empty.', { code: 'EMPTY_FILE' });
    }

    const userId = actor?.id;
    const result = await uploadBuffer(file.buffer, {
      folder: `tasks/${task._id}`,
      filename: file.originalname,
      contentType: file.mimetype,
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

  /** Remove an attachment from the task and delete it from S3. */
  async removeAttachment(id, attachmentId, actor) {
    const task = await Task.findById(id);
    if (!task) throw ApiError.notFound('Task not found');
    assertNotLocked(task, actor);
    await assertProjectNotArchived(task.project, task.stageKey);

    // Same doer/manager rule as the status-update feature.
    if (!canChangeStatus(actor, task)) {
      throw ApiError.forbidden('Only the assigned doer can delete attachments from this task');
    }

    const attachment = task.attachments.id(attachmentId);
    if (!attachment) throw ApiError.notFound('Attachment not found');

    // Upload ownership: whoever attached the evidence (or a manager/admin)
    // may remove it — a doer can't quietly delete a colleague's upload.
    const isOwner = attachment.uploadedBy && String(attachment.uploadedBy) === String(actor?.id);
    const isManager = can.manage(actor?.role);
    if (attachment.uploadedBy && !isOwner && !isManager) {
      throw ApiError.forbidden('Only whoever uploaded this file (or a manager) can delete it.');
    }

    // Delete the remote asset first so nothing is orphaned on S3. A
    // failure here is logged but doesn't block removing the DB reference.
    try {
      await destroyAsset(attachment.publicId, attachment.resourceType);
    } catch (err) {
      logger.warn('Failed to delete S3 asset', {
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

    // A deleted task must not leave a dangling id in some OTHER task's
    // dependencies[] — assertCompletable's unresolved-dependency check
    // simply won't match a vanished id, which silently "clears" that
    // dependency rather than erroring. Pulling it here makes the deletion's
    // effect on dependents explicit instead of an accidental side effect.
    await Task.updateMany({ dependencies: task._id }, { $pull: { dependencies: task._id } });

    /* Deleting the last Execution task used to reopen Phase 5, because a
       stage carried a stored status that would otherwise have stayed
       "completed" over an empty phase. Progress is derived now: an empty
       phase reads as pending on the next read, with nothing to undo. */

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

  /**
   * "My Work" — everything on one person's desk, for the My Tasks page.
   *
   * Open tasks soonest-deadline-first, plus the ones they finished in the last
   * week. The recently-done tail is not padding: a page that only ever shows a
   * backlog reads as a list that never gets shorter, and someone who cleared
   * six tasks this morning should be able to see that they did.
   *
   * Two queries rather than one `$or`, because the sorts genuinely differ —
   * open work is ordered by what is due next, finished work by what was most
   * recently closed — and a single query cannot express both.
   */
  /* `limit` was 50, and it BIT: a site engineer on two launches crosses fifty
     open tasks easily, and the fifty-first — sorted soonest-due-first, so
     always the newest assignment with the farthest deadline — silently never
     appeared in My Tasks at all. The page paginates client-side, so the only
     honest cap is one nobody reaches. */
  async myTasks(userId, { limit = 500, doneWithinDays = 7, doneLimit = 25 } = {}) {
    const doneSince = new Date(Date.now() - doneWithinDays * 86_400_000);

    /**
     * WHO PUT THIS ON MY DESK.
     *
     * My Tasks is one person's own work, so naming the ASSIGNEE on every row
     * would print the reader's own name forty times. The useful name is the
     * other one — whoever handed it over — and it is the first thing anybody
     * asks of a job they did not expect. `createdBy` is the honest answer:
     * on a task somebody raised by hand it is them, and on the ones a project
     * opens automatically it is whoever created the project (see
     * project.service.js, which stamps `createdBy: project.createdBy` on
     * every generated task).
     */
    const ASSIGNER = { path: 'createdBy', select: 'name' };

    const [open, recentlyDone, awaiting] = await Promise.all([
      /* Open work = anything I am a doer on (single owner OR one of several)
         that is still mine to do.
         The second condition is what makes several doers work: once ANYONE
         completes the task it stops being open for everybody else, so it
         disappears from their My Tasks and their dashboard — first to finish
         closes it for all. Testing `completedBy`, not the status, is the whole
         point: a task with no approval step goes straight from Done to
         APPROVED and one with an approver sits in WAITING_APPROVAL, so a
         `status !== done` test (what this used to be) left a finished task
         sitting in the other doers' lists for ever.
         The person who actually finished it still sees it, with its real
         status — "Waiting for approval by MD" is information they want. */
      Task.find({
        $and: [
          { $or: [{ assignee: userId }, { assigneeRefs: userId }] },
          { $or: [{ completedBy: null }, { completedBy: { $exists: false } }, { completedBy: userId }] },
          /**
           * AN ASSESSMENT WITH NO PROPERTY IS NOT WORK.
           *
           * Phase 2 keeps ONE task per assessment type as a placeholder,
           * unattached, waiting to be pointed at a property the moment the
           * MD sends one for that assessment (syncAssessmentTasks detaches
           * the last one rather than deleting it, so the skeleton survives).
           *
           * Those placeholders were landing on people's desks. Tick
           * Feasibility alone and the doer got four rows — Feasibility on
           * the property, plus Financial, Technical and Operational of
           * nothing at all. There is no form to open and no property to
           * assess; the task cannot be done, only stared at.
           *
           * The one carrying a property is the real job, and it is still
           * here. Nothing is deleted — the placeholder stays for the sync
           * to claim, it just stops pretending to be somebody's work.
           */
          {
            $or: [
              { stageKey: { $ne: 'p2' } },
              { subjectRecord: { $ne: null } },
            ],
          },
        ],
        status: { $ne: TASK_STATUS.COMPLETE },
      })
        .sort({ plannedEnd: 1 })
        .limit(limit)
        .populate('project', 'name code city')
        .populate(ASSIGNER),
      /* "Recently done" means done BY ME. On a shared task the other doers do
         not see a completion that was not theirs — their My Tasks simply stops
         showing it, which is the whole point of one-of-us-finishes-it. */
      /**
       * WHAT I HAVE FINISHED — not "what I finished this week".
       *
       * Two things emptied this tab. It required `actualEnd`, which the
       * form-submission path never wrote (see completeTaskForForm), so most
       * completed tasks could not match at all; and it required that date to
       * be inside seven days, so the ones that could match aged out and the
       * tab went back to zero. A person who finished ten things last month
       * opened "Completed" and was told they had completed nothing.
       *
       * `completedAt` is accepted as well, which brings back every task
       * finished through a form without touching a single stored row. And
       * the window is gone: the cap is `doneLimit`, so this is "your last 25
       * completed tasks", which is what the word means to the reader.
       */
      Task.find({
        $or: [{ assignee: userId }, { assigneeRefs: userId }],
        completedBy: { $in: [null, userId] },
        status: TASK_STATUS.COMPLETE,
      })
        .sort({ actualEnd: -1, completedAt: -1 })
        .limit(doneLimit)
        .populate('project', 'name code city')
        .populate(ASSIGNER),
      /* Waiting on sign-off, however long ago it was finished. The work has
         left the doer's desk but not their responsibility, so it needs its own
         list. Riding on the seven-day "recently done" window made a task that
         had waited eight days for an approver drop out of Waiting entirely. */
      Task.find({
        $or: [{ assignee: userId }, { assigneeRefs: userId }],
        completedBy: { $in: [null, userId] },
        approvalState: { $in: [TASK_APPROVAL.WAITING_DEPARTMENT, TASK_APPROVAL.WAITING_MANAGEMENT] },
      })
        .sort({ actualEnd: -1 })
        .limit(limit)
        .populate('project', 'name code city')
        .populate(ASSIGNER),
    ]);

    /* THE NEW GAMES CREATION FMS. Its steps are not Task documents — a game
       is not a project — so they are merged in here, already in the shape
       My Tasks draws, each carrying the `link` to its own task page. Best
       effort: a failure there must not take the whole of My Tasks with it. */
    const games = await newGameService.tasksFor(userId).catch((err) => {
      logger.warn(`New-game tasks unavailable for ${userId}: ${err.message}`);
      return { open: [], done: [] };
    });

    return {
      open: [...open, ...games.open],
      recentlyDone: [...recentlyDone, ...games.done],
      awaiting,
    };
  },
};

export default taskService;
