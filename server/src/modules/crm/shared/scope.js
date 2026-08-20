import { ROLES } from '../../../core/constants/index.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * What this user is allowed to see, as a Mongo filter.
 *
 * EVERY CRM list and detail query starts from this. Not "most" — every one.
 * Filtering records in React only removes them from the screen; the API still
 * returned them, and anyone who opens the network tab reads the whole customer
 * database. That is the most common serious mistake in a CRM build, and it is
 * invisible in a demo because the screen looks right.
 *
 * FAIL CLOSED. An unrecognised role gets nothing and an error, never `{}`. A
 * switch that falls through to `undefined` spreads into a query as no filter at
 * all, which turns "role we have not handled yet" into "sees everything" — the
 * exact opposite of what a missing case should mean.
 *
 * @param {object} user  from `authenticate` — must carry `role` and `_id`
 * @param {object} [opts]
 * @param {string} [opts.field='assignedTo']  the ownership field on this model
 *   (leads and deals use `assignedTo`, contacts and companies use `owner`)
 */
export function buildScope(user, { field = 'assignedTo' } = {}) {
  if (!user?.role) {
    throw ApiError.unauthorized('No role on this session', { code: 'SCOPE_NO_ROLE' });
  }

  const me = user._id || user.id;

  switch (user.role) {
    // Leadership and management run the pipeline, so they see all of it.
    case ROLES.MD:
    case ROLES.EA:
    case ROLES.MANAGER:
      return {};

    // Everyone else sees their own desk. A dashboard opening with someone
    // else's two thousand leads is not a to-do list, it is noise.
    case ROLES.EMPLOYEE:
      return { [field]: me };

    // Read-only accounts (finance, auditors) see everything but write nothing.
    // The write side is enforced by the route's own permission check, not here
    // — this function answers "what may they READ".
    case ROLES.VIEWER:
      return {};

    default:
      // Deliberately not `{}`. A role nobody has taught this function about is
      // a role that must not receive customer data by default.
      throw ApiError.forbidden(
        `Role "${user.role}" has no CRM visibility rule`,
        { code: 'SCOPE_UNKNOWN_ROLE' },
      );
  }
}

/** Can this user reassign work, edit routing rules, and see everyone's data? */
export function canManageCrm(user) {
  return [ROLES.MD, ROLES.EA, ROLES.MANAGER].includes(user?.role);
}

export default buildScope;
