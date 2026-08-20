import mongoose from 'mongoose';
import { Deal } from './deal.model.js';
import { Pipeline } from '../pipelines/pipeline.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { resolveAssignee } from '../shared/ownership.js';
import { User } from '../../auth/auth.model.js';
import { taskService } from '../tasks/task.service.js';
import {
  ACTIVITY_TYPE, ENTITY_TYPE, LOST_REASON_VALUES, CRM_EVENT,
  BOARD_ORDER_STEP, MIN_BOARD_GAP, TICKET_PRIORITY,
} from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Deals, and the board they live on.
 *
 * The two things this file exists to get right:
 *
 *   1. EVERY stage change writes history. Not most of them — a transition that
 *      skips `stageHistory` is a hole in the velocity data that cannot be
 *      filled in later, because the information was never recorded.
 *   2. Moving a card is ONE write. Gapped ordering means a drop between two
 *      cards takes their midpoint; renumbering a whole column on every drag is
 *      what makes a board feel slow at exactly the moment it is being used.
 */

/** The stage subdocument, or a clear refusal naming what was wrong. */
function stageIn(pipeline, stageId) {
  const stage = pipeline.stages.id(stageId);
  if (!stage) {
    throw ApiError.badRequest(
      `That stage does not belong to the "${pipeline.name}" pipeline`,
      { code: 'STAGE_NOT_IN_PIPELINE' },
    );
  }
  return stage;
}

/**
 * Close the open history entry and open a new one.
 *
 * `durationHours` is computed HERE, at the moment of the move, rather than
 * derived on read: the entry it belongs to is already in hand, and a figure
 * recomputed on every report is a figure that changes if the clock, the
 * timezone or the rounding ever does.
 */
function recordTransition(deal, stage, at, actorId) {
  const open = deal.stageHistory.find((h) => h.exitedAt == null);
  if (open) {
    open.exitedAt = at;
    open.durationHours = Math.round(((at - open.enteredAt) / 3_600_000) * 100) / 100;
  }
  deal.stageHistory.push({
    stageId: stage._id,
    stageName: stage.name,
    enteredAt: at,
    exitedAt: null,
    durationHours: null,
    movedBy: actorId,
  });
  deal.stageEnteredAt = at;
}

/**
 * Where in the column a card dropped between two neighbours belongs.
 *
 * Returns `null` when the neighbours are too close together to fit anything
 * between them — the caller renormalises the column and retries. That is rare
 * (it takes ~7 drops into the same gap) and costs one bulk write when it
 * happens, which is the trade being made: one occasional renumber instead of a
 * renumber on every single drag.
 */
function orderBetween(before, after) {
  if (before == null && after == null) return BOARD_ORDER_STEP;
  if (before == null) return after - BOARD_ORDER_STEP;
  if (after == null) return before + BOARD_ORDER_STEP;
  if (after - before < MIN_BOARD_GAP) return null;
  return Math.round((before + after) / 2);
}

/** Rewrite one column's positions back to clean multiples. */
async function renormalise(pipelineId, stageId) {
  const deals = await Deal.find({ pipeline: pipelineId, stage: stageId })
    .select('_id').sort({ boardOrder: 1, createdAt: 1 }).lean();

  if (!deals.length) return;
  await Deal.bulkWrite(deals.map((d, i) => ({
    updateOne: {
      filter: { _id: d._id },
      update: { $set: { boardOrder: (i + 1) * BOARD_ORDER_STEP } },
    },
  })));
}

export const dealService = {
  /**
   * THE BOARD, in one round trip: stages, their deals, and each column's
   * count and value.
   *
   * One call rather than one-per-column because the columns have to describe
   * the same instant — a board assembled from seven requests shows a deal in
   * two places whenever somebody else moves one while it loads. The totals are
   * computed from the same rows the columns render, so a header reading
   * "12 · ₹48L" can never disagree with the cards beneath it.
   */
  async board(pipelineId, user, query = {}) {
    const pipeline = pipelineId
      ? await Pipeline.findById(pipelineId)
      : await Pipeline.findOne({ isDefault: true, isActive: true });

    if (!pipeline) {
      throw ApiError.notFound('No pipeline is set up yet', { code: 'NO_PIPELINE' });
    }

    const scope = buildScope(user);
    const where = { ...scope, pipeline: pipeline._id };
    if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo)) {
      where.assignedTo = query.assignedTo;
    }
    if (query.search) {
      where.title = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const deals = await Deal.find(where)
      .populate('assignedTo', 'name avatarColor')
      .populate('contact', 'name')
      .sort({ boardOrder: 1, createdAt: 1 })
      .lean();

    const byStage = new Map();
    for (const d of deals) {
      const k = String(d.stage);
      if (!byStage.has(k)) byStage.set(k, []);
      byStage.get(k).push(d);
    }

    const stages = pipeline.orderedStages().map((s) => {
      const cards = byStage.get(String(s._id)) || [];
      return {
        _id: s._id,
        name: s.name,
        // The board renders this under the English name. Sent from the stage
        // rather than mapped in the client, so a rename cannot leave the old
        // Hindi sitting under the new English.
        labelHi: s.labelHi,
        order: s.order,
        probability: s.probability,
        isWon: s.isWon,
        isLost: s.isLost,
        exitCriteria: s.exitCriteria,
        count: cards.length,
        value: cards.reduce((sum, d) => sum + (d.value || 0), 0),
        deals: cards,
      };
    });

    return {
      pipeline: { _id: pipeline._id, name: pipeline.name, isDefault: pipeline.isDefault },
      stages,
      totals: {
        count: deals.length,
        value: deals.reduce((sum, d) => sum + (d.value || 0), 0),
        /** Σ(value × stage probability) — the weighted forecast. Arithmetic,
         *  not a prediction, which is exactly why it is trustworthy. */
        weighted: Math.round(stages.reduce(
          (sum, s) => sum + (s.value * (s.probability || 0)) / 100, 0,
        )),
      },
    };
  },

  /**
   * @param {object} body   the deal, as a form or a seeder describes it
   * @param {object} user   who is creating it
   * @param {object} [opts]
   * @param {boolean} [opts.isSeed]  mark this as demo data. A SECOND argument
   *   rather than a field on `body`, because `body` comes from an HTTP request
   *   on the route path — a caller who could set it there could hide their own
   *   deals from any report that ever learns to filter on the flag.
   */
  async create(body, user, opts = {}) {
    const pipeline = body.pipeline
      ? await Pipeline.findById(body.pipeline)
      : await Pipeline.findOne({ isDefault: true, isActive: true });
    if (!pipeline) throw ApiError.badRequest('No pipeline to put this deal in', { code: 'NO_PIPELINE' });

    // First stage by order, not `stages[0]` — the array's storage order is not
    // the display order once a stage has been inserted in the middle.
    const stage = body.stage ? stageIn(pipeline, body.stage) : pipeline.orderedStages()[0];

    const title = String(body.title || '').trim();
    if (!title) throw ApiError.badRequest('A deal needs a title');

    const last = await Deal.findOne({ pipeline: pipeline._id, stage: stage._id })
      .sort({ boardOrder: -1 }).select('boardOrder').lean();

    const now = new Date();
    const deal = new Deal({
      title,
      pipeline: pipeline._id,
      stage: stage._id,
      value: Number(body.value) || 0,
      expectedCloseDate: body.expectedCloseDate || undefined,
      lead: body.lead || undefined,
      contact: body.contact || undefined,
      company: body.company || undefined,
      // Validated, not trusted: only a manager may hand a deal to someone
      // else, and never to a role that cannot work one.
      assignedTo: await resolveAssignee(body.assignedTo, user, {
        User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
      }),
      boardOrder: (last?.boardOrder || 0) + BOARD_ORDER_STEP,
      isSeed: Boolean(opts.isSeed),
      createdBy: user._id || user.id,
    });
    // The first history entry is the deal entering its first stage — without
    // it, time-in-first-stage is unmeasurable for every deal ever created.
    recordTransition(deal, stage, now, user._id || user.id);
    await deal.save();

    await CrmActivity.create({
      type: ACTIVITY_TYPE.SYSTEM,
      entityType: ENTITY_TYPE.DEAL,
      entityId: deal._id,
      subject: `Deal created in ${stage.name}`,
      actor: user._id || user.id,
      occurredAt: now,
    });

    return Deal.findById(deal._id).populate('assignedTo', 'name avatarColor').lean();
  },

  /**
   * Move a card: to another stage, to another position, or both.
   *
   * @param {object} move
   * @param {string} [move.stage]        target stage id
   * @param {number} [move.beforeOrder]  boardOrder of the card it lands above
   * @param {number} [move.afterOrder]   boardOrder of the card it lands below
   * @param {string} [move.lostReason]   required when the target stage is lost
   */
  async move(id, move, user) {
    const scope = buildScope(user);
    const deal = await Deal.findOne({ _id: id, ...scope });
    if (!deal) throw ApiError.notFound('Deal not found');

    const pipeline = await Pipeline.findById(deal.pipeline);
    if (!pipeline) throw ApiError.badRequest('This deal\'s pipeline no longer exists');

    const targetStage = move.stage ? stageIn(pipeline, move.stage) : pipeline.stages.id(deal.stage);
    const changingStage = String(targetStage._id) !== String(deal.stage);

    /* A lost deal must say why, BEFORE anything is written. Asking afterwards
       produces rows with no reason whenever somebody closes the tab. */
    if (changingStage && targetStage.isLost) {
      if (!LOST_REASON_VALUES.includes(move.lostReason)) {
        throw ApiError.badRequest(
          `Pick why this was lost: ${LOST_REASON_VALUES.join(', ')}`,
          { code: 'LOST_REASON_REQUIRED', details: { reasons: LOST_REASON_VALUES } },
        );
      }
      deal.lostReason = move.lostReason;
      deal.lostNotes = move.lostNotes ? String(move.lostNotes).slice(0, 1000) : undefined;

      /* WHERE it died, captured at the moment it dies. The open history entry
         is the stage it is leaving, which is exactly the answer. Read here
         rather than derived later because "losing at the first stage is a lead
         problem, losing at Price Talk is a sales problem" is the question this
         whole analysis turns on, and it must not depend on history staying
         perfectly intact. */
      const leaving = deal.stageHistory.find((h) => h.exitedAt == null);
      if (leaving) {
        deal.lostAtStage = leaving.stageId;
        deal.lostAtStageName = leaving.stageName;
      }
    }

    const now = new Date();
    if (changingStage) {
      recordTransition(deal, targetStage, now, user._id || user.id);
      deal.stage = targetStage._id;

      // `closedAt` always means "closed right now", so reopening clears it —
      // otherwise a reopened deal keeps counting as won last quarter.
      if (targetStage.isWon || targetStage.isLost) {
        if (!deal.closedAt) deal.closedAt = now;
      } else {
        deal.closedAt = undefined;
        deal.lostReason = undefined;
        deal.lostNotes = undefined;
      }
    }

    /**
     * Where in the column it lands.
     *
     * The neighbours are identified BY ID, not by the order values the client
     * happened to see. Those values are a snapshot: if the column has to be
     * renormalised (below) they all change, and a midpoint computed from the
     * stale numbers puts the card on top of another one — two cards at
     * position 100, which the board then draws in an arbitrary order that
     * changes on every reload.
     */
    const neighbourOrder = async (dealId) => {
      if (!dealId || !mongoose.isValidObjectId(dealId)) return null;
      const n = await Deal.findOne({ _id: dealId, stage: targetStage._id }).select('boardOrder').lean();
      return n ? n.boardOrder : null;
    };

    let above = move.beforeId ? await neighbourOrder(move.beforeId) : (move.beforeOrder ?? null);
    let below = move.afterId ? await neighbourOrder(move.afterId) : (move.afterOrder ?? null);

    let order = orderBetween(above, below);
    if (order === null) {
      // No room between the neighbours. Spread the column back out, then read
      // the SAME two cards again — their positions have just changed.
      await renormalise(deal.pipeline, targetStage._id);
      above = move.beforeId ? await neighbourOrder(move.beforeId) : null;
      below = move.afterId ? await neighbourOrder(move.afterId) : null;

      order = orderBetween(above, below);
      if (order === null) {
        // Still nothing usable — the caller sent orders rather than ids, so
        // there is nothing left to re-resolve. Put it at the end of the column,
        // which is wrong-but-visible rather than stacked on another card.
        const last = await Deal.findOne({ pipeline: deal.pipeline, stage: targetStage._id })
          .sort({ boardOrder: -1 }).select('boardOrder').lean();
        order = (last?.boardOrder || 0) + BOARD_ORDER_STEP;
      }
    }
    deal.boardOrder = order;

    await deal.save();

    if (changingStage) {
      /* The stage a deal enters decides what its owner now owes: a demo needs
         a follow-up tomorrow, a negotiation needs a proposal today. Fired here
         rather than in the route so every caller of move() gets it. */
      await taskService.runRules(CRM_EVENT.DEAL_STAGE_CHANGED, {
        record: deal,
        entityType: ENTITY_TYPE.DEAL,
        stageName: targetStage.name,
        isWon: targetStage.isWon,
      });

      /* WON MEANS THE WORK STARTS, not that it ends. A booked deal hands over
         to onboarding, and that handover is the moment things get dropped:
         the salesperson has moved on and nobody owns what happens next. A
         ticket makes it somebody's, with a clock on it.

         Raised here rather than by a rule so it cannot be switched off by
         accident, and imported lazily because tickets know about deals —
         having deals import tickets at module scope would close the loop. */
      if (targetStage.isWon) {
        const { ticketService } = await import('../tickets/ticket.service.js');
        await ticketService.create({
          subject: `Onboarding — ${deal.title}`,
          description: 'Raised automatically when the deal was booked. '
            + 'Confirm the paperwork, schedule the handover call, and close this once they are live.',
          priority: TICKET_PRIORITY.NORMAL,
          source: 'manual',
          entityType: ENTITY_TYPE.DEAL,
          entityId: deal._id,
          assignedTo: deal.assignedTo,
        }, user).catch((err) => {
          /* A failed handover ticket must not roll back the booking. The deal
             IS won — that is a fact about the world — and refusing to record
             it because a follow-up could not be created would be the tail
             wagging the dog. Logged loudly instead. */
          logger.error(`Deal ${deal._id} was booked but its onboarding ticket could not be raised: ${err.message}`);
        });
      }

      const previous = deal.stageHistory[deal.stageHistory.length - 2];
      await CrmActivity.create({
        type: ACTIVITY_TYPE.STAGE_CHANGE,
        entityType: ENTITY_TYPE.DEAL,
        entityId: deal._id,
        subject: `${previous?.stageName || 'Created'} → ${targetStage.name}`,
        body: [
          previous?.durationHours != null && `Spent ${previous.durationHours}h in ${previous.stageName}.`,
          deal.lostReason && `Lost: ${deal.lostReason}.`,
          move.lostNotes,
        ].filter(Boolean).join(' '),
        actor: user._id || user.id,
        occurredAt: now,
      });
    }

    return Deal.findById(deal._id).populate('assignedTo', 'name avatarColor').lean();
  },

  /**
   * One deal in full — what a board card opens.
   *
   * The stage history comes back with the stage NAMES it was recorded with,
   * not resolved against the pipeline as it stands today: a stage renamed last
   * month must still read correctly in a history written before the rename.
   */
  async detail(id, user) {
    const scope = buildScope(user);
    const deal = await Deal.findOne({ _id: id, ...scope })
      .populate('assignedTo', 'name avatarColor')
      .populate('contact', 'name phone email')
      .populate('company', 'name')
      .populate('pipeline', 'name stages')
      .lean();
    if (!deal) return null;

    const [timeline, tasks] = await Promise.all([
      CrmActivity.find({ entityType: ENTITY_TYPE.DEAL, entityId: id })
        .populate('actor', 'name avatarColor').sort({ occurredAt: -1 }).limit(100)
        .lean(),
      (async () => {
        const { CrmTask } = await import('../tasks/task.model.js');
        return CrmTask.find({ entityType: ENTITY_TYPE.DEAL, entityId: id, status: 'open' })
          .sort({ dueAt: 1 }).lean();
      })(),
    ]);

    const stages = deal.pipeline?.stages || [];
    const current = stages.find((s) => String(s._id) === String(deal.stage));

    return {
      deal: {
        ...deal,
        stageName: current?.name || null,
        stageProbability: current?.probability ?? null,
        pipeline: deal.pipeline ? { _id: deal.pipeline._id, name: deal.pipeline.name } : null,
      },
      // Every stage the deal could move to, so the drawer can offer them
      // without fetching the pipeline separately.
      stages: [...stages].sort((a, b) => a.order - b.order),
      timeline,
      tasks,
    };
  },

  /** The same deals as the board, as a sortable list — what a manager
   *  reviewing 200 of them needs instead of drag and drop. */
  async list(query, user) {
    const scope = buildScope(user);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    /**
     * Only deals that belong to a pipeline.
     *
     * The `deals` collection still holds documents from an earlier version of
     * this module, written before pipelines existed: they carry a stage NAME
     * where a stage id now goes, so nothing can resolve their column, their
     * probability or their history. They rendered as "Unknown stage" rows —
     * data that looks like a bug because, as far as this code is concerned, it
     * is. A deal that cannot be placed in a pipeline cannot be worked.
     */
    const where = { ...scope, pipeline: { $exists: true, $ne: null } };
    if (query.pipeline && mongoose.isValidObjectId(query.pipeline)) where.pipeline = query.pipeline;
    if (query.stage && mongoose.isValidObjectId(query.stage)) where.stage = query.stage;
    if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo)) where.assignedTo = query.assignedTo;
    if (query.open === 'true') where.closedAt = null;
    if (query.search) {
      where.title = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    const SORTS = {
      value: { value: -1 },
      oldest: { createdAt: 1 },
      newest: { createdAt: -1 },
      stalest: { stageEnteredAt: 1 },
      closing: { expectedCloseDate: 1 },
    };

    const [total, items] = await Promise.all([
      Deal.countDocuments(where),
      Deal.find(where)
        .populate('assignedTo', 'name avatarColor')
        .populate('pipeline', 'name stages')
        .sort(SORTS[query.sort] || SORTS.newest)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return {
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: items.map((d) => ({
        ...d,
        // Resolved here so the list does not have to know how a pipeline
        // stores its stages.
        stageName: d.pipeline?.stages?.find((s) => String(s._id) === String(d.stage))?.name || null,
        pipeline: d.pipeline ? { _id: d.pipeline._id, name: d.pipeline.name } : null,
      })),
    };
  },
};

export default dealService;
