import { Router } from 'express';
import { z } from 'zod';
import {
  propertyCaptureService, ASSESSMENTS, DOCUMENTS, ROADS, SORT_KEYS, STATUS_KEYS, DEFAULT_LIMIT, MAX_LIMIT,
} from './propertyCapture.service.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { requireModule, requireStep } from '../../../core/middleware/access.js';
import { ACCESS } from '../../../core/constants/access.js';
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
    /* The three roads Step 2 chooses between. `skip` is the older two-road
       shape and is still accepted so nothing that speaks it breaks. */
    road: z.enum(ROADS).optional(),
    assessments: z.array(z.enum(['feasibility', 'financial', 'technical', 'operational'])).max(4).optional(),
    skip: z.boolean().optional(),
  }),
});

const router = Router();
router.use(authenticate);
/* The Property Capturing FMS module grant. The six STEPS are gated per
   route inside this file where the route belongs to one - see requireStep. */
router.use(requireModule('property-capture'));

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
    /* 'other' belongs here: the service emits it (a lead that came from
       someone who is neither an agent nor an applicant) and Step 1 has had a
       tab for it since it was added. It was missing from this list, so every
       click on that tab was refused by the edge before the service ever saw
       it - a filter that looked like a filter and returned an error. */
    /* `company` is not a source a row carries — it is the pair of them we
       opened ourselves, 'captured' and 'demand', asked for as one. The two
       are one tab and one button now ("Open a Store"), so they are one
       filter; the underlying rows keep their own source. */
    source: z.enum(['franchise', 'broker', 'demand', 'captured', 'other', 'company']).optional(),
    stage: z.enum(['capture', 'routing', 'decide', 'demand', 'assessment', 'selection', 'commercial', 'docreview', 'creation', 'rejected']).optional(),
    /* Where a property stands, as the queue itself works it out - see
       STATUS_LADDER in the service. Filtered there rather than in the browser,
       so a status filter narrows the whole step and its count, not the page. */
    status: z.enum(STATUS_KEYS).optional(),
    includeRejected: z.coerce.boolean().optional(),
    /* Which header tile was pressed — see TILE_VIEWS in the service. */
    view: z.enum(['shortlisted', 'assessment', 'assigned', 'documentsPending', 'draft']).optional(),
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
    status: req.query.status,
    sort: req.query.sort,
    dir: req.query.dir,
    page: req.query.page,
    limit: req.query.limit || DEFAULT_LIMIT,
    includeRejected: req.query.includeRejected,
    view: req.query.view,
  });
  return ApiResponse.ok(res, result, `Property queue fetched (page ${result.page} of ${result.totalPages})`);
}));

router.post('/:recordId/route', authorize(...CAN_MANAGE), requireStep('property-md-review', ACCESS.MANAGE), validate(routeSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.route(req.params.recordId, req.body, req.user.id);
  const said = {
    assessment: `${result.created.length} assessment form(s) opened`,
    commercial: 'Straight to commercial — the six closure documents are open',
    project: 'Straight to project — games and dates can be planned now',
  };
  return ApiResponse.ok(res, result, said[result.road] || 'Property routed');
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
    /* The three roads, same as a captured property gets. `skip` is the
       older two-road shape and still accepted — see routeSubmission. */
    road: z.enum(['assessment', 'commercial', 'project']).optional(),
    skip: z.boolean().optional(),
    reason: z.string().max(1000).optional(),
  }),
});

router.post(
  '/submissions/:enquiryId/route',
  authorize(...CAN_DECIDE),
  /* Step 2 again: routing an inbound submission is the same decision, taken
     on a property that arrived through the franchise or referral link. */
  requireStep('property-md-review', ACCESS.MANAGE),
  validate(submissionSchema),
  asyncHandler(async (req, res) => {
    const result = await propertyCaptureService.routeSubmission(req.params.enquiryId, req.body, req.user);
    return ApiResponse.ok(res, result, result.decision === 'reject'
      ? 'Submission declined'
      : result.nextStage === 'planning'
        ? 'Approved — games and dates can be planned, and the six documents are open too'
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
    /* WHERE THE SITE GOES NEXT - the whole question Step 4 exists to answer.
       The dialog has asked it since it was built; it was not being sent.
       Optional, and 'commercial' when absent, so an older client keeps the
       behaviour it had. */
    road: z.enum(['commercial', 'project']).optional(),
  }),
});

/**
 * Changing a decision already taken — Step 2's own second thought.
 *
 * Same authorization as the decision itself: whoever may decide may change
 * their mind, and the reason is required because the change is the thing
 * somebody will ask about later.
 */
const changeSchema = z.object({
  params: z.object({ recordId: z.string().length(24) }),
  body: z.object({
    to: z.enum(['shortlist', 'reject', 'waiting']),
    /* Optional at the edge because a withdrawal needs none - the service
       still requires one for shortlist and reject. See changeDecision. */
    reason: z.string().trim().max(1000).optional(),
    road: z.enum(['assessment', 'commercial', 'project']).optional(),
    assessments: z.array(z.enum(['feasibility', 'financial', 'technical', 'operational'])).max(4).optional(),
  }),
});

router.post('/:recordId/change-decision', authorize(...CAN_MANAGE), requireStep('property-md-review', ACCESS.MANAGE), validate(changeSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.changeDecision(req.params.recordId, req.body, req.user.id);
  const said = {
    shortlist: 'Decision changed — the property is shortlisted again',
    reject: 'Decision changed — the property is off the table',
    waiting: 'Decision withdrawn — the property is back in MD Review',
  };
  return ApiResponse.ok(res, result, said[result.to] || 'Decision changed');
}));

/**
 * Step 4's Reject — the assessment goes back, the property does not die.
 *
 * Its own endpoint rather than a flag on `decide`, because it is not a
 * decision: nothing is written to the property's status, and `decide`'s whole
 * job is to write one. See `sendBackForRework`.
 */
const reassessSchema = z.object({
  params: z.object({ recordId: z.string().length(24) }),
  /* Required here as well as in the service — the doer gets nothing else. */
  body: z.object({
    reason: z.string().trim().min(1).max(1000),
    /* Which assessments are being sent back. Omitted means all of them —
       the older shape, still meant literally. */
    assessments: z.array(z.enum(ASSESSMENTS.map((a) => a.key))).optional(),
  }),
});

router.post('/:recordId/reassess', authorize(...CAN_MANAGE), requireStep('property-md-review', ACCESS.MANAGE), validate(reassessSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.sendBackForRework(req.params.recordId, req.body, req.user.id);
  const n = result.assessmentsSentBack.length;
  return ApiResponse.ok(res, result, `Sent back — ${n} assessment${n === 1 ? '' : 's'} returned to the doer`);
}));

/**
 * Document Approvals' Reject — the document goes back to whoever filed it.
 *
 * Its own endpoint, and NOT `records/:id/decision` with `reject`, which is
 * what this step used to call: that sets the document to REJECTED, and a
 * rejected record cannot be reopened as a form, so the doer was refused and
 * then locked out of fixing it. See `sendDocumentsBack`.
 */
const sendBackDocsSchema = z.object({
  params: z.object({ recordId: z.string().length(24) }),
  body: z.object({
    /* Required at the edge as well as in the service — it is the only thing
       the doer is given to work from. */
    reason: z.string().trim().min(1).max(1000),
    /* Which of the six. Omitted means every one that has been submitted. */
    documents: z.array(z.enum(DOCUMENTS.map((d) => d.key))).optional(),
  }),
});

router.post('/:recordId/documents/send-back', authorize(...CAN_MANAGE), requireStep('property-doc-approval', ACCESS.MANAGE), validate(sendBackDocsSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.sendDocumentsBack(req.params.recordId, req.body, req.user.id);
  const n = result.documentsSentBack.length;
  return ApiResponse.ok(res, result, `Sent back — ${n} document${n === 1 ? '' : 's'} returned to the doer`);
}));

router.post('/:recordId/decide', authorize(...CAN_MANAGE), requireStep('property-md-review', ACCESS.MANAGE), validate(decideSchema), asyncHandler(async (req, res) => {
  const result = await propertyCaptureService.decide(req.params.recordId, req.body, req.user.id);
  return ApiResponse.ok(res, result, result.decision !== 'shortlist'
    ? 'Property rejected'
    : result.road === 'project'
      ? 'Approved — closure opens and the site is ready for games & dates'
      : 'Shortlisted — the property moves to commercial closure');
}));

export default router;
