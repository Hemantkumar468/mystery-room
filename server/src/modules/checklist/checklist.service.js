import { ChecklistMaster, ChecklistTask, ChecklistSite } from './checklist.model.js';
import { generateOccurrences, defaultEndKey } from './checklist.recurrence.js';
import { scopeService } from '../org/scope.service.js';
import { holidayService } from '../org/holidays/holiday.service.js';
import { notificationService } from '../org/notifications/notification.service.js';
import { workLogService } from '../org/worklog/worklog.service.js';
import { nextCode, codeAllocator } from '../org/counters/counter.model.js';
import { User } from '../auth/auth.model.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { containsRegex } from '../../core/utils/regex.js';
import { dateKey, startOfDay, endOfDay, appendRemarkLine, fmtDay, tz } from '../../core/utils/opsTime.js';
import { ACCESS, CHECKLIST_STATUS as CS, REMARK_CHANNELS } from '../../core/constants/ops.js';

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);
const CHUNK = 500;

// Aggregation-safe open/closed tests. In $expr, `$eq: ['$actualDate', null]`
// is FALSE when the field is missing (every never-closed row), so wrap it.
const ACTUAL = { $ifNull: ['$actualDate', null] };
const IS_OPEN = { $eq: [ACTUAL, null] };
const IS_CLOSED = { $ne: [ACTUAL, null] };

const audit = (entity, actorId, type, description, refType = 'checklist_task') =>
  workLogService.log({
    module: 'checklist',
    type,
    title: entity.taskName,
    description,
    actor: actorId,
    refType,
    refId: entity._id,
    branch: idOf(entity.branch),
  });

function assertNotViewer(user) {
  if (scopeService.accessLevel(user) === ACCESS.VIEWER) throw ApiError.forbidden('Viewers have read-only access');
}

function assertManager(user, what) {
  const level = scopeService.accessLevel(user);
  if (level !== ACCESS.ADMIN && level !== ACCESS.LEAD) throw ApiError.forbidden(`Only an admin or team lead can ${what}`);
}

/**
 * Which checklist rows the caller may see:
 *   admin   all rows
 *   lead    their people (reports + teams they manage) and their whole department
 *   others  their own rows
 */
async function scopeClause(user) {
  const level = scopeService.accessLevel(user);
  if (level === ACCESS.ADMIN) return {};
  if (level === ACCESS.LEAD) {
    const { userIds, department } = await scopeService.leadScope(user);
    return department ? { $or: [{ doer: { $in: userIds } }, { department }] } : { doer: { $in: userIds } };
  }
  return { doer: user.id };
}

async function canActOn(task, user) {
  const level = scopeService.accessLevel(user);
  if (level === ACCESS.ADMIN) return true;
  if (level === ACCESS.VIEWER) return false;
  if (idOf(task.doer) === String(user.id)) return true;
  if (level === ACCESS.LEAD) {
    const { userIds, department } = await scopeService.leadScope(user);
    return userIds.includes(idOf(task.doer)) || (department && task.department === department);
  }
  return false;
}

/** Create the dated rows for a routine. */
async function materialize(master, keys) {
  if (!keys.length) return 0;
  const next = await codeAllocator('checklist_task', 'CT', keys.length);
  const rows = keys.map((key) => ({
    code: next(),
    master: master._id,
    doer: master.doer,
    taskName: master.taskName,
    frequency: master.frequency,
    plannedKey: key,
    plannedDate: startOfDay(key),
    proofRequired: master.proofRequired,
    status: CS.PENDING,
    branch: master.branch,
    department: master.department,
    site: master.site,
    group: master.group,
  }));
  for (let i = 0; i < rows.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    await ChecklistTask.insertMany(rows.slice(i, i + CHUNK), { ordered: false });
  }
  return rows.length;
}

const occurrencesFor = async (m, startKey, endKey) =>
  generateOccurrences({
    startDate: startKey,
    endDate: endKey,
    frequency: m.frequency,
    holidays: await holidayService.keys(),
    weeklyOffs: m.weeklyOffs || [],
    anchorWeekday: m.anchorWeekday,
    anchorDay: m.anchorDay,
  });

function statusClause(status) {
  const todayStart = startOfDay(dateKey());
  const todayEnd = endOfDay(dateKey());
  switch (status) {
    case 'pending_today': // on the plate today: today's plus every earlier one still open
      return { actualDate: null, plannedDate: { $lte: todayEnd } };
    case 'overdue':
      return { actualDate: null, plannedDate: { $lt: todayStart } };
    case 'upcoming':
      return { actualDate: null, plannedDate: { $gt: todayEnd } };
    case 'due_today':
      return { actualDate: null, plannedDate: { $gte: todayStart, $lte: todayEnd } };
    case 'on_time': // closed on its planned day (or earlier)
      return { actualDate: { $ne: null }, isNonFunctional: false, $expr: { $lte: ['$actualDate', { $add: ['$plannedDate', 86_399_999] }] } };
    case 'late': // closed, but after its planned day
      return { actualDate: { $ne: null }, isNonFunctional: false, $expr: { $gt: ['$actualDate', { $add: ['$plannedDate', 86_399_999] }] } };
    case CS.PENDING:
      return { actualDate: null };
    case CS.COMPLETED:
      return { actualDate: { $ne: null }, isNonFunctional: false };
    case CS.NON_FUNCTIONAL:
      return { isNonFunctional: true };
    default:
      return {};
  }
}

/** Routine ids created by me / by any admin — the checklist "created by" switch. */
async function createdByMasterIds(value, user) {
  const ids = await scopeService.byWhomIds(value, user);
  if (!ids) return null;
  return ChecklistMaster.find({ createdBy: { $in: ids } }).distinct('_id');
}

async function baseTaskFilter(query, user) {
  const and = [];
  const branch = await scopeService.resolveBranch(query.branch, user);
  if (branch) and.push({ branch });
  const scope = await scopeClause(user);
  if (Object.keys(scope).length) and.push(scope);
  if (query.doer) and.push({ doer: query.doer });
  if (query.team) and.push({ doer: { $in: await scopeService.teamMemberIds(query.team) } });
  if (query.group) and.push({ group: query.group });
  if (query.master) and.push({ master: query.master });
  const createdBy = await createdByMasterIds(query.createdBy, user);
  if (createdBy) and.push({ master: { $in: createdBy } });
  if (query.frequency) and.push({ frequency: query.frequency });
  // 'unassigned' = occurrences with no department (the report's "Unassigned" row).
  if (query.department === 'unassigned') and.push({ department: null });
  else if (query.department) and.push({ department: query.department });
  if (query.site) and.push({ site: query.site });
  if (query.search) and.push({ $or: [{ taskName: containsRegex(query.search) }, { code: containsRegex(query.search) }] });
  if (query.from) and.push({ plannedDate: { $gte: startOfDay(query.from) } });
  if (query.to) and.push({ plannedDate: { $lte: endOfDay(query.to) } });
  return { filter: and.length ? { $and: and } : {}, branch };
}

const castTaskFilter = (f) => ChecklistTask.find().cast(ChecklistTask, f);

export const checklistService = {
  /* ------------------------------------------------------------ */
  /* Routines                                                      */
  /* ------------------------------------------------------------ */

  async createMaster(data, user) {
    assertNotViewer(user);
    // A member may add routines only for themselves — the doer they send is ignored.
    const level = scopeService.accessLevel(user);
    const doerId = level === ACCESS.MEMBER ? String(user.id) : data.doer;
    const doer = await User.findById(doerId).select('name department');
    if (!doer) throw ApiError.badRequest('The selected doer no longer exists');

    const branch = await scopeService.resolveBranch(data.branch === 'all' ? undefined : data.branch, user);
    const startKey = data.startDate;
    const endKey = data.endDate || defaultEndKey(startKey);
    if (endKey < startKey) throw ApiError.badRequest('The end date must fall after the start date');

    const draft = {
      frequency: data.frequency,
      weeklyOffs: data.weeklyOffs || [],
      anchorWeekday: data.anchorWeekday,
      anchorDay: data.anchorDay,
    };
    const keys = await occurrencesFor(draft, startKey, endKey);
    if (!keys.length) throw ApiError.badRequest('That combination produces no dates — check the dates, weekly offs and holidays');

    const master = await ChecklistMaster.create({
      code: await nextCode('checklist_master', 'CHK', 5),
      taskName: data.taskName,
      description: data.description,
      doer: doer._id,
      ...draft,
      startDate: startKey,
      endDate: endKey,
      autoRenew: data.autoRenew ?? !data.endDate,
      proofRequired: Boolean(data.proofRequired),
      branch,
      department: data.department || doer.department,
      site: data.site,
      group: data.group,
      createdBy: user.id,
    });
    const generated = await materialize(master, keys);

    notificationService.notify({
      recipients: [doer._id],
      exclude: user.id,
      title: 'New checklist assigned',
      message: `${user.name} assigned you the ${master.frequency} checklist "${master.taskName}" — ${generated} occurrence(s) from ${fmtDay(startOfDay(keys[0]))}.`,
      module: 'checklist',
      kind: 'assigned',
      refId: master._id,
      link: '/checklist',
    });
    audit(master, user.id, 'created', `Routine ${master.code} (${master.frequency}) for ${doer.name} — ${generated} occurrences`, 'checklist_master');
    return { master, generated, firstDate: keys[0], lastDate: keys.at(-1) };
  },

  async listMasters(query, user) {
    const and = [];
    const branch = await scopeService.resolveBranch(query.branch, user);
    if (branch) and.push({ branch });
    const scope = await scopeClause(user);
    if (Object.keys(scope).length) and.push(scope);
    if (query.frequency) and.push({ frequency: query.frequency });
    if (query.active === 'true') and.push({ isActive: true });
    if (query.active === 'false') and.push({ isActive: false });
    if (query.team) and.push({ doer: { $in: await scopeService.teamMemberIds(query.team) } });
    if (query.group) and.push({ group: query.group });
    if (query.doer) and.push({ doer: query.doer });
    const creators = await scopeService.byWhomIds(query.createdBy, user);
    if (creators) and.push({ createdBy: { $in: creators } });
    if (query.search) and.push({ $or: [{ taskName: containsRegex(query.search) }, { code: containsRegex(query.search) }] });

    const masters = await ChecklistMaster.find(and.length ? { $and: and } : {})
      .sort({ createdAt: -1 })
      .limit(500)
      .populate('doer', 'name avatarColor department')
      .populate('group', 'name color')
      .populate('branch', 'name code')
      .lean();

    const now = startOfDay(dateKey());
    const stats = await ChecklistTask.aggregate([
      { $match: { master: { $in: masters.map((m) => m._id) } } },
      {
        $group: {
          _id: '$master',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }] }, 1, 0] } },
          missed: { $sum: { $cond: [{ $and: [IS_OPEN, { $lt: ['$plannedDate', now] }] }, 1, 0] } },
          nextKey: { $min: { $cond: [{ $and: [IS_OPEN, { $gte: ['$plannedDate', now] }] }, '$plannedKey', null] } },
        },
      },
    ]);
    const byId = new Map(stats.map((s) => [String(s._id), s]));
    return masters.map((m) => {
      const s = byId.get(String(m._id)) || {};
      return { ...m, total: s.total || 0, completed: s.completed || 0, missed: s.missed || 0, nextDate: s.nextKey || null };
    });
  },

  /**
   * Edit a routine. Changes flow to OPEN, not-yet-due occurrences only —
   * completed history is immutable. Moving the end date later generates the
   * extra occurrences; earlier removes open ones past the new end.
   */
  async updateMaster(id, data, user) {
    assertManager(user, 'edit a checklist routine');
    const master = await ChecklistMaster.findById(id);
    if (!master) throw ApiError.notFound('Checklist routine not found');

    const todayStart = startOfDay(dateKey());
    const childPatch = {};
    if (data.taskName !== undefined) {
      master.taskName = data.taskName;
      childPatch.taskName = data.taskName;
    }
    if (data.doer !== undefined && String(data.doer) !== idOf(master.doer)) {
      const newDoer = await User.findById(data.doer).select('_id');
      if (!newDoer) throw ApiError.badRequest('That person no longer exists');
      childPatch.reassignedFrom = master.doer;
      childPatch.reassignedAt = new Date();
      childPatch.doer = newDoer._id;
      master.doer = newDoer._id;
    }
    for (const f of ['proofRequired', 'department', 'site', 'group']) {
      if (data[f] !== undefined) {
        master[f] = data[f] === null ? undefined : data[f];
        childPatch[f] = master[f];
      }
    }
    if (data.description !== undefined) master.description = data.description;
    if (data.autoRenew !== undefined) master.autoRenew = data.autoRenew;
    if (data.isActive !== undefined) master.isActive = data.isActive;

    let generated = 0;
    let removed = 0;
    if (data.endDate !== undefined && data.endDate !== master.endDate) {
      if (data.endDate < master.startDate) throw ApiError.badRequest('The end date must fall after the start date');
      if (data.endDate > master.endDate) {
        // Re-run the full series and keep only what's past the old end, so the
        // cadence stays anchored exactly as it was first generated.
        const extra = (await occurrencesFor(master, master.startDate, data.endDate)).filter((k) => k > master.endDate);
        master.endDate = data.endDate;
        generated = await materialize(master, extra);
      } else {
        const gone = await ChecklistTask.deleteMany({ master: master._id, actualDate: null, plannedKey: { $gt: data.endDate } });
        removed = gone.deletedCount;
        master.endDate = data.endDate;
      }
    }
    await master.save();

    let cascaded = 0;
    if (Object.keys(childPatch).length) {
      // Cleared fields (e.g. group removed) are unset on the occurrences too.
      const $set = {};
      const $unset = {};
      for (const [k, v] of Object.entries(childPatch)) {
        if (v === undefined) $unset[k] = 1;
        else $set[k] = v;
      }
      const update = {};
      if (Object.keys($set).length) update.$set = $set;
      if (Object.keys($unset).length) update.$unset = $unset;
      const r = await ChecklistTask.updateMany(
        { master: master._id, actualDate: null, plannedDate: { $gte: todayStart } },
        update,
      );
      cascaded = r.modifiedCount;
    }

    audit(master, user.id, 'updated', `Routine updated — ${cascaded} upcoming adjusted${generated ? `, ${generated} generated` : ''}${removed ? `, ${removed} removed` : ''}`, 'checklist_master');
    return { master, cascaded, generated, removed };
  },

  /** Stop a routine: future open occurrences go, history stays. */
  async stopMaster(id, user) {
    assertManager(user, 'stop a checklist routine');
    const master = await ChecklistMaster.findById(id);
    if (!master) throw ApiError.notFound('Checklist routine not found');
    master.isActive = false;
    master.autoRenew = false;
    await master.save();
    const r = await ChecklistTask.deleteMany({ master: master._id, actualDate: null, plannedDate: { $gte: startOfDay(dateKey()) } });
    audit(master, user.id, 'deleted', `Routine stopped — ${r.deletedCount} upcoming occurrence(s) removed, history kept`, 'checklist_master');
    return { removed: r.deletedCount };
  },

  /* ------------------------------------------------------------ */
  /* Occurrences                                                   */
  /* ------------------------------------------------------------ */

  async listTasks(query, user) {
    const { filter } = await baseTaskFilter(query, user);
    const status = statusClause(query.status);
    const final = Object.keys(status).length ? { $and: [...(filter.$and || []), status] } : filter;
    const limit = Math.min(Number(query.limit) || 500, 2000);
    const sort = query.status === 'completed' || query.status === 'non_functional' ? { actualDate: -1 } : { plannedDate: 1 };
    const [items, total] = await Promise.all([
      ChecklistTask.find(final)
        .sort(sort)
        .limit(limit)
        .populate('doer', 'name avatarColor department')
        .populate('reassignedFrom', 'name')
        .populate('group', 'name color')
        .lean(),
      ChecklistTask.countDocuments(final),
    ]);
    return { items, total };
  },

  async summary(query, user) {
    const { filter, branch } = await baseTaskFilter(query, user);
    const todayStart = startOfDay(dateKey());
    const todayEnd = endOfDay(dateKey());
    const [row] = await ChecklistTask.aggregate([
      { $match: castTaskFilter(filter) },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }] }, 1, 0] } },
          nonFunctional: { $sum: { $cond: ['$isNonFunctional', 1, 0] } },
          pending: { $sum: { $cond: [IS_OPEN, 1, 0] } },
          pendingToday: { $sum: { $cond: [{ $and: [IS_OPEN, { $lte: ['$plannedDate', todayEnd] }] }, 1, 0] } },
          dueToday: { $sum: { $cond: [{ $and: [IS_OPEN, { $gte: ['$plannedDate', todayStart] }, { $lte: ['$plannedDate', todayEnd] }] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [IS_OPEN, { $lt: ['$plannedDate', todayStart] }] }, 1, 0] } },
          onTime: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }, { $lte: ['$actualDate', { $add: ['$plannedDate', 86_399_999] }] }] }, 1, 0] } },
          upcoming: { $sum: { $cond: [{ $and: [IS_OPEN, { $gt: ['$plannedDate', todayEnd] }] }, 1, 0] } },
        },
      },
    ]);
    const r = row || { total: 0, completed: 0, nonFunctional: 0, pending: 0, pendingToday: 0, dueToday: 0, overdue: 0, onTime: 0, upcoming: 0 };
    r.late = r.completed - r.onTime;
    // Scored against what could actually be done by now: non-functional rows
    // don't count, and future occurrences aren't misses yet.
    const scorable = r.completed + r.overdue;
    return {
      ...r,
      _id: undefined,
      complianceRate: scorable ? Math.round((r.completed / scorable) * 100) : 100,
      onTimeRate: r.completed ? Math.round((r.onTime / r.completed) * 100) : null,
      branch,
    };
  },

  async departments(query, user) {
    const branch = await scopeService.resolveBranch(query.branch, user);
    const b = branch ? { branch } : {};
    const [t, m] = await Promise.all([
      ChecklistTask.distinct('department', { ...b, department: { $ne: null } }),
      ChecklistMaster.distinct('department', { ...b, department: { $ne: null } }),
    ]);
    return [...new Set([...t, ...m].filter(Boolean))].sort();
  },

  /**
   * Department scoreboard: per department (and per doer inside it) — completed,
   * pending, missed, non-functional and compliance %, ranked. Window defaults
   * to everything planned up to today so a year of generated future
   * occurrences doesn't drown the numbers. Leads are pinned to their department.
   */
  async departmentReport(query, user) {
    assertManager(user, 'see the department report');
    const branch = await scopeService.resolveBranch(query.branch, user);
    const level = scopeService.accessLevel(user);
    const match = { plannedDate: { $lte: endOfDay(query.to || dateKey()) } };
    if (query.from) match.plannedDate.$gte = startOfDay(query.from);
    if (branch) match.branch = branch;
    let pinned = query.department || null;
    if (level === ACCESS.LEAD) {
      pinned = user.department || null;
      if (!pinned) return { departments: [], doers: [], note: 'Set a department on your profile to see its report' };
    }
    if (pinned) match.department = pinned;
    if (query.team) match.doer = { $in: await scopeService.teamMemberIds(query.team) };
    const createdBy = await createdByMasterIds(query.createdBy, user);
    if (createdBy) match.master = { $in: createdBy };

    const todayStart = startOfDay(dateKey());
    const rows = await ChecklistTask.aggregate([
      { $match: castTaskFilter(match) },
      {
        $group: {
          _id: { department: { $ifNull: ['$department', 'Unassigned'] }, doer: '$doer' },
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }] }, 1, 0] } },
          nonFunctional: { $sum: { $cond: ['$isNonFunctional', 1, 0] } },
          missed: { $sum: { $cond: [{ $and: [IS_OPEN, { $lt: ['$plannedDate', todayStart] }] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $and: [IS_OPEN, { $gte: ['$plannedDate', todayStart] }] }, 1, 0] } },
        },
      },
      { $lookup: { from: 'users', localField: '_id.doer', foreignField: '_id', as: 'u' } },
      { $unwind: { path: '$u', preserveNullAndEmptyArrays: true } },
    ]);

    const finish = (b) => {
      const scorable = b.completed + b.missed + b.pending;
      return { ...b, complianceRate: scorable ? Math.round((b.completed / scorable) * 100) : 100 };
    };
    const depts = new Map();
    const doers = [];
    for (const r of rows) {
      const dept = r._id.department;
      if (!depts.has(dept)) depts.set(dept, { department: dept, total: 0, completed: 0, nonFunctional: 0, missed: 0, pending: 0, doers: 0 });
      const d = depts.get(dept);
      for (const f of ['total', 'completed', 'nonFunctional', 'missed', 'pending']) d[f] += r[f];
      d.doers += 1;
      doers.push(finish({
        department: dept,
        doerId: r._id.doer,
        doer: r.u?.name || 'Unknown',
        avatarColor: r.u?.avatarColor,
        total: r.total,
        completed: r.completed,
        nonFunctional: r.nonFunctional,
        missed: r.missed,
        pending: r.pending,
      }));
    }
    if (pinned && !depts.has(pinned)) depts.set(pinned, { department: pinned, total: 0, completed: 0, nonFunctional: 0, missed: 0, pending: 0, doers: 0 });

    const departments = [...depts.values()]
      .map(finish)
      .sort((a, b) => b.complianceRate - a.complianceRate || b.completed - a.completed || a.department.localeCompare(b.department));
    departments.forEach((d, i) => { d.rank = i + 1; });
    doers.sort((a, b) => b.complianceRate - a.complianceRate || b.completed - a.completed);
    return { departments, doers, branch };
  },

  async complete(id, { documentUrl, remark }, user) {
    const task = await ChecklistTask.findById(id);
    if (!task) throw ApiError.notFound('Checklist task not found');
    if (!(await canActOn(task, user))) throw ApiError.forbidden('This checklist task is outside your scope');
    if (task.actualDate) throw ApiError.conflict(`Already closed on ${fmtDay(task.actualDate)}`);
    if (task.proofRequired && !documentUrl) throw ApiError.badRequest('This checklist needs a proof document before it can be completed');

    const now = new Date();
    task.actualDate = now;
    task.documentUrl = documentUrl || undefined;
    task.status = CS.COMPLETED;
    task.isNonFunctional = false;
    if (remark) task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `${user.name}: ${remark}`, now);
    await task.save();
    audit(task, user.id, 'status_change', `${task.code} completed${task.plannedDate < startOfDay(dateKey(now)) ? ' (late)' : ''}`);
    return task;
  },

  /** Close an occurrence that couldn't apply — excluded from compliance, not counted as a miss. */
  async markNonFunctional(id, { reason }, user) {
    const task = await ChecklistTask.findById(id);
    if (!task) throw ApiError.notFound('Checklist task not found');
    if (!(await canActOn(task, user))) throw ApiError.forbidden('This checklist task is outside your scope');
    if (task.actualDate) throw ApiError.conflict('This task is already closed');
    const now = new Date();
    task.actualDate = now;
    task.isNonFunctional = true;
    task.status = CS.NON_FUNCTIONAL;
    task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Non-functional (${user.name}): ${reason}`, now);
    await task.save();
    audit(task, user.id, 'status_change', `${task.code} marked non-functional — ${reason}`);
    return task;
  },

  /**
   * Reopen a closed occurrence (completed or non-functional) for further action,
   * correction or review. It returns to pending on its original planned day; the
   * earlier closure stays on record in the notes and the activity log.
   */
  async reopen(id, { reason }, user) {
    assertManager(user, 'reopen checklist tasks');
    const task = await ChecklistTask.findById(id);
    if (!task) throw ApiError.notFound('Checklist task not found');
    if (!(await canActOn(task, user))) throw ApiError.forbidden('This checklist task is outside your scope');
    if (!task.actualDate) throw ApiError.conflict('This task is still open');

    const now = new Date();
    const was = task.isNonFunctional ? 'non-functional' : `completed on ${fmtDay(task.actualDate)}`;
    task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Reopened by ${user.name} (was ${was}): ${reason}`, now);
    task.actualDate = undefined;
    task.status = CS.PENDING;
    task.isNonFunctional = false;
    await task.save();

    notificationService.notify({
      recipients: [idOf(task.doer)],
      exclude: user.id,
      title: 'Checklist task reopened',
      message: `${user.name} reopened "${task.taskName}" (${task.code}) planned for ${fmtDay(task.plannedDate)}: ${reason}`,
      module: 'checklist',
      kind: 'reopened',
      refId: task._id,
      link: '/checklist',
    });
    audit(task, user.id, 'status_change', `${task.code} reopened (was ${was}) — ${reason}`);
    return task;
  },

  /** Hand one occurrence (optionally all later ones) to someone else. */
  async reassign(id, { newDoerId, applyToFuture, reason }, user) {
    assertManager(user, 'reassign checklist tasks');
    const task = await ChecklistTask.findById(id);
    if (!task) throw ApiError.notFound('Checklist task not found');
    if (idOf(task.doer) === String(newDoerId)) throw ApiError.badRequest('That person already owns this task');
    if (task.actualDate) throw ApiError.conflict('A closed task cannot be reassigned');
    const newDoer = await User.findById(newDoerId).select('name');
    if (!newDoer) throw ApiError.badRequest('That person no longer exists');

    const now = new Date();
    const note = `Reassigned to ${newDoer.name} by ${user.name}${reason ? `: ${reason}` : ''}`;
    const previous = task.doer;
    task.doer = newDoer._id;
    task.reassignedFrom = previous;
    task.reassignedAt = now;
    task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, note, now);
    await task.save();

    let futureCount = 0;
    if (applyToFuture && task.master) {
      const r = await ChecklistTask.updateMany(
        { master: task.master, actualDate: null, plannedDate: { $gt: task.plannedDate } },
        { doer: newDoer._id, reassignedFrom: previous, reassignedAt: now },
      );
      futureCount = r.modifiedCount;
      await ChecklistMaster.updateOne({ _id: task.master }, { doer: newDoer._id });
    }

    notificationService.notify({
      recipients: [newDoer._id],
      exclude: user.id,
      title: 'Checklist task assigned to you',
      message: `${user.name} handed you "${task.taskName}" (${task.code}) for ${fmtDay(task.plannedDate)}${futureCount ? ` and ${futureCount} later occurrence(s)` : ''}.`,
      module: 'checklist',
      kind: 'assigned',
      refId: task._id,
      link: '/checklist',
    });
    audit(task, user.id, 'status_change', futureCount ? `${note} (+${futureCount} upcoming)` : note);
    return { futureCount };
  },

  /** One endpoint for single and bulk remarks on either channel. */
  async addRemarks({ taskIds, remark, channel }, user) {
    assertManager(user, 'add management / coordinator remarks');
    const tasks = await ChecklistTask.find({ _id: { $in: taskIds } });
    if (!tasks.length) throw ApiError.notFound('No matching checklist tasks');
    const isMgmt = channel === REMARK_CHANNELS.MANAGEMENT;
    const field = isMgmt ? 'managementRemark' : 'coordinatorRemark';
    const now = new Date();
    await ChecklistTask.bulkWrite(
      tasks.map((t) => ({
        updateOne: {
          filter: { _id: t._id },
          update: {
            $set: { [field]: appendRemarkLine(t[field], `${user.name}: ${remark}`, now) },
            ...(isMgmt ? { $inc: { followUpCount: 1 } } : {}),
          },
        },
      })),
    );
    workLogService.log({
      module: 'checklist',
      type: 'remark',
      title: tasks.length === 1 ? tasks[0].taskName : `${tasks.length} checklist tasks`,
      description: `[${isMgmt ? 'Management follow-up' : 'Coordinator note'}] ${remark}`,
      actor: user.id,
      refType: 'checklist_task',
      refId: tasks[0]._id,
    });
    if (isMgmt) {
      const doers = [...new Set(tasks.map((t) => idOf(t.doer)))];
      notificationService.notify({
        recipients: doers,
        exclude: user.id,
        title: 'Checklist follow-up',
        message: `${user.name}: ${remark}`,
        module: 'checklist',
        kind: 'remark',
        link: '/checklist',
        email: false,
      });
    }
    return { updated: tasks.length };
  },

  /** One occurrence in full, with its routine and that routine's recent history. */
  async getTask(id, user) {
    const task = await ChecklistTask.findById(id)
      .populate('doer', 'name avatarColor title department')
      .populate('reassignedFrom', 'name')
      .populate('group', 'name color')
      .populate('branch', 'name code')
      .lean();
    if (!task) throw ApiError.notFound('Checklist task not found');
    const level = scopeService.accessLevel(user);
    if (level !== ACCESS.ADMIN && !(await canActOn({ ...task, doer: task.doer?._id }, user)) && idOf(task.doer) !== String(user.id)) {
      throw ApiError.notFound('Checklist task not found');
    }
    const [master, history, activity] = await Promise.all([
      task.master ? ChecklistMaster.findById(task.master).populate('doer', 'name').lean() : null,
      task.master
        ? ChecklistTask.find({ master: task.master, _id: { $ne: task._id }, plannedDate: { $lte: endOfDay(dateKey()) } })
          .sort({ plannedDate: -1 })
          .limit(12)
          .select('code plannedKey plannedDate actualDate status isNonFunctional doer')
          .populate('doer', 'name')
          .lean()
        : [],
      workLogService.forRef(task._id, 20),
    ]);
    const canAct = await canActOn({ ...task, doer: task.doer?._id }, user);
    return {
      ...task,
      master,
      history,
      activity,
      can: {
        complete: canAct && !task.actualDate,
        nonFunctional: canAct && !task.actualDate,
        reassign: [ACCESS.ADMIN, ACCESS.LEAD].includes(level) && !task.actualDate,
        remark: [ACCESS.ADMIN, ACCESS.LEAD].includes(level),
        reopen: [ACCESS.ADMIN, ACCESS.LEAD].includes(level) && canAct && Boolean(task.actualDate),
      },
    };
  },

  /** A routine in full: settings, stats, recent and upcoming occurrences, audit. */
  async getMaster(id, user) {
    const master = await ChecklistMaster.findById(id)
      .populate('doer', 'name avatarColor title department')
      .populate('group', 'name color')
      .populate('branch', 'name code')
      .populate('createdBy', 'name')
      .lean();
    if (!master) throw ApiError.notFound('Checklist routine not found');
    const level = scopeService.accessLevel(user);
    if (level === ACCESS.MEMBER || level === ACCESS.VIEWER) {
      if (idOf(master.doer) !== String(user.id)) throw ApiError.notFound('Checklist routine not found');
    }
    const todayStart = startOfDay(dateKey());
    const todayEnd = endOfDay(dateKey());
    const [stats, recent, upcoming, activity] = await Promise.all([
      ChecklistTask.aggregate([
        { $match: { master: master._id } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }] }, 1, 0] } },
            onTime: { $sum: { $cond: [{ $and: [IS_CLOSED, { $eq: ['$isNonFunctional', false] }, { $lte: ['$actualDate', { $add: ['$plannedDate', 86_399_999] }] }] }, 1, 0] } },
            nonFunctional: { $sum: { $cond: ['$isNonFunctional', 1, 0] } },
            missed: { $sum: { $cond: [{ $and: [IS_OPEN, { $lt: ['$plannedDate', todayStart] }] }, 1, 0] } },
            upcoming: { $sum: { $cond: [{ $and: [IS_OPEN, { $gte: ['$plannedDate', todayStart] }] }, 1, 0] } },
          },
        },
      ]),
      ChecklistTask.find({ master: master._id, plannedDate: { $lte: todayEnd } })
        .sort({ plannedDate: -1 })
        .limit(30)
        .populate('doer', 'name avatarColor')
        .lean(),
      ChecklistTask.find({ master: master._id, actualDate: null, plannedDate: { $gt: todayEnd } })
        .sort({ plannedDate: 1 })
        .limit(10)
        .select('code plannedKey plannedDate doer')
        .populate('doer', 'name')
        .lean(),
      workLogService.forRef(master._id, 20),
    ]);
    const st = stats[0] || { total: 0, completed: 0, onTime: 0, nonFunctional: 0, missed: 0, upcoming: 0 };
    const scorable = st.completed + st.missed;
    return {
      ...master,
      stats: { ...st, _id: undefined, complianceRate: scorable ? Math.round((st.completed / scorable) * 100) : 100 },
      recent,
      upcoming,
      activity,
      can: { edit: [ACCESS.ADMIN, ACCESS.LEAD].includes(level) },
    };
  },

  /* ------------------------------------------------------------ */
  /* Sites                                                         */
  /* ------------------------------------------------------------ */

  async listSites(query, user) {
    const branch = await scopeService.resolveBranch(query.branch, user);
    const b = branch ? { branch } : {};
    const [managed, used] = await Promise.all([
      ChecklistSite.find({ ...b, isActive: true }).sort({ name: 1 }).lean(),
      ChecklistTask.distinct('site', { ...b, site: { $ne: null } }),
    ]);
    const names = [...new Set([...managed.map((s) => s.name), ...used.filter(Boolean)])].sort((a, c) => a.localeCompare(c));
    return { sites: names, managed: managed.map((s) => ({ _id: s._id, name: s.name, branch: s.branch })) };
  },

  async addSite({ name, branch: requested }, user) {
    assertNotViewer(user);
    const branch = await scopeService.resolveBranch(requested === 'all' ? undefined : requested, user);
    const existing = await ChecklistSite.findOne({ branch, name });
    if (existing) {
      if (!existing.isActive) {
        existing.isActive = true;
        await existing.save();
      }
      return existing;
    }
    return ChecklistSite.create({ name, branch, createdBy: user.id });
  },

  /** Rename a site everywhere it's used, so history matches the dropdown. */
  async renameSite(id, { name }, user) {
    assertManager(user, 'rename sites');
    const site = await ChecklistSite.findById(id);
    if (!site) throw ApiError.notFound('Site not found');
    if (site.name === name) return { site, tasks: 0, masters: 0 };
    const old = site.name;
    site.name = name;
    await site.save();
    const [t, m] = await Promise.all([
      ChecklistTask.updateMany({ branch: site.branch, site: old }, { site: name }),
      ChecklistMaster.updateMany({ branch: site.branch, site: old }, { site: name }),
    ]);
    return { site, tasks: t.modifiedCount, masters: m.modifiedCount };
  },

  async removeSite(id, user) {
    assertManager(user, 'remove sites');
    const site = await ChecklistSite.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!site) throw ApiError.notFound('Site not found');
    return site;
  },

  /* ------------------------------------------------------------ */
  /* Holidays                                                      */
  /* ------------------------------------------------------------ */

  /**
   * Clear open occurrences off newly declared holidays. A daily occurrence is
   * dropped (the next working day already has its own); anything else moves
   * to the first following day that is neither a holiday nor already carrying
   * an occurrence of the same routine. Closed rows are history — untouched.
   */
  async adjustForHolidays(keys) {
    const holidays = new Set(await holidayService.keys());
    let removedDaily = 0;
    let shifted = 0;
    const open = await ChecklistTask.find({ plannedKey: { $in: keys }, actualDate: null, isNonFunctional: false });
    for (const t of open) {
      if (t.frequency === 'daily') {
        // eslint-disable-next-line no-await-in-loop
        await t.deleteOne();
        removedDaily += 1;
        continue;
      }
      let target = tz(startOfDay(t.plannedKey)).add(1, 'day');
      for (let hops = 0; hops < 60; hops += 1) {
        const key = target.format('YYYY-MM-DD');
        if (!holidays.has(key)) {
          // eslint-disable-next-line no-await-in-loop
          const clash = await ChecklistTask.exists(
            t.master ? { master: t.master, plannedKey: key } : { doer: t.doer, taskName: t.taskName, plannedKey: key },
          );
          if (!clash) break;
        }
        target = target.add(1, 'day');
      }
      t.plannedKey = target.format('YYYY-MM-DD');
      t.plannedDate = startOfDay(t.plannedKey);
      // eslint-disable-next-line no-await-in-loop
      await t.save();
      shifted += 1;
    }
    return { removedDaily, shifted };
  },

  /* ------------------------------------------------------------ */
  /* Jobs                                                          */
  /* ------------------------------------------------------------ */

  /** 08:30 — one digest per doer of every open occurrence due today or earlier. */
  async dailyDigest() {
    const todayEnd = endOfDay(dateKey());
    const todayStart = startOfDay(dateKey());
    const open = await ChecklistTask.find({ actualDate: null, isNonFunctional: false, plannedDate: { $lte: todayEnd } })
      .select('doer taskName code plannedDate proofRequired')
      .sort({ plannedDate: 1 })
      .lean();
    const byDoer = new Map();
    for (const t of open) {
      const k = String(t.doer);
      if (!byDoer.has(k)) byDoer.set(k, []);
      byDoer.get(k).push(t);
    }
    for (const [doer, list] of byDoer) {
      const late = list.filter((t) => t.plannedDate < todayStart).length;
      notificationService.notify({
        recipients: [doer],
        title: `Checklist — ${list.length} open${late ? `, ${late} overdue` : ''}`,
        message: list
          .slice(0, 20)
          .map((t) => `• ${t.taskName} (${t.code}) — ${fmtDay(t.plannedDate)}${t.proofRequired ? ' · proof needed' : ''}`)
          .join('\n') + (list.length > 20 ? `\n…and ${list.length - 20} more` : ''),
        module: 'checklist',
        kind: 'reminder',
        link: '/checklist',
      });
    }
    return open.length;
  },

  /** 01:00 — routines with auto-renew get another year before they run out. */
  async autoRenew() {
    const soon = tz().add(30, 'day').format('YYYY-MM-DD');
    const masters = await ChecklistMaster.find({ isActive: true, autoRenew: true, endDate: { $lte: soon } });
    let renewed = 0;
    for (const m of masters) {
      const newEnd = `${Number(m.endDate.slice(0, 4)) + 1}-12-31`;
      // eslint-disable-next-line no-await-in-loop
      const extra = (await occurrencesFor(m, m.startDate, newEnd)).filter((k) => k > m.endDate);
      m.endDate = newEnd;
      // eslint-disable-next-line no-await-in-loop
      await materialize(m, extra);
      // eslint-disable-next-line no-await-in-loop
      await m.save();
      renewed += 1;
    }
    return renewed;
  },
};

export default checklistService;
