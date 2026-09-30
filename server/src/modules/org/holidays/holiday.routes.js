import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { requireStep } from '../../../core/middleware/access.js';
import { ACCESS } from '../../../core/constants/access.js';
import { LEADERSHIP } from '../../../core/constants/index.js';
import { holidayService } from './holiday.service.js';
import { workLogService } from '../worklog/worklog.service.js';

const router = Router();

/**
 * Declaring a holiday is an Ops-settings write, and it is not a small one:
 * holidayService.create re-shapes every checklist occurrence that fell on the
 * day. The read stays open — the calendar and both ops modules colour their
 * dates from it. Two guards, as in branch.routes.js: the role rule and the
 * decision somebody made on Settings → Access Control.
 */
const mayEdit = requireStep('org-settings', ACCESS.EDIT);

const entry = z.object({
  name: z.string().trim().min(2).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});
const listSchema = z.object({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) });
const createSchema = z.object({
  body: z.union([entry, z.object({ holidays: z.array(entry).min(1).max(60) })]),
});
const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });

router.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) => ApiResponse.ok(res, await holidayService.list(req.validatedQuery || {}))),
);

router.post(
  '/',
  authorize(...LEADERSHIP),
  mayEdit,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const entries = req.body.holidays || [req.body];
    const result = await holidayService.create(entries, req.user.id);
    workLogService.log({
      module: 'org',
      type: 'created',
      title: result.created.map((h) => h.name).join(', '),
      description: `${result.created.length} holiday(s) declared`
        + (result.adjusted ? ` — checklist: ${result.adjusted.shifted} moved, ${result.adjusted.removedDaily} daily removed` : ''),
      actor: req.user.id,
      refType: 'holiday',
    });
    return ApiResponse.created(res, result, `${result.created.length} holiday(s) added`);
  }),
);

router.delete(
  '/:id',
  authorize(...LEADERSHIP),
  mayEdit,
  validate(idParam),
  asyncHandler(async (req, res) => {
    const h = await holidayService.remove(req.params.id);
    workLogService.log({ module: 'org', type: 'deleted', title: h.name, description: `Holiday on ${h.date} removed`, actor: req.user.id, refType: 'holiday' });
    return ApiResponse.ok(res, null, 'Holiday removed');
  }),
);

export default router;
