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

/**
 * REAL TIME, WITHOUT A SOCKET.
 *
 * The bell polled every thirty seconds, so "Feasibility is yours" could sit
 * unseen for half a minute after the MD pressed the button. This holds a
 * request open until something actually lands for that person, which is the
 * same screen-pop pattern the CRM telephony route already uses, and for the
 * same reason: the access token lives in localStorage, `EventSource` cannot
 * send an Authorization header, and putting a token in a query string writes
 * it into every access log. Long polling needs no new auth path, no protocol
 * upgrade, and nothing special from a proxy — which is what makes it behave
 * the same on a laptop and behind whatever sits in front of production.
 *
 * TWO WAYS TO WAKE, because one of them is not enough:
 *
 *   the emitter   instant, and only works for a waiter held on THIS node.
 *   a short re-read  1.5s, and works no matter which node wrote the row.
 *
 * With more than one instance behind a load balancer the writer and the
 * waiter are routinely different processes, so an in-process bus alone would
 * be silently wrong in exactly the deployment where it matters. The re-read
 * is the floor; the emitter makes the common case immediate.
 */
const waiters = new Map(); // userId -> Set<() => void>

function wake(recipients) {
  for (const r of recipients || []) {
    const set = waiters.get(String(r));
    if (!set) continue;
    for (const fn of set) { try { fn(); } catch { /* a dead waiter */ } }
  }
}

/** Resolve as soon as this user has a notification newer than `since`. */
async function waitForNotification(userId, since, waitMs) {
  const id = String(userId);
  const after = since ? new Date(since) : new Date(0);
  const deadline = Date.now() + waitMs;

  const newest = async () => Notification.findOne({ recipient: userId, createdAt: { $gt: after } })
    .sort({ createdAt: -1 }).lean();

  /* Check once before waiting at all: something may have landed between the
     client reading its last batch and re-opening the poll, and sleeping on
     that is how a notification arrives 25 seconds late. */
  const first = await newest();
  if (first) return first;

  let nudge = null;
  const ping = () => { if (nudge) nudge(); };
  if (!waiters.has(id)) waiters.set(id, new Set());
  waiters.get(id).add(ping);

  try {
    while (Date.now() < deadline) {
      /* Woken by the emitter, by the 1.5s floor, or by the deadline —
         whichever comes first. */
      const slice = Math.min(1500, deadline - Date.now());
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        const t = setTimeout(resolve, slice);
        nudge = () => { clearTimeout(t); resolve(); };
      });
      nudge = null;
      // eslint-disable-next-line no-await-in-loop
      const hit = await newest();
      if (hit) return hit;
    }
    return null;
  } finally {
    const set = waiters.get(id);
    if (set) { set.delete(ping); if (!set.size) waiters.delete(id); }
  }
}
export const notificationService = {
  waitForNotification,
  /** Fan out one Notification doc per recipient. Fire-and-forget — never
   * blocks or breaks the caller's main flow (same resilience contract as
   * activityService.log). */
  async notify({
    recipients, project, type, title, message, link, whatsapp,
    /* The template fields — see the notification model. Optional, so every
       existing caller keeps working and simply renders without them. */
    module: mod, entity, actorName, due,
  }) {
    if (!recipients?.length) return;
    try {
      await Notification.insertMany(
        recipients.map((recipient) => ({
          recipient, project, type, title, message, link, module: mod, entity, actorName, due,
        })),
      );
      /* WAKE ANYONE HOLDING A LONG POLL. Same instant the row lands, not up
         to thirty seconds later — see waitForNotification below. */
      wake(recipients);
    } catch (err) {
      logger.warn('Failed to write notification', { error: err.message });
    }

    /* SECOND CHANNEL. In-app is the primary one and is never conditional on
       WhatsApp working — this runs after the rows above are safely written,
       and swallows everything.

       It lives HERE rather than at each call site so the rules that decide
       whether a message may go out (quiet hours, the daily cap, opt-out,
       duplicates) exist once. A caller opts in by passing `whatsapp`, or
       simply by using a `type` the dispatcher already maps — see
       whatsappDispatch.TYPE_TO_EVENT. Passing `whatsapp: { task }` is what
       lets a template say more than the notification text does: the phase,
       the property, the due date. */
      // [WHATSAPP OFF] notifications still go out in-app; only the WhatsApp
      // leg is skipped. This was already inside a try/catch that logged and
      // continued, so no caller behaves differently.
    // try {
      // const { whatsappDispatch } = await import('../whatsapp/whatsappDispatch.service.js');
      // await whatsappDispatch.fanOut({
        // type,
        // eventKey: whatsapp?.eventKey,
        // recipients,
        // project,
        // link,
        // task: whatsapp?.task,
        // actorId: whatsapp?.actorId,
        // alertText: whatsapp?.alertText || message,
      // });
    // } catch (err) {
      // logger.warn('WhatsApp channel skipped', { error: err.message, type });
    // }
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
