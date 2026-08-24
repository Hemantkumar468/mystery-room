import { Router } from 'express';
import { aiController } from './ai.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { aiLimiter } from '../../core/middleware/rateLimiter.js';
import { CAN_MANAGE, CAN_CAPTURE } from '../../core/constants/index.js';
import {
  analysePropertySchema,
  recordIdParamSchema,
  historySchema,
  projectIdParamSchema,
  analyseAllSchema,
  analysisIdParamSchema,
  prefillAssessmentSchema,
  designGuidanceSchema,
  savedDesignGuidanceSchema,
  fieldAssistSchema,
  procurementBriefSchema,
} from './ai.validation.js';

const router = Router();

// Anyone working a project may *read* an analysis; only the roles that capture
// or decide on properties may spend money running one. Viewers stay read-only.
const canRunAnalysis = authorize(...CAN_CAPTURE);
const canRescore = authorize(...CAN_MANAGE);

router.use(authenticate);

router.get('/status', aiController.status);

/* ── Property intelligence ─────────────────────────────── */
// The tighter `aiLimiter` guards only the endpoints that call a provider;
// reads and polling stay on the general limiter so a client polling a running
// analysis can never exhaust its own budget for starting one.
router.post(
  '/property-intelligence/:recordId',
  aiLimiter,
  canRunAnalysis,
  validate(analysePropertySchema),
  aiController.analyseProperty,
);
router.get(
  '/property-intelligence/:recordId',
  validate(recordIdParamSchema),
  aiController.getPropertyAnalysis,
);
router.get(
  '/property-intelligence/:recordId/history',
  validate(historySchema),
  aiController.getPropertyHistory,
);

/* ── Project-wide ──────────────────────────────────────── */
router.get(
  '/projects/:projectId/scores',
  validate(projectIdParamSchema),
  aiController.getProjectScores,
);
// One request, many provider calls — the tighter aiLimiter matters most here.
router.post(
  '/projects/:projectId/analyse-all',
  aiLimiter,
  canRunAnalysis,
  validate(analyseAllSchema),
  aiController.analyseAllProperties,
);
// Polling only; stays off aiLimiter so watching a sweep cannot exhaust the
// budget for starting one, same rule as the per-property poll above.
router.get(
  '/projects/:projectId/analyse-all',
  validate(projectIdParamSchema),
  aiController.getSweepProgress,
);
router.post(
  '/projects/:projectId/comparison',
  aiLimiter,
  canRunAnalysis,
  validate(projectIdParamSchema),
  aiController.compareSites,
);
router.get(
  '/projects/:projectId/comparison',
  validate(projectIdParamSchema),
  aiController.getComparison,
);

/* ── Assessment prefill ────────────────────────────────── */
// Drafts a Phase 2 assessment form for the expert to edit. Calls a provider, so
// it sits behind `aiLimiter` like the other paid endpoints. Same permission as
// running an analysis — anyone who can capture can ask for a draft; nothing is
// written, so this grants no authority the user did not already have.
router.post(
  '/assessment-prefill',
  canRunAnalysis,
  aiLimiter,
  validate(prefillAssessmentSchema),
  aiController.prefillAssessment,
);

// Design ideas before drawing, and feedback on an uploaded drawing. Calls a
// provider, so it is rate-limited with the other paid endpoints.
router.post(
  '/design-guidance',
  canRunAnalysis,
  aiLimiter,
  validate(designGuidanceSchema),
  aiController.designGuidance,
);

// Reading the saved run costs nothing and calls no provider, so it sits outside
// `aiLimiter` — otherwise merely viewing a task would consume the AI budget.
router.get(
  '/design-guidance/:propertyRecordId',
  validate(savedDesignGuidanceSchema),
  aiController.getDesignGuidance,
);

// Tiny in-field writing help (draft / tidy one textarea). Calls a provider, so
// it shares the paid endpoints' rate limit.
router.post(
  '/field-assist',
  canRunAnalysis,
  aiLimiter,
  validate(fieldAssistSchema),
  aiController.fieldAssist,
);

/* ── Procurement brief (Phase 6 order tracker) ─────────── */
// Calls a provider, so it shares the paid endpoints' rate limit. Same
// permission as the other drafts: anyone who can capture may ask for one.
router.post(
  '/procurement-brief/:projectId',
  canRunAnalysis,
  aiLimiter,
  validate(procurementBriefSchema),
  aiController.procurementBrief,
);
// Reading the saved brief is free — outside `aiLimiter`, like design guidance.
router.get(
  '/procurement-brief/:projectId',
  validate(projectIdParamSchema),
  aiController.getProcurementBrief,
);

/* ── Maintenance ───────────────────────────────────────── */
// Re-applies the current rubric to a stored report. No provider call, so it is
// not rate-limited alongside the paid endpoints.
router.post('/analyses/:id/rescore', canRescore, validate(analysisIdParamSchema), aiController.rescore);

export default router;
