import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth.js';
import { requireModule, requireStep } from '../../core/middleware/access.js';
import { accessService } from '../access/access.service.js';
import { ACCESS } from '../../core/constants/access.js';
import { validate } from '../../core/middleware/validate.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { aiLimiter } from '../../core/middleware/rateLimiter.js';
import { hrmsService, canHr, canCreateAccounts } from './hrms.service.js';
import { CENTRE_ROLE_PRESETS, PIPELINE_ORDER, CANDIDATE_STAGE_VALUES } from './hrms.constants.js';
import {
  listRequisitionsSchema, requisitionIdSchema, createRequisitionSchema, updateRequisitionSchema, deleteSchema,
  draftJdSchema, listCandidatesSchema, candidateIdSchema, createCandidateSchema, updateCandidateSchema,
  moveCandidateSchema, createAccountSchema,
  scheduleInterviewSchema, updateInterviewSchema, decideInterviewSchema, interviewIdSchema,
  sendInviteSchema, exportCandidatesSchema,
} from './hrms.validation.js';

/**
 * The authenticated HRMS surface, mounted at /hrms. Reads are open to anyone
 * signed in; writes are gated inside the service (HR department or a manager)
 * so the rule lives in one place rather than per route.
 *
 * The public application form is in hrms.public.routes.js, mounted separately
 * and BEFORE this router — same reasoning as the CRM split.
 */
const router = Router();
router.use(authenticate);
/* Every HRMS route sits behind the HRMS module grant, so a role or a person
   who has had HRMS taken away on Settings -> Access Control is refused here
   too - not merely shown a sidebar without it. */
router.use(requireModule('hrms'));

/**
 * The hiring pipeline, as access surfaces.
 *
 * A stage is not a page - nobody navigates to "Offer" - so it cannot be
 * gated by hanging middleware off a route. It is gated where it is actually
 * exposed instead: the stages a caller may SEE narrow every listing, and the
 * stage a caller may WRITE INTO is checked on the move.
 */
const stageSurface = (stage) => `stage:hrms-${stage}`;

/** The stages this caller may see, in pipeline order. */
async function visibleStages(user) {
  const allowed = new Set(await accessService.filter(user, CANDIDATE_STAGE_VALUES.map(stageSurface)));
  return CANDIDATE_STAGE_VALUES.filter((stage) => allowed.has(stageSurface(stage)));
}

router.get('/overview', requireStep('hrms-overview'), asyncHandler(async (_req, res) => {
  return ApiResponse.ok(res, await hrmsService.overview(), 'Hiring overview');
}));

router.get('/meta', asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, { presets: CENTRE_ROLE_PRESETS, pipelineOrder: PIPELINE_ORDER, canEdit: canHr(req.user), canCreateAccounts: canCreateAccounts(req.user) }, 'HRMS meta');
}));

/* ── Requisitions ── */
router.get('/requisitions', requireStep('hrms-requisitions'), validate(listRequisitionsSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.listRequisitions(req.validatedQuery || {}), 'Requisitions');
}));
router.post('/requisitions', validate(createRequisitionSchema), asyncHandler(async (req, res) => {
  return ApiResponse.created(res, await hrmsService.createRequisition(req.body, req.user), 'Requisition created');
}));
// AI JD draft — a provider call, so it sits behind the AI budget limiter.
router.post('/requisitions/draft-jd', aiLimiter, validate(draftJdSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.draftJobDescription(req.body), 'Draft ready — review and edit it');
}));
router.get('/requisitions/:id', validate(requisitionIdSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.getRequisition(req.params.id), 'Requisition');
}));
router.patch('/requisitions/:id', validate(updateRequisitionSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.updateRequisition(req.params.id, req.body, req.user), 'Requisition updated');
}));
router.delete('/requisitions/:id', validate(deleteSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.deleteRequisition(req.params.id, req.body.reason, req.user), 'Requisition removed');
}));

/* ── Candidates ── */
router.get('/candidates', requireStep('hrms-candidates'), validate(listCandidatesSchema), asyncHandler(async (req, res) => {
  const stages = await visibleStages(req.user);
  return ApiResponse.ok(res, await hrmsService.listCandidates({ ...(req.validatedQuery || {}), stages }), 'Candidates');
}));
router.post('/candidates', validate(createCandidateSchema), asyncHandler(async (req, res) => {
  return ApiResponse.created(res, await hrmsService.createCandidate(req.body, req.user), 'Candidate added');
}));
router.patch('/candidates/:id', validate(updateCandidateSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.updateCandidate(req.params.id, req.body, req.user), 'Candidate updated');
}));
router.post('/candidates/:id/move', validate(moveCandidateSchema), asyncHandler(async (req, res) => {
  /* Checked in the handler rather than as mounted middleware, because the
     surface being asked for is in the BODY - it is the stage the candidate
     is being moved INTO, which no static route path can name. */
  const target = stageSurface(req.body.stage);
  if (!await accessService.allows(req.user, target, ACCESS.EDIT)) {
    throw ApiError.forbidden(
      `You cannot move a candidate into ${req.body.stage}. Ask whoever manages Access Control in Settings.`,
      { code: 'ACCESS_DENIED', details: { surface: target, needed: ACCESS.EDIT } },
    );
  }
  return ApiResponse.ok(res, await hrmsService.moveCandidate(req.params.id, req.body, req.user), 'Candidate moved');
}));
router.post('/candidates/:id/create-account', validate(createAccountSchema), asyncHandler(async (req, res) => {
  return ApiResponse.created(res, await hrmsService.createEmployeeAccount(req.params.id, req.body, req.user), 'Employee account created');
}));
router.delete('/candidates/:id', validate(deleteSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.deleteCandidate(req.params.id, req.body.reason, req.user), 'Candidate removed');
}));


/* ── Candidate detail + interview rounds ──────────────────────────────────
   Ordered so the literal paths win: /candidates/export must be declared
   BEFORE /candidates/:id, or Express hands "export" to the :id handler and
   the download 404s as a candidate that does not exist. */

router.get('/candidates/export', validate(exportCandidatesSchema), asyncHandler(async (req, res) => {
  const stages = await visibleStages(req.user);
  const out = await hrmsService.exportCandidates({ ...(req.validatedQuery || {}), stages }, req.user);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="candidates-${stamp}.csv"`);
  // Says what the file contains without opening it — and says so when the
  // ceiling clipped it, rather than letting a short file look complete.
  res.setHeader('X-Row-Count', String(out.rowCount));
  if (out.truncated) res.setHeader('X-Truncated', `${out.rowCount} of ${out.total}`);
  return res.send(out.csv);
}));

router.get('/candidates/:id', validate(candidateIdSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.getCandidate(req.params.id), 'Candidate');
}));

router.post('/candidates/:id/interviews', validate(scheduleInterviewSchema), asyncHandler(async (req, res) => {
  return ApiResponse.created(res, await hrmsService.scheduleInterview(req.params.id, req.body, req.user), 'Interview scheduled');
}));
router.patch('/candidates/:id/interviews/:interviewId', validate(updateInterviewSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.updateInterview(req.params.id, req.params.interviewId, req.body, req.user), 'Interview updated');
}));
router.post('/candidates/:id/interviews/:interviewId/decide', validate(decideInterviewSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.decideInterview(req.params.id, req.params.interviewId, req.body, req.user), 'Outcome recorded');
}));
router.post('/candidates/:id/interviews/:interviewId/invite', validate(sendInviteSchema), asyncHandler(async (req, res) => {
  const out = await hrmsService.sendInterviewInvite(req.params.id, req.params.interviewId, req.body, req.user);
  /* 200 either way, with the truth in the body. A 500 for "this server has
     no mail configured" would be a lie about whose fault it is, and the
     caller needs to tell the two apart to say anything useful on screen. */
  return ApiResponse.ok(res, out, out.sent ? 'Invite sent' : 'Invite not sent');
}));
router.delete('/candidates/:id/interviews/:interviewId', validate(interviewIdSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.cancelInterview(req.params.id, req.params.interviewId, req.user), 'Interview cancelled');
}));

export default router;
