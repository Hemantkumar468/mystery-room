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
import { publicTenantContext } from '../../core/tenancy/tenancy.js';
import { withoutTenant } from '../../core/tenancy/tenantContext.js';
import { crmEmailService } from './integrations/email/crmEmail.service.js';
import { ticketService } from './tickets/ticket.service.js';
import { ApiError } from '../../core/utils/ApiError.js';

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

/* NOTHING HERE HAS A SESSION, so nothing here knows which company it belongs
   to — and a document written with no company is invisible to every scoped
   query. An enquiry would be accepted, stored, and never appear on anybody's
   screen. This binds the company for the whole router; once a second one
   exists it refuses rather than guessing, because guessing files a stranger's
   enquiry into the wrong company's database. */
/* ── Email open and click tracking ────────────────────────────────────
   Public by necessity: these are fetched by the recipient's mail client and
   browser, which have no session and never will. The token is the only
   credential, which is why it is 18 random bytes and not derived from the
   address — a guessable token would let anyone mark somebody else's email as
   read, and a derived one would leak who was mailed to anybody who saw a URL.

   MOUNTED BEFORE publicTenantContext, and deliberately. That middleware asks
   the database which company a sessionless request belongs to; these two
   endpoints are fetched by a mail client on every single open, and making an
   image depend on a database round trip means a slow database renders as a
   broken-image box inside a customer's email. They do not need it either: the
   token is 18 random bytes and globally unique, so it identifies the message
   on its own. The lookups below say so with withoutTenant(). */

router.get('/e/o/:token', asyncHandler(async (req, res) => {
  // Recorded, but never allowed to fail the response. A mail client that gets
  // an error for a pixel shows a broken-image box in the middle of a customer
  // email, which is a worse outcome than an uncounted open.
  await withoutTenant(
    'a tracking hit identifies itself by an unguessable token, not by a session',
    () => crmEmailService.recordOpen(req.params.token),
  ).catch(() => null);

  /* A 1x1 transparent GIF, inline. No file on disk, no S3 round trip: this is
     fetched once per open and has to be instant. */
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(pixel.length),
    // Never cached: a cached pixel is an open that only ever counts once.
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });
  return res.end(pixel);
}));

router.get('/e/c/:token/:index', asyncHandler(async (req, res) => {
  const url = await withoutTenant(
    'a tracking hit identifies itself by an unguessable token, not by a session',
    () => crmEmailService.recordClick(req.params.token, req.params.index),
  ).catch(() => null);
  /* NOT AN OPEN REDIRECT. The destination comes from the list stored when the
     email was sent, indexed by position — never from the request. Without
     that, this endpoint would forward anyone anywhere while wearing our
     domain, which is precisely what phishing filters trust. An unknown token
     or index is a 404, not a redirect to somewhere plausible. */
  if (!url) throw ApiError.notFound('That link is not one we sent');
  return res.redirect(302, url);
}));


/* ── CSAT: one tap, no login ──────────────────────────────────────────
   The customer has no account and never will, so the token in the link is the
   whole credential — 18 random bytes, minted when the ticket was resolved. A
   sequential id here would let anyone score every ticket in the system by
   counting upwards.

   Above the tenant middleware, like the tracking pixel: the token identifies
   the ticket on its own, and making a customer-facing page depend on a lookup
   of which company it belongs to buys nothing and can fail. */

router.get('/csat/:token', asyncHandler(async (req, res) => {
  const context = await withoutTenant(
    'a rating link identifies itself by an unguessable token',
    () => ticketService.csatContext(req.params.token),
  );
  if (!context) throw ApiError.notFound('That rating link is not valid');
  return ApiResponse.ok(res, context, 'Rate this');
}));

router.post('/csat/:token', asyncHandler(async (req, res) => {
  const rated = await withoutTenant(
    'a rating link identifies itself by an unguessable token',
    () => ticketService.recordCsat(req.params.token, req.body?.score, req.body?.comment),
  );
  if (!rated) throw ApiError.badRequest('That rating could not be recorded — check the link and the score');
  return ApiResponse.ok(res, { thanks: true, score: rated.csat?.score }, 'Thank you');
}));

router.use(publicTenantContext('A public CRM request (web form, Meta webhook, telephony callback)'));

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
