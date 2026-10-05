import { Router } from 'express';
import { notificationController } from './notification.controller.js';
import { notificationService } from './notification.service.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { listNotificationsSchema, idParamSchema } from './notification.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(listNotificationsSchema), notificationController.list);
router.get('/unread-count', notificationController.unreadCount);

/**
 * THE BELL'S LIVE WIRE — held open until something lands for this person.
 *
 * The client reopens it the moment it returns, so the bell updates within a
 * breath of the write instead of on the next thirty-second tick. See
 * notificationService.waitForNotification for why this is a long poll and
 * not a socket, and for how it stays correct across more than one instance.
 *
 * 204 means "nothing arrived in that window" — not an error, and not a
 * reason for the client to back off. It simply asks again.
 *
 * `wait` is capped under the usual sixty-second proxy idle timeout so the
 * request COMPLETES rather than being cut mid-flight and retried, which is
 * what turns a quiet poll into a reconnect loop in production.
 */
router.get('/stream', asyncHandler(async (req, res) => {
  const waitMs = Math.min(30_000, Math.max(1_000, Number(req.query.wait) || 25_000));
  const hit = await notificationService.waitForNotification(req.user.id, req.query.since, waitMs);
  if (!hit) return res.sendStatus(204);
  return ApiResponse.ok(res, { at: hit.createdAt }, 'New notification');
}));

router.post('/:id/read', validate(idParamSchema), notificationController.markRead);
router.post('/read-all', notificationController.markAllRead);

export default router;
