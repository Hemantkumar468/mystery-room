import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_CAPTURE } from '../../../core/constants/index.js';
import * as outsource from './outsource.service.js';

/**
 * Inviting an outside designer, from inside the system.
 *
 * Manager-and-above is NOT the bar here: the person who knows a drawing is
 * being outsourced is the project manager or the architect coordinating it,
 * and both are ordinary capture roles. What the link can do is bounded
 * instead — it files one submission into one list of one phase, for review.
 *
 * The public half of this feature lives in outsource.public.routes.js and is
 * mounted BEFORE the authenticated router, for the same reason CRM's intake
 * is: `authenticate` here would answer every designer with a 401.
 */
const router = Router();
router.use(authenticate);
const canInvite = authorize(...CAN_CAPTURE);

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

const createSchema = z.object({
  body: z.object({
    projectId: objectId,
    stageKey: z.string().min(1).max(40),
    groupKey: z.string().max(60).optional(),
    taskId: objectId.optional(),
    templateTaskKey: z.string().max(60).optional(),
    name: z.string().min(1, 'Who is this going to?').max(120),
    company: z.string().max(160).optional(),
    // Loose on purpose: an Indian mobile arrives as "98765 43210",
    // "+91 98765-43210" or ten bare digits, and refusing any of those teaches
    // people to put the number in the notes field instead.
    phone: z.string().max(32).optional(),
    email: z.string().email('That email address does not look right').max(160).optional().or(z.literal('')),
    note: z.string().max(2000).optional(),
    expiresInDays: z.number().int().min(1).max(180).optional(),
  }),
});

const listSchema = z.object({
  query: z.object({
    projectId: objectId,
    stageKey: z.string().max(40).optional(),
  }),
});

const idParam = z.object({ params: z.object({ id: objectId }) });

const sendSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    channel: z.enum(['whatsapp', 'email', 'copied']),
    to: z.string().max(200).optional(),
  }),
});

router.get('/', validate(listSchema), asyncHandler(async (req, res) => {
  const links = await outsource.listLinks({
    projectId: req.query.projectId,
    stageKey: req.query.stageKey,
  });
  return ApiResponse.ok(res, links, 'Outside invitations');
}));

router.post('/', canInvite, validate(createSchema), asyncHandler(async (req, res) => {
  const result = await outsource.createLink(req.body, req.user?._id);
  return ApiResponse.created(res, result, `Link ready for ${req.body.name}`);
}));

router.post('/:id/sends', canInvite, validate(sendSchema), asyncHandler(async (req, res) => {
  const link = await outsource.recordSend(req.params.id, req.body, req.user?._id);
  return ApiResponse.ok(res, link, 'Send recorded');
}));

router.post('/:id/revoke', canInvite, validate(idParam), asyncHandler(async (req, res) => {
  const link = await outsource.revokeLink(req.params.id, req.user?._id);
  return ApiResponse.ok(res, link, 'That link no longer works');
}));

/* A new token, and the old one stops working immediately. */
router.post('/:id/regenerate', canInvite, validate(idParam), asyncHandler(async (req, res) => {
  const result = await outsource.regenerateLink(req.params.id);
  return ApiResponse.ok(res, result, 'New link ready — the old one is dead');
}));

export default router;
