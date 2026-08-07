import rateLimit from 'express-rate-limit';
import { config } from '../../config/index.js';

/** General API limiter — protects every route from abuse/bursts. */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  // /files serves images and attachments to <img>/<video> tags. One gallery
  // can issue dozens of those, which would burn the caller's whole API budget
  // and lock them out of the actual API — they are asset fetches, not calls.
  skip: (req) => req.path.startsWith('/files/'),
});

/**
 * Limiter for the endpoints that actually call an AI provider. Every one of
 * those requests costs real money, so they get their own hourly budget on top
 * of the general limiter — a runaway client or a stuck retry loop can burn a
 * provider bill in minutes otherwise. Keyed per user rather than per IP, so one
 * enthusiastic analyst cannot exhaust the whole office's allowance behind a
 * shared NAT.
 */
export const aiLimiter = rateLimit({
  windowMs: config.rateLimit.aiWindowMs,
  max: config.rateLimit.aiMax,
  standardHeaders: true,
  legacyHeaders: false,
  // Safe to key on the user alone: every route using this limiter mounts
  // `authenticate` first, so `req.user` is always set. Keying on the user
  // (rather than req.ip) also sidesteps v7's IPv6-normalisation requirement
  // for custom key generators.
  keyGenerator: (req) => `ai:${req.user?.id || 'anonymous'}`,
  message: {
    success: false,
    message: 'AI analysis limit reached for now. Please try again later.',
  },
});

/** Stricter limiter for auth endpoints to blunt credential-stuffing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Too many attempts, please try again later.' },
});

export default apiLimiter;
