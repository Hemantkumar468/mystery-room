import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../../modules/auth/auth.model.js';
import { withTenant, withoutTenant } from '../tenancy/tenantContext.js';
import { withActor } from '../audit/auditContext.js';

/** Extract a Bearer token from the Authorization header (or auth cookie). */
function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

/**
 * Require a valid access token. Attaches the live user document to `req.user`.
 *
 * ALSO BINDS THE COMPANY for the rest of the request. This is the one place in
 * the application where identity becomes known, so it is the one place the
 * tenant context is established — every router that calls `authenticate` gets
 * it without knowing tenancy exists. Doing it per-router instead would mean
 * one more thing to remember on every new router, and the failure mode of
 * forgetting is another company's data on screen.
 *
 * The tenant comes from the stored user, never from the request — the same
 * rule as `ownerId`, `assignedTo` and `isSeed`. A company a caller can name is
 * a company a caller can choose.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  const payload = jwt.verify(token, config.jwt.accessSecret);
  /* Unscoped on purpose: this lookup is what DETERMINES the company, so it
     cannot already be filtered by it. The exemption is deliberately narrow —
     one document, by primary key. */
  const user = await withoutTenant(
    'authentication resolves which company a user belongs to',
    () => User.findById(payload.sub).select('+isActive +tenant'),
  );
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive or missing');

  req.user = user;
  req.auth = { userId: user.id, role: user.role };

  if (!user.tenant) return next();
  return withTenant(user.tenant, next);
});

/**
 * Restrict a route to one or more roles. Use after `authenticate`.
 * @example router.post('/', authenticate, authorize(...CAN_MANAGE), handler)
 */
export const authorize = (...allowedRoles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  return next();
};

export default authenticate;
