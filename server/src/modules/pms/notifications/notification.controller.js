import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { notificationService } from './notification.service.js';

export const notificationController = {
  list: asyncHandler(async (req, res) => {
    const { unreadOnly, limit } = req.validatedQuery || {};
    const items = await notificationService.listForUser(req.user.id, {
      unreadOnly: unreadOnly === true || unreadOnly === 'true',
      limit,
    });
    return ApiResponse.ok(res, items);
  }),

  unreadCount: asyncHandler(async (req, res) => {
    const count = await notificationService.unreadCount(req.user.id);
    return ApiResponse.ok(res, { count });
  }),

  markRead: asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(req.params.id, req.user.id);
    return ApiResponse.ok(res, notification, 'Notification marked read');
  }),

  markAllRead: asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.user.id);
    return ApiResponse.ok(res, null, 'All notifications marked read');
  }),
};

export default notificationController;
