import rateLimit from 'express-rate-limit';
import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * What stands between the open internet and the Lead collection.
 *
 * The public intake endpoint has no JWT, by necessity — a marketing site
 * cannot hold a credential. So it gets four independent protections, because
 * each one fails differently:
 *
 *   rate limit  → volume, from one source
 *   form key    → who is allowed to post at all, and which form to blame
 *   honeypot    → unsophisticated bots, at zero cost to real users
 *   zod .strict → the shape of what gets through
 *
 * None of them is sufficient alone. A determined attacker with a leaked form
 * key still gets rate-limited; a bot that clears the honeypot still has to
 * produce a valid payload.
 */

/**
 * Far tighter than the general API limiter.
 *
 * A real landing page produces a handful of submissions an hour from any one
 * IP. Twenty is generous for that and useless for someone filling the database
 * with junk. Keyed on IP because there is no user to key on.
 */
export const publicIntakeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many submissions from this address. Please try again shortly.',
  },
});

/**
 * Per-form shared secret, from the environment.
 *
 *   CRM_FORM_KEYS=homepage:k_9f2a...,franchise-landing:k_7c1b...
 *
 * One key per form rather than one key for the endpoint, so a key that leaks
 * (they live in public HTML — assume they leak) can be revoked without taking
 * every other form down with it. The form's name comes back on the request, so
 * `formId` on the lead is trustworthy rather than whatever the caller claimed.
 *
 * Parsed once at first use, not per request.
 */
let keyMap = null;

function formKeys() {
  if (keyMap) return keyMap;
  keyMap = new Map();
  for (const pair of String(config.crm?.formKeys || '').split(',')) {
    const [formId, secret] = pair.split(':').map((s) => s?.trim());
    if (formId && secret) keyMap.set(secret, formId);
  }
  if (!keyMap.size) {
    logger.warn(
      'CRM_FORM_KEYS is not set — the public lead endpoint will refuse every '
      + 'request. Set it to "formName:secret,formName2:secret2" to enable web forms.',
    );
  }
  return keyMap;
}

/** Test seam, and the way a key rotation takes effect without a restart. */
export const resetFormKeys = () => { keyMap = null; };

export function requireFormKey(req, _res, next) {
  const presented = req.get('X-Form-Key');
  if (!presented) {
    return next(ApiError.unauthorized('Missing X-Form-Key', { code: 'FORM_KEY_MISSING' }));
  }

  const formId = formKeys().get(presented);
  if (!formId) {
    // Logged with the IP, because a burst of these is somebody probing.
    logger.warn(`CRM intake: rejected an unknown form key from ${req.ip}`);
    return next(ApiError.unauthorized('That form key is not recognised', { code: 'FORM_KEY_INVALID' }));
  }

  // The SERVER decides which form this is, from the key it recognised. A
  // `formId` in the body would be whatever the caller felt like typing, which
  // makes the per-form ROI numbers fiction.
  req.formId = formId;
  return next();
}

/**
 * The honeypot: a field real users never see and never fill.
 *
 * ACCEPTS the submission and discards it, rather than returning an error. A
 * 400 tells the bot which field gave it away, and it comes back an hour later
 * having stopped filling that one. A 201 and silence teaches it nothing.
 *
 * `req.isHoneypot` is set for the controller to act on; nothing else changes.
 */
export function honeypot(req, _res, next) {
  if (req.body?.website_url) {
    logger.info(`CRM intake: honeypot triggered from ${req.ip} — accepting and discarding`);
    req.isHoneypot = true;
  }
  return next();
}
