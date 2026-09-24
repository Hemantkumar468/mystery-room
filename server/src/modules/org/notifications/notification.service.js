import { Notification } from './notification.model.js';
import { User } from '../../auth/auth.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { sendMail, renderEmail } from './mailer.js';

const uniqIds = (ids = []) => [...new Set(ids.filter(Boolean).map(String))];

export const notificationService = {
  /**
   * Notify a set of people in-app (always) and by email (when SMTP is set up).
   * Never throws — a failed notification must not fail the action that caused it.
   *
   * @param {object} n
   * @param {Array}  n.recipients  user ids (duplicates and the actor are dropped)
   * @param {string} [n.exclude]   usually the actor — they don't need to hear about their own action
   */
  async notify({ recipients, exclude, title, message, module = 'system', kind = 'info', refId, link, email = true }) {
    try {
      const ids = uniqIds(recipients).filter((id) => !exclude || id !== String(exclude));
      if (!ids.length) return;

      await Notification.insertMany(
        ids.map((recipient) => ({ recipient, title, message, module, kind, refId, link })),
        { ordered: false },
      );

      if (email) {
        // Detached: SMTP round-trips must not hold the HTTP response.
        this.emailPeople(ids, { title, message, link }).catch(() => {});
      }
    } catch (err) {
      logger.warn('Notification dispatch failed', { title, error: err.message });
    }
  },

  async emailPeople(ids, { title, message, link }) {
    const people = await User.find({ _id: { $in: ids } }).select('email +isActive');
    const html = renderEmail({ title, message, link });
    await Promise.all(
      people
        .filter((p) => p.isActive !== false && p.email)
        .map((p) => sendMail({ to: p.email, subject: title, html, text: message })),
    );
  },

  async listFor(userId, { limit = 50, unreadOnly = false } = {}) {
    const filter = { recipient: userId };
    if (unreadOnly) filter.isRead = false;
    const [items, unread] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 200)),
      Notification.countDocuments({ recipient: userId, isRead: false }),
    ]);
    return { items, unread };
  },

  async markRead(userId, id) {
    const n = await Notification.findOneAndUpdate({ _id: id, recipient: userId }, { isRead: true }, { new: true });
    if (!n) throw ApiError.notFound('Notification not found');
    return n;
  },

  async markAllRead(userId) {
    await Notification.updateMany({ recipient: userId, isRead: false }, { isRead: true });
  },

  async remove(userId, id) {
    await Notification.deleteOne({ _id: id, recipient: userId });
  },

  async clear(userId) {
    await Notification.deleteMany({ recipient: userId });
  },
};

export default notificationService;
