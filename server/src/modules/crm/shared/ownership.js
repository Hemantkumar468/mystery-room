import { ROLES } from '../../../core/constants/index.js';

/**
 * Who may be given a lead.
 *
 * ONE definition, read by both doors into ownership: the routing engine
 * (automatic, on capture) and the reassign endpoint (a manager choosing from a
 * dropdown). It lived in the routing service alone at first, which meant the
 * rule was enforced on the path nobody watches and absent from the one a human
 * uses every day — the bug does not come back all at once, it comes back one
 * reassignment at a time.
 *
 * A Viewer is read-only by definition: they cannot log a call, change a status
 * or convert anything. Handing them a lead is not a mild misallocation, it is
 * a customer nobody will ever ring, discovered weeks later.
 */
export const CANNOT_OWN_LEADS = Object.freeze([ROLES.VIEWER]);

/** @param {{role?: string}} user */
export const canOwnLeads = (user) => Boolean(user?.role) && !CANNOT_OWN_LEADS.includes(user.role);

/**
 * Who a newly created record belongs to.
 *
 * THE RULE: you may create work for yourself; only a manager may create work
 * for somebody else. Without it, `owner`/`assignedTo` arriving in a request
 * body means an agent can put tasks on a colleague's Today list, or hand them
 * a deal — quietly, with the colleague having no idea where it came from.
 *
 * This is the same class of hole as `isSeed`: a trust-sensitive field that the
 * caller controls. The difference is that these two must sometimes be settable
 * (a manager assigning work is the normal case), so they are validated rather
 * than moved out of the body.
 *
 * @param {string|undefined} requested  the id the request asked for
 * @param {object} actor                the signed-in user
 * @param {object} deps
 * @param {import('mongoose').Model} deps.User
 * @param {Function} deps.canManage     canManageCrm, injected to avoid a cycle
 * @param {Function} deps.badRequest    ApiError.badRequest
 * @param {Function} deps.forbidden     ApiError.forbidden
 * @returns {Promise<import('mongoose').Types.ObjectId|string>}
 */
export async function resolveAssignee(requested, actor, {
  User, canManage, badRequest, forbidden,
}) {
  const me = actor._id || actor.id;
  if (!requested || String(requested) === String(me)) return me;

  if (!canManage(actor)) {
    throw forbidden(
      'Only a manager can assign work to someone else',
      { code: 'ASSIGN_TO_OTHER_FORBIDDEN' },
    );
  }

  const target = await User.findById(requested).select('name role isActive').lean();
  if (!target) throw badRequest('That user does not exist');
  if (!canOwnLeads(target)) {
    throw badRequest(
      `${target.name} is a ${target.role} and cannot be given work — they have no way to act on it.`,
      { code: 'ROLE_CANNOT_OWN' },
    );
  }
  return target._id;
}

export default canOwnLeads;
