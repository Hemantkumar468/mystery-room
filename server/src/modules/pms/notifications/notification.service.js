import { Notification } from './notification.model.js';
import { Project } from '../projects/project.model.js';
import { User } from '../../auth/auth.model.js';
import { logger } from '../../../config/logger.js';
import { LEADERSHIP } from '../../../core/constants/index.js';

/**
 * Realistic recipient resolution — this app's real roles are only
 * admin/manager (department-scoped), no CEO/Finance-Head/Ops-Head. Recipients
 * are the project's owner + members, plus every admin, deduped. Excludes
 * `excludeId` (typically the actor) so a user isn't notified of their own
 * action.
 */
async function resolveRecipients(project, excludeId) {
  // The MD's desk, not just the MD — an EA who cannot see what the MD is
  // notified about cannot do the job of an EA.
  const admins = await User.find({ role: { $in: LEADERSHIP } }).select('_id');
  const ids = new Set([
    ...(project.owner ? [String(project.owner)] : []),
    ...(project.members || []).map(String),
    ...admins.map((a) => String(a._id)),
  ]);
  if (excludeId) ids.delete(String(excludeId));
  return [...ids];
}

export const notificationService = {
  /** Fan out one Notification doc per recipient. Fire-and-forget — never
   * blocks or breaks the caller's main flow (same resilience contract as
   * activityService.log). */
  async notify({ recipients, project, type, title, message, link }) {
    if (!recipients?.length) return;
    try {
      await Notification.insertMany(
        recipients.map((recipient) => ({ recipient, project, type, title, message, link })),
      );
    } catch (err) {
      logger.warn('Failed to write notification', { error: err.message });
    }
  },

  /** Convenience wrapper: resolve a project's real recipients (owner +
   * members + admins, minus the actor) and notify them. */
  async notifyForProject(projectId, { type, title, message, link, actorId }) {
    try {
      const project = await Project.findById(projectId).select('owner members');
      if (!project) return;
      const recipients = await resolveRecipients(project, actorId);
      await this.notify({ recipients, project: projectId, type, title, message, link });
    } catch (err) {
      logger.warn('Failed to resolve/send project notification', { error: err.message });
    }
  },

  async listForUser(userId, { unreadOnly = false, limit = 20 } = {}) {
    const filter = { recipient: userId };
    if (unreadOnly) filter.read = false;
    return Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('project', 'name code');
  },

  async unreadCount(userId) {
    return Notification.countDocuments({ recipient: userId, read: false });
  },

  async markRead(id, userId) {
    return Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { read: true, readAt: new Date() },
      { new: true },
    );
  },

  async markAllRead(userId) {
    await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true, readAt: new Date() },
    );
  },
};

export default notificationService;
