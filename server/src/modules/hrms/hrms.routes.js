import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { aiLimiter } from '../../core/middleware/rateLimiter.js';
import { hrmsService, canHr, canCreateAccounts } from './hrms.service.js';
import { CENTRE_ROLE_PRESETS, PIPELINE_ORDER } from './hrms.constants.js';
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

router.get('/overview', asyncHandler(async (_req, res) => {
  return ApiResponse.ok(res, await hrmsService.overview(), 'Hiring overview');
}));

router.get('/meta', asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, { presets: CENTRE_ROLE_PRESETS, pipelineOrder: PIPELINE_ORDER, canEdit: canHr(req.user), canCreateAccounts: canCreateAccounts(req.user) }, 'HRMS meta');
}));

/* ── Requisitions ── */
router.get('/requisitions', validate(listRequisitionsSchema), asyncHandler(async (req, res) => {
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
router.get('/candidates', validate(listCandidatesSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.listCandidates(req.validatedQuery || {}), 'Candidates');
}));
router.post('/candidates', validate(createCandidateSchema), asyncHandler(async (req, res) => {
  return ApiResponse.created(res, await hrmsService.createCandidate(req.body, req.user), 'Candidate added');
}));
router.patch('/candidates/:id', validate(updateCandidateSchema), asyncHandler(async (req, res) => {
  return ApiResponse.ok(res, await hrmsService.updateCandidate(req.params.id, req.body, req.user), 'Candidate updated');
}));
router.post('/candidates/:id/move', validate(moveCandidateSchema), asyncHandler(async (req, res) => {
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
  const out = await hrmsService.exportCandidates(req.validatedQuery || {}, req.user);
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
