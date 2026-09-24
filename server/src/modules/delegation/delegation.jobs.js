import { Delegation } from './delegation.model.js';
import { DelegationReminder } from './records.model.js';
import { DelegationRecurrence } from './recurrence.model.js';
import { firesOn } from './recurrence.engine.js';
import { writeReminders, DEFAULT_REMINDERS } from './delegation.service.js';
import { notificationService } from '../org/notifications/notification.service.js';
import { workLogService } from '../org/worklog/worklog.service.js';
import { nextCode } from '../org/counters/counter.model.js';
import { User } from '../auth/auth.model.js';
import { logger } from '../../config/logger.js';
import { tz, dateKey, startOfDay, endOfDay, fmtDay, daysBetween } from '../../core/utils/opsTime.js';
import { DELEGATION_STATUS as S, DELEGATION_OPEN_STATUSES, ESCALATION_TIERS } from '../../core/constants/ops.js';

const link = (id) => `/delegation/tasks/${id}`;
const bulletList = (tasks, fmt) => tasks.slice(0, 15).map(fmt).join('\n') + (tasks.length > 15 ? `\n…and ${tasks.length - 15} more` : '');

export const delegationJobs = {
  /**
   * 23:50 — create tomorrow's instance of every repeat rule that fires then.
   * `lastGeneratedFor` makes the run idempotent: running twice (or on two
   * servers) can never create the same day twice.
   */
  async generateRecurring(forKey = tz().add(1, 'day').format('YYYY-MM-DD')) {
    const rules = await DelegationRecurrence.find({ isActive: true });
    let created = 0;
    for (const rule of rules) {
      try {
        if (rule.endDate && rule.endDate < forKey) {
          rule.isActive = false;
          await rule.save();
          continue;
        }
        if (!firesOn(rule, forKey)) continue;

        // Claim the day atomically before creating anything.
        const claimed = await DelegationRecurrence.findOneAndUpdate(
          { _id: rule._id, $or: [{ lastGeneratedFor: null }, { lastGeneratedFor: { $lt: forKey } }] },
          { lastGeneratedFor: forKey },
        );
        if (!claimed) continue;

        const b = rule.blueprint;
        const code = await nextCode('delegation', 'DLG');
        const task = await Delegation.create({
          code,
          title: b.title,
          description: b.description,
          assigner: b.assigner,
          doer: b.doer,
          inLoop: b.inLoop,
          branch: b.branch,
          group: b.group,
          recurrence: rule._id,
          category: b.category,
          tags: b.tags,
          priority: b.priority,
          status: S.PENDING,
          dueDate: endOfDay(forKey),
          checklistItems: (b.checklistItems || []).map((c) => ({ text: c.text })),
          evidenceRequired: b.evidenceRequired,
          verificationRequired: b.verificationRequired,
          voiceNoteUrl: b.voiceNoteUrl,
          referenceDocs: b.referenceDocs,
          createdBy: b.assigner,
        });
        await writeReminders(task._id, task.dueDate, b.reminders?.length ? b.reminders : DEFAULT_REMINDERS);

        notificationService.notify({
          recipients: [b.doer],
          title: 'Recurring task for tomorrow',
          message: `"${b.title}" (${code}) is due ${fmtDay(task.dueDate)} — repeats ${rule.frequency}.`,
          module: 'delegation',
          kind: 'assigned',
          refId: task._id,
          link: link(task._id),
        });
        workLogService.log({
          module: 'delegation',
          type: 'created',
          title: b.title,
          description: `Recurring instance ${code} generated for ${forKey}`,
          actor: b.assigner,
          refType: 'delegation',
          refId: task._id,
          branch: b.branch,
        });
        created += 1;
      } catch (err) {
        logger.error('Recurring delegation generation failed', { rule: String(rule._id), error: err.message });
      }
    }
    if (created) logger.info(`[jobs] ${created} recurring delegation(s) generated for ${forKey}`);
    return created;
  },

  /**
   * Every minute — fire due reminders. At most one reminder per task per day
   * reaches the doer; any further same-day rows are marked sent silently so
   * several before/after configs never stack into spam.
   */
  async dispatchReminders() {
    const now = new Date();
    const due = await DelegationReminder.find({ sentAt: null, fireAt: { $lte: now } }).limit(500).lean();
    if (!due.length) return 0;

    const tasks = await Delegation.find({ _id: { $in: due.map((r) => r.delegation) } })
      .select('title code doer assigner status dueDate deletedAt')
      .lean();
    const byId = new Map(tasks.map((t) => [String(t._id), t]));
    const todayStart = startOfDay(dateKey(now));
    const sentToday = new Set(
      (await DelegationReminder.find({ delegation: { $in: tasks.map((t) => t._id) }, sentAt: { $gte: todayStart } }).select('delegation').lean())
        .map((r) => String(r.delegation)),
    );

    let sent = 0;
    for (const r of due) {
      const t = byId.get(String(r.delegation));
      const closed = !t || t.deletedAt || !DELEGATION_OPEN_STATUSES.includes(t.status);
      const skip = closed || sentToday.has(String(r.delegation));
      // eslint-disable-next-line no-await-in-loop
      await DelegationReminder.updateOne({ _id: r._id }, { sentAt: now });
      if (skip) continue;
      sentToday.add(String(r.delegation));

      const overdue = t.dueDate && t.dueDate < now;
      notificationService.notify({
        recipients: [t.doer],
        title: overdue ? `Overdue: ${t.title}` : `Reminder: ${t.title}`,
        message: overdue
          ? `"${t.title}" (${t.code}) was due ${fmtDay(t.dueDate)} and is still open.`
          : `"${t.title}" (${t.code}) is due ${fmtDay(t.dueDate)}.`,
        module: 'delegation',
        kind: 'reminder',
        refId: t._id,
        link: link(t._id),
        email: r.channel === 'email',
      });
      sent += 1;
    }
    return sent;
  },

  /**
   * 09:00 — one digest per person: the doer hears about every overdue task
   * they own, the assigner about overdue tasks they handed out.
   */
  async overdueDigest() {
    const now = new Date();
    const overdue = await Delegation.find({
      deletedAt: null,
      parent: null,
      status: { $in: DELEGATION_OPEN_STATUSES },
      dueDate: { $lt: now },
    })
      .select('title code doer assigner dueDate')
      .populate('doer', 'name')
      .lean();
    if (!overdue.length) return 0;

    const group = (key) => {
      const m = new Map();
      for (const t of overdue) {
        const k = String(t[key]?._id || t[key]);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(t);
      }
      return m;
    };

    for (const [doerId, list] of group('doer')) {
      notificationService.notify({
        recipients: [doerId],
        title: `${list.length} overdue task${list.length > 1 ? 's' : ''} need your attention`,
        message: bulletList(list, (t) => `• ${t.title} (${t.code}) — ${daysBetween(t.dueDate, now)}d late`),
        module: 'delegation',
        kind: 'reminder',
        link: '/delegation/my-work',
      });
    }
    for (const [assignerId, list] of group('assigner')) {
      const others = list.filter((t) => String(t.doer?._id || t.doer) !== assignerId);
      if (!others.length) continue;
      notificationService.notify({
        recipients: [assignerId],
        title: `${others.length} task${others.length > 1 ? 's' : ''} you delegated ${others.length > 1 ? 'are' : 'is'} overdue`,
        message: bulletList(others, (t) => `• ${t.title} (${t.code}) — ${t.doer?.name || 'doer'}, ${daysBetween(t.dueDate, now)}d late`),
        module: 'delegation',
        kind: 'reminder',
        link: '/delegation/delegated',
      });
    }
    return overdue.length;
  },

  /**
   * 09:30 — escalation matrix, once per tier per deadline:
   *   tier 1 (3+ days late)  the doer's reporting manager
   *   tier 2 (7+ days late)  every director, plus the reporting manager
   *   tier 3 (15+ days late) no message — the task carries a review-meeting badge
   * Revising the deadline resets the tier, so every new date gets a fresh cycle.
   */
  async runEscalations() {
    const now = new Date();
    const tasks = await Delegation.find({
      deletedAt: null,
      status: { $in: DELEGATION_OPEN_STATUSES },
      dueDate: { $lt: now },
    })
      .populate('doer', 'name department reportingManager')
      .populate('assigner', 'name');
    if (!tasks.length) return 0;

    const directors = await User.find({ 'opsFlags.director': true }).select('_id +isActive').lean();
    const directorIds = directors.filter((d) => d.isActive !== false).map((d) => String(d._id));

    let escalated = 0;
    for (const task of tasks) {
      const late = daysBetween(task.dueDate, now);
      let target = 0;
      if (late >= ESCALATION_TIERS.REVIEW_MEETING.days) target = 3;
      else if (late >= ESCALATION_TIERS.DIRECTOR.days) target = 2;
      else if (late >= ESCALATION_TIERS.REPORTING_MANAGER.days) target = 1;
      if (target <= (task.escalationTier || 0)) continue;

      const manager = task.doer?.reportingManager ? String(task.doer.reportingManager) : null;
      const recipients = new Set();
      // Fire every tier crossed since the last run, so a task first seen 9 days late still hits tiers 1 and 2.
      for (let tier = (task.escalationTier || 0) + 1; tier <= target; tier += 1) {
        if (tier === 1 && manager) recipients.add(manager);
        if (tier === 2) {
          directorIds.forEach((id) => recipients.add(id));
          if (manager) recipients.add(manager);
        }
      }
      if (recipients.size) {
        notificationService.notify({
          recipients: [...recipients],
          title: `Escalation: task ${late} days overdue`,
          message: `"${task.title}" (${task.code}) assigned to ${task.doer?.name || 'a team member'}${task.doer?.department ? ` (${task.doer.department})` : ''} by ${task.assigner?.name || 'someone'} was due ${fmtDay(task.dueDate)} and is ${late} days late. Please intervene.`,
          module: 'delegation',
          kind: 'escalation',
          refId: task._id,
          link: link(task._id),
        });
      }
      task.escalationTier = target;
      task.escalatedAt = now;
      // eslint-disable-next-line no-await-in-loop
      await task.save();
      escalated += 1;
    }
    if (escalated) logger.info(`[jobs] ${escalated} delegation escalation(s) raised`);
    return escalated;
  },

  /** 10:00 — nudge assigners sitting on submitted work. */
  async approvalChase() {
    const waiting = await Delegation.find({ deletedAt: null, status: S.AWAITING_VERIFICATION })
      .select('title code assigner doer completedAt')
      .populate('doer', 'name')
      .lean();
    const byAssigner = new Map();
    for (const t of waiting) {
      const k = String(t.assigner);
      if (!byAssigner.has(k)) byAssigner.set(k, []);
      byAssigner.get(k).push(t);
    }
    const now = new Date();
    for (const [assignerId, list] of byAssigner) {
      const stale = list.filter((t) => t.completedAt && daysBetween(t.completedAt, now) >= 3).length;
      notificationService.notify({
        recipients: [assignerId],
        title: `${list.length} task${list.length > 1 ? 's' : ''} waiting for your approval`,
        message:
          (stale ? `${stale} have waited 3+ days.\n` : '')
          + bulletList(list, (t) => `• ${t.title} (${t.code}) — from ${t.doer?.name || 'doer'}`),
        module: 'delegation',
        kind: 'approval',
        link: '/delegation/delegated?status=awaiting_verification',
      });
    }
    return waiting.length;
  },
};

export default delegationJobs;
