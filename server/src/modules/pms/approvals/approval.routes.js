import { Router } from 'express';
import { z } from 'zod';
import { approvalController } from './approval.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';

/**
 * The approval review surface — read-only.
 *
 * Guarded by the same `CAN_MANAGE` set that gates every decision endpoint, and
 * for the same reason: this returns a doer's full submission, the project's
 * budget and its variance. That is exactly the commercial detail the vendor
 * pages had to be gated for, and an authenticated-only route here would hand
 * it to every site engineer with a login.
 *
 * Deciding still happens on the task endpoints — see approval.service.js.
 */
const router = Router();
const canDecide = authorize(...CAN_MANAGE);

const taskParam = z.object({
  params: z.object({ taskId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
});

router.use(authenticate);

router.get('/tasks/:taskId/submission', canDecide, validate(taskParam), approvalController.submission);
router.get('/tasks/:taskId/history', canDecide, validate(taskParam), approvalController.history);
router.get('/tasks/:taskId/analysis', canDecide, validate(taskParam), approvalController.analysis);

export default router;
