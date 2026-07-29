import dayjs from 'dayjs';
import { Project } from './project.model.js';
import { Template } from '../templates/template.model.js';
import { Task } from '../tasks/task.model.js';
import { Record } from '../records/record.model.js';
import { User } from '../../auth/auth.model.js';
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
 *   p8 Store Readiness     — gated on Final Approval, a deliberate manager
 *                           action. WORK_DONE_STATUSES includes the two
 *                           "waiting approval" statuses, so every readiness
 *                           task merely being *submitted* (not yet approved
 *                           by anyone) must never read as the phase being
 *                           complete.
 *   p9 Store Launch       — the Launch Store action, a one-way door; must
 *                           never fire silently.
 *   p5 Department Planning — completes on the first Execution task being
 *                           allocated (task.service#create), re-validated by
 *                           its own gate. It was previously left out on the
 *                           assumption that no Task ever carries stageKey
 *                           'p5' — nothing enforced that, so a single stray
 *                           p5 task would have let recompute() close the
 *                           phase behind the gate's back.
 */
const MANUAL_ONLY_STAGES = ['p5', 'p6', 'p7', 'p8', 'p9'];

/* ------------------------------------------------------------------------
 * Record-based stage rules (p2 Site Evaluation, p3 Commercial Finalization)
 *
 * These are the server-side mirror of the client's own rules — kept
 * deliberately identical so a "Mark Done" the UI offers can never be
 * refused here, and one it hides can never be forced through the API:
 *
 *   isTypeDone          <- client/src/features/projects/records/recordUi.js
 *   isPropertyApproved  <- client/src/features/projects/records/scoring.js
 *                          (isPropertyApprovedAtStage)
 *
 * Editing either side means editing the other.
 * --------------------------------------------------------------------- */

/** Default p2 assessment keys, used only when a template defines none. */
const DEFAULT_P2_TYPE_KEYS = ['feasibility', 'financial', 'technical', 'operational'];

/** Phase 4's single master form — mirrors MASTER_KEY in ProjectCreationPage.jsx. */
const P4_MASTER_KEY = 'project_creation';

/**
 * The mandatory Store Readiness (p8) modules for a project, taken from its
 * OWN template — the distinct `taskCategory` values across the template's p8
 * blueprint tasks (Construction, Utilities, IT & Systems, Hiring, …).
 *
 * Deliberately derived, never hardcoded: adding a readiness module to a
 * template makes it mandatory here automatically. Returns [] when a template
 * defines none, which leaves the coverage rule inert rather than inventing
 * requirements a project was never set up with.
 */
async function templateTaskCategories(project, stageKey) {
  const templateId = project.template?.ref;
  if (!templateId) return [];
  const template = await Template.findById(templateId).select('stages');
  const stage = template?.stages?.find((s) => s.key === stageKey);
  return [...new Set((stage?.tasks || []).map((t) => t.taskCategory).filter(Boolean))];
}

/** Store Readiness's mandatory modules — see templateTaskCategories. */
const p8RequiredCategories = (project) => templateTaskCategories(project, 'p8');

/**
 * The Final Go-Live Approval anchor — the one checklist item whose approval
 * actually authorises go-live. Mirrors GOLIVE_ANCHOR_KEY in
 * client/src/features/projects/storeLaunchTaskKeys.js; the two must match.
 */
const GOLIVE_ANCHOR_KEY = 'p9_golive_final';

/** This project's template assessmentTypes for a stage ([] when absent). */
async function templateAssessmentTypes(project, stageKey) {
  const templateId = project.template?.ref;
  if (!templateId) return [];
  const template = await Template.findById(templateId).select('stages');
  return template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
}

/** Does this project's template define `taskKey` on the given stage? */
async function templateHasTaskKey(project, stageKey, taskKey) {
  const templateId = project.template?.ref;
  if (!templateId) return false;
  const template = await Template.findById(templateId).select('stages');
  const stage = template?.stages?.find((s) => s.key === stageKey);
  return (stage?.tasks || []).some((t) => t.key === taskKey);
}

/**
 * First dependency cycle among `tasks`, as a readable code path
 * (e.g. ['T-001', 'T-004', 'T-001']), or null when the graph is acyclic.
 * Task creation/edit already refuses to build one (task.service's
 * assertValidDependencies), so this is a safety net for graphs that predate
 * that guard — a cycle would otherwise make Execution permanently
 * uncompletable with no explanation.
 */
function findDependencyCycle(tasks) {
  const byId = new Map(tasks.map((t) => [String(t._id), t]));
  const state = new Map(); // id -> 'visiting' | 'done'
  const stack = [];

  const walk = (id) => {
    const node = byId.get(id);
    if (!node) return null; // dependency outside this stage — not our cycle
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') {
      const at = stack.indexOf(id);
      return [...stack.slice(at), id].map((x) => byId.get(x)?.code || x);
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of node.dependencies || []) {
      const found = walk(String(dep?._id || dep));
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const t of tasks) {
    const found = walk(String(t._id));
    if (found) return found;
  }
  return null;
}

/** The template's assessmentTypes for one stage (never fabricated — [] if absent). */
async function templateTypesFor(project, stageKey) {
  const templateId = project.template?.ref;
  if (!templateId) return [];
  const template = await Template.findById(templateId).select('stages');
  return template?.stages?.find((s) => s.key === stageKey)?.assessmentTypes || [];
}

/** A type's required sub-items (e.g. NOC Management's 7 NOC types), or [] if it isn't a sub-keyed type. */
function requiredSubItems(type) {
  if (!type.subKeyField) return [];
  return (type.masterDataSchema || []).find((f) => f.key === type.subKeyField)?.options || [];
}

/**
 * Is one assessment type satisfied for a property? An ordinary type needs a
 * single Approved record; a sub-keyed type needs one Approved record per
 * required sub-item.
 */
function isTypeDone(records, parentId, type) {
  const own = records.filter(
    (r) => String(r.parentRecordId) === String(parentId) && r.assessmentType === type.key,
  );
  const required = requiredSubItems(type);
  if (!required.length) return own.some((r) => r.status === RECORD_STATUS.APPROVED);
  return required.every((opt) => own.some(
    (r) => r.status === RECORD_STATUS.APPROVED && r.values?.[type.subKeyField] === opt,
  ));
}

/**
 * Has this property been approved *at Site Evaluation* — as distinct from the
 * Phase-1 shortlist decision that got it here? Both reuse the same decide()
 * call, so `shortlistedBy` can't tell them apart; chronology can. A decision
 * timestamp at or after every assessment's most recent submission can only be
 * a fresh decision taken once evaluation was actually complete.
 *
 * Deliberately does NOT require each assessment to be individually Approved:
 * the manager's Approve on the property itself is the decision. Matches the
 * client's isPropertyApprovedAtStage exactly.
 */
function isPropertyApprovedAtP2(property, p2Records, typeKeys) {
  if (!property.decidedAt || property.status !== RECORD_STATUS.SHORTLISTED) return false;
  const latestPerType = typeKeys.map((key) => {
    const own = p2Records.filter(
      (r) => String(r.parentRecordId) === String(property._id) && r.assessmentType === key,
    );
    if (!own.length) return null;
    return own.reduce((a, b) => (new Date(b.createdAt) > new Date(a.createdAt) ? b : a));
  });
  // Every assessment type must have been filed at least once.
  if (!latestPerType.length || latestPerType.some((r) => !r)) return false;
  const evaluationCompletedAt = Math.max(...latestPerType.map((r) => new Date(r.createdAt).getTime()));
  return new Date(property.decidedAt).getTime() >= evaluationCompletedAt;
}

/**
 * The one property Commercial Finalization works on: a shortlisted Phase-1
 * property that has cleared Site Evaluation. Mirrors CommercialFinalizationPage's
 * own `properties` derivation.
 */
/**
 * The property Project Creation works on: a shortlisted property whose
 * mandatory Commercial Finalization modules are all Approved. Mirrors
 * ProjectCreationPage's own `isCommerciallyFinalized` filter.
 */
async function resolveP3FinalizedProperty(projectId, project) {
  const [shortlisted, p3Records, p3Types] = await Promise.all([
    Record.find({ project: projectId, stageKey: 'p1', status: RECORD_STATUS.SHORTLISTED }),
    Record.find({ project: projectId, stageKey: 'p3' }),
    templateTypesFor(project, 'p3'),
  ]);
  const mandatory = p3Types.filter((t) => !t.subKeyField);
  if (!mandatory.length) return null;
  return shortlisted.find((p) => mandatory.every((t) => isTypeDone(p3Records, p._id, t))) || null;
}

/**
 * Copy the approved Project Setup master form onto the Project document, so
 * the project itself — not just a Record buried in a stage — carries the
 * budget, target opening date, project manager and configuration that were
 * signed off. Everything here comes from real submitted values; a field the
 * form didn't capture is left exactly as it was rather than being invented.
 */
async function applyProjectSetup(project, values, userId) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const date = (v) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  // ── Budget ──
  const planned = num(values.estimated_budget);
  if (planned !== undefined) project.budget.planned = planned;
  if (values.currency) project.budget.currency = values.currency;

  // ── Opening date / timeline ──
  const opening = date(values.target_opening_date);
  if (opening) project.targetEndDate = opening;
  const start = date(values.project_start_date);
  if (start) project.plannedStartDate = start;

  // ── Project manager ──
  // The form captures a name, the Project stores a real User ref. Resolve it
  // to an actual account; if no one matches, leave `owner` untouched rather
  // than fabricating a link to the wrong person.
  const pmName = String(values.project_manager || '').trim();
  if (pmName) {
    const pm = await User.findOne({ name: new RegExp(`^${pmName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id');
    if (pm) project.owner = pm._id;
  }

  // ── Configuration ──
  // The whole approved form, in the field the schema already reserves for
  // captured master data ({ [stageKey]: { [fieldKey]: value } }).
  project.masterData = { ...(project.masterData || {}), p4: { ...values } };
  project.markModified('masterData');

  await activityService.log({
    project: project._id,
    entityType: 'project',
    entityId: project._id,
    action: ACTIVITY_ACTIONS.UPDATED,
    actor: userId,
    message: 'Project budget, timeline, manager and configuration set from the approved Project Setup',
    meta: { stageKey: 'p4' },
  });
}

async function resolveP2ApprovedProperty(projectId, project) {
  const [shortlisted, p2Records, p2Types] = await Promise.all([
    Record.find({ project: projectId, stageKey: 'p1', status: RECORD_STATUS.SHORTLISTED }),
    Record.find({ project: projectId, stageKey: 'p2' }),
    templateTypesFor(project, 'p2'),
  ]);
  const typeKeys = p2Types.length ? p2Types.map((t) => t.key) : DEFAULT_P2_TYPE_KEYS;
  return shortlisted.find((p) => isPropertyApprovedAtP2(p, p2Records, typeKeys)) || null;
}

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
 * Instantiate a template into concrete project stages, cascading a realistic
 * planned timeline from the project start date.
 *
 * Deliberately does NOT create any Task documents. A template's `tasks[]`
 * arrays (server/src/seed/storeLaunchTemplate.js) stay pure reference data —
 * this used to bulk-insert every one of them as real, already-assigned Task
 * documents for all 10 phases the moment a project was created, before any
 * user had done anything. Every phase whose UI actually works off a task
 * board (Execution, Store Readiness, Store Launch, and Department Planning
 * authoring Execution's list) already has a real "Allocate Task" flow
 * (see task.routes.js POST / + DepartmentPlanningPage.jsx's AllocateTaskModal,
 * reused across those pages) — tasks now only ever exist because a real user
 * created one.
 */
async function materializeFromTemplate(template, project) {
  const stages = [];
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

    cursor = dayjs(stagePlannedEnd);
  });

  project.stages = stages;
  project.targetEndDate = project.targetEndDate || cursor.toDate();
  project.currentStageKey = stages[0]?.key;

  await project.save();
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

    // STORE_LIVE and ARCHIVED are one-way doors owned by their own fully
    // gated flows (completeStage's p9 branch / archiveProject), which
    // re-validate Go-Live approvals, prior-stage completion and the closure
    // gates, and stamp storeLiveAt/By + archivedAt/By. A generic PATCH must
    // never be able to enter — or silently leave — either state.
    const TERMINAL_STATUSES = [PROJECT_STATUS.STORE_LIVE, PROJECT_STATUS.ARCHIVED];
    if (data.status !== undefined && data.status !== project.status) {
      if (TERMINAL_STATUSES.includes(data.status)) {
        throw ApiError.badRequest(
          `"${data.status}" is set only by its own flow (Phase 9 Launch Store / Phase 10 Archive Project), not by a general project edit.`,
        );
      }
      if (TERMINAL_STATUSES.includes(project.status)) {
        throw ApiError.badRequest(
          'This project has reached a terminal state and its status can no longer be changed.',
        );
      }
    }

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
  async completeStage(projectId, stageKey, userId, actor) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    const stage = project.stages.find((s) => s.key === stageKey);
    if (!stage) throw ApiError.badRequest(`Unknown stage "${stageKey}" for this project`);
    if (stage.status === STAGE_STATUS.COMPLETED) return this.getById(projectId); // idempotent

    // Completing p1-p6/p7 is self-serve (the doer closes out their own stage),
    // but p8's "Give Final Approval" and p9's "Launch Store" are
    // compliance-sensitive and manager/admin-only — the client already hides
    // them (canFinalApprove/canLaunch), and this is the server-side half of
    // that same rule. `actor` is omitted for internal calls (e.g. task.service
    // auto-completing p5), which never target p8/p9.
    const ROLE_GATED_STAGES = ['p8', 'p9'];
    if (ROLE_GATED_STAGES.includes(stageKey) && actor
      && !['admin', 'manager'].includes(actor.role)) {
      throw ApiError.forbidden(
        stageKey === 'p9'
          ? 'Only a Manager or Admin can take the store live.'
          : 'Only a Manager or Admin can give final readiness approval.',
      );
    }

    // Stages that carry their own complete, stage-specific gate below, so the
    // generic "collection mode ⇒ at least one record exists" fallback would
    // only get in their way:
    //   p5 / p7 / p8  — validated against their own Task documents; none of
    //                   them files Records at all anymore.
    //   p2 / p3 / p4  — validated against the real approval rules (see their
    //                   branches below). Their own errors say what's actually
    //                   missing; the generic one would shadow that with a
    //                   misleading "create at least one record" whenever the
    //                   true blocker is that nothing has been approved yet.
    //   p9 / p10      — the Go-Live and Closure gates, likewise fully
    //                   self-validating.
    const SELF_GATED_STAGES = ['p2', 'p3', 'p4', 'p5', 'p7', 'p8', 'p9', 'p10'];
    if (stage.captureMode === 'collection' && !SELF_GATED_STAGES.includes(stageKey)) {
      const count = await Record.countDocuments({ project: projectId, stageKey });
      if (count < 1) {
        const noun = (stage.recordNoun || 'record').toLowerCase();
        throw ApiError.badRequest(`Create at least one ${noun} before completing this stage.`, {
          code: 'NO_RECORDS',
        });
      }
    }

    // Site Evaluation (p2) — at least one shortlisted property must have been
    // Approved *at this stage*: every assessment type filed, and a manager's
    // decision taken after the last of them. This replaces the generic
    // "≥1 record exists" rule, which was far weaker than what the UI
    // enforces — a direct API call could complete the phase off a single
    // draft assessment.
    if (stageKey === 'p2') {
      const property = await resolveP2ApprovedProperty(projectId, project);
      if (!property) {
        throw ApiError.badRequest(
          'Approve at least one property in Site Evaluation before completing this phase — every assessment must be filed and the property decided afterwards.',
          { code: 'NO_APPROVED_PROPERTY' },
        );
      }
    }

    // Commercial Finalization (p3) — every mandatory module must be Approved
    // for the property that cleared Site Evaluation. The sub-keyed modules
    // (NOC Management, Commercial Approvals) are optional, exactly as
    // CommercialFinalizationPage's own mandatorySteps rule has it.
    if (stageKey === 'p3') {
      const property = await resolveP2ApprovedProperty(projectId, project);
      if (!property) {
        throw ApiError.badRequest(
          'No property has cleared Site Evaluation yet, so there is nothing to finalize commercially.',
          { code: 'NO_APPROVED_PROPERTY' },
        );
      }
      const types = await templateTypesFor(project, 'p3');
      const mandatory = types.filter((t) => !t.subKeyField);
      if (!mandatory.length) {
        throw ApiError.badRequest(
          'This project’s template defines no mandatory Commercial Finalization modules.',
          { code: 'NO_MANDATORY_MODULES' },
        );
      }
      const p3Records = await Record.find({ project: projectId, stageKey: 'p3' });
      const pending = mandatory.filter((t) => !isTypeDone(p3Records, property._id, t));
      if (pending.length) {
        throw ApiError.badRequest(
          `${pending.length} mandatory module${pending.length === 1 ? '' : 's'} not yet approved: ${pending.map((t) => t.name).join(', ')}`,
          // `details` (not `reasons`) — that's the field ApiError actually
          // serializes through to the client, see core/utils/ApiError.js.
          { code: 'MANDATORY_MODULES_PENDING', details: pending.map((t) => t.name) },
        );
      }
    }

    // Project Creation (p4) — the one phase whose entire purpose is approval,
    // so completion requires the Project Setup master form to be genuinely
    // APPROVED by a manager, not merely submitted by whoever filled it in.
    // (The client used to auto-complete this stage the instant the form was
    // submitted, which meant the project's budget/timeline/manager could be
    // set live with nobody ever approving them.)
    if (stageKey === 'p4') {
      const property = await resolveP3FinalizedProperty(projectId, project);
      if (!property) {
        throw ApiError.badRequest(
          'No property has cleared Commercial Finalization yet, so there is no project to create.',
          { code: 'NO_FINALIZED_PROPERTY' },
        );
      }
      const master = await Record.findOne({
        project: projectId,
        stageKey: 'p4',
        assessmentType: P4_MASTER_KEY,
        parentRecordId: property._id,
        status: RECORD_STATUS.APPROVED,
      }).sort({ createdAt: -1 });
      if (!master) {
        throw ApiError.badRequest(
          'The Project Setup form must be approved by a manager before Project Creation can complete.',
          { code: 'PROJECT_SETUP_NOT_APPROVED' },
        );
      }
      // Source of truth moves onto the Project document itself.
      await applyProjectSetup(project, master.values || {}, userId);
    }

    // Department Planning (p5) doesn't file its own records anymore — its
    // real output is allocating Execution's (p6) task list via Allocate
    // Task. "Done" means at least one real task has actually been
    // allocated, not that a template pre-populated an empty checklist.
    if (stageKey === 'p5') {
      // ...and Project Creation must genuinely be behind us: p5 plans against
      // the budget, timeline and manager that p4's approval establishes.
      const p4 = project.stages.find((s) => s.key === 'p4');
      if (p4 && p4.status !== STAGE_STATUS.COMPLETED) {
        throw ApiError.badRequest(
          'Project Creation (Phase 4) must be completed before Department Planning can be closed out.',
          { code: 'P4_NOT_COMPLETE' },
        );
      }
      const planned = await Task.find({ project: projectId, stageKey: 'p6' })
        .select('code title department plannedEnd');
      if (planned.length < 1) {
        throw ApiError.badRequest('Allocate at least one task to Execution before completing Department Planning.', {
          code: 'NO_TASKS_ALLOCATED',
        });
      }
      // Planning is only "done" when every allocation is actually complete —
      // a task with no owning department or no due date is a half-filed plan
      // that Execution can't schedule or Approval Workflow route. Creation
      // enforces both (task.service#assertValidAllocation); this catches
      // anything filed before that gate existed.
      const incomplete = planned.filter((t) => !t.department || !t.plannedEnd);
      if (incomplete.length) {
        throw ApiError.badRequest(
          `${incomplete.length} allocated task${incomplete.length === 1 ? ' is' : 's are'} missing a department or due date: ${incomplete.map((t) => t.code).join(', ')}`,
          { code: 'INCOMPLETE_ALLOCATION', details: incomplete.map((t) => t.code) },
        );
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

      // Blocked work is called out explicitly rather than being lumped into
      // the generic status tally — "3 tasks Blocked" tells a manager what to
      // go unblock, which the aggregate count doesn't.
      const blocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
      if (blocked.length) {
        reasons.push(`${blocked.length} blocked task${blocked.length === 1 ? '' : 's'} (${blocked.map((t) => t.code).join(', ')})`);
      }

      // A dependency cycle can never resolve, so the two checks above would
      // reject forever with no way forward. Detect it and say so plainly.
      const cycle = findDependencyCycle(tasks);
      if (cycle) {
        reasons.push(`circular dependency: ${cycle.join(' → ')}`);
      }

      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), {
          code: 'EXECUTION_NOT_READY',
          details: reasons,
        });
      }
    }

    // Approval Workflow (p7) reviews the SAME p6 tasks at the second,
    // management tier — it has no tasks of its own. Every one must be fully
    // Approved (management sign-off cleared, not just the department tier)
    // before Phase 8 unlocks.
    if (stageKey === 'p7') {
      const reasons = [];

      // Execution must genuinely be behind us — not merely "its tasks look
      // approved". Phase 6 has its own gate (blocked work, dependency
      // cycles, checklists); requiring the stage itself keeps the two from
      // disagreeing.
      const p6 = project.stages.find((s) => s.key === 'p6');
      if (p6 && p6.status !== STAGE_STATUS.COMPLETED) {
        reasons.push('Execution (Phase 6) is not completed yet');
      }

      const tasks = await Task.find({ project: projectId, stageKey: 'p6' });
      if (!tasks.length) {
        throw ApiError.badRequest('There are no Execution tasks to approve.', { code: 'APPROVAL_NOT_READY' });
      }

      const statusCounts = {};
      for (const t of tasks) {
        if (t.status !== TASK_STATUS.APPROVED) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        reasons.push(`${count} task${count === 1 ? '' : 's'} ${TASK_STATUS_LABELS[status] || status}`);
      }

      // The six-gate approval pipeline itself. The UI has always required
      // every module Approved before offering "Proceed to Phase 8", but the
      // server never checked it — so a direct API call could complete the
      // phase with the entire pipeline untouched.
      const property = await resolveP2ApprovedProperty(projectId, project);
      const modules = await templateTypesFor(project, 'p7');
      if (modules.length) {
        if (!property) {
          reasons.push('no property has cleared Site Evaluation, so the approval pipeline has no subject');
        } else {
          const p7Records = await Record.find({ project: projectId, stageKey: 'p7' });
          const pending = modules.filter((m) => !isTypeDone(p7Records, property._id, m));
          if (pending.length) {
            reasons.push(`${pending.length} approval module${pending.length === 1 ? '' : 's'} not approved: ${pending.map((m) => m.name).join(', ')}`);
          }
        }
      }

      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'APPROVAL_NOT_READY', details: reasons });
      }
    }

    // Store Readiness (p8) — "Give Final Approval" is a deliberate manager
    // action (see MANUAL_ONLY_STAGES), re-validated here against the same
    // bar StoreReadinessDashboardPage.jsx's own readyForFinalApproval uses:
    // every checklist task genuinely Approved, and no open critical issue.
    if (stageKey === 'p8') {
      const reasons = [];

      // Approval Workflow must genuinely be behind us — Phase 7 has its own
      // gate (six approval tiers + Execution's tasks), so requiring the stage
      // keeps the two from disagreeing.
      const p7 = project.stages.find((s) => s.key === 'p7');
      if (p7 && p7.status !== STAGE_STATUS.COMPLETED) {
        reasons.push('Approval Workflow (Phase 7) is not completed yet');
      }

      const tasks = await Task.find({ project: projectId, stageKey });
      if (!tasks.length) {
        throw ApiError.badRequest('There are no readiness checklist items to approve.', { code: 'READINESS_NOT_READY' });
      }

      // Mandatory module coverage — read from THIS project's template, never
      // a hardcoded list, so adding a readiness module to the template makes
      // it mandatory here with no code change.
      const required = await p8RequiredCategories(project);
      if (required.length) {
        const covered = new Set(tasks.map((t) => t.taskCategory).filter(Boolean));
        const missing = required.filter((c) => !covered.has(c));
        if (missing.length) {
          reasons.push(`${missing.length} mandatory readiness module${missing.length === 1 ? '' : 's'} with no checklist item: ${missing.join(', ')}`);
        }
      }

      const statusCounts = {};
      for (const t of tasks) {
        if (t.status !== TASK_STATUS.APPROVED) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        reasons.push(`${count} checklist item${count === 1 ? '' : 's'} ${TASK_STATUS_LABELS[status] || status}`);
      }

      // ANY blocked item stops readiness, not just a high-priority one — a
      // store isn't ready while something is stuck, whatever its priority.
      const blocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
      if (blocked.length) {
        reasons.push(`${blocked.length} blocked readiness item${blocked.length === 1 ? '' : 's'} (${blocked.map((t) => t.code).join(', ')})`);
      }
      const criticalOpen = tasks.filter(
        (t) => ['critical', 'high'].includes(t.priority) && (t.status === TASK_STATUS.BLOCKED || t.status === TASK_STATUS.REJECTED),
      ).length;
      if (criticalOpen > 0) reasons.push(`${criticalOpen} critical issue${criticalOpen === 1 ? '' : 's'} still open`);

      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'READINESS_NOT_READY', details: reasons });
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

        // Mandatory launch-category coverage, read from THIS project's
        // template (never a hardcoded list) — same rule Store Readiness uses.
        const required = await templateTaskCategories(project, 'p9');
        if (required.length) {
          const covered = new Set(tasks.map((t) => t.taskCategory).filter(Boolean));
          const missing = required.filter((c) => !covered.has(c));
          if (missing.length) {
            reasons.push(`${missing.length} launch module${missing.length === 1 ? '' : 's'} with no checklist item: ${missing.join(', ')}`);
          }
        }

        // The Final Go-Live Approval itself. This was a CLIENT-ONLY rule
        // (StoreLaunchPage's `readyToLaunch` required the anchor task
        // approved) — the server never checked it, so a direct API call
        // could take a store live with the one sign-off that actually
        // authorises go-live never given. Inert if the template defines no
        // anchor, rather than inventing a requirement.
        const anchorInTemplate = await templateHasTaskKey(project, 'p9', GOLIVE_ANCHOR_KEY);
        if (anchorInTemplate) {
          const anchor = tasks.find((t) => t.templateTaskKey === GOLIVE_ANCHOR_KEY);
          if (!anchor) reasons.push('the Final Go-Live Approval item has not been allocated');
          else if (anchor.status !== TASK_STATUS.APPROVED) reasons.push('Final Go-Live Approval has not been given');
        }

        // ANY blocked item stops a launch, not just a high-priority one.
        const blocked = tasks.filter((t) => t.status === TASK_STATUS.BLOCKED);
        if (blocked.length) {
          reasons.push(`${blocked.length} blocked checklist item${blocked.length === 1 ? '' : 's'} (${blocked.map((t) => t.code).join(', ')})`);
        }
        const criticalOpen = tasks.filter(
          (t) => ['critical', 'high'].includes(t.priority)
            && (t.status === TASK_STATUS.BLOCKED || t.status === TASK_STATUS.REJECTED),
        ).length;
        if (criticalOpen > 0) reasons.push(`${criticalOpen} critical issue${criticalOpen === 1 ? '' : 's'} still open`);
      }
      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'LAUNCH_NOT_READY', details: reasons });
      }

      // Going live happens ONCE. Reopening p9 and completing it again must
      // not re-stamp storeLiveAt/By (which would rewrite the store's real
      // opening date) or re-announce the launch to everyone. Both are
      // therefore conditional on this being the first time.
      const alreadyLive = Boolean(project.storeLiveAt);
      project.status = PROJECT_STATUS.STORE_LIVE;
      if (!alreadyLive) {
        project.storeLiveAt = new Date();
        project.storeLiveBy = userId;
        justWentLive = true;
      }
    }

    // Project Closure (p10) — the lifecycle's final sign-off, and the gate
    // that unlocks archiving. This branch previously did not exist: p10 fell
    // through to the generic "≥1 record" rule, so a single closure record
    // completed the phase. That mattered doubly, because closureReadiness's
    // first gate is "every stage Completed" — so cheaply completing p10 was
    // also the last step needed to make Archive Project pass. (Audit H10.)
    if (stageKey === 'p10') {
      const reasons = [];

      // 1. Every other phase genuinely completed.
      const incomplete = project.stages.filter(
        (s) => s.key !== 'p10' && s.status !== STAGE_STATUS.COMPLETED,
      );
      if (incomplete.length) {
        reasons.push(`${incomplete.length} earlier phase(s) not yet completed (${incomplete.map((s) => s.name).join(', ')})`);
      }

      // 2. Lifecycle sanity — a project can only be closed once it actually
      //    went live (Phase 9's one-way door), never straight from planning.
      if (![PROJECT_STATUS.STORE_LIVE, PROJECT_STATUS.ARCHIVED].includes(project.status)) {
        reasons.push('the store has not gone live yet, so the project cannot be closed');
      }

      // 3. Mandatory closure modules — read from THIS project's template,
      //    falling back to the shared constant only when a template defines
      //    none, so closure requirements are never invented.
      const templateModules = (await templateAssessmentTypes(project, 'p10')).map((m) => m.key);
      const required = templateModules.length ? templateModules : CLOSURE_MODULE_VALUES;
      const p10Records = await Record.find({ project: projectId, stageKey: 'p10' }).select('assessmentType status decisionReason');
      const approved = new Set(
        p10Records.filter((r) => r.status === RECORD_STATUS.APPROVED).map((r) => r.assessmentType),
      );
      const missing = required.filter((k) => !approved.has(k));
      if (missing.length) {
        reasons.push(`${missing.length} closure module${missing.length === 1 ? '' : 's'} not approved: ${missing.join(', ')}`);
      }
      const awaiting = p10Records.filter((r) => r.status === RECORD_STATUS.SUBMITTED).length;
      if (awaiting) reasons.push(`${awaiting} closure submission${awaiting === 1 ? '' : 's'} still awaiting a decision`);

      // 4. Nothing anywhere in the project may still be open, blocked or
      //    awaiting approval — closure means the work is genuinely finished.
      const openTasks = await Task.find({
        project: projectId,
        status: { $nin: [TASK_STATUS.APPROVED] },
      }).select('code status');
      if (openTasks.length) {
        const counts = {};
        for (const t of openTasks) counts[t.status] = (counts[t.status] || 0) + 1;
        reasons.push(`${openTasks.length} task(s) not fully approved: ${Object.entries(counts).map(([st, n]) => `${n} ${TASK_STATUS_LABELS[st] || st}`).join(', ')}`);
      }

      if (reasons.length > 0) {
        throw ApiError.badRequest(reasons.join(' · '), { code: 'CLOSURE_NOT_READY', details: reasons });
      }

      // Closure audit stamps. Remarks come from the approved Project Sign-Off
      // module's own reviewer remarks — real captured data.
      project.closedAt = new Date();
      project.closedBy = userId;
      const signOff = p10Records.find(
        (r) => r.assessmentType === CLOSURE_MODULES.PROJECT_SIGN_OFF && r.status === RECORD_STATUS.APPROVED,
      );
      if (signOff?.decisionReason) project.closureRemarks = signOff.decisionReason;
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
    //    Required modules come from THIS project's template (the shared
    //    constant is only a fallback), so archiving and p10 completion are
    //    measured against exactly the same list.
    const templateModules = (await templateAssessmentTypes(project, 'p10')).map((m) => m.key);
    const requiredModules = templateModules.length ? templateModules : CLOSURE_MODULE_VALUES;
    const missingModules = requiredModules.filter((k) => approvedOf(k).length === 0);
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
      // The three module-specific gates below only apply when this project's
      // template actually defines that module. A template without, say,
      // Vendor Performance must not be permanently unarchivable because of a
      // requirement it never opted into — same "derive, don't hardcode" rule
      // the module list itself follows.
      ...(requiredModules.includes(CLOSURE_MODULES.DOCUMENT_ARCHIVE) ? [{
        key: 'documents_uploaded',
        label: 'All documents uploaded',
        passed: archiveRecords.length > 0 && documentsArchived > 0,
        detail: archiveRecords.length && documentsArchived > 0
          ? `${documentsArchived} document(s) archived`
          : 'Document Archive has no approved submission with an archived-document count',
      }] : []),
      ...(requiredModules.includes(CLOSURE_MODULES.FINANCIAL_CLOSURE) ? [{
        key: 'financial_closure',
        label: 'Financial closure completed',
        passed: financialRecords.length > 0 && pendingPayment === 0,
        detail: financialRecords.length === 0
          ? 'Financial Closure has no approved submission yet'
          : pendingPayment > 0
            ? `₹${pendingPayment.toLocaleString('en-IN')} still pending`
            : 'All invoices reconciled and payments released',
      }] : []),
      ...(requiredModules.includes(CLOSURE_MODULES.VENDOR_PERFORMANCE) ? [{
        key: 'vendor_payments',
        label: 'Vendor payments completed',
        passed: vendorRecords.length > 0 && unpaidVendors.length === 0,
        detail: vendorRecords.length === 0
          ? 'No vendor has been evaluated yet'
          : unpaidVendors.length
            ? `${unpaidVendors.length} vendor payment(s) not marked Paid`
            : `All ${vendorRecords.length} vendor payment(s) settled`,
      }] : []),
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
    // Cascade to BOTH child collections. Every collection-mode phase (p1-p4,
    // p7's module pipeline, p8/p9/p10 records) stores its data as Record
    // documents whose `project` ref is required — deleting only Tasks left
    // those Records as permanent orphans pointing at a nonexistent Project.
    await Promise.all([
      Task.deleteMany({ project: id }),
      Record.deleteMany({ project: id }),
    ]);
    return project;
  },
};

export default projectService;
