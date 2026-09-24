import { Record } from '../records/record.model.js';
import { Project } from '../projects/project.model.js';
import { recordService } from '../records/record.service.js';
import { DrawingPlan } from './drawingPlan.model.js';
import { Task } from '../tasks/task.model.js';
import { Template } from '../templates/template.model.js';
import { User } from '../../auth/auth.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { RECORD_STATUS } from '../../../core/constants/index.js';
import {
  DRAWING_CHECKLIST, DRAWING_SET_1, DRAWING_SET_2, DRAWING_STATUS_APPROVED, drawingByNo,
} from '../../../seed/drawingChecklist.js';
import { mergeDrawings } from './flow.service.js';

/**
 * The Design & Drawings FMS — a management read model OVER the same p11
 * Records and checklist master the single-project drawing checklist already
 * uses (flow.service.js#mergeDrawings), plus one small new table
 * (`DrawingPlan`) for the assignment/planned-date data no Record carries
 * until something is filed.
 *
 * Two things this module adds that flow.service.js does not need:
 *   - a rollup ACROSS every project, for the multi-project dashboard;
 *   - the write actions (assign / approve / resend) a management screen
 *     needs, layered on the existing Record/decide() machinery rather than
 *     inventing a second one.
 */

const STAGE_DRAWINGS = 'p11';
const LIVE = { $nin: [RECORD_STATUS.REJECTED, RECORD_STATUS.ARCHIVED] };
const TOTAL_DRAWINGS = DRAWING_CHECKLIST.length;

/** On Track (0 days overdue) / At Risk (1-3) / Delayed (4+). Tune here only. */
const AT_RISK_MAX_DAYS = 3;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysOverdue = (plannedDate, today) => {
  const ms = startOfDay(today) - startOfDay(plannedDate);
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
};

async function requireProject(projectId) {
  const project = await Project.findById(projectId)
    .select('name code city owner plannedStartDate targetEndDate archivedAt template')
    .populate('owner', 'name avatarColor title')
    .lean();
  if (!project) throw ApiError.notFound('Project not found');
  return project;
}

/**
 * The row a checklist row is classified into for the KPI strip — four
 * mutually-exclusive buckets that sum to the total, never a fifth overlapping
 * one. A drawing already filed (Submitted for review or Approved) is "on
 * time" regardless of what happens to it next; only an un-filed drawing past
 * its planned date is "delayed".
 */
export function classifyDrawing(row, plan, today = new Date()) {
  if (row.status === DRAWING_STATUS_APPROVED || row.status === 'Submitted for review') return 'submitted';
  if (plan?.plannedDate && daysOverdue(plan.plannedDate, today) > 0) return 'delayed';
  if (row.status === 'In progress') return 'in_progress';
  return 'pending';
}

/**
 * A project's Design & Drawings health, from its own checklist rows — never
 * from generic task due-dates. `delayDays` is how far overdue the OLDEST
 * still-unapproved, past-due drawing is; 0 rows overdue is On Track.
 */
export function projectHealth(rows, plansByNo, today = new Date()) {
  let delayDays = 0;
  for (const r of rows) {
    if (r.status === DRAWING_STATUS_APPROVED) continue;
    const plan = plansByNo.get(r.no);
    if (!plan?.plannedDate) continue;
    delayDays = Math.max(delayDays, daysOverdue(plan.plannedDate, today));
  }
  /* Same three values as PROJECT_HEALTH/HEALTH_META (core/constants,
     client/lib/ui.js) — not that enum's value (this is Design & Drawings'
     own health, computed from checklist planned dates, not task due dates),
     just the same vocabulary so the client can reuse HealthBadge unchanged. */
  const status = delayDays === 0 ? 'on_track' : delayDays <= AT_RISK_MAX_DAYS ? 'at_risk' : 'delayed';
  return { status, delayDays };
}

/** Which phase task owns each half of the checklist. */
const SET_TASK_KEY = { 1: 'p11_draw', 2: 'p11_draw2' };

/**
 * The doer and the buddy, named the way the template page names them.
 *
 * `assignees` holds ROSTER ids ("emp-prj-002", "MR-04") while `assigneeRefs`
 * holds the resolved Users in the same order, so the two zip by position;
 * `primaryAssignee` / `backupAssignee` then say which is which. Taking
 * `assigneeRefs[0]` and `[1]` positionally instead is right only by accident —
 * it reported the BUDDY as a second doer, which is the opposite of what a
 * buddy is: the person who picks the task up when the doer cannot.
 */
function doerAndBuddy(task, usersById) {
  const refs = (task?.assigneeRefs || []).map((id) => usersById.get(String(id)));
  const roster = task?.assignees || [];
  const byRoster = new Map();
  refs.forEach((user, idx) => { if (user && roster[idx]) byRoster.set(String(roster[idx]), user); });
  const pick = (id) => (id ? byRoster.get(String(id)) || null : null);

  const present = refs.filter(Boolean);
  const doer = pick(task?.primaryAssignee) || present[0] || null;
  const buddy = pick(task?.backupAssignee) || null;
  const taken = new Set([doer, buddy].filter(Boolean).map((u) => String(u._id)));
  return { doer, buddy, others: present.filter((u) => !taken.has(String(u._id))) };
}

/**
 * What the template and the project's own phase tasks ALREADY say about these
 * drawings — who is on them, who the flow holds responsible, how long the
 * phase allows and how urgent it is.
 *
 * This is the answer to "why is the whole table blank?": the plan was never
 * missing, it just lives one level up. A `DrawingPlan` is an override for a
 * single drawing; with no override a row inherits its half of the checklist's
 * task, so editing the template or reassigning the phase task moves all 29 (or
 * 8) rows at once and nothing has to be typed in per drawing.
 *
 * Template first for plan-days, priority and the responsible role (design-time
 * facts); the live Task first for the people and the date (what actually
 * happened to THIS project).
 */
function buildTaskPlan(tasks, templateStage, usersById) {
  const byKey = new Map(tasks.map((t) => [t.templateTaskKey, t]));
  const tplByKey = new Map((templateStage?.tasks || []).map((t) => [t.key, t]));

  const entryFor = (key) => {
    const task = byKey.get(key) || null;
    const tpl = tplByKey.get(key) || null;
    if (!task && !tpl) return null;
    const { doer, buddy, others } = doerAndBuddy(task, usersById);
    return {
      key,
      taskId: task?._id || null,
      taskTitle: task?.title || tpl?.title || null,
      assignedTo: doer,
      buddy,
      alsoAssigned: others,
      plannedDate: task?.plannedEnd || null,
      planDays: tpl?.estimatedDays ?? null,
      responsibleRole: tpl?.brief?.who || task?.brief?.who || null,
    };
  };

  const bySet = {};
  for (const [set, key] of Object.entries(SET_TASK_KEY)) {
    const entry = entryFor(key);
    if (entry) bySet[set] = entry;
  }
  return { bySet };
}

/**
 * The plan a row actually runs on: its own override where one exists, the
 * phase task's underneath.
 *
 * Deliberately the single source for the table, `classifyDrawing` AND
 * `projectHealth` — if a row DISPLAYS a planned date it inherited, that date
 * has to be the one the delay maths uses, or the dashboard calls a project On
 * Track while the table shows it three days past due.
 */
function effectivePlan(row, plan, defaults) {
  const d = defaults[String(row.set)] || null;
  return {
    assignedTo: plan?.assignedTo || d?.assignedTo || null,
    designerOwner: plan?.designerOwner || null,
    plannedDate: plan?.plannedDate || d?.plannedDate || null,
    plannedTime: plan?.plannedTime || null,
    notes: plan?.notes || null,
    planDays: d?.planDays ?? null,
    responsibleRole: d?.responsibleRole || null,
    alsoAssigned: plan?.assignedTo ? [] : (d?.alsoAssigned || []),
    /* The stand-in, kept separate from the doers: a drawing with a named doer
       and no buddy is exactly the one that stalls when that person is away. */
    buddy: plan?.assignedTo ? null : (d?.buddy || null),
    fromTask: d?.taskTitle || null,
    /* Which values are the phase task's rather than this drawing's own, so the
       table can say so instead of passing inherited data off as a decision
       somebody made about drawing #14. */
    inherited: {
      assignedTo: !plan?.assignedTo && !!d?.assignedTo,
      plannedDate: !plan?.plannedDate && !!d?.plannedDate,
    },
  };
}

/** Every user named by these tasks, in one lookup — assignee lists hold ids as strings. */
async function usersForTasks(tasks) {
  const ids = new Set();
  /* Only `assigneeRefs` — `assignees`/`primaryAssignee`/`backupAssignee` hold
     ROSTER ids, which are not User ids and must be zipped, not looked up. */
  for (const t of tasks) for (const id of t.assigneeRefs || []) ids.add(String(id));
  const valid = [...ids].filter((id) => /^[0-9a-fA-F]{24}$/.test(id));
  if (!valid.length) return new Map();
  const users = await User.find({ _id: { $in: valid } }).select('name avatarColor').lean();
  return new Map(users.map((u) => [String(u._id), { _id: u._id, name: u.name, avatarColor: u.avatarColor }]));
}

/** The p11 stage of a template, with only the task fields the defaults need. */
async function drawingStageOf(templateRef) {
  if (!templateRef) return null;
  const tpl = await Template.findById(templateRef).select('stages.key stages.tasks').lean();
  return tpl?.stages?.find((st) => st.key === STAGE_DRAWINGS) || null;
}

const phaseCount = (rows, set) => ({
  approved: rows.filter((r) => r.set === set && r.approved).length,
  total: set === 1 ? DRAWING_SET_1.length : DRAWING_SET_2.length,
});

/** One project's full rollup — the row the dashboard table renders, plus its progress. */
function summariseProject(project, rows, plansByNo, today) {
  const approvedTotal = rows.filter((r) => r.approved).length;
  const phase1 = phaseCount(rows, 1);
  const phase2 = phaseCount(rows, 2);
  return {
    id: project._id,
    name: project.name,
    code: project.code,
    status: project.status,
    location: project.city || null,
    manager: project.owner ? { id: project.owner._id, name: project.owner.name, avatarColor: project.owner.avatarColor } : null,
    startDate: project.plannedStartDate || null,
    targetDate: project.targetEndDate || null,
    overallProgress: Math.round((approvedTotal / TOTAL_DRAWINGS) * 100),
    phase1,
    phase2,
    phase3: { approved: approvedTotal, total: TOTAL_DRAWINGS },
    /* Which of the three the project is actually working through right now —
       Phase 1 waits on nothing, Phase 2 opens once Set 1 is fully approved,
       Phase 3 ("Approved Designs") is reached once every one of the 37 is. */
    currentPhase: phase1.approved < phase1.total ? 1 : phase2.approved < phase2.total ? 2 : 3,
    health: projectHealth(rows, plansByNo, today),
  };
}

/** All `p11` records across every project, grouped by project id string. */
async function allDrawingRecordsByProject() {
  const records = await Record.find({ stageKey: STAGE_DRAWINGS, status: LIVE })
    .select('project values status submittedAt submittedBy approvedBy approvedAt rejectedAt rejectReason updatedAt')
    /* Populated portfolio-wide because the breakdown pages name the person,
       not the id — and a Record only exists once something was actually
       filed, so this is a handful of docs, not one per checklist row. */
    .populate('submittedBy', 'name avatarColor')
    .populate('approvedBy', 'name avatarColor')
    .lean();
  const byProject = new Map();
  for (const r of records) {
    const key = String(r.project);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(r);
  }
  return byProject;
}

/** All `DrawingPlan` docs across every project, grouped by `${project}:${drawingNo}`. */
async function allPlansByProject(projectIds) {
  const plans = await DrawingPlan.find({ project: { $in: projectIds } })
    .populate('assignedTo', 'name avatarColor')
    .populate('designerOwner', 'name avatarColor')
    .lean();
  const byProject = new Map();
  for (const p of plans) {
    const key = String(p.project);
    if (!byProject.has(key)) byProject.set(key, new Map());
    byProject.get(key).set(p.drawingNo, p);
  }
  return byProject;
}

/**
 * Task/template defaults for every project at once — two queries and one user
 * lookup for the whole portfolio, not three per project.
 */
async function allTaskDefaultsByProject(projects) {
  const projectIds = projects.map((p) => p._id);
  const tasks = await Task.find({
    project: { $in: projectIds },
    stageKey: STAGE_DRAWINGS,
    templateTaskKey: { $in: Object.values(SET_TASK_KEY) },
  }).select('project templateTaskKey title assignees assigneeRefs primaryAssignee backupAssignee plannedEnd priority brief').lean();

  const templateRefs = [...new Set(
    projects.map((p) => p.template?.ref).filter(Boolean).map(String),
  )];
  const templates = templateRefs.length
    ? await Template.find({ _id: { $in: templateRefs } }).select('stages.key stages.tasks').lean()
    : [];
  const stageByTemplate = new Map(templates.map((t) => [
    String(t._id), t.stages?.find((st) => st.key === STAGE_DRAWINGS) || null,
  ]));

  const usersById = await usersForTasks(tasks);
  const tasksByProject = new Map();
  for (const t of tasks) {
    const key = String(t.project);
    if (!tasksByProject.has(key)) tasksByProject.set(key, []);
    tasksByProject.get(key).push(t);
  }

  return new Map(projects.map((p) => [
    String(p._id),
    buildTaskPlan(
      tasksByProject.get(String(p._id)) || [],
      stageByTemplate.get(String(p.template?.ref)) || null,
      usersById,
    ).bySet,
  ]));
}

/**
 * The multi-project dashboard: org-wide KPI totals + one row per project.
 *
 * One pass over every Project/Record/DrawingPlan rather than a query per
 * project — the same "fetch once, group in memory" shape DataExplorerPage.jsx
 * already uses client-side, done here so a 12-project portfolio costs 3
 * queries instead of 36.
 */
export async function getFmsOverview() {
  const today = new Date();
  const portfolio = await loadPortfolio();

  const buckets = { submitted: 0, in_progress: 0, pending: 0, delayed: 0 };
  const rows = portfolio.map(({ project, rows: drawings, plansByNo }) => {
    for (const r of drawings) buckets[classifyDrawing(r, plansByNo.get(r.no), today)] += 1;
    return summariseProject(project, drawings, plansByNo, today);
  });

  return {
    totals: {
      projects: portfolio.length,
      drawings: portfolio.length * TOTAL_DRAWINGS,
      submitted: buckets.submitted,
      inProgress: buckets.in_progress,
      pending: buckets.pending,
      delayed: buckets.delayed,
    },
    projects: rows,
  };
}

/** One project's full 37-row table, each row merged with its DrawingPlan. */
export async function getFmsProject(projectId) {
  const today = new Date();
  const project = await requireProject(projectId);

  const [records, plans, tasks, stage] = await Promise.all([
    Record.find({ project: projectId, stageKey: STAGE_DRAWINGS, status: LIVE })
      .populate('approvedBy', 'name avatarColor')
      .populate('submittedBy', 'name avatarColor')
      .lean(),
    DrawingPlan.find({ project: projectId })
      .populate('assignedTo', 'name avatarColor')
      .populate('designerOwner', 'name avatarColor')
      .lean(),
    Task.find({ project: projectId, stageKey: STAGE_DRAWINGS })
      .select('templateTaskKey title assignees assigneeRefs primaryAssignee backupAssignee plannedEnd priority brief')
      .lean(),
    drawingStageOf(project.template?.ref),
  ]);

  const plan = buildTaskPlan(tasks, stage, await usersForTasks(tasks));
  const defaults = plan.bySet;
  const drawingPlansByNo = new Map(plans.map((p) => [p.drawingNo, p]));

  /* The effective plan — the row's own override over its phase task's — is
     built ONCE and then used for display, for the KPI buckets and for health,
     so the three can never disagree about when a drawing was due. */
  const plansByNo = new Map();
  const rows = mergeDrawings(records).map((r) => {
    const plan = effectivePlan(r, drawingPlansByNo.get(r.no) || null, defaults);
    plansByNo.set(r.no, plan);
    return {
      ...r,
      ...plan,
      linkGenerated: false, // submission links are follow-up work — never fabricated
      bucket: classifyDrawing(r, plan, today),
    };
  });

  const approvedTotal = rows.filter((r) => r.approved).length;
  /* A "resend" reads as: the reviewer sent it back, and it has not yet come
     back in for review again. Once it is resubmitted the architect moves it
     to "Submitted for review" themselves, which clears this. */
  const resendCount = rows.filter((r) => r.rejectReason && r.status === 'In progress').length;

  return {
    project,
    rows,
    /* What the template and the phase tasks already decided, said ONCE at the
       top instead of only as a muted hint repeated down 37 rows. This is the
       plan the rows inherit — seeing it is how a reader knows the table is
       driven by the template rather than waiting to be filled in by hand. */
    stats: {
      overallProgress: Math.round((approvedTotal / TOTAL_DRAWINGS) * 100),
      phase1: phaseCount(rows, 1),
      phase2: phaseCount(rows, 2),
      phase3: { approved: approvedTotal, total: TOTAL_DRAWINGS },
      approved: approvedTotal,
      pending: rows.filter((r) => r.status === 'Not started').length,
      resend: resendCount,
      delayed: rows.filter((r) => r.bucket === 'delayed').length,
      health: projectHealth(rows, plansByNo, today),
    },
  };
}

function requireDrawing(drawingNo) {
  const drawing = drawingByNo(drawingNo);
  if (!drawing) throw ApiError.badRequest(`There is no drawing #${drawingNo} on the 37-drawing checklist.`);
  return drawing;
}

/** Upserts the assignment/plan for one checklist row. Never bulk-created. */
export async function assignDrawing({
  projectId, drawingNo, assignedTo, designerOwner, plannedDate, plannedTime, notes, actorId,
}) {
  requireDrawing(drawingNo);
  await requireProject(projectId);

  const plan = await DrawingPlan.findOneAndUpdate(
    { project: projectId, drawingNo: Number(drawingNo) },
    {
      $set: {
        assignedTo: assignedTo || null,
        designerOwner: designerOwner || null,
        plannedDate: plannedDate || null,
        plannedTime: plannedTime || null,
        notes: notes || null,
        updatedBy: actorId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
    .populate('assignedTo', 'name avatarColor')
    .populate('designerOwner', 'name avatarColor');

  return plan;
}

/** The Record that IS this drawing's current live evidence — the one `mergeDrawings` picked. */
async function currentRecordFor(projectId, drawingNo) {
  const drawing = requireDrawing(drawingNo);
  const records = await Record.find({
    project: projectId, stageKey: STAGE_DRAWINGS, status: LIVE, 'values.checklist_drawing': drawing.name,
  });
  if (!records.length) throw ApiError.notFound(`Nothing has been filed yet against "${drawing.name}" — there is nothing to act on.`);
  records.sort((a, b) => Number(b.values?.revision_no || 0) - Number(a.values?.revision_no || 0));
  return records[0];
}

/**
 * APPROVE — the only path that may ever mark a checklist row Approved.
 * Reuses the existing, already-audited decide() rather than a second
 * approval mechanism; role enforcement is the route's `authorize(...CAN_MANAGE)`.
 */
export async function approveDrawing({
  projectId, drawingNo, actorId, actor,
}) {
  const record = await currentRecordFor(projectId, drawingNo);
  await recordService.decide(record._id, 'approve', undefined, actorId, undefined, actor);
  return getFmsProject(projectId);
}

/**
 * RESEND — sends a submitted drawing back for changes.
 *
 * Deliberately NOT `decide('reject')`: a rejected Record is excluded from the
 * checklist's live view (`LIVE` above, same rule flow.service.js uses), which
 * would make the row fall back to whatever the next revision is — or to "Not
 * started" if this was the only one — instead of "In progress". A resend
 * must keep this submission as the row's live evidence while sending it back,
 * so it stamps the rejection directly on the record without changing its
 * enum `status`.
 */
export async function resendDrawing({
  projectId, drawingNo, reason, actorId,
}) {
  if (!reason?.trim()) throw ApiError.badRequest('Say what needs to change before resending this drawing.');
  const record = await currentRecordFor(projectId, drawingNo);
  if (record.status !== RECORD_STATUS.SUBMITTED) {
    throw ApiError.badRequest('Only a drawing that is currently Submitted for review can be resent.');
  }

  const now = new Date();
  record.rejectedBy = actorId;
  record.rejectedAt = now;
  record.rejectReason = reason.trim();
  record.decidedBy = actorId;
  record.decidedAt = now;
  record.values = { ...record.values, checklist_status: 'In progress' };
  record.markModified('values');
  record.updatedBy = actorId;
  record.decisionHistory.push({
    decision: 'reject', fromStatus: record.status, toStatus: record.status, by: actorId, at: now, reason: reason.trim(),
  });
  await record.save();

  return getFmsProject(projectId);
}

/** Every revision ever filed against this checklist row — never destroyed, oldest first. */
export async function getDrawingRevisions({ projectId, drawingNo }) {
  const drawing = requireDrawing(drawingNo);
  const records = await Record.find({
    project: projectId, stageKey: STAGE_DRAWINGS, 'values.checklist_drawing': drawing.name,
  })
    .populate('submittedBy', 'name avatarColor')
    .populate('approvedBy', 'name avatarColor')
    .populate('rejectedBy', 'name avatarColor')
    .sort({ createdAt: 1 })
    .lean();

  return records.map((r) => ({
    id: r._id,
    revision: Number(r.values?.revision_no) || null,
    status: r.status === RECORD_STATUS.APPROVED ? DRAWING_STATUS_APPROVED : (r.values?.checklist_status || 'Not started'),
    submittedAt: r.submittedAt || r.createdAt,
    submittedBy: r.submittedBy || null,
    approvedBy: r.approvedBy || null,
    approvedAt: r.approvedAt || null,
    rejectedBy: r.rejectedBy || null,
    rejectedAt: r.rejectedAt || null,
    rejectReason: r.rejectReason || null,
    remarks: r.values?.remarks || null,
    files: Array.isArray(r.values?.drawing_file)
      ? r.values.drawing_file.map((f) => ({
        url: f?.url,
        name: f?.originalName || f?.name || 'file',
        mime: f?.mimetype || null,
        bytes: f?.bytes ?? null,
      })).filter((f) => f.url)
      : [],
  }));
}

/* ── the breakdown behind each KPI card ──────────────────────────────── */

/**
 * Every project's checklist rows, each with the plan it actually runs on.
 *
 * The KPI strip and the page you reach by clicking a KPI card have to agree to
 * the row — a card reading 1,030 Pending over a page that lists 1,028 is worse
 * than no page at all. They agree because they are one computation: this is
 * the only place the portfolio is assembled, and both callers bucket rows off
 * the `plansByNo` it hands back.
 */
async function loadPortfolio() {
  const projects = await Project.find({ archivedAt: null })
    .select('name code city status owner plannedStartDate targetEndDate template')
    .populate('owner', 'name avatarColor title')
    .sort({ name: 1 })
    .lean();
  const projectIds = projects.map((p) => p._id);

  const [recordsByProject, plansByProject, defaultsByProject] = await Promise.all([
    allDrawingRecordsByProject(),
    allPlansByProject(projectIds),
    allTaskDefaultsByProject(projects),
  ]);

  return projects.map((project) => {
    const key = String(project._id);
    const rows = mergeDrawings(recordsByProject.get(key) || []);
    const own = plansByProject.get(key) || new Map();
    const defaults = defaultsByProject.get(key) || {};
    /* Inherit here too. A rollup that ignored the phase task's dates would
       report On Track for a project whose own table shows it overdue. */
    const plansByNo = new Map(
      rows.map((r) => [r.no, effectivePlan(r, own.get(r.no) || null, defaults)]),
    );
    return { project, rows, plansByNo };
  });
}

/**
 * The six KPI cards, and what each one is a count OF.
 *
 * Declared once, here, because the card, its page title and the rows the page
 * lists all have to mean the same thing. `bucket` is the value
 * `classifyDrawing` returns, so a metric cannot drift away from the number on
 * its own card.
 */
export const FMS_METRICS = Object.freeze({
  projects: {
    kind: 'project',
    title: 'Total Projects',
    blurb: 'Every ongoing project, and how far each one has got through its 37-drawing checklist.',
  },
  drawings: {
    kind: 'drawing',
    title: 'Total Drawings',
    blurb: 'Every checklist row on every project — the 37-drawing master, once per project.',
  },
  submitted: {
    kind: 'drawing',
    bucket: 'submitted',
    title: 'Submitted',
    blurb: 'Filed for review or already approved. Once a drawing is in, it stays counted here whatever happens to it next.',
  },
  inProgress: {
    kind: 'drawing',
    bucket: 'in_progress',
    title: 'In Progress',
    blurb: 'Being drawn now — started, not yet filed, and not past its planned date.',
  },
  pending: {
    kind: 'drawing',
    bucket: 'pending',
    title: 'Pending',
    blurb: 'Not started, and not yet past its planned date. Nothing is late here — these are simply not due.',
  },
  delayed: {
    kind: 'drawing',
    bucket: 'delayed',
    title: 'Delayed',
    blurb: 'Past its planned date and still not filed. Every row here is holding something up.',
  },
});

/** One checklist row, flattened with the project it belongs to. */
function flatDrawingRow(project, row, plan, bucket, today) {
  return {
    key: `${project._id}:${row.no}`,
    projectId: project._id,
    projectName: project.name,
    projectCode: project.code || null,
    location: project.city || null,
    manager: project.owner
      ? { id: project.owner._id, name: project.owner.name, avatarColor: project.owner.avatarColor }
      : null,

    no: row.no,
    name: row.name,
    category: row.category,
    set: row.set,
    setLabel: row.setLabel,
    blocksBoq: row.blocksBoq,

    status: row.status,
    approved: row.approved,
    bucket,
    revision: row.revision,
    revisions: row.revisions,
    recordId: row.recordId,
    files: row.files?.length || 0,

    assignedTo: plan.assignedTo,
    buddy: plan.buddy,
    designerOwner: plan.designerOwner,
    plannedDate: plan.plannedDate,
    plannedTime: plan.plannedTime,
    responsibleRole: plan.responsibleRole,
    fromTask: plan.fromTask,
    inherited: plan.inherited,
    /* How late, in whole days, and 0 when it is not. The card's own maths —
       never recomputed on the client, where a different timezone would put a
       row one day out from the number that sent you to the page. */
    daysOverdue: plan.plannedDate ? daysOverdue(plan.plannedDate, today) : 0,

    submittedAt: row.submittedAt,
    submittedBy: row.submittedBy,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    rejectedAt: row.rejectedAt,
    rejectReason: row.rejectReason,
    remarks: row.remarks,
    updatedAt: row.updatedAt,
  };
}

/**
 * `[{ label, value, count }]` for a group-by, biggest first.
 *
 * `value` is what the group FILTERS on and `label` is what it reads as — an id
 * for a project or a person, the text itself for a category. Kept apart
 * because two people can share a name and a renamed project must not silently
 * stop matching the rows it was grouping.
 */
function tally(rows, pick) {
  const counts = new Map();
  for (const r of rows) {
    const hit = pick(r);
    if (!hit || hit.label == null || hit.label === '') continue;
    const key = String(hit.value ?? hit.label);
    const cur = counts.get(key) || { label: hit.label, value: hit.value ?? hit.label, count: 0 };
    cur.count += 1;
    counts.set(key, cur);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

/**
 * The yes/no facts about a drawing that the fact tiles count.
 *
 * Each tile on the breakdown page is one of these, so clicking "251 with
 * nobody on them" filters by exactly the predicate that produced the 251 —
 * the number and the list it opens cannot drift apart, because they are the
 * same function.
 */
const DRAWING_FLAGS = {
  owner: { label: 'has an owner', test: (r) => !!r.assignedTo },
  unassigned: { label: 'nobody assigned', test: (r) => !r.assignedTo },
  dated: { label: 'has a planned date', test: (r) => !!r.plannedDate },
  undated: { label: 'no planned date', test: (r) => !r.plannedDate },
  overdue: { label: 'past its planned date', test: (r) => r.daysOverdue > 0 },
  approved: { label: 'approved', test: (r) => r.approved },
  awaiting: { label: 'awaiting review', test: (r) => r.status === 'Submitted for review' },
  sentback: { label: 'sent back to the designer', test: (r) => !!r.rejectReason && r.status === 'In progress' },
  boq: { label: 'blocks the BOQ', test: (r) => r.blocksBoq },
};

const PROJECT_FLAGS = {
  on_track: { label: 'On Track', test: (p) => p.health.status === 'on_track' },
  at_risk: { label: 'At Risk', test: (p) => p.health.status === 'at_risk' },
  delayed: { label: 'Delayed', test: (p) => p.health.status === 'delayed' },
  phase1: { label: 'on Phase 1', test: (p) => p.currentPhase === 1 },
  phase2: { label: 'on Phase 2', test: (p) => p.currentPhase === 2 },
  phase3: { label: 'all 37 approved', test: (p) => p.currentPhase === 3 },
};

const DRAWING_SORTS = {
  project: (a, b) => a.projectName.localeCompare(b.projectName) || a.no - b.no,
  drawing: (a, b) => a.no - b.no || a.projectName.localeCompare(b.projectName),
  status: (a, b) => a.status.localeCompare(b.status) || a.projectName.localeCompare(b.projectName),
  /* Undated rows sort LAST whichever way the column is pointed — "no date" is
     not an early date, and floating 1,000 blanks to the top of a queue sorted
     by due date hides the handful of rows that actually have one. */
  planned: (a, b) => (a.plannedDate ? new Date(a.plannedDate) : Infinity)
    - (b.plannedDate ? new Date(b.plannedDate) : Infinity),
  overdue: (a, b) => b.daysOverdue - a.daysOverdue || a.projectName.localeCompare(b.projectName),
  updated: (a, b) => (b.updatedAt ? new Date(b.updatedAt) : 0) - (a.updatedAt ? new Date(a.updatedAt) : 0),
};

const PROJECT_SORTS = {
  project: (a, b) => a.name.localeCompare(b.name),
  progress: (a, b) => b.overallProgress - a.overallProgress || a.name.localeCompare(b.name),
  delayed: (a, b) => b.counts.delayed - a.counts.delayed || a.name.localeCompare(b.name),
  target: (a, b) => (a.targetDate ? new Date(a.targetDate) : Infinity)
    - (b.targetDate ? new Date(b.targetDate) : Infinity),
  health: (a, b) => b.health.delayDays - a.health.delayDays || a.name.localeCompare(b.name),
};

/** Case-insensitive "does any of these fields contain the search text". */
const matches = (q, ...fields) => {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return fields.some((f) => f && String(f).toLowerCase().includes(needle));
};

/**
 * What is behind one KPI card: the rows it counted, grouped, sorted and paged.
 *
 * Rows are filtered and paged in memory rather than in Mongo, deliberately. A
 * checklist row is not a document — 1,032 of the 1,036 rows on this page have
 * no Record at all until somebody files against them (flow.service.js#
 * mergeDrawings materialises them from the master), so there is nothing to
 * `$match` on. The portfolio is 3 queries and a few thousand small objects;
 * paging it here is what lets a "Pending" row that exists only as a checklist
 * entry appear on the page at all.
 *
 * EVERY FILTER IS ALSO A THING YOU CAN CLICK. The fact tiles and the group
 * bars on the page are each one of these parameters, so a count and the list
 * it opens are produced by the same predicate rather than by two pieces of
 * code that agree until one of them is edited.
 */
export async function getFmsBreakdown({
  metric, page = 1, limit = 25, sort, dir = 'asc', q,
  projectId, set, category, status, owner, flag,
  location, manager, projectStatus,
} = {}) {
  const meta = FMS_METRICS[metric];
  if (!meta) throw ApiError.badRequest(`There is no "${metric}" card on the Design & Drawings dashboard.`);

  const today = new Date();
  const portfolio = await loadPortfolio();

  /* The whole KPI strip travels with every breakdown, so the page can show
     which card you came from IN CONTEXT of the other five rather than as a
     number floating on its own. */
  const buckets = { submitted: 0, in_progress: 0, pending: 0, delayed: 0 };
  for (const { rows, plansByNo } of portfolio) {
    for (const r of rows) buckets[classifyDrawing(r, plansByNo.get(r.no), today)] += 1;
  }
  const totals = {
    projects: portfolio.length,
    drawings: portfolio.length * TOTAL_DRAWINGS,
    submitted: buckets.submitted,
    inProgress: buckets.in_progress,
    pending: buckets.pending,
    delayed: buckets.delayed,
  };

  const projectOptions = portfolio.map(({ project }) => ({
    id: project._id, name: project.name, code: project.code || null,
  }));
  const projectName = (id) => projectOptions.find((p) => String(p.id) === String(id))?.name || 'that project';

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(200, Math.max(5, Number(limit) || 25));
  const slice = (all) => all.slice((pageNum - 1) * perPage, (pageNum - 1) * perPage + perPage);

  /* Every active filter said back in words, so the page can show what a click
     just did as a chip you can take off again. A filter you cannot see is a
     page that looks like it has lost rows. */
  const applied = [];
  const say = (key, label) => applied.push({ key, label });

  if (meta.kind === 'project') {
    const all = portfolio
      .map(({ project, rows, plansByNo }) => {
        const counts = { submitted: 0, in_progress: 0, pending: 0, delayed: 0 };
        for (const r of rows) counts[classifyDrawing(r, plansByNo.get(r.no), today)] += 1;
        return {
          ...summariseProject(project, rows, plansByNo, today),
          /* The same four buckets as the KPI strip, per project — this is the
             answer to "which of the 28 is the 1,030 actually in?". */
          counts: { ...counts, inProgress: counts.in_progress },
          /* The one row holding this project up, named. A count says a project
             is late; this says what to go and chase. */
          worstDrawing: rows
            .filter((r) => !r.approved && plansByNo.get(r.no)?.plannedDate)
            .map((r) => ({ no: r.no, name: r.name, days: daysOverdue(plansByNo.get(r.no).plannedDate, today) }))
            .filter((r) => r.days > 0)
            .sort((a, b) => b.days - a.days)[0] || null,
        };
      })
      .filter((p) => {
        if (projectId && String(p.id) !== String(projectId)) return false;
        if (location && p.location !== location) return false;
        if (manager && String(p.manager?.id) !== String(manager)) return false;
        if (projectStatus && p.status !== projectStatus) return false;
        if (flag && !(PROJECT_FLAGS[flag]?.test(p) ?? true)) return false;
        return matches(q, p.name, p.code, p.location, p.manager?.name);
      });

    if (q) say('q', `matching "${q}"`);
    if (projectId) say('projectId', projectName(projectId));
    if (location) say('location', `in ${location}`);
    if (manager) say('manager', `managed by ${all[0]?.manager?.name || 'that manager'}`);
    if (projectStatus) say('projectStatus', `status: ${projectStatus}`);
    if (flag && PROJECT_FLAGS[flag]) say('flag', PROJECT_FLAGS[flag].label);

    all.sort(PROJECT_SORTS[sort] || PROJECT_SORTS.project);
    if (dir === 'desc') all.reverse();

    return {
      metric, title: meta.title, blurb: meta.blurb, kind: meta.kind,
      totals, projectOptions, applied, page: pageNum, limit: perPage,
      total: all.length,
      rows: slice(all),
      summary: {
        projects: all.length,
        onTrack: all.filter(PROJECT_FLAGS.on_track.test).length,
        atRisk: all.filter(PROJECT_FLAGS.at_risk.test).length,
        delayed: all.filter(PROJECT_FLAGS.delayed.test).length,
        avgProgress: all.length
          ? Math.round(all.reduce((n, p) => n + p.overallProgress, 0) / all.length) : 0,
        phase1: all.filter(PROJECT_FLAGS.phase1.test).length,
        phase2: all.filter(PROJECT_FLAGS.phase2.test).length,
        phase3: all.filter(PROJECT_FLAGS.phase3.test).length,
      },
      groups: {
        byLocation: tally(all, (p) => (p.location ? { label: p.location, value: p.location } : null)),
        byManager: tally(all, (p) => (p.manager ? { label: p.manager.name, value: String(p.manager.id) } : null)),
        byStatus: tally(all, (p) => (p.status ? { label: p.status, value: p.status } : null)),
      },
    };
  }

  const wanted = meta.bucket;
  const all = [];
  for (const { project, rows, plansByNo } of portfolio) {
    if (projectId && String(project._id) !== String(projectId)) continue;
    for (const row of rows) {
      const plan = plansByNo.get(row.no);
      const bucket = classifyDrawing(row, plan, today);
      if (wanted && bucket !== wanted) continue;
      if (set && Number(set) !== row.set) continue;
      if (category && row.category !== category) continue;
      if (status && row.status !== status) continue;

      const flat = flatDrawingRow(project, row, plan, bucket, today);
      /* `none` is a real answer, not a missing one: "which of these has nobody
         on them" is the question the Owner group exists to answer. */
      if (owner && (owner === 'none' ? !!flat.assignedTo : String(flat.assignedTo?._id) !== String(owner))) continue;
      if (flag && !(DRAWING_FLAGS[flag]?.test(flat) ?? true)) continue;
      if (!matches(q, project.name, project.code, row.name, row.category, plan.assignedTo?.name)) continue;
      all.push(flat);
    }
  }

  if (q) say('q', `matching "${q}"`);
  if (projectId) say('projectId', projectName(projectId));
  if (set) say('set', `Set ${set}`);
  if (category) say('category', category);
  if (status) say('status', status);
  if (owner) say('owner', owner === 'none' ? 'nobody assigned' : `owned by ${all[0]?.assignedTo?.name || 'that person'}`);
  if (flag && DRAWING_FLAGS[flag]) say('flag', DRAWING_FLAGS[flag].label);

  all.sort(DRAWING_SORTS[sort] || (wanted === 'delayed' ? DRAWING_SORTS.overdue : DRAWING_SORTS.project));
  if (dir === 'desc') all.reverse();

  return {
    metric, title: meta.title, blurb: meta.blurb, kind: meta.kind,
    totals, projectOptions, applied, page: pageNum, limit: perPage,
    total: all.length,
    rows: slice(all),
    summary: {
      drawings: all.length,
      projects: new Set(all.map((r) => String(r.projectId))).size,
      set1: all.filter((r) => r.set === 1).length,
      set2: all.filter((r) => r.set === 2).length,
      /* Set 1 is the 29 the BOQ waits for, so "how many of these are holding
         up ordering" is a different and more urgent number than the total. */
      blocksBoq: all.filter(DRAWING_FLAGS.boq.test).length,
      assigned: all.filter(DRAWING_FLAGS.owner.test).length,
      unassigned: all.filter(DRAWING_FLAGS.unassigned.test).length,
      dated: all.filter(DRAWING_FLAGS.dated.test).length,
      undated: all.filter(DRAWING_FLAGS.undated.test).length,
      overdue: all.filter(DRAWING_FLAGS.overdue.test).length,
      worstOverdue: all.reduce((n, r) => Math.max(n, r.daysOverdue), 0),
      approved: all.filter(DRAWING_FLAGS.approved.test).length,
      awaitingReview: all.filter(DRAWING_FLAGS.awaiting.test).length,
      sentBack: all.filter(DRAWING_FLAGS.sentback.test).length,
    },
    groups: {
      byProject: tally(all, (r) => ({ label: r.projectName, value: String(r.projectId) })),
      byCategory: tally(all, (r) => ({ label: r.category, value: r.category })),
      byStatus: tally(all, (r) => ({ label: r.status, value: r.status })),
      byOwner: tally(all, (r) => (r.assignedTo
        ? { label: r.assignedTo.name, value: String(r.assignedTo._id) }
        : { label: 'Nobody assigned', value: 'none' })),
    },
  };
}

export const designDrawingsFmsService = {
  getFmsOverview,
  getFmsBreakdown,
  getFmsProject,
  assignDrawing,
  approveDrawing,
  resendDrawing,
  getDrawingRevisions,
  classifyDrawing,
  projectHealth,
};

export default designDrawingsFmsService;
