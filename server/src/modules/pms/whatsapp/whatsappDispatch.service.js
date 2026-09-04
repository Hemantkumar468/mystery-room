import { whatsappService as provider } from '../../../core/services/whatsapp.service.js';
import { logger } from '../../../config/logger.js';
import { User } from '../../auth/auth.model.js';
import { ROLES } from '../../../core/constants/index.js';
import {
  WhatsappTemplate, WhatsappEventMap, WhatsappLog, WhatsappSetting, WHATSAPP_EVENTS,
} from './whatsapp.model.js';

/**
 * Deciding whether a WhatsApp message should go out, and with what in it.
 *
 * WHY THIS IS A CHANNEL AND NOT A CALL SITE. Every place that already tells
 * somebody something — a task assigned, an approval waiting — calls
 * notificationService.notify(). Adding `whatsappService.send(...)` next to
 * each of them would mean the rules (quiet hours, the daily cap, opt-out,
 * duplicates) live in a dozen places and drift apart. So notify() fans out to
 * this dispatcher instead, and a new event is a row in the event map rather
 * than a code change.
 *
 * BEST EFFORT, ALWAYS. Nothing here may throw into the caller: an in-app
 * notification that arrives is worth more than one that fails because a
 * messaging provider was slow. Same contract as activityService.log.
 */

/** In-app notification type → the WhatsApp event it corresponds to. */
const TYPE_TO_EVENT = {
  task_assigned: WHATSAPP_EVENTS.TASK_ASSIGNED,
};

const DATE = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

/** Cached per call, not per message: one settings read for a fan-out of twenty. */
async function loadSettings() {
  return (await WhatsappSetting.findOne()) || null;
}

/**
 * Quiet hours as a window that can wrap midnight (21 → 8).
 * Returns the Date to run at, or null for "send now".
 */
function quietHoldUntil(settings, now = new Date()) {
  const { quietHoursStart: start, quietHoursEnd: end } = settings;
  if (start === end) return null; // no window configured

  const hour = now.getHours();
  const inWindow = start < end ? hour >= start && hour < end : hour >= start || hour < end;
  if (!inWindow) return null;

  const at = new Date(now);
  at.setMinutes(0, 0, 0);
  at.setHours(end);
  // Past the end hour already means the window wrapped midnight — the next
  // end is tomorrow morning, not this morning.
  if (at <= now) at.setDate(at.getDate() + 1);
  return at;
}

/** Midnight today, for the per-day counters. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Fills the template's {{n}} from the event's own data.
 *
 * Anything a binding asks for and the event does not carry becomes an empty
 * string rather than "undefined" — a message reading "Hi undefined" reaches a
 * real phone and cannot be recalled.
 */
function buildParams(paramMapping, { recipient, task, link, alertText, baseUrl }) {
  const url = task?.code && task?.project
    ? `${(baseUrl || '').replace(/\/+$/, '')}/projects/${task.project}/tasks/${encodeURIComponent(task.code)}`
    : `${(baseUrl || '').replace(/\/+$/, '')}${link || ''}`;

  const values = {
    'recipient.name': recipient?.name || '',
    'task.title': task?.title || '',
    'task.phase': task?.stageName || '',
    'task.property': task?.propertyName || '',
    'task.project': task?.projectName || '',
    'task.dueDate': DATE(task?.plannedEnd),
    'task.status': task?.status || '',
    'task.url': baseUrl ? url : '',
    'task.completedBy': task?.completedByName || '',
    'task.completedOn': DATE(task?.completedAt),
    'alert.text': alertText || '',
  };

  return [...paramMapping]
    .sort((a, b) => a.position - b.position)
    .map((b) => (b.source === 'custom' ? (b.value || '') : (values[b.source] ?? '')));
}

/** Who this event's message is addressed to, by the mapping's rule. */
async function resolveRecipients(rule, { recipients = [], actorId, task }) {
  if (rule === 'assignee') return recipients;
  if (rule === 'actor') return actorId ? [actorId] : [];

  const role = rule === 'md' ? ROLES.MD : ROLES.MANAGER;
  const users = await User.find({ role, isActive: true }).select('_id');
  // A manager rule with nobody in that role is a misconfiguration, not an
  // error: fall back to the doer so the message still reaches somebody.
  return users.length ? users.map((u) => String(u._id)) : recipients;
}

export const whatsappDispatch = {
  TYPE_TO_EVENT,

  /**
   * The entry point notify() calls. Resolves the audience, applies every
   * rule, and queues one job per recipient.
   *
   * @returns {Promise<{queued: number, skipped: string[]}>} — for tests and
   *   the caller's log line; nothing depends on it.
   */
  async fanOut({ eventKey, type, recipients = [], actorId, task, link, alertText, project }) {
    const skipped = [];
    try {
      const key = eventKey || TYPE_TO_EVENT[type];
      if (!key) return { queued: 0, skipped: ['no matching event'] };

      // Cheapest checks first: two database reads should not happen for a
      // deployment that has never switched WhatsApp on.
      if (!provider.enabled) return { queued: 0, skipped: ['provider disabled'] };

      const settings = await loadSettings();
      if (!settings?.isEnabled) return { queued: 0, skipped: ['switched off in settings'] };

      const map = await WhatsappEventMap.findOne({ eventKey: key });
      if (!map?.isEnabled) return { queued: 0, skipped: [`${key} not enabled`] };

      // Re-checked at send time, not just when the mapping was saved: a
      // template can be paused or removed upstream long afterwards.
      const template = await WhatsappTemplate.findOne({ name: map.templateName, language: map.language });
      if (!template || template.status !== 'APPROVED' || template.category === 'MARKETING') {
        logger.warn('WhatsApp event skipped: template is no longer usable', {
          eventKey: key, template: map.templateName, status: template?.status, category: template?.category,
        });
        return { queued: 0, skipped: ['template not usable'] };
      }

      const audience = await resolveRecipients(map.recipientRule, { recipients, actorId, task });
      if (!audience.length) return { queued: 0, skipped: ['no recipients'] };

      const holdUntil = quietHoldUntil(settings);
      const { getAgenda } = await import('../../../core/jobs/agenda.js');
      const agenda = getAgenda();
      let queued = 0;

      for (const userId of audience) {
        const user = await User.findById(userId).select('name phone whatsappOptOut');
        if (!user) { skipped.push('user missing'); continue; }
        if (user.whatsappOptOut) { skipped.push(`${user.name}: opted out`); continue; }

        const phone = provider.normalizePhone(user.phone);
        if (!phone) { skipped.push(`${user.name}: no usable phone`); continue; }

        // One message per person per task per event per day. A sweep that runs
        // twice, or a task saved twice in a minute, must not message anybody
        // twice — that is how people mute a business number.
        if (task?._id) {
          const already = await WhatsappLog.findOne({
            recipient: userId, eventKey: key, task: task._id, createdAt: { $gte: startOfToday() },
            status: { $ne: 'failed' },
          });
          if (already) { skipped.push(`${user.name}: already sent today`); continue; }
        }

        const sentToday = await WhatsappLog.countDocuments({
          recipient: userId, createdAt: { $gte: startOfToday() }, status: { $in: ['queued', 'sent', 'delivered', 'read'] },
        });
        if (sentToday >= settings.maxMessagesPerUserPerDay) {
          skipped.push(`${user.name}: daily cap reached`);
          continue;
        }

        const params = buildParams(map.paramMapping, {
          recipient: user, task, link, alertText, baseUrl: settings.taskLinkBaseUrl,
        });

        const log = await WhatsappLog.create({
          eventKey: key,
          templateName: map.templateName,
          language: map.language,
          recipient: userId,
          phone,
          params,
          task: task?._id,
          project: project || task?.project,
          status: 'queued',
        });

        // Held, not dropped: a task assigned at 23:00 is still assigned in the
        // morning, and a notification nobody ever receives is worse than a
        // late one.
        const job = agenda.create('whatsapp:send', { logId: String(log._id) });
        if (holdUntil) job.schedule(holdUntil);
        await job.save();
        queued += 1;
      }

      if (skipped.length) {
        logger.info(`WhatsApp ${key}: ${queued} queued, ${skipped.length} skipped`, { skipped });
      }
      return { queued, skipped };
    } catch (err) {
      // Never propagates: the in-app notification has already been written and
      // must not be undone by a messaging failure.
      logger.warn('WhatsApp fan-out failed', { error: err.message, eventKey, type });
      return { queued: 0, skipped: ['error'] };
    }
  },

  /** Used by the jobs, which already know their audience and their event. */
  buildParams,
  quietHoldUntil,
};

export default whatsappDispatch;
