import { logger } from '../../../config/logger.js';
import { withoutTenant, withRecordTenant } from '../../../core/tenancy/tenantContext.js';
import { whatsappService as provider } from '../../../core/services/whatsapp.service.js';
import { Task } from '../tasks/task.model.js';
import { whatsappDispatch } from './whatsappDispatch.service.js';
import { WhatsappLog, WhatsappSetting, WhatsappEventMap, WHATSAPP_EVENTS } from './whatsapp.model.js';

/**
 * The WhatsApp channel's background work.
 *
 *   whatsapp:send            one queued message → the provider
 *   whatsapp:sweepReminders  daily: tasks coming due
 *   whatsapp:sweepOverdue    daily: tasks past due, escalating
 *   whatsapp:refreshStatus   every few minutes: did the messages arrive?
 *
 * WHY SENDING IS A JOB. A provider having a bad minute must never become a
 * slow save for the person who assigned the task. The queue also gives
 * retries for free, and survives a restart mid-fan-out.
 *
 * WHY STATUS NEEDS A SWEEP AT ALL. The provider answers a send with
 * `status: "sent"` before WhatsApp has decided anything. A message rejected
 * for the 24-hour rule stays "sent" here until somebody asks again — so the
 * only way to know what actually happened is to go back and look.
 */

export const SEND = 'whatsapp:send';
export const SWEEP_REMINDERS = 'whatsapp:sweepReminders';
export const SWEEP_OVERDUE = 'whatsapp:sweepOverdue';
export const REFRESH_STATUS = 'whatsapp:refreshStatus';

const DAY = 24 * 60 * 60 * 1000;
const days = (ms) => Math.floor(ms / DAY);

/** Tasks that are finished are not chased. */
const OPEN_STATUSES = { $nin: ['completed', 'approved', 'cancelled', 'archived'] };

/* ------------------------------------------------------------------ */
/* One message                                                         */
/* ------------------------------------------------------------------ */

export async function sendQueued(logId) {
  const log = await WhatsappLog.findById(logId);
  if (!log) return { sent: false, reason: 'log row gone' };
  if (log.status !== 'queued') return { sent: false, reason: `already ${log.status}` };

  return withRecordTenant(log, () => deliver(log));
}

async function deliver(log) {
  const result = await provider.sendTemplate({
    phone: log.phone,
    templateName: log.templateName,
    languageCode: log.language,
    params: log.params,
  });

  if (result.sent) {
    log.status = 'sent';
    log.messageId = result.messageId;
    log.chatMessageId = result.chatMessageId;
    log.chatId = result.chatId;
    log.redirected = Boolean(result.redirected);
    log.sentAt = new Date();
  } else {
    // `skipped` means a rule stopped it (no token, unusable number); `failed`
    // means the provider refused. Kept apart so a settings problem does not
    // read as a delivery problem in the log table.
    log.status = result.skipped ? 'skipped' : 'failed';
    log.statusMessage = result.skipped || result.error?.message;
    log.error = result.error;
    log.retryCount += 1;
  }
  await log.save();
  return { sent: Boolean(result.sent), status: log.status };
}

/* ------------------------------------------------------------------ */
/* Sweeps                                                              */
/* ------------------------------------------------------------------ */

/** The mapping decides whether a sweep runs at all, and with what lead time. */
async function activeMap(eventKey) {
  const settings = await WhatsappSetting.findOne();
  if (!settings?.isEnabled || !provider.enabled) return null;
  const map = await WhatsappEventMap.findOne({ eventKey, isEnabled: true });
  return map ? { map, settings } : null;
}

/** Recipients of a task: its doers. */
const doersOf = (task) => [...new Set([
  ...(task.assigneeRefs || []).map(String),
  ...(task.assignee ? [String(task.assignee)] : []),
])];

/**
 * Tasks due within the mapping's lead time.
 *
 * Deliberately a window and not "exactly N days out": a sweep that missed a
 * run — a deploy, a restart — would otherwise skip that day's reminders
 * silently and nobody would ever know which ones were lost.
 */
export async function sweepReminders() {
  const active = await activeMap(WHATSAPP_EVENTS.TASK_REMINDER);
  if (!active) return { checked: 0, queued: 0 };

  const lead = active.map.leadTimeDays ?? 1;
  const now = new Date();
  const until = new Date(now.getTime() + lead * DAY);

  const tasks = await Task.find({
    status: OPEN_STATUSES,
    plannedEnd: { $gte: now, $lte: until },
  }).select('title code project stageName plannedEnd status assignee assigneeRefs').limit(500);

  let queued = 0;
  for (const task of tasks) {
    const left = Math.max(0, days(new Date(task.plannedEnd) - now));
    const alertText = left === 0 ? 'due today' : `${left} day${left === 1 ? '' : 's'}`;
    // Back INSIDE the task's own company for the work itself. The sweep spans
    // companies; the log row it writes belongs to exactly one, and a row
    // written with no tenant is invisible to the Logs tab that is supposed to
    // prove the message went out.
    const res = await withRecordTenant(task, () => whatsappDispatch.fanOut({
      eventKey: WHATSAPP_EVENTS.TASK_REMINDER,
      recipients: doersOf(task),
      task,
      alertText,
      project: task.project,
    }));
    queued += res.queued;
  }

  if (tasks.length) logger.info(`WhatsApp reminder sweep: ${tasks.length} due tasks, ${queued} queued`);
  return { checked: tasks.length, queued };
}

/**
 * Tasks past their date.
 *
 * Escalation is a recipient change, not a second template: past
 * `escalateAfterDays` the same message also goes to the manager. Chasing the
 * doer forever is what gets a business number blocked, and the person who can
 * actually unblock the work is their manager.
 */
export async function sweepOverdue() {
  const active = await activeMap(WHATSAPP_EVENTS.TASK_OVERDUE);
  if (!active) return { checked: 0, queued: 0 };

  const now = new Date();
  const tasks = await Task.find({
    status: OPEN_STATUSES,
    plannedEnd: { $lt: now },
  }).select('title code project stageName plannedEnd status assignee assigneeRefs').limit(500);

  let queued = 0;
  let escalated = 0;
  for (const task of tasks) {
    const late = Math.max(1, days(now - new Date(task.plannedEnd)));
    const alertText = `${late} day${late === 1 ? '' : 's'}`;

    // See sweepReminders: the sweep is deployment-wide, each message is not.
    const res = await withRecordTenant(task, () => whatsappDispatch.fanOut({
      eventKey: WHATSAPP_EVENTS.TASK_OVERDUE,
      recipients: doersOf(task),
      task,
      alertText,
      project: task.project,
    }));
    queued += res.queued;

    if (late >= (active.settings.escalateAfterDays ?? 3)) {
      const up = await withRecordTenant(task, () => whatsappDispatch.fanOut({
        eventKey: WHATSAPP_EVENTS.TASK_OVERDUE,
        recipients: [],           // resolved by the mapping's recipientRule
        task,
        alertText,
        project: task.project,
      }));
      queued += up.queued;
      escalated += up.queued;
    }
  }

  if (tasks.length) {
    logger.info(`WhatsApp overdue sweep: ${tasks.length} overdue tasks, ${queued} queued (${escalated} escalations)`);
  }
  return { checked: tasks.length, queued, escalated };
}

/**
 * Ask the provider what became of everything still in flight.
 *
 * Only messages under 24 hours old: WhatsApp stops changing a status after
 * that, so an older row is as final as it will ever be and re-reading it is
 * an API call spent on nothing.
 */
export async function refreshStatuses(limit = 50) {
  if (!provider.configured) return { checked: 0, updated: 0 };

  const rows = await WhatsappLog.find({
    status: 'sent',
    chatMessageId: { $ne: null },
    createdAt: { $gte: new Date(Date.now() - DAY) },
  }).sort({ createdAt: -1 }).limit(limit);

  let updated = 0;
  for (const log of rows) {
    const result = await provider.getMessageStatus(log.chatMessageId);
    if (!result.ok || !result.status || result.status === log.status) continue;

    log.status = result.status;
    log.statusMessage = result.statusMessage || null;
    if (result.status === 'delivered' || result.status === 'read') log.deliveredAt = new Date();
    await log.save();
    updated += 1;
  }

  if (updated) logger.info(`WhatsApp status sweep: ${updated} of ${rows.length} messages changed state`);
  return { checked: rows.length, updated };
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function defineWhatsappJobs(agenda) {
  // NOTE THE ARGUMENT ORDER: agenda v6 takes (name, processor, options).
  // Options passed second are stored as the job function and every run fails
  // with "definition.fn is not a function".
  agenda.define(
    SEND,
    // Unscoped only long enough to FIND the row; the work itself then runs as
    // that row's company — see sendQueued.
    (job) => withoutTenant('a queued WhatsApp message is located by id, then scoped to its own company',
      () => sendQueued(job.attrs.data.logId)),
    { concurrency: 3 },
  );
  agenda.define(
    SWEEP_REMINDERS,
    () => withoutTenant('the WhatsApp reminder sweep runs for every company', () => sweepReminders()),
    { concurrency: 1 },
  );
  agenda.define(
    SWEEP_OVERDUE,
    () => withoutTenant('the WhatsApp overdue sweep runs for every company', () => sweepOverdue()),
    { concurrency: 1 },
  );
  agenda.define(
    REFRESH_STATUS,
    () => withoutTenant('the WhatsApp status sweep runs for every company', () => refreshStatuses()),
    { concurrency: 1 },
  );
}

/** Scheduled once, after the definitions exist. */
export async function scheduleWhatsappJobs(agenda) {
  // Morning, not midnight: a reminder is read when the working day starts,
  // and quiet hours would hold a midnight one until then anyway.
  await agenda.every('0 9 * * *', SWEEP_REMINDERS, {}, { timezone: 'Asia/Kolkata' });
  await agenda.every('0 10 * * *', SWEEP_OVERDUE, {}, { timezone: 'Asia/Kolkata' });
  // Often enough that the Logs tab is honest within a coffee break, rare
  // enough that it is not a poll loop against someone else's API.
  await agenda.every('10 minutes', REFRESH_STATUS);
}

export default { defineWhatsappJobs, scheduleWhatsappJobs };
