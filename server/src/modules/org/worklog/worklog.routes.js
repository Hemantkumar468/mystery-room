import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { ROLES } from '../../../core/constants/index.js';
import { workLogService } from './worklog.service.js';

const router = Router();

const listSchema = z.object({
  query: z.object({
    module: z.enum(['delegation', 'checklist', 'org']).optional(),
    actor: z.string().length(24).optional(),
    refId: z.string().length(24).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    search: z.string().max(100).optional(),
    page: z.coerce.number().optional(),
    limit: z.coerce.number().optional(),
  }),
});

/** The audit log is a management view. */
router.get(
  '/',
  authorize(ROLES.ADMIN, ROLES.MANAGER),
  validate(listSchema),
  asyncHandler(async (req, res) => {
    const { items, meta } = await workLogService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Activity fetched', meta);
  }),
);

export default router;
