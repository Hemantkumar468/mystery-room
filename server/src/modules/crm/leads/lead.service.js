import mongoose from 'mongoose';
import { Lead } from './lead.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { User } from '../../auth/auth.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { canOwnLeads } from '../shared/ownership.js';
import { maskPhone } from '../intake/phone.js';
import {
  LEAD_STATUS, LEAD_STATUS_VALUES, LEAD_CLOSED_STATUSES,
  ACTIVITY_TYPE, ENTITY_TYPE,
} from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * Reading and working the lead list.
 *
 * Creation is NOT here — it goes through intake/leadIntake.service.js, the one
 * door every capture path uses. This file is what happens to a lead after it
 * lands: finding it, reassigning it, moving its status.
 *
 * EVERY query starts from `buildScope(user)`. Not most of them.
 */

/** The four filters the list screen offers, as a Mongo query. Anything not
 *  named here is ignored rather than passed through — the query object comes
 *  from a URL. */
function filtersToQuery(q = {}) {
  const where = {};

  if (q.status && LEAD_STATUS_VALUES.includes(q.status)) where.status = q.status;
  if (q.source) where.source = String(q.source);

  if (q.assignedTo === 'unassigned') where.assignedTo = null;
  else if (q.assignedTo && mongoose.isValidObjectId(q.assignedTo)) where.assignedTo = q.assignedTo;

  // The dashboard's "nobody has touched these" tile links here with this flag,
  // so the number on the tile and the rows in the list are the same question
  // asked once — not two definitions that drift apart.
  if (q.unworked === 'true' || q.unworked === true) {
    where.status = { $nin: LEAD_CLOSED_STATUSES };
    where.firstActivityAt = null;
    where.assignedAt = { $lt: new Date(Date.now() - 86_400_000) };
  }

  if (q.search) {
    const rx = new RegExp(String(q.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    where.$or = [{ name: rx }, { company: rx }, { city: rx }, { email: rx }, { phone: rx }];
  }

  return where;
}

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  updated: { updatedAt: -1 },
};

export const leadService = {
  async list(query, user) {
    const scope = buildScope(user);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const where = { ...scope, ...filtersToQuery(query) };

    const [total, items] = await Promise.all([
      Lead.countDocuments(where),
      Lead.find(where)
        .populate('assignedTo', 'name avatarColor')
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
      items: items.map((l) => ({
        ...l,
        // Masked in the LIST. A list screen is where a customer database gets
        // copied out one screenshot at a time; the detail view returns the
        // real number, and opening a record is a deliberate act.
        phone: maskPhone(l.phone),
        phoneMasked: true,
      })),
    };
  },

  /**
   * Move a lead to a different owner.
   *
   * Managers only — an agent who could reassign could hand their hard leads to
   * someone else, and the reassignment log would show them doing it, which is
   * not the same as preventing it.
   *
   * Every move is written to the timeline with a reason. "Why do I have this
   * lead?" and "who took mine?" are questions that come up constantly, and an
   * unlogged reassignment makes both unanswerable.
   */
  async reassign(id, { assignedTo, reason }, user) {
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can reassign leads', { code: 'REASSIGN_FORBIDDEN' });
    }
    const lead = await Lead.findById(id);
    if (!lead) throw ApiError.notFound('Lead not found');

    if (!mongoose.isValidObjectId(assignedTo)) {
      throw ApiError.badRequest('Pick a valid person to assign this to');
    }
    const target = await User.findById(assignedTo).select('name role').lean();
    if (!target) throw ApiError.badRequest('That user does not exist');
    // The SAME rule the routing engine applies. Enforced here too because this
    // is the other door into ownership — a rule that only guards the automatic
    // path comes back through the manual one, quietly, one dropdown at a time.
    if (!canOwnLeads(target)) {
      throw ApiError.badRequest(
        `${target.name} is a ${target.role} and cannot own leads — they have no way to act on one.`,
        { code: 'ROLE_CANNOT_OWN' },
      );
    }

    const previous = lead.assignedTo
      ? await User.findById(lead.assignedTo).select('name').lean()
      : null;

    lead.assignedTo = target._id;
    lead.assignedAt = new Date();
    lead.routedBy = `reassigned by ${user.name || 'a manager'}`;
    await lead.save();

    /**
     * THE WORK MOVES WITH THE RECORD.
     *
     * Open tasks left behind produce two failures at once, and both are
     * silent: the previous owner's Today screen shows work that is no longer
     * theirs, and the new owner has no idea a follow-up was ever due. The
     * first is noise they learn to ignore; the second is the customer nobody
     * rings.
     *
     * Only OPEN tasks. A completed one is a record of who actually did it —
     * rewriting that would put the new owner's name on the old owner's call.
     */
    const { CrmTask } = await import('../tasks/task.model.js');
    const { TASK_STATUS } = await import('../crm.constants.js');
    const moved = await CrmTask.updateMany(
      { entityType: ENTITY_TYPE.LEAD, entityId: lead._id, status: TASK_STATUS.OPEN },
      { $set: { owner: target._id } },
    );

    await CrmActivity.create({
      type: ACTIVITY_TYPE.SYSTEM,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      subject: 'Reassigned',
      body: [
        `${previous?.name || 'Unassigned'} → ${target.name}`,
        reason ? `— ${reason}` : null,
        // Said out loud, because the new owner needs to know work came with it
        // and the old one needs to know why their list just got shorter.
        moved.modifiedCount
          ? `(${moved.modifiedCount} open task${moved.modifiedCount === 1 ? '' : 's'} moved too)`
          : null,
      ].filter(Boolean).join(' '),
      actor: user._id || user.id,
      occurredAt: new Date(),
    });

    return Lead.findById(id).populate('assignedTo', 'name avatarColor').lean();
  },

  /**
   * Change a lead's status, and stamp first contact the first time somebody
   * actually works it.
   *
   * `firstActivityAt` is written here and never overwritten — it is the other
   * half of the response-time metric, and a field that moves every time the
   * status changes would measure the LAST touch instead of the first.
   */
  async setStatus(id, { status, reason }, user) {
    if (!LEAD_STATUS_VALUES.includes(status)) {
      throw ApiError.badRequest(`Unknown status "${status}"`, { code: 'UNKNOWN_STATUS' });
    }
    const scope = buildScope(user);
    const lead = await Lead.findOne({ _id: id, ...scope });
    if (!lead) throw ApiError.notFound('Lead not found');

    if (status === LEAD_STATUS.DISQUALIFIED && !String(reason || '').trim()) {
      // The same rule the spec puts on Closed Lost, for the same reason: a
      // disqualified pile with no reasons is a pile nobody can learn from.
      throw ApiError.badRequest(
        'Say why this lead is being disqualified — the reasons are what the source report is made of',
        { code: 'REASON_REQUIRED' },
      );
    }

    const previous = lead.status;
    lead.status = status;
    if (!lead.firstActivityAt) lead.firstActivityAt = new Date();
    lead.lastActivityAt = new Date();
    if (status === LEAD_STATUS.DISQUALIFIED) lead.disqualifiedReason = String(reason).trim();
    await lead.save();

    await CrmActivity.create({
      type: ACTIVITY_TYPE.STAGE_CHANGE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      subject: `Status: ${previous} → ${status}`,
      body: reason || undefined,
      actor: user._id || user.id,
      occurredAt: new Date(),
    });

    return Lead.findById(id).populate('assignedTo', 'name avatarColor').lean();
  },

  /**
   * Log a call, a note or a message against a lead.
   *
   * This is what makes `firstActivityAt` real: until somebody records doing
   * something, a lead has been assigned and ignored, and the dashboard says so.
   */
  async logActivity(id, { type, subject, body, occurredAt }, user) {
    const scope = buildScope(user);
    const lead = await Lead.findOne({ _id: id, ...scope });
    if (!lead) throw ApiError.notFound('Lead not found');

    const activity = await CrmActivity.create({
      type: type || ACTIVITY_TYPE.NOTE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead._id,
      subject: subject || undefined,
      body: body || undefined,
      actor: user._id || user.id,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    });

    const now = new Date();
    if (!lead.firstActivityAt) lead.firstActivityAt = now;
    lead.lastActivityAt = now;
    // Recording a conversation means the lead has been contacted — leaving it
    // in `new` after somebody has spoken to them makes every "untouched" count
    // wrong.
    if (lead.status === LEAD_STATUS.NEW) lead.status = LEAD_STATUS.CONTACTED;
    await lead.save();

    return CrmActivity.findById(activity._id).populate('actor', 'name avatarColor').lean();
  },
};

export default leadService;
