import { Router } from 'express';
import { notificationController } from './notification.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { listNotificationsSchema, idParamSchema } from './notification.validation.js';

const router = Router();

router.use(authenticate);

router.get('/', validate(listNotificationsSchema), notificationController.list);
router.get('/unread-count', notificationController.unreadCount);
router.post('/:id/read', validate(idParamSchema), notificationController.markRead);
router.post('/read-all', notificationController.markAllRead);

export default router;
