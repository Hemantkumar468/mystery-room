import { Router } from 'express';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { publicIntakeLimiter, requireFormKey, honeypot } from './intake/intake.guards.js';
import { publicLeadSchema, collectUtm } from './intake/intake.validation.js';
import { leadIntakeService } from './intake/leadIntake.service.js';
import { verifyMetaSignature } from './integrations/meta.service.js';
import telephonyWebhooks from './integrations/telephony/telephony.webhooks.js';
import { FETCH_META_LEAD } from './integrations/meta.jobs.js';
import { getAgenda } from '../../core/jobs/agenda.js';
import { LEAD_SOURCE } from './crm.constants.js';
import { config } from '../../config/index.js';
import { logger } from '../../config/logger.js';

/**
 * The UNAUTHENTICATED half of the CRM.
 *
 * Mounted separately from crm.routes.js — which sits behind `authenticate()` —
 * because these two things have opposite requirements and mixing them in one
 * router is how a route ends up public by accident. Anything added here is
 * reachable by the entire internet; that should take a deliberate edit to this
 * file, not an accidental one to a shared router.
 *
 * Every route here carries its own protection: a rate limit, a shared secret
 * or a cryptographic signature. There is no session to lean on.
 */
const router = Router();

/* ── Web forms ───────────────────────────────────────────────
   POST /api/v1/crm/public/leads
   Headers: X-Form-Key: <per-form secret>                                    */

router.post(
  '/leads',
  publicIntakeLimiter,
  requireFormKey,
  honeypot,
  validate(publicLeadSchema),
  asyncHandler(async (req, res) => {
    // A bot filled the hidden field. Answer exactly as if it had worked: an
    // error would tell it which field gave it away, and it would come back
    // tomorrow having stopped filling that one.
    if (req.isHoneypot) {
      return ApiResponse.created(res, { received: true }, 'Thanks — we will be in touch.');
    }

    const { lead, created, duplicate } = await leadIntakeService.intake({
      ...req.body,
      utm: collectUtm(req.body),
      // From the KEY the server recognised, not from the body — a caller-supplied
      // form id would make every per-form ROI number fiction.
      formId: req.formId,
      source: req.body.source || LEAD_SOURCE.WEB_FORM,
    });

    // The response says nothing about what the CRM did with it. Telling a
    // public caller "you already exist, assigned to Priya" is a lookup oracle
    // for anyone who wants to test whether a number is in the database.
    logger.info(
      `CRM intake [${req.formId}]: ${created ? 'new lead' : 're-enquiry'} ${lead._id}`
      + (duplicate ? ` (matched on ${duplicate.matchedOn})` : ''),
    );
    return ApiResponse.created(res, { received: true }, 'Thanks — we will be in touch.');
  }),
);

/* ── Telephony ───────────────────────────────────────────────
   Exotel posts call status, recordings and inbound rings here. Each handler
   verifies the URL token before reading a single field. */
router.use('/webhooks/telephony', telephonyWebhooks);

/* ── Meta Lead Ads webhook ───────────────────────────────────
   GET  → Meta's subscription handshake
   POST → a lead was submitted (an ID only; the data is fetched in a job)     */

/**
 * The handshake. Meta calls this once when the webhook is subscribed, and
 * again whenever it is edited.
 *
 * `hub.challenge` must be echoed back as a BARE body — not JSON, not wrapped
 * in the app's envelope. Meta compares the response byte for byte, and a
 * `{ success: true, data: … }` wrapper fails verification with no useful error.
 */
router.get('/webhooks/meta', (req, res) => {
  /**
   * Read from the RAW url, not from `req.query`.
   *
   * Meta names these parameters `hub.mode`, `hub.verify_token` and
   * `hub.challenge` — with dots. `express-mongo-sanitize` runs globally and
   * strips any key containing a dot or a dollar (they are Mongo operators), so
   * by the time the request reaches here `req.query['hub.mode']` is
   * `undefined` and verification fails for a reason no log line explains.
   *
   * The sanitiser is right to do that; this endpoint just has to read around
   * it rather than weaken it for every other route.
   */
  const params = new URLSearchParams(req.originalUrl.split('?')[1] || '');
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  if (mode === 'subscribe' && token && token === config.crm.meta.verifyToken) {
    logger.info('Meta webhook verified');
    return res.status(200).send(String(challenge));
  }

  logger.warn(`Meta webhook verification refused (mode=${mode})`);
  return res.sendStatus(403);
});

router.post('/webhooks/meta', asyncHandler(async (req, res) => {
  /* Signature first, before anything reads the body. An unsigned POST is
     someone who found the URL, and the only safe thing to do with it is
     nothing at all. */
  if (!verifyMetaSignature(req.rawBody, req.get('X-Hub-Signature-256'))) {
    logger.warn(`Meta webhook: bad signature from ${req.ip}`);
    return res.sendStatus(403);
  }

  /* Answer IMMEDIATELY, then work.
     Meta expects a 2xx within seconds and resends the whole batch otherwise —
     so the slow part (a Graph API call per lead) has to happen after the
     response, in a job that can fail and retry on its own. */
  res.sendStatus(200);

  const agenda = getAgenda();
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) continue;

      // Instagram and Facebook lead forms arrive through the same webhook;
      // the platform is only distinguishable here, so it is recorded now.
      const platform = entry.messaging_product === 'instagram'
        ? LEAD_SOURCE.INSTAGRAM : LEAD_SOURCE.FACEBOOK;

      await agenda.now(FETCH_META_LEAD, { leadgenId, platform, formId: change.value?.form_id });
      logger.info(`Meta webhook: queued fetch for leadgen ${leadgenId}`);
    }
  }
  return undefined;
}));

export default router;
