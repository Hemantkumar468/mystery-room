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

export default router;
