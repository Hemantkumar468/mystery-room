import dayjs from 'dayjs';
import mongoose from 'mongoose';
import { Project } from './project.model.js';
import { Template } from '../templates/template.model.js';
import { FORM_OWNER } from '../../../core/constants/jobRoles.js';
import { fmsService } from '../../fms/fms.service.js';
import { templateService } from '../templates/template.service.js';
import { Task } from '../tasks/task.model.js';
import { phaseProgress, phaseProgressDetail } from './phaseProgress.js';
import { Record } from '../records/record.model.js';
import { User } from '../../auth/auth.model.js';
import { activityService } from '../activity/activity.service.js';
import { notificationService } from '../notifications/notification.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  STAGE_LIFECYCLE,
  TEMPLATE_STATUS,
  TASK_STATUS,
  TASK_STATUS_LABELS,
  ACTIVITY_ACTIONS,
  RECORD_STATUS,
  CLOSURE_MODULES,
  CLOSURE_MODULE_VALUES,
  CLOSURE_AUDIT_EVENTS,
  P3_GATING_MODULES,
  can,
} from '../../../core/constants/index.js';

// "Done" is one value now. Progress counts complete tasks and nothing else —
// the old list had to include four approval statuses because sign-off lived
// on the same field, which is exactly the confusion that split them apart.
const WORK_DONE_STATUSES = [TASK_STATUS.COMPLETE];

/** Route slug per stage, for notification links — mirrors client/src/features/projects/stagesConfig.jsx's STAGES list. */
const STAGE_PATH_SLUGS = {
  p4: 'project-creation',
  p5: 'department-planning',
  p6: 'execution',
  p7: 'approval-workflow',
  p8: 'store-readiness',
  p9: 'store-launch',
  p10: 'project-closure',
};

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
 * The property Project Creation works on: a shortlisted property whose LOI and
 * Lease are Approved.
 *
 * Uses the same P3_GATING_MODULES rule as the p3 completion gate, and must —
 * these two answer the same question ("is this property commercially closed
 * enough to build on?") from different directions. If this one still demanded
 * legal verification and the deposit schedule, clearing p3 would leave Project
 * Creation with no property to work on, and the phase would be complete while
 * the next one insisted nothing was ready.
 */
async function resolveP3FinalizedProperty(projectId, project) {
  const [shortlisted, p3Records, p3Types] = await Promise.all([
    Record.find({ project: projectId, stageKey: 'p1', status: RECORD_STATUS.SHORTLISTED }),
    Record.find({ project: projectId, stageKey: 'p3' }),
    templateTypesFor(project, 'p3'),
  ]);
  const gating = p3Types.filter((t) => P3_GATING_MODULES.includes(t.key));
  if (!gating.length) return null;
  return shortlisted.find((p) => gating.every((t) => isTypeDone(p3Records, p._id, t))) || null;
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
  // The `user` field type now stores a real User id, so resolve that first and
  // only fall back to a name match for values captured before it did (and for
  // anything typed by hand). Matching by name alone never resolved anything at
  // all while the picker offered an invented roster: it stored "emp-exp-001",
  // which is nobody's name, so `owner` was silently left untouched every time.
  const pmRaw = String(values.project_manager || '').trim();
  if (pmRaw) {
    const pm = mongoose.isValidObjectId(pmRaw)
      ? await User.findById(pmRaw).select('_id')
      : await User.findOne({ name: new RegExp(`^${pmRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).select('_id');
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

/**
 * Self-contained entry point for callers that only have a projectId, not an
 * already-loaded project doc (record.service.js's decide() — enforcing that
 * only one property may be Approved at Site Evaluation at a time, since this
 * is the exact function every downstream gate above uses to resolve THE ONE
 * property, via `.find()`, silently picking whichever comes first if two
 * were ever simultaneously approved).
 */
async function getP2ApprovedProperty(projectId) {
  const project = await Project.findById(projectId).select('template');
  if (!project) return null;
  return resolveP2ApprovedProperty(projectId, project);
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

/** Build a city-scoped human code, e.g. MR-PUN-003.
 *
 * Numbered from the existing CODES with the same prefix, not from a count of
 * the city's projects — a count collides the moment a project is deleted or
 * the same city arrives with different casing ("Sagar" vs "sagar" produced
 * two claims on MR-SAG-001). */
async function generateProjectCode(city) {
  const cityCode = city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const prefix = `MR-${cityCode}-`;
  const rows = await Project.find({ code: { $regex: `^${prefix}\\d+$` } }).select('code').lean();
  const next = rows.reduce((max, r) => Math.max(max, parseInt(r.code.slice(prefix.length), 10) || 0), 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

/** Draft projects may not have a city yet, so they can't use
 * generateProjectCode (which requires one). Derived from the document's own
 * ObjectId instead — trivially unique, no query needed. Replaced with a real
 * MR-<CITY>-### code by generateProjectCode() the moment the draft is
 * published (see publishDraft below). */
function generateDraftCode(objectId) {
  return `DRAFT-${objectId.toString().slice(-8).toUpperCase()}`;
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
/**
 * Generate every task the template describes, for a template that opted into
 * `autoAssignTasks`.
 *
 * This is "the master template runs": the MD fills in a short form for a new
 * city, and the whole plan — every phase's tasks, each with its owner, buddy,
 * lead time, planned dates and checklist — exists immediately, with nobody
 * hand-allocating work the template already spells out.
 *
 * The template's named doer becomes the task's real `assignee`, which is the
 * only field My Tasks queries. It used not to: the template could only name
 * someone from a hardcoded roster of invented people, so setting a User
 * reference from it was impossible and the generated plan landed on no
 * dashboard at all. The picker now offers registered accounts, so
 * `primaryAssignee` holds a User id and the work reaches the person named.
 *
 * The buddy joins `watchers` for the same reason — a backup owner who is never
 * told about the task is not a backup.
 *
 * One thing it deliberately does NOT do: run for templates without the
 * `autoAssignTasks` flag, so every existing playbook keeps today's manual
 * allocation.
 *
 * Idempotent by construction: it is only ever reached from
 * materializeFromTemplate, which itself runs once per project. The existence
 * check makes that explicit rather than implicit, so a future second caller
 * cannot silently double every task.
 */
/**
 * Resolve a template's assignee strings to real User ids.
 *
 * Those fields are plain strings because they used to hold ids from a
 * hardcoded roster of invented people ("emp-exp-001"). They now hold User ids,
 * and both shapes are live in the database at once, so this handles each:
 *
 *  - an ObjectId is already an account;
 *  - a roster id resolves through `User.employeeId`, which is where those ids
 *    survive on the real accounts. Templates saved since the change store User
 *    ids directly, so this path only serves the ones not yet re-saved;
 *  - anything else names nobody, and is dropped rather than guessed at.
 *
 * Batched into one query per project rather than one per task.
 */
async function resolveTemplateAssignees(template) {
  const raw = new Set();
  for (const stage of template.stages || []) {
    for (const t of stage.tasks || []) {
      // Lists first (several doers / several buddies), singles for older templates.
      for (const v of [...(t.assignees || []), ...(t.backupAssignees || []), t.primaryAssignee, t.backupAssignee]) {
        if (v) raw.add(String(v));
      }
    }
  }

  const resolved = new Map();
  const legacy = [];
  for (const value of raw) {
    if (mongoose.isValidObjectId(value)) resolved.set(value, value);
    else legacy.push(value);
  }

  if (legacy.length) {
    const users = await User.find({ employeeId: { $in: legacy } }).select('employeeId');
    for (const u of users) resolved.set(u.employeeId, u._id);
  }
  return resolved;
}

/**
 * THE FORM A TASK IS, when the template cannot spell out the address.
 *
 * Phase 2's assessment tasks get theirs in syncPerPropertyTasks, because each
 * one is about a particular property and the property id is in the URL. Phase
 * 3's six documents are not: a project reaches commercial closure on ONE site,
 * the page finds it itself, and the address needs nothing but the project.
 *
 * So they had no `appPath` at all, and the whole chain that depends on it was
 * off for the entire phase: no button on the task, no form to open, nothing to
 * come back from, and — because `formKey` was blank too — no way for a filed
 * LOI to know which task it had just finished. Six documents on every project,
 * each one a task somebody had to find the screen for and then remember to
 * tick by hand. The assessments have worked this way for weeks; closure never
 * did.
 *
 * Derived rather than stored so it cannot rot: the address is built from what
 * the task already is.
 */
const FORM_STAGE_PATH = { p3: 'commercial-finalization' };

function derivedFormPath(project, stage, task, code) {
  const seg = FORM_STAGE_PATH[stage?.key];
  if (!seg || !task?.formKey) return undefined;
  /* `task` as well as `form`, for the same reason Phase 2's path carries it:
     the form page shows a "Back to my task" button built from the code, and
     without it somebody who has just filed an LOI is standing on a phase page
     with no way back to the job that sent them. */
  return `/projects/${project._id}/${seg}?form=${task.formKey}&task=${code}`;
}

/**
 * One Task document from one template task — shared by the creation-time
 * cascade below and by syncStageFromTemplate, so a phase re-issued later gets
 * exactly the task the cascade would have produced on day one.
 */
function buildTaskDoc({
  project, stage, task, taskIdx, plannedStart, plannedEnd, seqNo, assigneeRefs,
  formOwners = null, assignments = null,
}) {
  return {
      project: project._id,
      code: `${project.code}-T${String(seqNo).padStart(3, '0')}`,
      templateTaskKey: task.key,
      stageKey: stage.key,
      stageName: stage.name,
      title: task.title,
      description: task.description,
      // The doer's own What/Who/When/How, and the form this task opens.
      brief: task.brief,
      formKey: task.formKey,
      appPath: task.appPath || derivedFormPath(project, stage, task, `${project.code}-T${String(seqNo).padStart(3, '0')}`),
      openPhaseOnly: task.openPhaseOnly,
      // The template's approval rule: whether one is needed, and who gives it.
      approval: task.approval,
      priority: task.priority,
      department: task.department || stage.ownerDepartment,
      taskCategory: task.taskCategory,
      assignees: task.assignees || [],
      backupAssignees: task.backupAssignees || [],
      primaryAssignee: task.primaryAssignee || null,
      backupAssignee: task.backupAssignee || null,
      /* Every doer that resolves to a real account becomes a ref, so the task
         lands in ALL their My Tasks at once; `assignee` is the first of them
         for every single-owner code path. Names that resolve to nobody are
         dropped rather than guessed. Buddies become watchers. */
      ...(() => {
        /**
         * THREE ANSWERS, IN ORDER — and the first one that exists wins.
         *
         *   1. WHAT THE COMPANY CHOSE on Settings -> FMS · Assign Work. An
         *      explicit decision about who does this job, so nothing else
         *      gets a vote.
         *   2. THE ORG SHEET, for the four assessments. It names a
         *      Feasibility Expert and a Technical Expert, and those people
         *      fill those forms — so a company that never opens that screen
         *      still has its assessments addressed correctly.
         *   3. THE TEMPLATE's own list, which is the demo roster it shipped
         *      with (`emp-exp-001`) resolved against whoever carries that
         *      code today. Last, because it is the least likely to be right.
         */
        const chosen = assignments?.get(`${stage.key}:${task.key}`) ?? null;
        const owned = formOwners?.get(task.formKey) ?? null;
        const doerIds = chosen?.doers?.length
          ? [...new Set(chosen.doers.map(String))]
          : owned ? [String(owned)] : [...new Set(
            [...(task.assignees || []), task.primaryAssignee].filter(Boolean)
              .map((v) => assigneeRefs.get(String(v))).filter(Boolean).map(String),
          )];
        /* Cover, on the same three-step rule. A buddy watches the task and
           can pick it up; it is not work they owe, so it never lands in
           their own list. */
        const buddyIds = (chosen?.buddies?.length
          ? [...new Set(chosen.buddies.map(String))]
          : [...new Set(
            [...(task.backupAssignees || []), task.backupAssignee].filter(Boolean)
              .map((v) => assigneeRefs.get(String(v))).filter(Boolean).map(String),
          )]
        ).filter((id) => !doerIds.includes(id));
        return {
          ...(doerIds.length ? { assignee: doerIds[0], assigneeRefs: doerIds } : {}),
          ...(buddyIds.length ? { watchers: buddyIds } : {}),
        };
      })(),
      // Surfaces on day one when the template's named doer is unavailable, so
      // the buddy is visible rather than the task quietly having no owner.
      reassignNeeded: task.primaryAssigneeUnavailable === true && Boolean(task.primaryAssignee),
      estimatedHours: (task.estimatedDays || 1) * 8,
      plannedStart,
      plannedEnd,
      order: task.order ?? taskIdx,
      checklist: (task.checklist || []).map((c) => ({ label: c.label, required: c.required })),
      createdBy: project.createdBy,
  };
}

async function cascadeTasksFromTemplate(template, project) {
  const already = await Task.countDocuments({ project: project._id });
  if (already > 0) return 0;

  const stageByKey = new Map(project.stages.map((s) => [s.key, s]));
  const orderedStages = [...template.stages].sort((a, b) => a.order - b.order);
  /* Who the company has put on each recurring job, and who the org sheet
     names — both consulted before the template's own roster. See
     buildTaskDoc for the order. */
  const [assigneeRefs, formOwners, assignments] = await Promise.all([
    resolveTemplateAssignees(template), resolveFormOwners(), fmsService.resolve(),
  ]);
  const taskDocs = [];

  for (const stage of orderedStages) {
    if (stage.manualTasksOnly) continue;
    const liveStage = stageByKey.get(stage.key);
    if (!liveStage) continue;

    // Tasks run back-to-back inside their phase, starting when the phase does.
    // Phases that run in parallel therefore produce tasks that also overlap —
    // the parallelism is inherited rather than re-derived here.
    let cursor = dayjs(liveStage.plannedStart);

    const orderedTasks = [...(stage.tasks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const [taskIdx, task] of orderedTasks.entries()) {
      const plannedStart = cursor.toDate();
      const plannedEnd = cursor.add(task.estimatedDays || 1, 'day').toDate();
      cursor = dayjs(plannedEnd);

      taskDocs.push(buildTaskDoc({
        project, stage, task, taskIdx, plannedStart, plannedEnd, seqNo: taskDocs.length + 1, assigneeRefs,
        formOwners, assignments,
      }));
    }
  }

  if (taskDocs.length) await Task.insertMany(taskDocs);
  await notifyBulkAssigned(project, taskDocs, project.createdBy);
  logger.info(`Template "${template.name}" generated ${taskDocs.length} tasks for project ${project.code}`);
  return taskDocs.length;
}

/**
 * Bring ONE phase of a live project up to date with its template.
 *
 * A project snapshots its template at creation, which is right for day-to-day
 * stability — but when a phase is re-shaped (Phase 6 becoming the order
 * tracker), live projects must follow or the old phase lingers. This refreshes
 * the stage's snapshot (name, owner, What/Who/When/How, gate, exit criteria,
 * capture mode), keeps every FINISHED task of the phase as history, removes
 * the unfinished ones the old definition generated, and re-issues the
 * template's current tasks with the same scheduling and doer resolution the
 * creation-time cascade uses. Task codes continue after the project's highest.
 *
 * `apply: false` returns the plan without writing — the CLI
 * (seed/syncProjectStage.js) shows that first. `reopen` puts a completed
 * stage back to in-progress, for a phase whose work is being redefined.
 */
export async function syncStageFromTemplate(project, stageKey, { apply = false, reopen = false } = {}) {
  const templateId = project.template?.ref?._id || project.template?.ref || project.template;
  const template = await Template.findById(templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);
  const tStage = template.stages.find((st) => st.key === stageKey);
  const live = project.stages.find((st) => st.key === stageKey);
  if (!tStage || !live) throw new Error(`Stage "${stageKey}" is missing on the ${tStage ? 'project' : 'template'}`);

  /* Work already finished is kept when a phase is re-synced from its
     template; anything unfinished is replaced. */
  const FINISHED = new Set([TASK_STATUS.COMPLETE]);
  const existing = await Task.find({ project: project._id, stageKey });
  const keep = existing.filter((t) => FINISHED.has(t.status));
  const stale = existing.filter((t) => !FINISHED.has(t.status));
  const keptKeys = new Set(keep.map((t) => t.templateTaskKey).filter(Boolean));

  const codes = await Task.find({ project: project._id }).select('code');
  const maxNo = codes.reduce((m, t) => Math.max(m, Number(String(t.code || '').split('-T').pop()) || 0), 0);
  const [assigneeRefs, formOwners, assignments] = await Promise.all([
    resolveTemplateAssignees(template), resolveFormOwners(), fmsService.resolve(),
  ]);

  let cursor = dayjs(live.plannedStart || new Date());
  const docs = [];
  const orderedTasks = [...(tStage.tasks || [])].sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  for (const [taskIdx, task] of orderedTasks.entries()) {
    const plannedStart = cursor.toDate();
    const plannedEnd = cursor.add(task.estimatedDays || 1, 'day').toDate();
    cursor = dayjs(plannedEnd);
    if (keptKeys.has(task.key)) continue; // already finished under the old definition — history, not a duplicate
    docs.push(buildTaskDoc({
      project, stage: tStage, task, taskIdx, plannedStart, plannedEnd, seqNo: maxNo + docs.length + 1, assigneeRefs,
      formOwners, assignments,
    }));
  }

  const plan = {
    project: project.code,
    stage: stageKey,
    rename: live.name === tStage.name ? null : { from: live.name, to: tStage.name },
    removeTasks: stale.map((t) => `${t.code} "${t.title}" (${t.status})`),
    keepTasks: keep.map((t) => `${t.code} "${t.title}" (${t.status})`),
    addTasks: docs.map((d) => `${d.code} "${d.title}"${d.assignee ? '' : ' (no doer resolved)'}`),
    reopen,
  };
  if (!apply) return plan;

  Object.assign(live, {
    name: tStage.name,
    color: tStage.color,
    slaDays: tStage.slaDays,
    ownerDepartment: tStage.ownerDepartment,
    whatWhoWhenHow: tStage.whatWhoWhenHow || [],
    parallelGroup: tStage.parallelGroup,
    branchOf: tStage.branchOf,
    gate: tStage.gate,
    exitCriteria: tStage.exitCriteria,
    captureMode: tStage.captureMode || 'single',
    recordNoun: tStage.recordNoun || 'Record',
  });
  if (plan.reopen) {
    /* Nothing to un-complete: adding unfinished tasks makes the phase
       read as processing on the next read, by arithmetic. Only the
       stamps have to go, or they would outlive what they recorded. */
    live.completedManually = false;
    live.completedAt = undefined;
    live.completedBy = undefined;
  }
  project.markModified('stages');
  await project.save();
  if (stale.length) await Task.deleteMany({ _id: { $in: stale.map((t) => t._id) } });
  if (docs.length) await Task.insertMany(docs);
  logger.info(`Stage ${stageKey} of ${project.code} synced from template: -${stale.length} +${docs.length} tasks`);
  return plan;
}

/**
 * Tell people about a batch of tasks that just landed on them — ONE line each,
 * not one per task.
 *
 * Creating a project instantiates fifty-odd tasks at once. Notifying per task
 * would put fifty rows in one person's bell in the same second, which is not
 * fifty times as useful as one row: it is how somebody decides the bell is
 * noise and stops opening it. So the batch collapses to "14 tasks are yours on
 * <project>", pointing at My Tasks where they are all listed anyway.
 *
 * Fire-and-forget, same contract as everything else here: a project must not
 * fail to be created because a notification could not be written.
 */
async function notifyBulkAssigned(project, taskDocs, actorId) {
  const perPerson = new Map();
  for (const t of taskDocs || []) {
    const doers = new Set([
      ...(t.assigneeRefs || []).map(String),
      ...(t.assignee ? [String(t.assignee)] : []),
    ]);
    for (const id of doers) {
      if (String(id) === String(actorId || '')) continue;
      perPerson.set(id, (perPerson.get(id) || 0) + 1);
    }
  }
  if (!perPerson.size) return;

  await Promise.all([...perPerson].map(([recipient, n]) => notificationService.notify({
    recipients: [recipient],
    project: project._id,
    type: 'task_assigned',
    title: n === 1 ? 'A task is yours' : `${n} tasks are yours`,
    message: `${project.name} (${project.code}) — ${n} task${n === 1 ? '' : 's'} allocated to you.`,
    link: '/my-tasks',
  })));
}

/**
 * Phases a project's KIND makes irrelevant, closed by the system on day
 * one. A franchise arrives with its property (the enquiry was the capture
 * and the commitment was the assessment); a renovation happens inside a
 * centre we already run, so commercial paperwork is moot too. The stages
 * stay VISIBLE — completed with a note, never hidden — because a timeline
 * with missing phases reads as broken, while one with green phases reads
 * as truth: nothing was needed there.
 */
const KIND_SKIPS = {
  franchise: ['p1', 'p2'],
  renovation: ['p1', 'p2', 'p3'],
};

/**
 * The renovated centre's SITE, carried into the new project as its own
 * approved Phase 1 record — cloned from the source centre's approved
 * property so drawings, BOQ and execution have a real site to hang off,
 * with zero retyping. One source of truth, copied once, labelled where
 * it came from.
 */
async function carrySiteFromSource(project, sourceProject, userId) {
  // The chosen site is the approved one if sign-off happened, else the
  // shortlisted one — older projects ran before the approval step existed.
  const site =
    (await Record.findOne({ project: sourceProject._id, stageKey: 'p1', status: 'approved' })
      .sort({ approvedAt: -1 })
      .lean()) ||
    (await Record.findOne({ project: sourceProject._id, stageKey: 'p1', status: 'shortlisted' })
      .sort({ updatedAt: -1 })
      .lean());
  if (!site) return; // an old project without a captured site — nothing honest to carry
  await Record.create({
    project: project._id,
    stageKey: 'p1',
    title: site.title,
    status: 'approved',
    approvedBy: userId,
    approvedAt: new Date(),
    values: {
      ...(site.values || {}),
      remarks: `Carried from ${sourceProject.code} — the centre this renovation happens inside.`,
    },
  });
}

/**
 * The centre's PROJECT PLAN, carried into the renovation as a Phase 3B DRAFT.
 *
 * "Add two more games" starts from what the outlet already runs — so the plan
 * form opens with the existing games pre-ticked, the confirmed area and shape
 * notes filled, and the site drawings attached. The planner ticks the games
 * being ADDED, sets this renovation's own dates and budget, and submits; the
 * MD then approves the outlet's full future game set in one place. A DRAFT,
 * not an approved record: the whole point of the renovation is that this plan
 * changes, so it must go through its own submit → approve.
 *
 * Dates, costs and the generated layout are deliberately NOT carried — they
 * belong to the original build, and stale milestones pre-filled as if current
 * are worse than blanks.
 */
async function carryPlanFromSource(project, sourceProject, userId) {
  const plan =
    (await Record.findOne({ project: sourceProject._id, stageKey: 'p20', status: 'approved' })
      .sort({ approvedAt: -1 })
      .lean()) ||
    (await Record.findOne({ project: sourceProject._id, stageKey: 'p20' }).sort({ updatedAt: -1 }).lean());
  if (!plan) return; // the centre predates Phase 3B — the planner starts clean
  const v = plan.values || {};
  const existingGames = Array.isArray(v.selected_games) ? v.selected_games : [];
  await Record.create({
    project: project._id,
    stageKey: 'p20',
    title: plan.title || 'Project Plan',
    status: 'draft',
    createdBy: userId,
    values: {
      confirmed_area: v.confirmed_area ?? sourceProject.areaSqft,
      site_shape: v.site_shape,
      selected_games: existingGames,
      game_count: existingGames.length,
      game_notes: [
        existingGames.length
          ? `Already running at ${sourceProject.code}: ${existingGames.join(', ')}. Tick the games being ADDED above — keep the existing ones ticked so the layout and approval cover the whole outlet.`
          : null,
        v.game_notes,
      ].filter(Boolean).join('\n\n'),
      cad_files: v.cad_files,
      remarks: `Carried from ${sourceProject.code} — set this renovation's own dates and budget, then submit for approval.`,
    },
  });
}

async function applyProjectKind(project, userId, skipsOverride) {
  /* A caller may override the kind's default skips — the franchise decision
     does: 'straight to LOI' keeps the default (Phases 1-2 done), while
     'assess the properties' and 'search for a property' pass [] so the
     project genuinely RUNS Phases 1-2 like any scouted launch. */
  const skips = Array.isArray(skipsOverride) ? skipsOverride : KIND_SKIPS[project.kind];
  if (!skips?.length) return;
  const now = new Date();

  /* Under the derived-progress model an EMPTY phase reads as pending, so
     the skip must speak the model's own language: the cascade's tasks are
     COMPLETED by the system (they were never anyone's work), and the stage
     is marked completedManually so recompute() honours the closure. */
  await Task.updateMany(
    { project: project._id, stageKey: { $in: skips } },
    { $set: { status: TASK_STATUS.COMPLETE, completedAt: now, completedBy: userId } },
  );

  let touched = false;
  for (const stage of project.stages) {
    if (!skips.includes(stage.key)) continue;
    stage.completedManually = true;
    stage.startedAt = stage.startedAt || now;
    stage.completedAt = now;
    stage.completedBy = userId;
    touched = true;
  }
  if (touched) {
    project.markModified('stages');
    await project.save();
  }

  await activityService.log({
    project: project._id,
    entityType: 'project',
    entityId: project._id,
    action: ACTIVITY_ACTIONS.UPDATED,
    actor: userId,
    message: `${project.kind === 'renovation' ? 'Renovation' : 'Franchise'} project — ${skips.length} phase(s) completed by the system on creation: not applicable to this kind of work.`,
  });
}
async function materializeFromTemplate(template, project) {
  const stages = [];
  let cursor = dayjs(project.plannedStartDate);

  const orderedStages = [...template.stages].sort((a, b) => a.order - b.order);

  /**
   * Phases sharing a `parallelGroup` start on the SAME day rather than queueing
   * behind each other, and the next sequential phase waits for the longest of
   * them. Without this, the client's two parallel branches (drawings ‖ vendor
   * identification, procurement ‖ civil works) would schedule end-to-end and
   * push every planned date — and therefore the whole opening forecast — weeks
   * late on paper while the real work ran side by side.
   */
  let groupKey = null;
  let groupStart = null;

  orderedStages.forEach((stage, stageIdx) => {
    const continuesGroup = Boolean(stage.parallelGroup) && stage.parallelGroup === groupKey;
    const start = continuesGroup ? groupStart : cursor;
    const end = start.add(stage.slaDays || 7, 'day');

    stages.push({
      key: stage.key,
      name: stage.name,
      order: stage.order ?? stageIdx,
      color: stage.color,
      slaDays: stage.slaDays,
      ownerDepartment: stage.ownerDepartment,
      // Carried so every screen can answer What/Who/When/How and show the gate
      // without re-deriving it — see projectStageSchema.
      whatWhoWhenHow: stage.whatWhoWhenHow || [],
      parallelGroup: stage.parallelGroup,
      gate: stage.gate,
      exitCriteria: stage.exitCriteria,
      captureMode: stage.captureMode || 'single',
      recordNoun: stage.recordNoun || 'Record',
      lifecycle: STAGE_LIFECYCLE.ACTIVE,
      plannedStart: start.toDate(),
      plannedEnd: end.toDate(),
      requiresApproval: stage.requiresApproval || false,
      approverRoles: stage.approverRoles || [],
    });

    if (continuesGroup) {
      // Siblings ran alongside — the sequential cursor tracks the LATEST finish.
      cursor = end.isAfter(cursor) ? end : cursor;
    } else {
      groupKey = stage.parallelGroup || null;
      groupStart = start;
      cursor = end;
    }
  });

  project.stages = stages;
  project.targetEndDate = project.targetEndDate || cursor.toDate();
  project.currentStageKey = stages[0]?.key;

  await project.save();

  if (template.autoAssignTasks) await cascadeTasksFromTemplate(template, project);
  return project;
}

/* ── Phase 2: one assessment task per shortlisted property ─────────────────

   The template gives Phase 2 one task per assessment ("Do the Feasibility
   assessment"), each owned by its assessor. With three properties shortlisted
   that single task meant three assessments, and the doer had to open it and
   then pick a property off a list — sometimes the wrong one.

   So each assessment task fans out per shortlisted property: property 1's
   Feasibility, property 2's Feasibility — each its own row in My Tasks, each
   opening straight onto its own property with only that assessment card live.
   The template stays the definition; the tasks follow the shortlist.

   Idempotent, and called after every Phase 1 decision:
     - a newly shortlisted property gets one task per assessment template task.
       The first property takes over the phase's original, still-open task, so
       its status, comments and history carry on instead of being replaced.
     - a property that leaves the shortlist (rejected, decision undone, deleted)
       loses only tasks nobody has touched; started or finished work stays.
     - the last task of an assessment is never deleted: it goes back to being
       the phase-wide task, so the phase never silently loses its work.
     - an assessment whose single phase-wide task was already COMPLETED under
       the old model is left alone — that one task covered every property.
   `apply: false` returns the plan without writing (seed/syncAssessmentTasks.js). */
const PER_PROPERTY_STAGE = 'p2';
const IN_EVALUATION = [
  RECORD_STATUS.SHORTLISTED,
  RECORD_STATUS.EVALUATION_IN_PROGRESS,
  RECORD_STATUS.APPROVED,
].filter(Boolean);

/* The name as a task title can carry it: spaces collapsed and trimmed (the
   Task schema trims titles, so an untrimmed name never matches its own saved
   title and every sync would "rename" it again), and capped, because some
   property names are a full street address. */
const TITLE_NAME_MAX = 48;
const propertyNameOf = (r) => {
  const name = String(r?.values?.property_name || r?.title || 'Property').replace(/\s+/g, ' ').trim() || 'Property';
  return name.length > TITLE_NAME_MAX ? `${name.slice(0, TITLE_NAME_MAX - 1).trimEnd()}…` : name;
};

/**
 * formKey -> the live account of the person the org sheet says owns it.
 *
 * Read fresh rather than cached: who holds "Feasibility Expert" is an HR
 * fact that changes on the Employees screen, and a cache here would keep
 * addressing new work to somebody who left. It is one query per sync.
 *
 * A seat nobody holds, or one whose only holder has been deactivated,
 * resolves to nothing — and the task then falls back to the template's own
 * assignee rather than being created ownerless.
 */
async function resolveFormOwners() {
  const roles = [...new Set(Object.values(FORM_OWNER))];
  const holders = await User.find({ jobRoles: { $in: roles }, isActive: { $ne: false } })
    .select('jobRoles')
    .sort({ createdAt: 1 })
    .lean();

  const byRole = new Map();
  for (const u of holders) {
    for (const role of u.jobRoles ?? []) {
      /* First holder wins, in account order. A seat with several people in
         it (the sheet lists five Cluster / Branch Managers) needs a rule,
         and "the first" is at least stable between runs — the MD can
         reassign the task itself, which is a decision, not a guess. */
      if (roles.includes(role) && !byRole.has(role)) byRole.set(role, u._id);
    }
  }

  const out = new Map();
  for (const [formKey, role] of Object.entries(FORM_OWNER)) {
    const id = byRole.get(role);
    if (id) out.set(formKey, id);
  }
  return out;
}

async function syncAssessmentTasks(projectId, { apply = true, actorId = null } = {}) {
  const project = await Project.findById(projectId);
  const plan = {
    project: project?.code || String(projectId),
    create: [], attach: [], rename: [], reassign: [], remove: [], detach: [],
  };
  if (!project) return plan;

  const live = (project.stages || []).find((s) => s.key === PER_PROPERTY_STAGE);
  const templateId = project.template?.ref?._id || project.template?.ref || project.template;
  const template = live && templateId ? await Template.findById(templateId) : null;
  const tStage = template?.stages?.find((s) => s.key === PER_PROPERTY_STAGE);
  const formKeys = new Set((tStage?.assessmentTypes || []).map((a) => a.key));
  const assessTasks = [...(tStage?.tasks || [])]
    .filter((t) => t.formKey && formKeys.has(t.formKey))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!assessTasks.length) return plan;

  const [properties, existing, codes, assigneeRefs, formOwners, assignments] = await Promise.all([
    Record.find({ project: project._id, stageKey: 'p1', status: { $in: IN_EVALUATION } })
      .select('title status values.property_name createdAt')
      .sort({ createdAt: 1 }),
    Task.find({ project: project._id, stageKey: PER_PROPERTY_STAGE, templateTaskKey: { $in: assessTasks.map((t) => t.key) } }),
    Task.find({ project: project._id }).select('code'),
    resolveTemplateAssignees(template),
    resolveFormOwners(),
    fmsService.resolve(),
  ]);
  const wanted = new Map(properties.map((p) => [String(p._id), p]));
  let lastNo = codes.reduce((m, t) => Math.max(m, Number(String(t.code || '').split('-T').pop()) || 0), 0);

  const creates = [];
  const updates = [];
  const removals = [];

  for (const [taskIdx, tTask] of assessTasks.entries()) {
    const mine = existing.filter((t) => t.templateTaskKey === tTask.key);
    const bySubject = new Map(mine.filter((t) => t.subjectRecord).map((t) => [String(t.subjectRecord), t]));
    const phaseWide = mine.filter((t) => !t.subjectRecord);
    if (!bySubject.size && phaseWide.some((t) => t.status === TASK_STATUS.COMPLETE)) continue;

    let spare = phaseWide.find((t) => t.status !== TASK_STATUS.COMPLETE) || null;
    const dated = mine.find((t) => t.plannedStart) || null;
    let created = 0;

    for (const [pid, property] of wanted) {
      const title = `${tTask.title} — ${propertyNameOf(property)}`;
      const have = bySubject.get(pid);
      if (have) {
        const set = {};
        // The property was renamed since: the task says what it is now.
        if (have.title !== title) {
          set.title = title;
          plan.rename.push(`${have.code} → "${title}"`);
        }

        /* THE TASKS THAT PREDATE THE FORM LINK. Every assessment task created
           before this existed opens the generic task page and leaves the doer
           to find the form. Filling it in is safe on any task — the address is
           derived from what the task already is, not from anything a person
           chose. */
        const wantPath = `/projects/${project._id}/site-evaluation/${property._id}?form=${tTask.formKey}&task=${have.code}`;
        if (have.appPath !== wantPath) set.appPath = wantPath;

        /* AND THE ONES ADDRESSED TO THE OLD ROSTER. Only while still
           untouched: pending, never started, nothing written on it. Moving
           work somebody has already begun is a decision for a person, not
           something a sync should do behind their back. */
        const owner = formOwners.get(tTask.formKey);
        const untouched = have.status === TASK_STATUS.PENDING
          && !have.actualStart && !have.startedAt
          && !(have.comments || []).length && !(have.attachments || []).length;
        if (owner && untouched && String(have.assignee || '') !== String(owner)) {
          set.assignee = owner;
          set.assigneeRefs = [owner];
          plan.reassign = plan.reassign || [];
          plan.reassign.push(`${have.code} "${have.title}" → the ${tTask.formKey} owner`);
        }

        if (Object.keys(set).length) updates.push({ id: have._id, set });
        continue;
      }
      if (spare) {
        updates.push({ id: spare._id, set: { subjectRecord: property._id, title } });
        plan.attach.push(`${spare.code} (${spare.status}) → "${title}"`);
        spare = null;
        continue;
      }
      const plannedStart = dated?.plannedStart || live.plannedStart || new Date();
      const plannedEnd = dated?.plannedEnd || dayjs(plannedStart).add(tTask.estimatedDays || 1, 'day').toDate();
      lastNo += 1;
      const doc = {
        ...buildTaskDoc({
          project, stage: tStage, task: tTask, taskIdx, plannedStart, plannedEnd, seqNo: lastNo, assigneeRefs,
          formOwners, assignments,
        }),
        subjectRecord: property._id,
        title,
        /* THE FORM ITSELF, one click from My Tasks.
           Without this the doer opens a task that describes the work and
           then has to go and find the screen that does it — through a
           project they may never have opened, a phase they do not know the
           number of, and a table of four columns. The address is already
           the one the Step 3 queue uses. */
        /* `task` as well as `form`: the form page offers a "Back to my task"
           button, and without the code it has nowhere to go back to. */
        appPath: `/projects/${project._id}/site-evaluation/${property._id}?form=${tTask.formKey}&task=${project.code}-T${String(lastNo).padStart(3, '0')}`,
      };
      creates.push(doc);
      created += 1;
      plan.create.push(`${doc.code} "${title}"${doc.assignee ? '' : ' (no doer resolved)'}`);
    }

    // Properties that are no longer being evaluated.
    let survivors = mine.length + created;
    for (const [sid, t] of bySubject) {
      if (wanted.has(sid)) continue;
      const untouched = t.status === TASK_STATUS.PENDING
        && !t.actualStart && !t.startedAt
        && !(t.comments || []).length && !(t.attachments || []).length;
      if (!untouched) continue; // someone worked on it — history, not clutter
      if (survivors > 1) {
        removals.push(t._id);
        survivors -= 1;
        plan.remove.push(`${t.code} "${t.title}"`);
      } else {
        updates.push({ id: t._id, set: { subjectRecord: null, title: tTask.title } });
        plan.detach.push(`${t.code} → "${tTask.title}" (no property left on the shortlist)`);
      }
    }
  }

  if (!apply) return plan;

  if (creates.length) await Task.insertMany(creates);
  // updateOne, not save(): an old task carrying a since-retired value must not
  // fail validation just because its title is being changed.
  for (const { id, set } of updates) await Task.updateOne({ _id: id }, { $set: set });
  if (removals.length) await Task.deleteMany({ _id: { $in: removals } });
  if (creates.length) await notifyBulkAssigned(project, creates, actorId || project.createdBy);
  if (creates.length || updates.length || removals.length) {
    logger.info(
      `Phase 2 assessment tasks for ${project.code}: +${creates.length} created, ${plan.attach.length} moved onto a property, `
      + `${plan.rename.length} renamed, -${removals.length} removed, ${plan.detach.length} back to phase-wide`,
    );
  }
  return plan;
}

export const projectService = {
  getP2ApprovedProperty,
  syncAssessmentTasks,

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

  /**
   * Saves a draft — status DRAFT, no template resolved, no stages
   * materialized, no notification. Deliberately mirrors only the fields a
   * half-filled Create Project form can supply; `name` defaults to
   * "Untitled Draft" and `code` is always auto-generated so the model's
   * unconditional `required: true` on those two fields is never at risk,
   * even though every other field (city, plannedStartDate included) may be
   * missing — see project.model.js's conditional `required` on those two.
   */
  async createDraft(data, userId) {
    const project = new Project({
      name: (data.name || '').trim() || 'Untitled Draft',
      description: data.description,
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
      status: PROJECT_STATUS.DRAFT,
      createdBy: userId,
    });
    project.code = data.code || generateDraftCode(project._id);
    await project.save();
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.CREATED,
      actor: userId,
      message: `Draft "${project.name}" created`,
    });
    return this.getById(project._id);
  },

  /**
   * Creation picks the workflow one of two ways:
   *
   *  - no `templateId` → the admin's published Default Template, exactly as
   *    before. This stays the path of least resistance: the MD fills the short
   *    form, the standard flow runs, nobody chooses anything.
   *  - an explicit `templateId` → that template, so a project can deliberately
   *    start from a different playbook (client flow, franchise fast-track, a
   *    customised copy) instead of the default.
   *
   * This previously refused a caller-supplied template outright. It is opened
   * up deliberately, and narrowly: the template must exist and be PUBLISHED,
   * so a half-built draft template can never become a live project's workflow.
   * Either way the project snapshots the template's stages, so editing the
   * template afterwards cannot rewrite a running project.
   *
   * A `status: 'draft'` body is routed to `createDraft` instead — see
   * project.controller.js#create.
   */
  async create(data, userId) {
    if (data.status === PROJECT_STATUS.DRAFT) return this.createDraft(data, userId);

    let template;
    if (data.templateId) {
      template = await Template.findById(data.templateId);
      if (!template) throw ApiError.badRequest('That template no longer exists — pick another one.');
      if (template.status !== TEMPLATE_STATUS.PUBLISHED) {
        throw ApiError.badRequest(
          `"${template.name}" is not published yet, so a project can't start from it. Publish it first, or use the standard flow.`,
        );
      }
    } else {
      template = await templateService.resolveDefaultTemplate(data.workflowType);
    }

    /* A renovation is work INSIDE an existing centre: its location facts
       come from that centre, never from the form — retyped facts drift.
       The payload may name the project and set dates/budget; city,
       address and area are the source centre's, full stop. */
    /* Optional per-call override of the kind's phase skips (see
       applyProjectKind) — plucked off before the model sees it. */
    const skipPhases = Array.isArray(data.skipPhases) ? data.skipPhases : undefined;
    delete data.skipPhases;

    /* Who owns the property hunt. Plucked off before the model sees it: it is
       not a field ON the project, it is an assignment made TO the tasks the
       template is about to materialise. */
    const captureAssignee = data.captureAssignee;
    delete data.captureAssignee;

    let sourceProject = null;
    if (data.kind === 'renovation') {
      if (!data.sourceProjectId) {
        throw ApiError.badRequest('Pick the centre being renovated — a renovation belongs to an existing project.');
      }
      sourceProject = await Project.findById(data.sourceProjectId);
      if (!sourceProject) throw ApiError.badRequest('That centre no longer exists.');
      data.city = sourceProject.city;
      data.address = sourceProject.address;
      data.areaSqft = sourceProject.areaSqft ?? data.areaSqft;
      if (!data.name?.trim()) data.name = `${sourceProject.name} — Renovation`;
    }

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
      kind: data.kind || 'new_centre',
      renovatesProject: sourceProject?._id,
      createdBy: userId,
    });

    await materializeFromTemplate(template, project);
    if (sourceProject) {
      await carrySiteFromSource(project, sourceProject, userId);
      await carryPlanFromSource(project, sourceProject, userId);
    }
    await applyProjectKind(project, userId, skipPhases);

    /**
     * NAME THE PERSON ON THE PROPERTY HUNT, at the moment the store is
     * created.
     *
     * Phase 1's tasks are materialised from the template unassigned, which
     * means a brand-new store arrives in the property queue reading
     * "Unassigned" — a step with no owner, which is the one thing the standard
     * this module is built to forbids. The MD names them on the create form
     * and every p1 task carries it from the first second.
     *
     * AFTER `applyProjectKind`, deliberately: a franchise or renovation closes
     * Phase 1 on creation (KIND_SKIPS), and those completed tasks are not work
     * anybody has to be put on. Only tasks still open are assigned.
     */
    if (captureAssignee) {
      await Task.updateMany(
        { project: project._id, stageKey: 'p1', status: { $ne: TASK_STATUS.COMPLETE } },
        { $set: { assignee: captureAssignee } },
      );

      /* AND TELL THEM. An assignment nobody is told about is a wish: the
         person finds out when somebody chases them, which is exactly the
         phone call this module exists to stop. Fire-and-forget, like every
         other notification here — a store must not fail to be created because
         a bell could not be written. */
      if (String(captureAssignee) !== String(userId || '')) {
        notificationService.notify({
          recipients: [captureAssignee],
          project: project._id,
          type: 'task_assigned',
          title: 'Find a site',
          message: `${project.name} (${project.code}) — the property hunt is yours. `
            + `${project.city ? `Start in ${project.city}.` : ''}`.trim(),
          link: '/property/capture',
        }).catch(() => {});
      }
    }
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

  /**
   * Draft -> real project ("Create Project" on a draft that's been Continued).
   * Re-validates the same requirements `createProjectSchema` enforces on a
   * fresh create — never trusts that the draft's stored data is actually
   * complete, since it may have been PATCHed piecemeal over several sessions.
   * On success, runs the exact same template-resolve + materialize +
   * code-generation sequence `create()` runs, so a published draft is
   * indistinguishable from a project created directly.
   */
  async publishDraft(id, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    if (project.status !== PROJECT_STATUS.DRAFT) {
      throw ApiError.badRequest('This project is not a draft.');
    }
    if (!project.name || project.name.trim().length < 2) {
      throw ApiError.badRequest('Enter a project name (min 2 characters) before creating the project.');
    }
    if (!project.city || project.city.trim().length < 2) {
      throw ApiError.badRequest('Enter a city before creating the project.');
    }
    if (!project.plannedStartDate) {
      throw ApiError.badRequest('Enter a planned start date before creating the project.');
    }

    const template = await templateService.resolveDefaultTemplate();

    project.code = await generateProjectCode(project.city);
    project.template = { ref: template._id, name: template.name, version: template.version };
    project.status = PROJECT_STATUS.PLANNING;

    await materializeFromTemplate(template, project);
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.STATUS_CHANGED,
      actor: userId,
      message: `Project "${project.name}" created from draft — template "${template.name}" applied`,
    });
    return this.getById(project._id);
  },

  async update(id, data, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    const isDraft = project.status === PROJECT_STATUS.DRAFT;

    // DRAFT is entered only via createDraft and left only via publishDraft
    // (which resolves a template and materializes stages — a generic PATCH
    // must never be able to silently perform, or skip, that). So a PATCH may
    // never change status into or out of DRAFT, in either direction.
    if (data.status !== undefined && data.status !== project.status
      && (data.status === PROJECT_STATUS.DRAFT || isDraft)) {
      throw ApiError.badRequest(
        'Draft status can only be entered by saving a new draft, and left by publishing it — not by a general project edit.',
      );
    }

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

    // A draft may still be filling in the identity fields that are
    // otherwise immutable once a project is real (see generateProjectCode /
    // materializeFromTemplate, which each only ever run once).
    const editable = isDraft
      ? [
        'name', 'description', 'address', 'areaSqft', 'status', 'priority',
        'owner', 'members', 'targetEndDate', 'budget', 'broker', 'tags',
        'city', 'plannedStartDate', 'code',
      ]
      : [
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
      message: isDraft ? `Draft "${project.name}" updated` : `Project "${project.name}" updated`,
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

  /* completeStage() AND reopenStage() ARE GONE, and with them ten phase
     gates and roughly six hundred lines.

     A phase is complete when its tasks are complete. That is now the only
     definition, computed by phaseProgress() on every read. There is nothing
     left to "complete" and therefore nothing to reopen: setting a task back
     to pending reopens its phase by arithmetic, with no second action, no
     second permission check, and no chance of the two disagreeing.

     What the gates did — refuse a phase until the one before it closed,
     until every dependency cleared, until a module was covered — is the
     ordering rule that was deliberately removed. What they ALSO did, almost
     invisibly, was carry the two lifecycle transitions: p9 set STORE_LIVE
     and p10 unlocked archiving. Those are not ordering, so they survive as
     the explicit action below and archiveProject() further down. */


  /**
   * The whole project as a tree: phases, each with its tasks, in one read.
   *
   * This replaces the phase strip. The strip showed thirteen identical circles
   * and made you click one to learn anything — no tasks, no owners, no dates.
   * The tree arrives fully expanded because everything it holds is something
   * somebody came to the page to see.
   *
   * It does NOT return a phase status. Progress is derived from the tasks the
   * client already has in its hand, so there is no second number to disagree
   * with the first — the counts travel with it only so the same arithmetic is
   * not written twice on two screens.
   */
  async tree(projectId) {
    const project = await Project.findById(projectId)
      .select('name code city status storeLiveAt stages progress health plannedStartDate targetEndDate budget masterData template')
      .lean();
    if (!project) throw ApiError.notFound('Project not found');

    /* THE FORM DEFINITIONS LIVE ON THE TEMPLATE, NOT ON THE PROJECT.
       A project stage snapshots scheduling and lifecycle and deliberately never
       copies `masterDataSchema` (see projectStageSchema) — so reading the schema
       off `project.stages` returns an empty array for every phase of every
       project, silently, which is exactly what it did the first time this was
       written. The saved ANSWERS live on the project; only the QUESTIONS come
       from the template. */
    const templateId = project.template?.ref?._id || project.template?.ref;
    const template = templateId
      ? await Template.findById(templateId).select('stages code name isDefault').lean()
      : null;
    /* The template stage itself, keyed — the tree reports the PLAN beside the
       actual, so it needs slaDays and the blueprint task list too, not just the
       form schema. */
    const planFor = new Map((template?.stages || []).map((ts) => [ts.key, ts]));

    /* The modules a phase is made of, when it has any. Six for Commercial
       Closure, four for Site Evaluation, fourteen for the Readiness Checklist —
       each one its own form, its own records and its own sign-off. */
    /* THE TEMPLATE'S OWN SCHEDULE, as dates.
       Every stage carries `slaDays` — "this phase should take 10 days" — but
       until now that number was only ever printed as "planned 10d" beside a
       window derived from whatever dates the TASKS happened to carry. The two
       could say different things and nothing reconciled them.

       So the plan is laid end to end from the project's planned start: phase
       one runs from the start for its own slaDays, phase two begins where phase
       one was due to end, and so on. Calendar days, not working days — that is
       what slaDays counts elsewhere (see estimatedDurationDays), and inventing
       a working-day calendar here would put this schedule out of step with the
       total the template already reports.

       A stage with no slaDays contributes nothing and gets no window, rather
       than silently borrowing a neighbour's. */
    const DAY_MS = 86400000;
    const scheduleFor = new Map();
    if (project.plannedStartDate) {
      let cursor = new Date(project.plannedStartDate).getTime();
      for (const ts of template?.stages || []) {
        const days = ts.slaDays;
        if (days == null) { scheduleFor.set(ts.key, null); continue; }
        const startsOn = new Date(cursor);
        cursor += days * DAY_MS;
        scheduleFor.set(ts.key, { startsOn, endsOn: new Date(cursor), days });
      }
    }

    const modulesFor = new Map((template?.stages || []).map((ts) => [ts.key, (ts.assessmentTypes || []).map((a) => ({
      key: a.key,
      name: a.name || a.key,
      subtitle: a.subtitle || '',
      subKeyField: a.subKeyField || null,
    }))]));

    const schemaFor = new Map(
      (template?.stages || []).map((ts) => [ts.key, [
        ...(ts.masterDataSchema || []),
        /* Flattened out of assessmentTypes, each field tagged with BOTH the
           module's display name and its key. The key is the load-bearing one:
           a task's `formKey` names the assessment it belongs to, so the drawer
           can open on that module alone instead of on all 151 fields Phase 7
           would otherwise hand a person in one flat list. */
        ...(ts.assessmentTypes || []).flatMap((a) => (a.masterDataSchema || [])
          .map((f) => ({ ...f, module: a.name || a.key, moduleKey: a.key }))),
      ]]),
    );

    /* THE RECORDS, for phases that have modules only.
       Trimmed to the fields the status rule and the report link actually read —
       a record carries its whole `values` blob, and sending fifteen phases of
       those would put the entire project through this endpoint to colour some
       cards. `parentRecordId` matters: every assessment hangs off a property,
       and two properties on one project each have their own set. */
    const moduleStageKeys = [...modulesFor.entries()].filter(([, m]) => m.length).map(([k]) => k);
    const records = moduleStageKeys.length
      ? await Record.find({ project: projectId, stageKey: { $in: moduleStageKeys } })
        .select('stageKey assessmentType status parentRecordId createdAt submittedAt submittedBy approvedBy')
        .populate('submittedBy', 'name')
        .populate('approvedBy', 'name')
        .sort({ createdAt: -1 })
        .lean()
      : [];
    const recordsByStage = new Map();
    for (const r of records) {
      if (!recordsByStage.has(r.stageKey)) recordsByStage.set(r.stageKey, []);
      recordsByStage.get(r.stageKey).push(r);
    }

    const tasks = await Task.find({ project: projectId })
      .select('code title status approvalState dueAt startedAt completedAt stageKey department '
        + 'priority assignee assigneeRefs parentTaskRef order plannedStart plannedEnd formKey appPath')
      .populate('assignee', 'name avatarColor')
      .sort({ order: 1, createdAt: 1 })
      .lean();

    const byStage = new Map();
    for (const t of tasks) {
      if (!byStage.has(t.stageKey)) byStage.set(t.stageKey, []);
      byStage.get(t.stageKey).push(t);
    }

    const phases = [...(project.stages || [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s) => {
        const own = byStage.get(s.key) || [];
        const { progress, counts } = phaseProgressDetail(own);
        const ts = planFor.get(s.key);
        const blueprint = ts?.tasks || [];

        /* WHAT THE TEMPLATE SAID THIS PHASE WOULD BE, reported beside what it
           actually is. Nothing here is enforced and nothing is rewritten: a
           project that has drifted from its template is a fact somebody needs
           to SEE, and repairing it silently would destroy the evidence of
           whatever decision caused the drift.

           Matched on the task TITLE, not on a key, because a materialised task
           keeps no reference back to the blueprint row it came from. So a
           RENAMED task reads as one blueprint row unmet — which is exactly the
           drift worth showing, and why this reports rather than repairs. */
        const haveTitles = new Set(own.map((t) => String(t.title || '').trim().toLowerCase()));
        const unmet = blueprint
          .filter((bt) => !haveTitles.has(String(bt.title || '').trim().toLowerCase()))
          .map((bt) => bt.title);

        return {
          key: s.key,
          name: s.name,
          order: s.order,
          color: s.color,
          department: s.ownerDepartment,
          lifecycle: s.lifecycle,
          /* THE FORM THIS PHASE OPENS, and the values already saved into it.

             Sent with the tree rather than fetched when a task is clicked: the
             drawer has to render the instant it opens, and a second round trip
             there is the difference between a panel and a spinner. The schema
             is the template snapshot on this project, so it is already local.

             Flattened from assessmentTypes when the stage has them — one form
             per module concatenated, each field tagged with the module it came
             from, because the drawer shows one task and a task does not know
             which module it belongs to. */
          fields: schemaFor.get(s.key) || [],
          values: (project.masterData || {})[s.key] || {},
          /* Empty for a phase with no modules — the client falls back to task
             branches there, which is still the right shape for Phase 1. */
          assessments: modulesFor.get(s.key) || [],
          records: recordsByStage.get(s.key) || [],
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          /* Sent for convenience, NOT as a stored value — the client derives
             the same answer from `tasks` and must never need this to agree. */
          progress,
          counts,
          /* The template's plan for this phase. `null` when the project has no
             template at all — which the client must say out loud rather than
             draw as a phase that was planned to take zero days. */
          plan: ts ? {
            slaDays: ts.slaDays ?? null,
            blueprintTasks: blueprint.length,
            estimatedDays: blueprint.reduce((n, bt) => n + (bt.estimatedDays || 0), 0),
            unmet,
            /* Null when the project has no planned start, or the stage no
               slaDays — the card then falls back to its tasks' dates and says
               so, rather than drawing a window out of nothing. */
            startsOn: scheduleFor.get(s.key)?.startsOn ?? null,
            endsOn: scheduleFor.get(s.key)?.endsOn ?? null,
          } : null,
          tasks: own,
        };
      });

    /* WHAT THE PROJECT IS COUNTING DOWN TO.

       The template declares its own target: a `datetime` field, which in the
       default template is Phase 12's "Launch Date & Time". Found by TYPE and
       not by key, so a template that names it something else still works and
       nothing here has to be edited when one does. If a template ever carries
       several, the one in the LATEST stage wins — a launch is the last dated
       thing in a build, not the first.

       The fallbacks run in order of how deliberate they are: a date somebody
       typed into the launch form beats the date the project was opened with,
       and neither is invented when both are missing. */
    let launch = null;
    for (const st of [...(project.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      const dt = (schemaFor.get(st.key) || []).find((f) => f.type === 'datetime');
      if (!dt) continue;
      const raw = ((project.masterData || {})[st.key] || {})[dt.key];
      if (raw) launch = { at: new Date(raw), source: 'form', label: dt.label || 'Launch', stageKey: st.key };
    }
    if (!launch && project.targetEndDate) {
      /* `targetEndDate`, NOT `targetOpeningDate`. The select on this query had
         been asking for `targetOpeningDate` for a long time and no such field
         exists on the Project model — Mongoose neither warns nor errors on a
         selected path it does not know, so it simply came back undefined every
         time and this fallback would have been dead code that always skipped.
         (`targetOpeningDate` does exist elsewhere, but as a RECORD value inside
         the Store Readiness timeline form, not as a field on the project.) */
      launch = { at: project.targetEndDate, source: 'target', label: 'Target end date', stageKey: null };
    }

    return {
      project: {
        _id: project._id,
        name: project.name,
        code: project.code,
        city: project.city,
        status: project.status,
        health: project.health,
        progress: project.progress,
        storeLiveAt: project.storeLiveAt,
        targetEndDate: project.targetEndDate,
        /* The overview now carries everything the header strip used to, so the
           two facts it owned alone travel with the tree. */
        plannedStartDate: project.plannedStartDate,
        budget: project.budget,
        /* COMPUTED HERE, not read from the model's `budgetUtilization` virtual.
           This query is `.lean()`, and lean documents carry no virtuals — the
           field would have come back undefined on every call, and "0% used"
           would have looked like a real answer. Same arithmetic as the virtual;
           see projectSchema. */
        budgetUtilization: project.budget?.planned
          ? Math.round(((project.budget.actual || 0) / project.budget.planned) * 100)
          : 0,
      },
      /* So a screen can say WHICH template it is based on — and say plainly
         that there is none, rather than drawing an empty plan. */
      template: template
        ? {
          _id: template._id,
          code: template.code,
          name: template.name,
          isDefault: !!template.isDefault,
          /* What the template says the whole build should take — the sum of
             every stage's slaDays, the same arithmetic as the model's
             estimatedDurationDays virtual (which `.lean()` cannot give us). */
          totalDays: (template.stages || []).reduce((n, ts) => n + (ts.slaDays || 0), 0),
          /* Where that plan runs out, measured from the project's planned
             start — the date the template itself implies for go-live. */
          plannedEndsOn: project.plannedStartDate
            ? new Date(new Date(project.plannedStartDate).getTime()
              + (template.stages || []).reduce((n, ts) => n + (ts.slaDays || 0), 0) * 86400000)
            : null,
          /* THE SHAPE OF THE PLAN, and only that.
             `branchOf` says a phase hangs off another and blocks nothing;
             `parallelGroup` says two phases run side by side. A project
             SNAPSHOTS its phases at creation, so every project made before
             these fields existed is silent about them — and the diagram then
             draws a branch as a link in the chain, which is a different plan
             from the one the template describes.
             Three keys per stage, deliberately: sending the template's whole
             stages array would add its schemas, task lists and checklists to
             every tree read, for three strings the client needs. */
          stages: (template.stages || []).map((ts) => ({
            key: ts.key,
            branchOf: ts.branchOf || null,
            parallelGroup: ts.parallelGroup || null,
            alsoDrawnFrom: ts.alsoDrawnFrom || [],
          })),
        }
        : null,
      launch,
      phases,
    };
  },
  /**
   * Copy an approved Project Setup form onto the project itself.
   *
   * THIS IS DATA FLOW, NOT A GATE, and it very nearly went out with the
   * gates. It lived inside completeStage's p4 branch, so deleting that
   * branch also deleted the step that puts the approved budget, opening
   * date and project manager onto the Project document — the form would
   * have been approved and the project left blank, with nothing logged.
   * Caught by 05-project-creation, which asserts the values land.
   *
   * Idempotent: approving the same form twice writes the same values.
   */
  async applyProjectSetupValues(projectId, values, userId) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    await applyProjectSetup(project, values || {}, userId);
    await project.save();
    return project;
  },

  /**
   * Open the store. The first of two one-way doors.
   *
   * Deliberately NOT derived from task state: going live is a decision a
   * person makes on a particular day, not an arithmetic consequence of the
   * last checkbox. It is stamped once — reopening work afterwards must never
   * rewrite the real opening date or re-announce the launch.
   *
   * Permission is checked here as well as at the route, because this is the
   * kind of action that acquires a second caller later.
   */
  async launchStore(projectId, userId, actor) {
    const project = await Project.findById(projectId);
    if (!project) throw ApiError.notFound('Project not found');
    if (actor && !can.decide(actor.role)) {
      throw ApiError.forbidden('Only a manager or admin can launch a store.');
    }
    if (project.status === PROJECT_STATUS.ARCHIVED) {
      throw ApiError.badRequest('This project is archived.');
    }

    const alreadyLive = Boolean(project.storeLiveAt);
    project.status = PROJECT_STATUS.STORE_LIVE;
    /* Every phase moves to the `live` lifecycle. This does NOT freeze them —
       rule 4 removed the freezing. It records which side of opening day the
       phase belongs to, which is what reports ask. */
    for (const s of project.stages || []) s.lifecycle = STAGE_LIFECYCLE.LIVE;
    if (!alreadyLive) {
      project.storeLiveAt = new Date();
      project.storeLiveBy = userId;
    }
    project.markModified('stages');
    await project.save();

    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.STATUS_CHANGED,
      actor: userId,
      message: `launched ${project.name} — the store is live`,
    });
    if (!alreadyLive) {
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
    const incompleteStages = (project.stages || []).filter((s) => phaseProgress(tasks.filter((t) => t.stageKey === s.key)) !== TASK_STATUS.COMPLETE);

    // 2. Every closure module approved, and nothing still awaiting a decision.
    //    Required modules come from THIS project's template (the shared
    //    constant is only a fallback), so archiving and p10 completion are
    //    measured against exactly the same list.
    const templateModules = (await templateAssessmentTypes(project, 'p10')).map((m) => m.key);
    const requiredModules = templateModules.length ? templateModules : CLOSURE_MODULE_VALUES;
    const missingModules = requiredModules.filter((k) => approvedOf(k).length === 0);
    const awaitingDecision = records.filter((r) => r.status === RECORD_STATUS.SUBMITTED).length;

    /* 3. Work still outstanding. `blocked` and `rejected` are gone as task
          states; anything not complete is what "still open" means now. */
    const openIssues = tasks.filter((t) => t.status !== TASK_STATUS.COMPLETE);

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

    /* THE STAGE NO LONGER CARRIES A STATUS.

       This loop used to write one, from a tangle of "all done / any blocked
       / any active" rules that had to be kept in step with completeStage's
       gates and never quite were. Progress is phaseProgress(tasks) now, and
       it is computed where it is read.

       The stage TIMESTAMPS survive, because "when did this phase actually
       start and finish" is a fact reports want and arithmetic cannot
       recover after the event. They are stamped FROM the derived progress,
       so they can never disagree with it. */
    for (const stage of project.stages) {
      const stageTasks = tasks.filter((t) => t.stageKey === stage.key);
      if (!stageTasks.length) continue;
      const progress = phaseProgress(stageTasks);
      if (progress !== TASK_STATUS.PENDING) stage.startedAt = stage.startedAt || now;
      if (progress === TASK_STATUS.COMPLETE) {
        stage.completedAt = stage.completedAt || now;
        if (userId && !stage.completedBy) stage.completedBy = userId;
      } else {
        /* Reopened by somebody setting a task back. A stale completedAt
           would make an unfinished phase read as finished in every report
           downstream — the same trap the task-level stamps had. */
        stage.completedAt = undefined;
        stage.completedBy = undefined;
      }
    }

    project.progress = total ? Math.round((doneCount / total) * 100) : 0;

    /* The first phase that is not finished — derived, like everything else. */
    const currentStage = [...project.stages]
      .sort((a, b) => a.order - b.order)
      .find((s) => phaseProgress(tasks.filter((t) => t.stageKey === s.key)) !== TASK_STATUS.COMPLETE);
    project.currentStageKey = currentStage?.key || project.stages.at(-1)?.key;

    // Lifecycle + health. Task progress hitting 100% is not enough on its own
    // to call the whole PROJECT complete — e.g. every Execution task could be
    // sitting in Waiting Approval, which already counts toward `doneCount`
    // for the progress bar but must not flip the project to Completed before
    // every stage (Execution included) has actually been marked Completed.
    const allStagesComplete = project.stages.length > 0
      && project.stages.every((s) => phaseProgress(tasks.filter((t) => t.stageKey === s.key)) === TASK_STATUS.COMPLETE);
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

  async remove(id, userId) {
    const project = await Project.findById(id);
    if (!project) throw ApiError.notFound('Project not found');
    const isDraft = project.status === PROJECT_STATUS.DRAFT;
    // Logged before deletion — Activity documents intentionally outlive the
    // Project they reference (every other action on this project already
    // left entries here too), so this is the final entry in that same trail.
    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.DELETED,
      actor: userId,
      message: isDraft ? `Draft "${project.name}" deleted` : `Project "${project.name}" deleted`,
    });
    await Project.findByIdAndDelete(id);
    // Cascade to BOTH child collections. Every collection-mode phase (p1-p4,
    // p7's module pipeline, p8/p9/p10 records) stores its data as Record
    // documents whose `project` ref is required — deleting only Tasks left
    // those Records as permanent orphans pointing at a nonexistent Project.
    // (A draft never has either, since it's never materialized — this is a
    // no-op cascade for drafts, but still correct/cheap to run.)
    await Promise.all([
      Task.deleteMany({ project: id }),
      Record.deleteMany({ project: id }),
    ]);
    return project;
  },
};

export default projectService;
