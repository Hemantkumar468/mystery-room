import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { publicIntakeLimiter, honeypot } from '../../crm/intake/intake.guards.js';
import { uploadSingle, enforceTypeSizeLimits } from '../../../core/middleware/upload.js';
import { publicTenantContext } from '../../../core/tenancy/tenancy.js';
import { recordService } from '../records/record.service.js';
import * as outsource from './outsource.service.js';

/**
 * The page an outside designer actually opens. No account, no session.
 *
 * THREE ROUTES, and the shape of each is set by that: whoever is calling is
 * not authenticated, is not necessarily who we sent the link to, and the URL
 * will end up in a WhatsApp forward.
 *
 *   GET  /:token          the brief — site, games, what to produce, by when
 *   POST /:token/uploads  one file at a time, straight to private storage
 *   POST /:token/submit   files it as a submission for somebody to review
 *
 * The token is the whole credential, so it is treated like one: hashed at
 * rest, checked on every call (never trusted from a previous one), rate
 * limited, and expiring. A closed link answers with WHY it is closed and
 * nothing else — no project name, no phase, no hint that a project exists.
 */
const router = Router();

// Nothing here carries a session, so nothing names the company. Same device
// as CRM's public intake and the HRMS job page.
router.use(publicTenantContext('An outside designer opening their brief or filing work'));
router.use(publicIntakeLimiter);

const tokenParam = z.object({ params: z.object({ token: z.string().min(20).max(200) }) });

router.get('/:token', validate(tokenParam), asyncHandler(async (req, res) => {
  const brief = await outsource.briefForToken(req.params.token);
  return ApiResponse.ok(res, brief, brief.closed ? 'This link is not active' : 'Design brief');
}));

/**
 * A file, before the submission exists — the same two-step the internal form
 * uses, so the drawings are already in storage by the time Submit is pressed
 * and a slow upload never costs somebody their filled-in form.
 *
 * The token is re-checked here rather than only on submit: without it, an
 * expired or revoked link would still be a working upload endpoint into the
 * company's private bucket.
 */
router.post(
  '/:token/uploads',
  validate(tokenParam),
  uploadSingle('file'),
  enforceTypeSizeLimits,
  asyncHandler(async (req, res) => {
    const { link, reason } = await outsource.findByToken(req.params.token);
    if (!link || reason) return ApiResponse.ok(res, { closed: true, reason: reason || 'unknown' }, 'This link is not active');
    const ref = await recordService.uploadMedia(req.file);
    return ApiResponse.created(res, ref, 'File received');
  }),
);

const submitSchema = z.object({
  params: z.object({ token: z.string().min(20).max(200) }),
  body: z.object({
    // The phase's own form decides what is inside; the shape is validated
    // against that schema on the way into the record, not here.
    values: z.record(z.any()).default({}),
  }).passthrough(),
});

router.post(
  '/:token/submit',
  honeypot,
  validate(submitSchema),
  asyncHandler(async (req, res) => {
    /* A bot filled the hidden field. Answer exactly as a real submission does
       and write nothing — telling it that it was caught only teaches it. */
    if (req.isHoneypot) return ApiResponse.created(res, { ok: true }, 'Received — thank you');
    await outsource.submitThroughLink(req.params.token, { values: req.body.values });
    return ApiResponse.created(res, { ok: true }, 'Received — thank you');
  }),
);

export default router;
