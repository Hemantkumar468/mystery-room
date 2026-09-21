import { accessService } from '../../modules/access/access.service.js';
import { ACCESS, ACCESS_LABELS, parseSurfaceKey } from '../constants/access.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * The real boundary for the access policy. Everything the Settings screen
 * decides is enforced HERE; the client's hiding of a nav row or a step is a
 * courtesy so nobody clicks into a refusal.
 *
 * WHY IT IS NOT `authorize()`. `authorize(...CAN_MANAGE)` asks a question
 * about a role and gets a fixed answer compiled into the code. This asks a
 * question about a person and a surface, and the answer is whatever the
 * company last decided on a screen. Both still exist and both still apply:
 * `authorize` keeps stating the rules that are properties of the SOFTWARE
 * (only the MD may delete a project), and this states the ones that are
 * decisions of the BUSINESS (this outlet team works Step 3 and nothing else).
 *
 * MUST RUN AFTER `authenticate`, which is what puts the user on the request
 * and binds the company. Mounted before it, every call would be a 401 that
 * looks like a session problem.
 */
export const requireAccess = (key, level = ACCESS.VIEW) => asyncHandler(async (req, _res, next) => {
  if (!req.user) throw ApiError.unauthorized('Authentication required');

  const allowed = await accessService.allows(req.user, key, level);
  if (allowed) return next();

  /* Named in the words the Settings screen uses, so the person who gets this
     message can ask for the right thing. "Forbidden" sends them to support;
     "you have View only on Step 3, this needs Can work" sends them to
     whoever owns the policy. */
  const surface = accessService.surfaceFor(key);
  const what = surface?.label ?? parseSurfaceKey(key).id;
  const needed = ACCESS_LABELS[level] ?? level;
  throw ApiError.forbidden(
    `Your access to "${what}" does not include ${needed}. Ask whoever manages Access Control in Settings.`,
    { code: 'ACCESS_DENIED', details: { surface: key, needed: level } },
  );
});

/** Sugar for the common case: a whole module gated at its own mount point. */
export const requireModule = (moduleId, level = ACCESS.VIEW) => requireAccess(`module:${moduleId}`, level);

/** Sugar for one step of a flow. */
export const requireStep = (stepId, level = ACCESS.VIEW) => requireAccess(`step:${stepId}`, level);

export default requireAccess;
