import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireModule } from '../../core/middleware/access.js';
import { DEPARTMENT_VALUES } from '../../core/constants/index.js';
import { performanceService } from './performance.service.js';

/**
 * Performance module — KRA/KPI report (scoped to who the caller may see) and a
 * gamified scoreboard (open to everyone), both filterable branch-, team- and
 * group-wise. Numbers are always derived live from delegation + checklist data.
 */
const router = Router();
router.use(authenticate);
// Settings → Access Control can hide this module per role or person.
router.use(requireModule('ops-performance'));

const objectId = z.string().length(24);
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const common = {
  branch: z.union([objectId, z.literal('all')]).optional(),
  team: objectId.optional(),
  group: objectId.optional(),
  department: z.enum(DEPARTMENT_VALUES).optional(),
  source: z.enum(['all', 'delegation', 'checklist']).optional(),
};

const kraSchema = z.object({ query: z.object({ ...common, from: dayKey.optional(), to: dayKey.optional() }) });
const boardSchema = z.object({ query: z.object({ ...common, period: z.enum(['week', 'month', 'quarter', 'all']).optional() }) });

router.get(
  '/kra',
  validate(kraSchema),
  asyncHandler(async (req, res) => ApiResponse.ok(res, await performanceService.kraReport(req.validatedQuery || {}, req.user))),
);

router.get(
  '/scoreboard',
  validate(boardSchema),
  asyncHandler(async (req, res) => ApiResponse.ok(res, await performanceService.scoreboard(req.validatedQuery || {}, req.user))),
);

export default router;
