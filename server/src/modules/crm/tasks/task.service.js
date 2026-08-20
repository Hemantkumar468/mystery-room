import mongoose from 'mongoose';
import { CrmTask } from './task.model.js';
import { rulesFor, dedupeKey } from './rules.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { resolveAssignee } from '../shared/ownership.js';
import { User } from '../../auth/auth.model.js';
import {
  TASK_STATUS, TASK_TYPE_VALUES, TASK_DEFAULT_MINUTES, ENTITY_TYPE,
} from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Tasks: creating them, finishing them, and the rule engine that produces them
 * without anybody asking.
 */

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

/**
 * Overdue work belonging to everybody EXCEPT the person asking.
 *
 * Grouped by owner rather than listed flat: a manager's question is "whose
 * queue is on fire", not "what are the ninety oldest tasks in the company" —
 * and the answer to the first is actionable in a way the second never is.
 *
 * Returns `null` for anyone who is not a manager, so the client can simply
 * check for its presence rather than duplicating the role rule.
 */
async function teamOverdue(user) {
  if (!canManageCrm(user)) return null;
  const me = String(user._id || user.id);

  const rows = await CrmTask.aggregate([
    { $match: { status: TASK_STATUS.OPEN, dueAt: { $lt: startOfToday() } } },
    {
      $group: {
        _id: '$owner',
        overdue: { $sum: 1 },
        oldest: { $min: '$dueAt' },
      },
    },
    { $sort: { overdue: -1 } },
    { $limit: 25 },
  ]);

  const owners = await User.find({ _id: { $in: rows.map((r) => r._id) } })
    // `isActive` is `select: false` on the schema, so it has to be asked for.
    .select('name avatarColor +isActive')
    .lean();
  const byId = new Map(owners.map((u) => [String(u._id), u]));

  return rows
    .filter((r) => String(r._id) !== me)
    .map((r) => {
      const owner = byId.get(String(r._id));
      return {
        owner: owner ? { _id: owner._id, name: owner.name, avatarColor: owner.avatarColor } : null,
        overdue: r.overdue,
        oldest: r.oldest,
        /** The row a manager must act on first: nobody is coming back to it. */
        ownerInactive: owner ? owner.isActive === false : true,
      };
    });
}

/**
 * Did anything actually happen to back this completion up?
 *
 * A call-type task is corroborated by a real call activity against the same
 * record, logged by a channel rather than typed by the person claiming credit.
 * The window is generous — a rep ticks the task after the call, sometimes an
 * hour after — because a false `self_reported` is a mild inaccuracy while a
 * false `telephony` is a lie the reporting would repeat.
 *
 * Returns `self_reported` when nothing corroborates it, which today is always.
 */
const EVIDENCE_WINDOW_MINUTES = 120;

const EVIDENCE_FOR_TYPE = {
  call: ['call'],
  meeting: ['meeting'],
  demo: ['meeting'],
  site_visit: ['meeting'],
  email: ['email'],
};

async function evidenceFor(task) {
  const wanted = EVIDENCE_FOR_TYPE[task.type];
  if (!wanted || !task.entityId) return 'self_reported';

  const { CrmActivity } = await import('../activities/crmActivity.model.js');
  const hit = await CrmActivity.findOne({
    entityType: task.entityType,
    entityId: task.entityId,
    type: { $in: wanted },
    // Only channel-written rows carry a provider id. One typed in by hand is
    // the same claim as the tick itself, so it proves nothing.
    providerEventId: { $exists: true, $ne: null },
    occurredAt: { $gte: new Date(Date.now() - EVIDENCE_WINDOW_MINUTES * 60_000) },
  }).select('_id type').lean();

  if (!hit) return 'self_reported';
  // eslint-disable-next-line no-param-reassign
  task.completionEvidence = hit._id;
  return hit.type === 'call' ? 'telephony' : hit.type;
}

export const taskService = {
  /**
   * THE "TODAY" SCREEN, in one call.
   *
   * Ordered by what the reader should do, not by what is easy to compute:
   * overdue first because it is somebody's failure, then today's work, then
   * what has arrived, then what is going stale. An agent who opens the CRM and
   * immediately knows what to do keeps opening it; one who has to assemble
   * that answer from three screens does not.
   */
  async today(user) {
    const me = user._id || user.id;
    const [overdue, dueToday, upcoming, newLeads, stalled] = await Promise.all([
      CrmTask.find({ owner: me, status: TASK_STATUS.OPEN, dueAt: { $lt: startOfToday() } })
        .sort({ dueAt: 1 }).limit(50).lean(),

      CrmTask.find({
        owner: me,
        status: TASK_STATUS.OPEN,
        dueAt: { $gte: startOfToday(), $lte: endOfToday() },
      }).sort({ dueAt: 1 }).limit(50).lean(),

      // Tomorrow onward, so "what is coming" is answerable without leaving the
      // page — but capped, because a list of everything is not a plan.
      CrmTask.find({ owner: me, status: TASK_STATUS.OPEN, dueAt: { $gt: endOfToday() } })
        .sort({ dueAt: 1 }).limit(10).lean(),

      // Imported lazily: leads.model importing tasks importing leads would be a
      // cycle, and this is the only place the task side needs it.
      (async () => {
        const { Lead } = await import('../leads/lead.model.js');
        return Lead.find({
          assignedTo: me,
          firstActivityAt: null,
          assignedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
        }).sort({ assignedAt: -1 }).limit(20)
          .select('name company city source assignedAt status').lean();
      })(),

      (async () => {
        const { Deal } = await import('../deals/deal.model.js');
        return Deal.find({
          assignedTo: me,
          closedAt: null,
          stageEnteredAt: { $lt: new Date(Date.now() - 7 * 86_400_000) },
        }).sort({ stageEnteredAt: 1 }).limit(20)
          .select('title value stage stageEnteredAt pipeline').lean();
      })(),
    ]);

    return {
      overdue,
      dueToday,
      upcoming,
      /** Assigned recently and never contacted — the leads that will be lost
       *  first, listed where the agent already is. */
      newLeads,
      /** Open deals sitting in one stage for over a week. */
      stalled,
      /**
       * EVERYONE ELSE'S OVERDUE WORK — managers only.
       *
       * Without this, an agent's overdue tasks live on exactly one screen:
       * their own. A week of leave is forty overdue follow-ups nobody sees,
       * and the customers behind them are simply never called back.
       *
       * Deactivated owners are flagged rather than filtered out. Somebody who
       * has left the company is precisely the person whose queue must be
       * looked at, and hiding those rows would make the problem invisible at
       * the moment it becomes permanent.
       */
      team: await teamOverdue(user),

      counts: {
        overdue: overdue.length,
        dueToday: dueToday.length,
        meetings: dueToday.filter((t) => ['meeting', 'demo', 'site_visit'].includes(t.type)).length,
        newLeads: newLeads.length,
        stalled: stalled.length,
      },
    };
  },

  async list(query, user) {
    const scope = buildScope(user, { field: 'owner' });
    const where = { ...scope };
    if (query.status) where.status = query.status;
    else where.status = TASK_STATUS.OPEN;
    if (query.type && TASK_TYPE_VALUES.includes(query.type)) where.type = query.type;
    if (query.entityId && mongoose.isValidObjectId(query.entityId)) where.entityId = query.entityId;

    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const [total, items] = await Promise.all([
      CrmTask.countDocuments(where),
      CrmTask.find(where).populate('owner', 'name avatarColor').sort({ dueAt: 1 }).limit(limit)
        .lean(),
    ]);
    return { total, items };
  },

  async create(body, user) {
    const title = String(body.title || '').trim();
    if (!title) throw ApiError.badRequest('A task needs a title');
    if (!body.dueAt) throw ApiError.badRequest('A task needs a due date — an undated task is a note');

    const type = TASK_TYPE_VALUES.includes(body.type) ? body.type : 'call';
    const task = new CrmTask({
      title,
      notes: body.notes,
      type,
      priority: body.priority,
      // Same rule as a deal: you may make work for yourself, only a manager
      // may make it for somebody else. Otherwise an agent can quietly load a
      // colleague's Today list with tasks they never agreed to.
      owner: await resolveAssignee(body.owner, user, {
        User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
      }),
      entityType: body.entityType,
      entityId: body.entityId,
      entityLabel: body.entityLabel,
      dueAt: new Date(body.dueAt),
      durationMinutes: body.durationMinutes ?? TASK_DEFAULT_MINUTES[type],
      reminderOffsetMinutes: body.reminderOffsetMinutes ?? null,
      createdBy: user._id || user.id,
    });
    await task.save();
    return task.toObject();
  },

  /**
   * Finish a task.
   *
   * Completing one against a lead or deal also logs an activity, which is what
   * keeps `firstActivityAt` and the "never contacted" count honest: a rep who
   * ticks off "call them" has, by their own account, called them.
   */
  async complete(id, user) {
    const scope = buildScope(user, { field: 'owner' });
    const task = await CrmTask.findOne({ _id: id, ...scope });
    if (!task) throw ApiError.notFound('Task not found');
    if (task.status === TASK_STATUS.DONE) return task.toObject();

    task.status = TASK_STATUS.DONE;
    task.completedAt = new Date();

    /**
     * Look for something that corroborates the claim.
     *
     * Right now nothing can: no channel writes call or message activities yet,
     * so every completion is `self_reported` and the field says so honestly.
     * When telephony lands this same lookup starts finding real calls and the
     * source becomes `telephony` without another line changing — which is the
     * point of writing it now rather than later.
     */
    task.completionSource = await evidenceFor(task);

    await task.save();

    if (task.entityType && task.entityId) {
      const { CrmActivity } = await import('../activities/crmActivity.model.js');
      await CrmActivity.create({
        type: task.type === 'call' ? 'call' : 'note',
        entityType: task.entityType,
        entityId: task.entityId,
        subject: `Task done: ${task.title}`,
        actor: user._id || user.id,
        occurredAt: task.completedAt,
      });

      if (task.entityType === ENTITY_TYPE.LEAD) {
        const { Lead } = await import('../leads/lead.model.js');
        // Only if it has never been stamped — this is FIRST contact, and a
        // field that moves on every completion would measure the last one.
        await Lead.updateOne(
          { _id: task.entityId, firstActivityAt: null },
          { $set: { firstActivityAt: task.completedAt, lastActivityAt: task.completedAt } },
        );
      }
    }

    return task.toObject();
  },

  async cancel(id, user) {
    const scope = buildScope(user, { field: 'owner' });
    const task = await CrmTask.findOneAndUpdate(
      { _id: id, ...scope },
      { $set: { status: TASK_STATUS.CANCELLED } },
      { new: true },
    ).lean();
    if (!task) throw ApiError.notFound('Task not found');
    return task;
  },

  /**
   * Run the rule engine for one event.
   *
   * NEVER THROWS. A rule that fails must not take down the thing that
   * triggered it — losing a captured lead because its follow-up task could not
   * be written would be a far worse outcome than a missing task.
   *
   * @param {string} event      one of CRM_EVENT
   * @param {object} ctx
   * @param {object} ctx.record       the lead or deal
   * @param {string} ctx.entityType
   * @param {string} [ctx.stageName]  for stage-change events
   * @param {boolean} [ctx.isWon]
   */
  async runRules(event, ctx) {
    const rules = rulesFor(event);
    if (!rules.length) return [];

    const made = [];
    for (const rule of rules) {
      try {
        if (rule.when && !rule.when(ctx)) continue;

        const owner = ctx.record.assignedTo || ctx.record.owner;
        // A task nobody owns appears on nobody's Today screen — which is the
        // same as not creating it, except that it also clutters the database.
        if (!owner) continue;

        const key = dedupeKey(rule, ctx.entityType, ctx.record._id);
        // eslint-disable-next-line no-await-in-loop
        const already = await CrmTask.findOne({
          createdByRule: key, status: TASK_STATUS.OPEN,
        }).select('_id').lean();
        if (already) continue;

        const template = rule.task(ctx);
        // eslint-disable-next-line no-await-in-loop
        const task = await new CrmTask({
          ...template,
          owner,
          entityType: ctx.entityType,
          entityId: ctx.record._id,
          entityLabel: ctx.record.name || ctx.record.title,
          durationMinutes: template.durationMinutes ?? TASK_DEFAULT_MINUTES[template.type],
          createdByRule: key,
        }).save();

        made.push(task.toObject());
      } catch (err) {
        logger.error(`CRM rule "${rule.key}" failed on ${event}: ${err.message}`);
      }
    }

    if (made.length) logger.info(`CRM rules: ${made.length} task(s) created on ${event}`);
    return made;
  },
};

export default taskService;
