import { Delegation } from './delegation.model.js';
import {
  DelegationRemark,
  DelegationRevision,
  DelegationReminder,
  DelegationFollowup,
} from './records.model.js';
import { DelegationRecurrence } from './recurrence.model.js';
import { DelegationTemplate } from './template.model.js';
import { visibilityFilter, assertCanView, capabilities, relation, involvedIds, assertNotViewer } from './delegation.policy.js';
import { previewDates } from './recurrence.engine.js';
import { scopeService } from '../org/scope.service.js';
import { notificationService } from '../org/notifications/notification.service.js';
import { workLogService } from '../org/worklog/worklog.service.js';
import { nextCode } from '../org/counters/counter.model.js';
import { User } from '../auth/auth.model.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { containsRegex } from '../../core/utils/regex.js';
import { getPagination, buildMeta } from '../../core/utils/pagination.js';
import { dateKey, startOfDay, endOfDay, fmtDay } from '../../core/utils/opsTime.js';
import {
  DELEGATION_STATUS as S,
  DELEGATION_STATUS_VALUES,
  DELEGATION_OPEN_STATUSES,
} from '../../core/constants/ops.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const LIST_POPULATE = [
  { path: 'assigner', select: 'name avatarColor title' },
  {
    path: 'doer',
    select: 'name avatarColor title department reportingManager',
    populate: { path: 'reportingManager', select: 'name' },
  },
  { path: 'group', select: 'name color' },
  { path: 'branch', select: 'name code' },
  { path: 'recurrence', select: 'frequency isActive' },
  { path: 'parent', select: 'title code' },
];

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

/** A date-only value ('YYYY-MM-DD') means "by the end of that business day". */
export const parseDue = (v) => {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return endOfDay(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export const reminderFireAt = (due, { value, unit, trigger }) => {
  if (!due) return null;
  const ms = (Number(value) || 0) * (UNIT_MS[unit] || 0);
  return new Date(new Date(due).getTime() + (trigger === 'before' ? -ms : ms));
};

/** With no reminders chosen a task still gets a day-before nudge and a day-after chase. */
export const DEFAULT_REMINDERS = [
  { channel: 'email', value: 1, unit: 'days', trigger: 'before' },
  { channel: 'email', value: 1, unit: 'days', trigger: 'after' },
];

export async function writeReminders(delegationId, due, reminders) {
  await DelegationReminder.deleteMany({ delegation: delegationId, sentAt: null });
  // Configs may be plain objects or Mongoose subdocuments (from a repeat rule's
  // blueprint) — pick the fields explicitly rather than spreading.
  const rows = (reminders || [])
    .map(({ channel, value, unit, trigger }) => ({ channel: channel || 'in_app', value, unit, trigger }))
    .map((r) => ({ ...r, delegation: delegationId, fireAt: reminderFireAt(due, r) }))
    .filter((r) => r.fireAt && r.value && r.unit && r.trigger);
  if (rows.length) await DelegationReminder.insertMany(rows);
}

/** Cast a filter through the schema so it's safe inside aggregate() $match. */
const castFilter = (filter) => Delegation.find().cast(Delegation, filter);

const taskLink = (id) => `/delegation/tasks/${id}`;

export const notifyInvolved = (task, actorId, { title, message, kind = 'status_change', extra = [] }) =>
  notificationService.notify({
    recipients: [...involvedIds(task), ...extra],
    exclude: actorId,
    title,
    message,
    module: 'delegation',
    kind,
    refId: task._id,
    link: taskLink(task._id),
  });

export const audit = (task, actorId, type, description, meta) =>
  workLogService.log({
    module: 'delegation',
    type,
    title: task.title,
    description,
    actor: actorId,
    refType: 'delegation',
    refId: task._id,
    branch: idOf(task.branch),
    meta,
  });

async function assertPeople(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return [];
  const people = await User.find({ _id: { $in: unique } }).select('name +isActive');
  if (people.length !== unique.length) throw ApiError.badRequest('One or more selected people no longer exist');
  return people;
}

/** Walk down the sub-task tree from a set of roots (bounded depth). */
async function descendants(rootIds, { includeDeleted = false } = {}) {
  const all = [];
  let frontier = rootIds.map(String);
  for (let depth = 0; depth < 10 && frontier.length; depth += 1) {
    const filter = { parent: { $in: frontier } };
    if (!includeDeleted) filter.deletedAt = null;
    // eslint-disable-next-line no-await-in-loop
    const kids = await Delegation.find(filter)
      .select('title code status dueDate parent doer createdAt priority deletedAt')
      .populate('doer', 'name avatarColor')
      .lean();
    all.push(...kids);
    frontier = kids.map((k) => String(k._id));
  }
  return all;
}

/** "Rahul → Priya → Karan": who the work was passed down to, following the first sub-task. */
function hierarchyChain(taskId, childrenByParent) {
  const chain = [];
  let cur = String(taskId);
  for (let i = 0; i < 10; i += 1) {
    const kids = childrenByParent.get(cur);
    if (!kids?.length) break;
    chain.push(kids[0].doer?.name || 'Someone');
    cur = String(kids[0]._id);
  }
  return chain.length ? chain.join(' → ') : null;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

async function buildBaseFilter(query, user) {
  const and = [{ deletedAt: null }];
  const me = String(user.id);

  const branch = await scopeService.resolveBranch(query.branch, user);
  if (branch) and.push({ branch });

  const visible = await visibilityFilter(user);
  if (Object.keys(visible).length) and.push(visible);

  switch (query.view) {
    case 'mine':
      and.push({ doer: me });
      break;
    case 'delegated':
      and.push({ assigner: me });
      // "Waiting on others": leave out tasks people assigned to themselves.
      if (query.othersOnly === 'true') and.push({ doer: { $ne: me } });
      break;
    case 'loop':
      and.push({ inLoop: me, doer: { $ne: me } });
      break;
    case 'group':
      and.push({ group: { $ne: null } });
      break;
    default:
      break;
  }

  if (query.group) and.push({ group: query.group });
  if (query.recurrence) and.push({ recurrence: query.recurrence });
  if (query.team) and.push({ doer: { $in: await scopeService.teamMemberIds(query.team) } });
  if (query.doer) and.push({ doer: query.doer });
  if (query.assigner) and.push({ assigner: query.assigner });
  // Admin-wise view: only tasks assigned by me / by any admin.
  const byWhom = await scopeService.byWhomIds(query.assignedBy, user);
  if (byWhom) and.push({ assigner: { $in: byWhom } });
  if (query.category) and.push({ category: query.category });
  if (query.tag) and.push({ tags: query.tag });
  if (query.priority) and.push({ priority: query.priority });
  if (query.verification === 'required') and.push({ verificationRequired: true });
  if (query.verification === 'not_required') and.push({ verificationRequired: { $ne: true } });
  if (query.topLevel === 'true') and.push({ parent: null });

  if (query.frequency === 'once') and.push({ recurrence: null });
  else if (query.frequency === 'recurring') and.push({ recurrence: { $ne: null } });
  else if (query.frequency) {
    const ids = await DelegationRecurrence.find({ frequency: query.frequency }).distinct('_id');
    and.push({ recurrence: { $in: ids } });
  }

  if (query.search) {
    const rx = containsRegex(query.search);
    and.push({ $or: [{ title: rx }, { description: rx }, { code: rx }] });
  }
  if (query.dueFrom || query.dueTo) {
    const range = {};
    if (query.dueFrom) range.$gte = startOfDay(query.dueFrom);
    if (query.dueTo) range.$lte = endOfDay(query.dueTo);
    and.push({ dueDate: range });
  }
  if (query.createdFrom || query.createdTo) {
    const range = {};
    if (query.createdFrom) range.$gte = startOfDay(query.createdFrom);
    if (query.createdTo) range.$lte = endOfDay(query.createdTo);
    and.push({ createdAt: range });
  }
  return { filter: { $and: and }, branch };
}

const overdueClause = () => ({ status: { $in: DELEGATION_OPEN_STATUSES }, dueDate: { $lt: new Date() } });

/**
 * Derived buckets behind the KPI cards, on top of the real statuses:
 *   open            every not-yet-closed task (excludes work awaiting approval)
 *   incomplete      total pending — anything not completed, incl. awaiting approval
 *   pending_today   open and due today or earlier
 *   overdue         open and past its due date (the "delayed" card)
 *   due_today       open and due today
 *   stuck           blocked or dependent on others
 *   on_time         completed on or before the due date
 *   completed_late  completed after the due date
 */
const INCOMPLETE_STATUSES = [...DELEGATION_OPEN_STATUSES, S.AWAITING_VERIFICATION];

const DERIVED_BUCKETS = {
  open: () => ({ status: { $in: DELEGATION_OPEN_STATUSES } }),
  // Total pending: everything not yet completed, whatever its due date —
  // including work submitted and still waiting for approval.
  incomplete: () => ({ status: { $in: INCOMPLETE_STATUSES } }),
  // Pending today: open and due today or already past due.
  pending_today: () => ({ status: { $in: DELEGATION_OPEN_STATUSES }, dueDate: { $lte: endOfDay(dateKey()) } }),
  overdue: overdueClause,
  due_today: () => ({
    status: { $in: DELEGATION_OPEN_STATUSES },
    dueDate: { $gte: startOfDay(dateKey()), $lte: endOfDay(dateKey()) },
  }),
  stuck: () => ({ status: { $in: [S.BLOCKED, S.DEPENDENT] } }),
  on_time: () => ({ status: S.COMPLETED, $expr: { $lte: ['$completedAt', '$dueDate'] } }),
  completed_late: () => ({ status: S.COMPLETED, $expr: { $gt: ['$completedAt', '$dueDate'] } }),
};
export const DELEGATION_BUCKETS = Object.keys(DERIVED_BUCKETS);

function statusClause(status) {
  if (!status || status === 'all') return {};
  if (DERIVED_BUCKETS[status]) return DERIVED_BUCKETS[status]();
  return { status };
}

const SORTS = {
  due: { dueDate: 1, createdAt: -1 },
  '-due': { dueDate: -1 },
  created: { createdAt: 1 },
  '-created': { createdAt: -1 },
  updated: { updatedAt: -1 },
};

export const delegationService = {
  async list(query, user) {
    const { page, limit, skip } = getPagination({ ...query, limit: Math.min(Number(query.limit) || 200, 500) });
    const { filter: base, branch } = await buildBaseFilter(query, user);
    const filter = { $and: [...base.$and, statusClause(query.status)] };

    const bucketCount = (name) => Delegation.countDocuments({ $and: [...base.$and, DERIVED_BUCKETS[name]()] });
    const [items, total, statusRows, overdue, dueToday, stuck, onTime, completedLate, pendingToday] = await Promise.all([
      Delegation.find(filter)
        .sort(SORTS[query.sort] || SORTS['-created'])
        .skip(skip)
        .limit(limit)
        .select('-managementRemark -coordinatorRemark')
        .populate(LIST_POPULATE),
      Delegation.countDocuments(filter),
      Delegation.aggregate([{ $match: castFilter(base) }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      bucketCount('overdue'),
      bucketCount('due_today'),
      bucketCount('stuck'),
      bucketCount('on_time'),
      bucketCount('completed_late'),
      bucketCount('pending_today'),
    ]);

    // Sub-task hierarchy for the rows on this page.
    const kids = await descendants(items.map((t) => t._id));
    const byParent = new Map();
    for (const k of kids) {
      const p = String(k.parent);
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(k);
    }

    const counts = Object.fromEntries(DELEGATION_STATUS_VALUES.map((s) => [s, 0]));
    for (const r of statusRows) counts[r._id] = r.n;
    counts.all = Object.values(counts).reduce((a, b) => a + b, 0);
    counts.open = DELEGATION_OPEN_STATUSES.reduce((a, st) => a + counts[st], 0);
    counts.incomplete = counts.open + counts[S.AWAITING_VERIFICATION];
    Object.assign(counts, { overdue, due_today: dueToday, pending_today: pendingToday, stuck, on_time: onTime, completed_late: completedLate });

    const rows = items.map((t) => ({
      ...t.toJSON(),
      subtaskCount: byParent.get(String(t._id))?.length || 0,
      assigneeHierarchy: hierarchyChain(t._id, byParent),
    }));

    return { items: rows, meta: { ...buildMeta({ page, limit, total }), counts, branch } };
  },

  /** KPI tiles for "My Work" — scoped to the caller. */
  async summary(query, user) {
    const branch = await scopeService.resolveBranch(query.branch, user);
    const me = String(user.id);
    const b = branch ? { branch } : {};
    const live = { ...b, deletedAt: null };
    const now = new Date();
    const todayEnd = endOfDay(dateKey(now));
    const [totalAssigned, mine, overdue, dueToday, awaitingMyApproval, submittedByMe, loop, delegatedOpen, blocked, pendingToday] = await Promise.all([
      Delegation.countDocuments({ ...live, doer: me }),
      Delegation.countDocuments({ ...live, doer: me, status: { $in: DELEGATION_OPEN_STATUSES } }),
      Delegation.countDocuments({ ...live, doer: me, status: { $in: DELEGATION_OPEN_STATUSES }, dueDate: { $lt: now } }),
      Delegation.countDocuments({ ...live, doer: me, status: { $in: DELEGATION_OPEN_STATUSES }, dueDate: { $gte: startOfDay(dateKey(now)), $lte: todayEnd } }),
      Delegation.countDocuments({ ...live, assigner: me, status: S.AWAITING_VERIFICATION }),
      Delegation.countDocuments({ ...live, doer: me, status: S.AWAITING_VERIFICATION }),
      Delegation.countDocuments({ ...live, inLoop: me, doer: { $ne: me }, status: { $in: DELEGATION_OPEN_STATUSES } }),
      Delegation.countDocuments({ ...live, assigner: me, doer: { $ne: me }, status: { $in: DELEGATION_OPEN_STATUSES } }),
      Delegation.countDocuments({ ...live, doer: me, status: { $in: [S.BLOCKED, S.DEPENDENT] } }),
      Delegation.countDocuments({ ...live, doer: me, status: { $in: DELEGATION_OPEN_STATUSES }, dueDate: { $lte: todayEnd } }),
    ]);
    // Total pending = everything of mine not yet completed, whatever the due date.
    const totalPending = mine + submittedByMe;
    return { branch, totalAssigned, mine, totalPending, pendingToday, overdue, dueToday, awaitingMyApproval, submittedByMe, loop, delegatedOpen, blocked };
  },

  async getById(id, user) {
    const task = await Delegation.findById(id).populate([
      ...LIST_POPULATE,
      { path: 'inLoop', select: 'name avatarColor title' },
      { path: 'dependencyDetails.personId', select: 'name' },
      { path: 'shiftedFrom', select: 'code title' },
      { path: 'shiftedTo', select: 'code title' },
      { path: 'deletedBy', select: 'name' },
      { path: 'createdBy', select: 'name' },
    ]);
    if (!task) throw ApiError.notFound('Task not found');
    await assertCanView(task, user);

    const kids = await descendants([task._id]);
    const byParent = new Map();
    for (const k of kids) {
      const p = String(k.parent);
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(k);
    }
    const buildTree = (pid) =>
      (byParent.get(String(pid)) || []).map((k) => ({
        ...k,
        assigneeHierarchy: hierarchyChain(k._id, byParent),
        subtasks: buildTree(k._id),
      }));

    // Ancestors: the chain of parents above this task.
    const ancestors = [];
    let cursor = task.parent?._id || task.parent;
    for (let i = 0; cursor && i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const p = await Delegation.findById(cursor).select('title code status dueDate parent doer').populate('doer', 'name').lean();
      if (!p) break;
      ancestors.unshift(p);
      cursor = p.parent;
    }

    // Remarks roll up from the whole sub-task tree, oldest first (a chat thread).
    const treeIds = [task._id, ...kids.map((k) => k._id)];
    const titleOf = new Map(kids.map((k) => [String(k._id), k.title]));
    const [remarks, revisions, reminders, followups, activity] = await Promise.all([
      DelegationRemark.find({ delegation: { $in: treeIds } }).sort({ createdAt: 1 }).populate('author', 'name avatarColor title').lean(),
      DelegationRevision.find({ delegation: task._id }).sort({ createdAt: -1 }).populate('changedBy', 'name').lean(),
      DelegationReminder.find({ delegation: task._id }).sort({ fireAt: 1 }).lean(),
      DelegationFollowup.find({ delegation: task._id }).sort({ createdAt: -1 }).populate('follower', 'name avatarColor').lean(),
      workLogService.forRef(task._id, 40),
    ]);

    return {
      ...task.toJSON(),
      subtasks: buildTree(task._id),
      ancestors,
      assigneeHierarchy: hierarchyChain(task._id, byParent),
      remarks: remarks.map((r) =>
        String(r.delegation) === String(task._id)
          ? r
          : { ...r, fromSubtask: true, subtaskTitle: titleOf.get(String(r.delegation)) },
      ),
      revisions,
      reminders,
      followups,
      activity,
      can: capabilities(task, user),
    };
  },

  /* ---------------------------------------------------------------- */
  /* Create                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Create one task per selected doer. Optional: sub-task of a parent,
   * group, repeat rule, reminders, checklist, evidence/verification.
   */
  async create(data, user) {
    assertNotViewer(user);
    const doers = [...new Set(data.doers.map(String))];
    await assertPeople([...doers, ...(data.inLoop || [])]);

    let parent = null;
    if (data.parent) {
      parent = await Delegation.findById(data.parent);
      if (!parent || parent.deletedAt) throw ApiError.badRequest('The parent task no longer exists');
      await assertCanView(parent, user);
    }

    // Sub-tasks live in their parent's branch; "all" is a view, never a home.
    const branch = parent
      ? idOf(parent.branch)
      : await scopeService.resolveBranch(data.branch === 'all' ? undefined : data.branch, user);
    const group = data.group || (parent ? idOf(parent.group) : null) || undefined;

    const todayKey = dateKey();
    const repeat = data.repeat || null;
    // A routine that has already started gets today's instance now; the nightly
    // job creates every later one.
    const firstDue = repeat && (repeat.startDate || todayKey) <= todayKey ? endOfDay(todayKey) : parseDue(data.dueDate);
    if (!firstDue) throw ApiError.badRequest('A valid due date is required');

    const reminders = data.reminders?.length ? data.reminders : DEFAULT_REMINDERS;
    const created = [];

    for (const doer of doers) {
      // Sub-task visibility: the parent's assigner and loop follow the child.
      let inLoop = [...new Set((data.inLoop || []).map(String))];
      if (parent) {
        inLoop.push(idOf(parent.assigner), ...(parent.inLoop || []).map(String));
      }
      inLoop = [...new Set(inLoop)].filter((id) => id && id !== doer);

      // eslint-disable-next-line no-await-in-loop
      const code = await nextCode('delegation', 'DLG');
      // eslint-disable-next-line no-await-in-loop
      const task = await Delegation.create({
        code,
        title: data.title,
        description: data.description,
        assigner: user.id,
        doer,
        inLoop,
        branch,
        group,
        parent: parent?._id,
        category: data.category,
        tags: data.tags || [],
        priority: data.priority,
        status: S.PENDING,
        dueDate: firstDue,
        checklistItems: (data.checklistItems || []).map((c) => ({ text: c.text, completed: false })),
        evidenceRequired: Boolean(data.evidenceRequired),
        verificationRequired: Boolean(data.verificationRequired),
        voiceNoteUrl: data.voiceNoteUrl,
        referenceDocs: data.referenceDocs || [],
        createdBy: user.id,
      });

      if (repeat) {
        // eslint-disable-next-line no-await-in-loop
        const rule = await DelegationRecurrence.create({
          source: task._id,
          frequency: repeat.frequency,
          startDate: repeat.startDate || todayKey,
          endDate: repeat.endDate || undefined,
          weeklyDays: repeat.weeklyDays || [],
          monthDates: (repeat.monthDates || []).map(String),
          intervalDays: repeat.intervalDays,
          custom: repeat.custom,
          lastGeneratedFor: dateKey(firstDue),
          blueprint: {
            title: task.title,
            description: task.description,
            assigner: user.id,
            doer,
            inLoop,
            branch,
            group,
            category: task.category,
            tags: task.tags,
            priority: task.priority,
            checklistItems: task.checklistItems.map((c) => ({ text: c.text })),
            evidenceRequired: task.evidenceRequired,
            verificationRequired: task.verificationRequired,
            voiceNoteUrl: task.voiceNoteUrl,
            referenceDocs: task.referenceDocs,
            reminders,
          },
          createdBy: user.id,
        });
        task.recurrence = rule._id;
        // eslint-disable-next-line no-await-in-loop
        await task.save();
      }

      // eslint-disable-next-line no-await-in-loop
      await writeReminders(task._id, task.dueDate, reminders);

      notificationService.notify({
        recipients: [doer],
        exclude: user.id,
        title: parent ? 'New sub-task assigned to you' : 'New task assigned to you',
        message: `${user.name} assigned you "${task.title}" (${code}) — due ${fmtDay(task.dueDate)}.${repeat ? ` Repeats ${repeat.frequency}.` : ''}`,
        module: 'delegation',
        kind: 'assigned',
        refId: task._id,
        link: taskLink(task._id),
      });
      if (inLoop.length) {
        notificationService.notify({
          recipients: inLoop,
          exclude: user.id,
          title: 'You were added to a task loop',
          message: `You're following "${task.title}" (${code}), assigned by ${user.name}.`,
          module: 'delegation',
          kind: 'loop',
          refId: task._id,
          link: taskLink(task._id),
        });
      }
      audit(task, user.id, parent ? 'subtask_created' : 'created', parent ? `Sub-task added under ${parent.code}` : `Task ${code} assigned`);
      created.push(task);
    }

    return Delegation.find({ _id: { $in: created.map((t) => t._id) } }).populate(LIST_POPULATE);
  },

  /* ---------------------------------------------------------------- */
  /* Edit / delete                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Field edits. The assigner (or an admin) edits the task itself; the doer may
   * only tick checklist items and attach evidence / references. Status and
   * deadline changes go through their own lifecycle endpoints.
   */
  async update(id, data, user) {
    assertNotViewer(user);
    const task = await Delegation.findById(id);
    if (!task || task.deletedAt) throw ApiError.notFound('Task not found');
    const r = await assertCanView(task, user);
    const owner = r.isAdmin || r.isAssigner;
    if (!owner && !r.isDoer) throw ApiError.forbidden('Only the assigner, the doer or an admin can edit this task');

    const OWNER_FIELDS = ['title', 'description', 'category', 'tags', 'priority', 'inLoop', 'group', 'evidenceRequired', 'verificationRequired', 'voiceNoteUrl', 'referenceDocs', 'evidenceUrls', 'branch'];
    const DOER_FIELDS = ['evidenceUrls', 'voiceNoteUrl', 'referenceDocs'];
    const allowed = owner ? OWNER_FIELDS : DOER_FIELDS;
    const attempted = Object.keys(data).filter((k) => k !== 'checklistItems');
    const forbidden = attempted.filter((k) => !allowed.includes(k));
    if (forbidden.length) throw ApiError.forbidden(`As the doer you can't change: ${forbidden.join(', ')}`);

    if (data.inLoop) await assertPeople(data.inLoop);
    if (data.branch && !(await scopeService.branchExists(data.branch))) throw ApiError.badRequest('Unknown or inactive branch');

    for (const k of allowed) if (data[k] !== undefined) task[k] = data[k];
    if (data.inLoop) task.inLoop = [...new Set(data.inLoop.map(String))].filter((u) => u !== idOf(task.doer));
    if (data.group === null) task.group = undefined;

    if (data.checklistItems) {
      if (owner) {
        // Owners may restructure the checklist; ticks on surviving items are kept.
        const prev = new Map(task.checklistItems.map((c) => [String(c._id), c.completed]));
        task.checklistItems = data.checklistItems.map((c) => ({
          _id: c._id,
          text: c.text,
          completed: c.completed ?? (c._id ? prev.get(String(c._id)) || false : false),
        }));
      } else {
        // The doer only ticks existing items.
        const ticks = new Map(data.checklistItems.filter((c) => c._id).map((c) => [String(c._id), Boolean(c.completed)]));
        task.checklistItems.forEach((c) => {
          if (ticks.has(String(c._id))) c.completed = ticks.get(String(c._id));
        });
      }
    }

    await task.save();
    const onlyTicks = Object.keys(data).length === 1 && data.checklistItems;
    if (!onlyTicks) {
      notifyInvolved(task, user.id, {
        title: 'Task updated',
        message: `${user.name} updated "${task.title}" (${task.code}).`,
        kind: 'updated',
      });
    }
    audit(task, user.id, 'updated', onlyTicks ? 'Checklist progress updated' : 'Task details updated');
    return this.getById(id, user);
  },

  /** Soft delete — the task and its sub-tasks move to the trash. */
  async remove(id, user) {
    assertNotViewer(user);
    const task = await Delegation.findById(id);
    if (!task || task.deletedAt) throw ApiError.notFound('Task not found');
    const r = relation(task, user);
    if (!r.isAdmin && !r.isAssigner) throw ApiError.forbidden('Only the assigner or an admin can delete this task');

    const now = new Date();
    const kids = await descendants([task._id]);
    await Delegation.updateMany(
      { _id: { $in: [task._id, ...kids.map((k) => k._id)] } },
      { deletedAt: now, deletedBy: user.id },
    );
    if (task.recurrence) await DelegationRecurrence.updateOne({ _id: task.recurrence, source: task._id }, { isActive: false });
    audit(task, user.id, 'deleted', `Moved to trash${kids.length ? ` with ${kids.length} sub-task(s)` : ''}`);
    return { deleted: 1 + kids.length };
  },

  async restore(id, user) {
    assertNotViewer(user);
    const task = await Delegation.findById(id);
    if (!task || !task.deletedAt) throw ApiError.notFound('Deleted task not found');
    const r = relation(task, user);
    if (!r.isAdmin && !r.isAssigner) throw ApiError.forbidden('Only the assigner or an admin can restore this task');

    // Bring back the sub-tasks that went to the trash together with it.
    const kids = await descendants([task._id], { includeDeleted: true });
    const window = 5_000;
    const sameBatch = kids.filter((k) => k.deletedAt && Math.abs(new Date(k.deletedAt) - task.deletedAt) <= window);
    await Delegation.updateMany(
      { _id: { $in: [task._id, ...sameBatch.map((k) => k._id)] } },
      { $unset: { deletedAt: 1, deletedBy: 1 } },
    );
    audit(task, user.id, 'restored', 'Restored from trash');
    return { restored: 1 + sameBatch.length };
  },

  async listDeleted(query, user) {
    const filter = { deletedAt: { $ne: null } };
    const branch = await scopeService.resolveBranch(query.branch, user);
    if (branch) filter.branch = branch;
    if (!scopeService.isAdmin(user)) filter.assigner = user.id;
    if (query.search) {
      const rx = containsRegex(query.search);
      filter.$or = [{ title: rx }, { code: rx }];
    }
    if (query.from || query.to) {
      filter.deletedAt = { $ne: null };
      if (query.from) filter.deletedAt.$gte = startOfDay(query.from);
      if (query.to) filter.deletedAt.$lte = endOfDay(query.to);
    }
    return Delegation.find(filter)
      .sort({ deletedAt: -1 })
      .limit(500)
      .select('-managementRemark -coordinatorRemark')
      .populate([...LIST_POPULATE, { path: 'deletedBy', select: 'name' }]);
  },

  /* ---------------------------------------------------------------- */
  /* Conversation                                                      */
  /* ---------------------------------------------------------------- */

  async addComment(id, { body, attachments }, user) {
    assertNotViewer(user);
    const task = await Delegation.findById(id);
    if (!task || task.deletedAt) throw ApiError.notFound('Task not found');
    const r = await assertCanView(task, user);

    const remark = await DelegationRemark.create({ delegation: task._id, author: user.id, body, attachments: attachments || [], kind: 'comment' });

    // A loop member commenting is usually asking the doer for something —
    // tell the doer as a request, everyone else as a normal remark.
    const loopAsk = r.isLoop && !r.isAssigner && !r.isDoer;
    const doerId = idOf(task.doer);
    if (loopAsk && doerId !== String(user.id)) {
      notificationService.notify({
        recipients: [doerId],
        title: 'Action needed — comment from the loop',
        message: `${user.name} (in the loop) commented on "${task.title}": ${body}`,
        module: 'delegation',
        kind: 'remark',
        refId: task._id,
        link: taskLink(task._id),
      });
    }
    notificationService.notify({
      recipients: involvedIds(task).filter((u) => !(loopAsk && u === doerId)),
      exclude: user.id,
      title: 'New comment',
      message: `${user.name} on "${task.title}": ${body}`,
      module: 'delegation',
      kind: 'remark',
      refId: task._id,
      link: taskLink(task._id),
      email: false,
    });
    audit(task, user.id, 'remark', body.slice(0, 280));
    return remark.populate('author', 'name avatarColor title');
  },

  /** People this user has recently assigned to or looped in — surfaced first in pickers. */
  async recentCollaborators(user) {
    const rows = await Delegation.find({ assigner: user.id, deletedAt: null })
      .sort({ createdAt: -1 })
      .limit(200)
      .select('doer inLoop')
      .lean();
    const doers = [];
    const loop = [];
    for (const r of rows) {
      if (r.doer && !doers.includes(String(r.doer))) doers.push(String(r.doer));
      for (const l of r.inLoop || []) if (!loop.includes(String(l))) loop.push(String(l));
    }
    return { doerIds: doers.slice(0, 50), inLoopIds: loop.slice(0, 50) };
  },

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */

  listTemplates: () => DelegationTemplate.find().sort({ title: 1 }).populate('createdBy', 'name'),

  async createTemplate(data, user) {
    assertNotViewer(user);
    return DelegationTemplate.create({ ...data, createdBy: user.id });
  },

  async updateTemplate(id, data, user) {
    const t = await DelegationTemplate.findById(id);
    if (!t) throw ApiError.notFound('Template not found');
    if (!scopeService.isAdmin(user) && String(t.createdBy) !== String(user.id)) {
      throw ApiError.forbidden('Only the template author or an admin can edit it');
    }
    Object.assign(t, data);
    return t.save();
  },

  async removeTemplate(id, user) {
    const t = await DelegationTemplate.findById(id);
    if (!t) throw ApiError.notFound('Template not found');
    if (!scopeService.isAdmin(user) && String(t.createdBy) !== String(user.id)) {
      throw ApiError.forbidden('Only the template author or an admin can delete it');
    }
    await t.deleteOne();
  },

  /* ---------------------------------------------------------------- */
  /* Recurrences                                                       */
  /* ---------------------------------------------------------------- */

  async listRecurrences(query, user) {
    const filter = {};
    const branch = await scopeService.resolveBranch(query.branch, user);
    if (branch) filter['blueprint.branch'] = branch;
    if (!scopeService.isAdmin(user)) {
      filter.$or = [{ 'blueprint.assigner': user.id }, { 'blueprint.doer': user.id }, { 'blueprint.inLoop': user.id }];
    }
    if (query.active === 'true') filter.isActive = true;
    const rules = await DelegationRecurrence.find(filter)
      .sort({ createdAt: -1 })
      .populate('blueprint.doer', 'name avatarColor')
      .populate('blueprint.assigner', 'name avatarColor')
      .lean();
    const today = dateKey();
    return rules.map((r) => ({ ...r, nextDates: r.isActive ? previewDates(r, today > r.startDate ? today : r.startDate, 3) : [] }));
  },

  /** One repeat rule with its upcoming dates and the instances it has produced. */
  async getRecurrence(id, user) {
    const rule = await DelegationRecurrence.findById(id)
      .populate('blueprint.doer', 'name avatarColor title')
      .populate('blueprint.assigner', 'name avatarColor')
      .populate('blueprint.inLoop', 'name avatarColor')
      .populate('blueprint.group', 'name color')
      .populate('blueprint.branch', 'name code')
      .lean();
    if (!rule) throw ApiError.notFound('Repeat rule not found');
    const me = String(user.id);
    const involved = [rule.blueprint.assigner?._id, rule.blueprint.doer?._id, ...(rule.blueprint.inLoop || []).map((u) => u._id)].map(String);
    if (!scopeService.isAdmin(user) && !involved.includes(me)) {
      throw ApiError.notFound('Repeat rule not found');
    }
    const counts = await Delegation.aggregate([
      { $match: { recurrence: rule._id, deletedAt: null } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const today = dateKey();
    return {
      ...rule,
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
      nextDates: rule.isActive ? previewDates(rule, today > rule.startDate ? today : rule.startDate, 6) : [],
      canEdit: scopeService.isAdmin(user) || String(rule.blueprint.assigner?._id) === me,
    };
  },

  async updateRecurrence(id, data, user) {
    assertNotViewer(user);
    const rule = await DelegationRecurrence.findById(id);
    if (!rule) throw ApiError.notFound('Repeat rule not found');
    if (!scopeService.isAdmin(user) && String(rule.blueprint.assigner) !== String(user.id)) {
      throw ApiError.forbidden('Only the assigner or an admin can change this repeat rule');
    }
    if (data.isActive !== undefined) rule.isActive = data.isActive;
    if (data.endDate !== undefined) rule.endDate = data.endDate || undefined;
    await rule.save();
    return rule;
  },

  /** Preview a repeat rule before saving it. */
  preview(rule) {
    const from = rule.startDate || dateKey();
    return previewDates(rule, from, 6);
  },
};

export default delegationService;
