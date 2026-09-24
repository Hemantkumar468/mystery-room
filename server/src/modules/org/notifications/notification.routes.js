import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { notificationService } from './notification.service.js';

const router = Router();
const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });
const listSchema = z.object({
  query: z.object({
    limit: z.coerce.number().int().positive().max(200).optional(),
    unread: z.enum(['true', 'false']).optional(),
  }),
});

// Every route acts on the caller's own inbox only.
router.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) => {
    const q = req.validatedQuery || {};
    const { items, unread } = await notificationService.listFor(req.user.id, {
      limit: q.limit,
      unreadOnly: q.unread === 'true',
    });
    return ApiResponse.ok(res, items, 'Notifications', { unread });
  }),
);

router.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.user.id);
    return ApiResponse.ok(res, null, 'All notifications marked as read');
  }),
);

router.post(
  '/:id/read',
  validate(idParam),
  asyncHandler(async (req, res) => {
    const n = await notificationService.markRead(req.user.id, req.params.id);
    return ApiResponse.ok(res, n, 'Marked as read');
  }),
);

router.delete(
  '/',
  asyncHandler(async (req, res) => {
    await notificationService.clear(req.user.id);
    return ApiResponse.ok(res, null, 'Notifications cleared');
  }),
);

router.delete(
  '/:id',
  validate(idParam),
  asyncHandler(async (req, res) => {
    await notificationService.remove(req.user.id, req.params.id);
    return ApiResponse.ok(res, null, 'Notification deleted');
  }),
);

export default router;
