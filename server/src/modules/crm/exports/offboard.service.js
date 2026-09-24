import mongoose from 'mongoose';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { recordAudit } from '../../../core/audit/audit.js';
import { canManageCrm } from '../shared/scope.js';
import { canOwnLeads } from '../shared/ownership.js';
import { ROLES } from '../../../core/constants/index.js';
import { User } from '../../auth/auth.model.js';
import { Lead } from '../leads/lead.model.js';
import { Deal } from '../deals/deal.model.js';
import { CrmTask } from '../tasks/task.model.js';
import { Ticket } from '../tickets/ticket.model.js';
import { TICKET_OPEN_STATUSES, TASK_STATUS, LEAD_CLOSED_STATUSES } from '../crm.constants.js';

/**
 * Somebody has left. Move their work, then close their access.
 *
 * ONE ACTION, IN THIS ORDER, and the order is the whole design. Revoking
 * access first leaves their pipeline owned by an account that cannot log in:
 * every lead they held becomes invisible to the list views that filter by
 * assignee, and nobody notices until a customer rings to ask why nobody called
 * back. Reassigning first means the work is somebody's before the door shuts.
 *
 * DRY RUN BY DEFAULT. This touches every record a person owned, and "how many
 * am I about to move, and to whom" is a question that must be answerable
 * before the fact rather than after.
 *
 * WHAT IT DOES NOT DO: delete anything. Their activities, their audit rows and
 * their name on the history stay exactly where they are. Who did what last
 * March does not change because they resigned in September.
 */
export const offboardService = {
  /**
   * @param {string} userId    who is leaving
   * @param {{to?: string, apply?: boolean}} body  who inherits; dry run unless apply
   */
  async run(userId, body, actor) {
    if (!canManageCrm(actor)) {
      throw ApiError.forbidden('Only a manager can offboard somebody', { code: 'OFFBOARD_FORBIDDEN' });
    }
    if (!mongoose.isValidObjectId(userId)) throw ApiError.badRequest('Not a user id');

    const leaving = await User.findById(userId).select('name role isActive department').lean();
    if (!leaving) throw ApiError.notFound('That user does not exist');

    if (String(userId) === String(actor._id || actor.id)) {
      /* Refused, and not out of pedantry: offboarding yourself reassigns your
         pipeline and then locks you out mid-transaction, with nobody left in
         the session to finish or undo it. */
      throw ApiError.badRequest('You cannot offboard yourself', { code: 'OFFBOARD_SELF' });
    }

    let heir = null;
    if (body?.to) {
      if (!mongoose.isValidObjectId(body.to)) throw ApiError.badRequest('Not a user id');
      heir = await User.findById(body.to).select('name role isActive').lean();
      if (!heir) throw ApiError.badRequest('The person inheriting does not exist');
      if (heir.isActive === false) {
        throw ApiError.badRequest(`${heir.name} is deactivated and cannot inherit work`);
      }
      if (!canOwnLeads(heir)) {
        /* The same rule as every other assignment door — one definition, in
           ownership.js. A viewer inheriting a pipeline is a pipeline nobody
           can act on. */
        throw ApiError.badRequest(
          `${heir.name} is a ${heir.role} and cannot be given work.`,
          { code: 'ROLE_CANNOT_OWN' },
        );
      }
    }

    const open = {
      leads: { assignedTo: userId, status: { $nin: LEAD_CLOSED_STATUSES } },
      deals: { assignedTo: userId },
      tasks: { owner: userId, status: TASK_STATUS.OPEN },
      tickets: { assignedTo: userId, status: { $in: TICKET_OPEN_STATUSES } },
    };

    const counts = {
      leads: await Lead.countDocuments(open.leads),
      deals: await Deal.countDocuments(open.deals),
      tasks: await CrmTask.countDocuments(open.tasks),
      tickets: await Ticket.countDocuments(open.tickets),
    };
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    if (!body?.apply) {
      return {
        dryRun: true,
        leaving: { _id: leaving._id, name: leaving.name, role: leaving.role },
        heir: heir && { _id: heir._id, name: heir.name },
        counts,
        total,
        note: heir
          ? `${total} open record(s) would move to ${heir.name}, then ${leaving.name}'s access would be revoked.`
          : `${total} open record(s) are still owned by ${leaving.name}. Name somebody to inherit them before applying.`,
      };
    }

    if (total && !heir) {
      throw ApiError.badRequest(
        `${leaving.name} still holds ${total} open record(s). Name somebody to inherit them.`,
        { code: 'OFFBOARD_NEEDS_HEIR', details: counts },
      );
    }

    /* WORK FIRST. If the reassignment fails halfway, the person can still log
       in and the state is recoverable. If access were revoked first and the
       reassignment then failed, the records would be stranded on a dead
       account with nobody able to see them. */
    if (heir) {
      await Promise.all([
        Lead.updateMany(open.leads, { $set: { assignedTo: heir._id, assignedAt: new Date() } }),
        Deal.updateMany(open.deals, { $set: { assignedTo: heir._id } }),
        CrmTask.updateMany(open.tasks, { $set: { owner: heir._id } }),
        Ticket.updateMany(open.tickets, { $set: { assignedTo: heir._id } }),
      ]);
    }

    await User.updateOne({ _id: userId }, {
      $set: {
        isActive: false,
        // Taken out of the rotation as well as locked out: an inactive account
        // left in the routing pool silently collects leads nobody sees.
        crmAvailable: false,
      },
    });

    await recordAudit({
      entity: 'User',
      entityId: leaving._id,
      label: leaving.name,
      action: 'offboard',
      detail: heir
        ? `Offboarded. ${total} open record(s) moved to ${heir.name}. Access revoked.`
        : 'Offboarded with no open records. Access revoked.',
    });

    logger.warn(
      `${leaving.name} offboarded by ${actor.name}: ${total} record(s) moved`
      + `${heir ? ` to ${heir.name}` : ''}, access revoked.`,
    );

    return {
      dryRun: false,
      leaving: { _id: leaving._id, name: leaving.name },
      heir: heir && { _id: heir._id, name: heir.name },
      counts,
      total,
    };
  },

  /** Who could reasonably inherit — the same people who can be assigned work. */
  async candidates(excludeUserId) {
    const rows = await User.find({
      isActive: { $ne: false },
      role: { $nin: [ROLES.VIEWER] },
      _id: { $ne: excludeUserId },
    }).select('name role department').sort({ name: 1 }).lean();
    return rows;
  },
};

export default offboardService;
