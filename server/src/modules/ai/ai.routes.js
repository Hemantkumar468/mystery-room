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

/* ── Maintenance ───────────────────────────────────────── */
// Re-applies the current rubric to a stored report. No provider call, so it is
// not rate-limited alongside the paid endpoints.
router.post('/analyses/:id/rescore', canRescore, validate(analysisIdParamSchema), aiController.rescore);

export default router;
