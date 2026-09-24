import { Router } from 'express';
import { z } from 'zod';
import { fmsService } from './fms.service.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireAccess } from '../../core/middleware/access.js';
import { ACCESS } from '../../core/constants/access.js';

/**
 * FMS · Assign Work — who each recurring job in a flow belongs to.
 *
 * A SEPARATE SURFACE FROM ACCESS CONTROL, deliberately. Both are settings
 * screens and both are about people, but they answer different questions and
 * are usually answered by different people: Access Control decides who may
 * OPEN Step 3, this decides who the four assessments are GIVEN to. A project
 * head hands out work every week without having any business widening
 * somebody's permissions, and gating them together would force the company
 * to choose between the two.
 */

const router = Router();
router.use(authenticate);
router.use(requireAccess('module:fms-assign'));

const objectId = z.string().length(24);

/** Every job, who is on it, and the directory the pickers choose from. */
router.get('/assignments', asyncHandler(async (_req, res) => {
  const data = await fmsService.board();
  return ApiResponse.ok(res, data, `${data.rows.length} jobs across ${data.fms.length} flow(s)`);
}));

/** Put people on one job. */
router.put(
  '/assignments/:item',
  requireAccess('module:fms-assign', ACCESS.MANAGE),
  validate(z.object({
    params: z.object({ item: z.string().min(1).max(80) }),
    body: z.object({
      doers: z.array(objectId).max(20).optional(),
      buddies: z.array(objectId).max(20).optional(),
      note: z.string().max(300).optional(),
    }),
  })),
  asyncHandler(async (req, res) => {
    const data = await fmsService.save(req.params.item, req.body, req.user);
    return ApiResponse.ok(res, data, 'Saved — new work for this job goes to them from now on');
  }),
);

/** Back to the fallback: the org sheet, then the project template. */
router.delete(
  '/assignments/:item',
  requireAccess('module:fms-assign', ACCESS.MANAGE),
  validate(z.object({ params: z.object({ item: z.string().min(1).max(80) }) })),
  asyncHandler(async (req, res) => {
    const data = await fmsService.clear(req.params.item);
    return ApiResponse.ok(res, data, 'Cleared — this job follows the org sheet again');
  }),
);

export default router;
