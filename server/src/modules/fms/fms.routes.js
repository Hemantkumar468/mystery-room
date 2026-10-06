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

const objectId = z.string().length(24);

/**
 * WHO A JOB WOULD GO TO, for pre-filling a picker.
 *
 * ABOVE THE GATE ON PURPOSE, and this is the same rule the rest of the ERP
 * follows: gate the DESTINATION, not the lookup behind a field on it. The
 * New Store form needs this to show "assigned to the Property Consultant"
 * before anybody presses Create, and whoever may open that form is already
 * allowed to hand the work out — they are doing exactly that by submitting
 * it. Gating this with the Assign Work screen instead would mean an MD who
 * narrowed that one admin surface silently got an empty picker on a form
 * they are entitled to use, which reads as "nobody is assigned".
 *
 * It discloses one name and the seat it comes from. Nothing is writable
 * here, and the directory of people is NOT returned — that still lives
 * behind the gate below.
 */
router.get(
  '/default-doer/:item',
  validate(z.object({ params: z.object({ item: z.string().min(1).max(80) }) })),
  asyncHandler(async (req, res) => {
    const data = await fmsService.defaultDoerFor(req.params.item);
    return ApiResponse.ok(res, data, data ? data.says : 'Nobody is named for this job');
  }),
);

router.use(requireAccess('module:fms-assign'));

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
