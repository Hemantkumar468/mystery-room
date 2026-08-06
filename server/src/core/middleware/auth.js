import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../../modules/auth/auth.model.js';

/** Extract a Bearer token from the Authorization header (or auth cookie). */
function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
}

/**
 * Require a valid access token. Attaches the live user document to `req.user`.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  const payload = jwt.verify(token, config.jwt.accessSecret);
  const user = await User.findById(payload.sub).select('+isActive');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive or missing');

  req.user = user;
  req.auth = { userId: user.id, role: user.role };
  next();
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
