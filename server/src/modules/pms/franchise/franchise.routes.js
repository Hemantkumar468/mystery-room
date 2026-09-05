import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { validate } from '../../../core/middleware/validate.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { CAN_DECIDE } from '../../../core/constants/index.js';
import { franchiseService } from './franchise.service.js';

/**
 * The AUTHENTICATED half of franchise enquiries: the MD's queue and the
 * decision. The public form lives in franchise.public.routes.js, mounted
 * before this router — same split as HRMS and CRM intake.
 */
const listSchema = z.object({
  query: z.object({
    status: z.enum(['submitted', 'approved', 'rejected']).optional(),
  }),
});

const decisionSchema = z.object({
  params: z.object({ id: z.string().length(24) }),
  body: z.object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(1000).optional(),
  }),
});

const router = Router();
router.use(authenticate);

router.get('/enquiries', validate(listSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await franchiseService.list(req.validatedQuery || req.query || {}), 'Franchise enquiries');
}));

/* Approving creates a whole project — that is a decision-tier action. */
router.post(
  '/enquiries/:id/decision',
  authorize(...CAN_DECIDE),
  validate(decisionSchema),
  asyncHandler(async (req, res) => {
    const out = await franchiseService.decide(req.params.id, req.body, req.user);
    return ApiResponse.ok(res, out, req.body.decision === 'approve' ? 'Approved — project created' : 'Rejected');
  }),
);

export default router;
