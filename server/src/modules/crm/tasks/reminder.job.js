import { CrmTask } from './task.model.js';
import { User } from '../../auth/auth.model.js';
import { notificationService } from '../../pms/notifications/notification.service.js';
import { mailService } from '../../../core/services/mail.service.js';
import { config } from '../../../config/index.js';
import { TASK_STATUS, QUIET_AFTER_DAYS, CRM_EVENT, ENTITY_TYPE } from '../crm.constants.js';
import { logger } from '../../../config/logger.js';

export const SWEEP_REMINDERS = 'crm.tasks.sweepReminders';
export const SWEEP_QUIET_RECORDS = 'crm.records.sweepQuiet';

/**
 * The two background sweeps behind §5.
 *
 * Both are Agenda jobs rather than timers, because a deploy in the middle of an
 * hour must not lose whatever was pending — and because a reminder that fails
 * should be retried rather than silently dropped.
 */

/**
 * Is it inside this person's quiet hours right now?
 *
 * Handles the window crossing midnight (22 → 7), which is the normal case and
 * the one a naive `hour >= start && hour < end` gets wrong — that expression is
 * false all night and true all day.
 */
export function inQuietHours(user, at = new Date()) {
  const { quietHoursStart: start, quietHoursEnd: end } = user || {};
  if (start == null || end == null || start === end) return false;
  const hour = at.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** When the window ends, so a held reminder can be re-scheduled rather than
 *  thrown away. */
export function quietHoursEndAt(user, at = new Date()) {
  const end = user?.quietHoursEnd;
  if (end == null) return at;
  const next = new Date(at);
  next.setMinutes(0, 0, 0);
  if (next.getHours() >= end) next.setDate(next.getDate() + 1);
  next.setHours(end);
  return next;
}

/**
 * Announce every task whose reminder has come due.
 *
 * The claim is atomic — `findOneAndUpdate` with `reminderSentAt: null` in the
 * filter — so two workers cannot announce the same task twice.
 */
export async function sweepReminders(now = new Date()) {
  const due = await CrmTask.find({
    remindAt: { $lte: now },
    reminderSentAt: null,
    status: TASK_STATUS.OPEN,
  }).limit(200).lean();

  let sent = 0;
  let held = 0;

  for (const task of due) {
    // eslint-disable-next-line no-await-in-loop
    const owner = await User.findById(task.owner).select('name email quietHoursStart quietHoursEnd').lean();
    if (!owner) continue;

    if (inQuietHours(owner, now)) {
      /* HELD, NOT DROPPED. Pushing `remindAt` to the end of the window means
         the reminder arrives when it can actually be acted on, and the task is
         still announced — a reminder silently discarded because it fell at
         11pm is the same as no reminder at all. */
      // eslint-disable-next-line no-await-in-loop
      await CrmTask.updateOne(
        { _id: task._id },
        { $set: { remindAt: quietHoursEndAt(owner, now) } },
      );
      held += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const claimed = await CrmTask.findOneAndUpdate(
      { _id: task._id, reminderSentAt: null },
      { $set: { reminderSentAt: now } },
    ).lean();
    if (!claimed) continue;

    const when = new Date(task.dueAt).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
    const link = task.entityType && task.entityId
      ? `/crm/${task.entityType === ENTITY_TYPE.DEAL ? 'pipeline' : 'leads'}?open=${task.entityId}`
      : '/crm/today';

    // eslint-disable-next-line no-await-in-loop
    await notificationService.notify({
      recipients: [task.owner],
      type: 'crm_task_due',
      title: `Due ${when}: ${task.title}`,
      message: task.entityLabel ? `${task.type} · ${task.entityLabel}` : task.type,
      link,
    });
    sent += 1;

    if (owner.email) {
      // eslint-disable-next-line no-await-in-loop
      await mailService.send({
        to: owner.email,
        subject: `Due ${when}: ${task.title}`,
        html: `<p>Hi ${owner.name || 'there'},</p>`
          + `<p><strong>${task.title}</strong> is due at ${when}.</p>`
          + (task.entityLabel ? `<p>${task.type} · ${task.entityLabel}</p>` : '')
          + `<p><a href="${config.appUrl}${link}">Open it in the CRM</a></p>`,
      });
    }
  }

  if (sent || held) logger.info(`CRM task reminders: ${sent} sent, ${held} held for quiet hours`);
  return { sent, held, considered: due.length };
}

/**
 * Find records nobody has touched, and make somebody responsible for them.
 *
 * The spec calls the equivalent lead sweep the highest-value automation in the
 * whole CRM, and it is: most stalled records are not lost, they are forgotten,
 * and forgetting is the one failure a computer can reliably catch.
 */
export async function sweepQuietRecords(now = new Date()) {
  const { Lead } = await import('../leads/lead.model.js');
  const { taskService } = await import('./task.service.js');
  const { LEAD_CLOSED_STATUSES } = await import('../crm.constants.js');

  const quietSince = new Date(now.getTime() - QUIET_AFTER_DAYS * 86_400_000);

  const leads = await Lead.find({
    status: { $nin: LEAD_CLOSED_STATUSES },
    assignedTo: { $ne: null },
    // Never touched, or last touched before the cutoff.
    $or: [{ lastActivityAt: null }, { lastActivityAt: { $lt: quietSince } }],
    assignedAt: { $lt: quietSince },
  }).limit(200).lean();

  let made = 0;
  for (const lead of leads) {
    // eslint-disable-next-line no-await-in-loop
    const tasks = await taskService.runRules(CRM_EVENT.RECORD_WENT_QUIET, {
      record: lead,
      entityType: ENTITY_TYPE.LEAD,
    });
    made += tasks.length;
  }

  if (made) logger.info(`CRM quiet sweep: ${made} re-engage task(s) created`);
  return { considered: leads.length, created: made };
}

/** Registered by core/jobs/agenda.js at boot. */
export function defineTaskJobs(agenda) {
  // NOTE THE ARGUMENT ORDER: agenda v6 takes (name, processor, options).
  // Passing options second stores them as the job function, and every run
  // fails with "definition.fn is not a function" — once a minute, forever,
  // in a log nobody is watching.
  agenda.define(SWEEP_REMINDERS, () => sweepReminders(), { concurrency: 1 });
  agenda.define(SWEEP_QUIET_RECORDS, () => sweepQuietRecords(), { concurrency: 1 });
}

/** Scheduled once, after the definitions exist. */
export async function scheduleTaskJobs(agenda) {
  await agenda.every('1 minute', SWEEP_REMINDERS);
  // Hourly, not minutely: a record that has been quiet for three days is not
  // more urgent sixty seconds later, and the query touches every open lead.
  await agenda.every('1 hour', SWEEP_QUIET_RECORDS);
}
