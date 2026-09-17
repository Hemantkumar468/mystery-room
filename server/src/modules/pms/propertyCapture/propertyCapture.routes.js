import { Router } from 'express';
import { z } from 'zod';
import {
  propertyCaptureService, ASSESSMENTS, DOCUMENTS, SORT_KEYS, DEFAULT_LIMIT, MAX_LIMIT,
} from './propertyCapture.service.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE, CAN_DECIDE } from '../../../core/constants/index.js';

/**
 * Property capture — the queue and its one decision.
 *
 * READING is open to any signed-in user: the expansion team works this list.
 * ROUTING a property is manager-and-above, because it is the same weight of
 * call as shortlisting at Phase 1 — which is exactly what it does underneath.
 */
const routeSchema = z.object({
  params: z.object({ recordId: z.string().length(24) }),
  body: z.object({
    assessments: z.array(z.enum(['feasibility', 'financial', 'technical', 'operational'])).max(4).optional(),
    skip: z.boolean().optional(),
  }),
});

const router = Router();
router.use(authenticate);

/** The four assessments and six documents — served so the client cannot drift. */
router.get('/meta', asyncHandler(async (_req, res) => (
  ApiResponse.ok(res, { assessments: ASSESSMENTS, documents: DOCUMENTS }, 'Meta fetched')
)));

/**
 * One page of the queue, plus the counts the stepper needs.
 *
 * Paginated at the SERVICE, not in the browser. The union this builds is the
 * whole pipeline, and shipping every row so the client can show twenty-five of
 * them wastes the transfer and the render on work nobody sees — and gets
 * slower every month the business grows. `counts` rides along in the same
 * response so the four phase totals stay correct on every page without a
 * second round trip.
 */
const listQuery = z.object({
  query: z.object({
    source: z.enum(['franchise', 'broker', 'demand', 'captured']).optional(),
    stage: z.enum(['capture', 'demand', 'assessment', 'commercial', 'rejected']).optional(),
    includeRejected: z.coerce.boolean().optional(),
    city: z.string().max(80).optional(),
    search: z.string().max(200).optional(),
    sort: z.enum(SORT_KEYS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  }).partial(),
});

router.get('/', validate(listQuery), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.list({
    source: req.query.source,
    city: req.query.city,
    stage: req.query.stage,
    search: req.query.search,
    sort: req.query.sort,
    dir: req.query.dir,
    page: req.query.page,
    limit: req.query.limit || DEFAULT_LIMIT,
    includeRejected: req.query.includeRejected,
  });
  return ApiResponse.ok(res, result, `Property queue fetched (page ${result.page} of ${result.totalPages})`);
}));

router.post('/:recordId/route', authorize(...CAN_MANAGE), validate(routeSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.route(req.params.recordId, req.body, req.user.id);
  return ApiResponse.ok(res, result, result.skipped
    ? 'Assessment skipped — the property moves to commercial closure'
    : `${result.created.length} assessment form(s) opened`);
}));

/**
 * A submitted property's next step — the one question Step 1 asks about a
 * property that arrived through the franchise or referral link.
 *
 * Decision-tier, because answering it approves the lead and creates the
 * project: the same weight as the franchise decision it wraps, so it carries
 * the same authorization rather than a looser one of its own.
 */
const submissionSchema = z.object({
  params: z.object({ enquiryId: z.string().length(24) }),
  body: z.object({
    decision: z.enum(['approve', 'reject']).optional(),
    propertyIds: z.array(z.string()).max(12).optional(),
    assessments: z.array(z.enum(['feasibility', 'financial', 'technical', 'operational'])).max(4).optional(),
    skip: z.boolean().optional(),
    reason: z.string().max(1000).optional(),
  }),
});

router.post(
  '/submissions/:enquiryId/route',
  authorize(...CAN_DECIDE),
  validate(submissionSchema),
  asyncHandler(async (req, res) => {
    const result = await propertyCaptureService.routeSubmission(req.params.enquiryId, req.body, req.user);
    return ApiResponse.ok(res, result, result.decision === 'reject'
      ? 'Submission declined'
      : result.nextStage === 'commercial'
        ? 'Approved — the site goes straight to commercial closure'
        : 'Approved — the assessment forms are open');
  }),
);

/** The verdict after assessment: take it forward, or take it off the table. */
const decideSchema = z.object({
  params: z.object({ recordId: z.string().length(24) }),
  body: z.object({
    decision: z.enum(['shortlist', 'reject']),
    reason: z.string().max(1000).optional(),
  }),
});

router.post('/:recordId/decide', authorize(...CAN_MANAGE), validate(decideSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.decide(req.params.recordId, req.body, req.user.id);
  return ApiResponse.ok(res, result, result.decision === 'shortlist'
    ? 'Shortlisted — the property moves to commercial closure'
    : 'Property rejected');
}));

export default router;
