import { Delegation } from './delegation.model.js';
import { DelegationRemark, DelegationRevision, DelegationFollowup, DelegationReminder } from './records.model.js';
import { assertCanView, involvedIds, assertNotViewer } from './delegation.policy.js';
import { writeReminders, notifyInvolved, audit, parseDue, delegationService } from './delegation.service.js';
import { notificationService } from '../org/notifications/notification.service.js';
import { nextCode } from '../org/counters/counter.model.js';
import { User } from '../auth/auth.model.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { isSameWeek, appendRemarkLine, fmtDay } from '../../core/utils/opsTime.js';
import {
  DELEGATION_STATUS as S,
  MAX_SAME_WEEK_REVISIONS,
  REMARK_CHANNELS,
} from '../../core/constants/ops.js';

/**
 * The delegation workflow:
 *
 *   pending ─accept→ accepted ─start→ in_progress ─complete→ completed
 *                                                  └submit→ awaiting_verification ─approve→ completed
 *                                                                                   └send back→ pending
 *   pending/accepted ─mark dependent→ dependent ─resume→ accepted
 *   pending/accepted/in_progress ─blocked by→ blocked ─resume→ accepted
 *   completed ─reopen→ in_progress
 *   any open ─deadline moved to another week→ shifted (+ a fresh pending copy)
 */

const STATUS_LABEL = {
  [S.PENDING]: 'Pending',
  [S.ACCEPTED]: 'Accepted',
  [S.IN_PROGRESS]: 'In Progress',
  [S.DEPENDENT]: 'Dependent on Others',
  [S.BLOCKED]: 'Blocked',
  [S.AWAITING_VERIFICATION]: 'Awaiting Verification',
  [S.COMPLETED]: 'Completed',
  [S.SHIFTED]: 'Shifted',
};

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

async function load(id, user) {
  assertNotViewer(user);
  const task = await Delegation.findById(id);
  if (!task || task.deletedAt) throw ApiError.notFound('Task not found');
  const rel = await assertCanView(task, user);
  return { task, rel };
}

const revision = (task, user, { newStatus, newDueDate, reason }) =>
  DelegationRevision.create({
    delegation: task._id,
    oldDueDate: task.dueDate,
    newDueDate: newDueDate ?? task.dueDate,
    oldStatus: task.status,
    newStatus: newStatus ?? task.status,
    reason,
    changedBy: user.id,
  });

const systemRemark = (task, user, body) =>
  DelegationRemark.create({ delegation: task._id, author: user.id, body, kind: 'system' });

const resetEscalation = (task) => {
  task.escalationTier = 0;
  task.escalatedAt = undefined;
};

export const lifecycle = {
  /**
   * Doer moves the work forward: accept, start, or resume after a
   * dependency/blocker clears.
   */
  async setStatus(id, { status, remark }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isDoer && !rel.isAdmin) throw ApiError.forbidden('Only the doer can update the progress of this task');

    const from = task.status;
    const allowed = {
      [S.ACCEPTED]: [S.PENDING, S.DEPENDENT, S.BLOCKED],
      [S.IN_PROGRESS]: [S.PENDING, S.ACCEPTED, S.DEPENDENT, S.BLOCKED],
    };
    if (!allowed[status]?.includes(from)) {
      throw ApiError.conflict(`A task that is ${STATUS_LABEL[from]} can't move to ${STATUS_LABEL[status]}`);
    }
    const resumed = [S.DEPENDENT, S.BLOCKED].includes(from);

    await revision(task, user, { newStatus: status, reason: remark || (resumed ? 'Resumed' : `Marked ${STATUS_LABEL[status]}`) });
    task.status = status;
    task.revisionCount += 1;
    if (resumed) task.blockedByDetails = undefined;
    await task.save();
    if (remark) await DelegationRemark.create({ delegation: task._id, author: user.id, body: remark });

    const title = resumed ? 'Task resumed' : status === S.ACCEPTED ? 'Task accepted' : 'Work started';
    notifyInvolved(task, user.id, {
      title,
      message: `${user.name}: "${task.title}" (${task.code}) is now ${STATUS_LABEL[status]}.${remark ? ` — ${remark}` : ''}`,
      kind: 'status_change',
    });
    audit(task, user.id, 'status_change', `${STATUS_LABEL[from]} → ${STATUS_LABEL[status]}${remark ? ` — ${remark}` : ''}`);
    return task;
  },

  /**
   * Doer declares the work done. Verification-required tasks wait for the
   * assigner's approval; the rest close immediately.
   */
  async complete(id, { evidenceUrls = [], remark }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isDoer && !rel.isAdmin) throw ApiError.forbidden('Only the doer can complete this task');
    if (![S.PENDING, S.ACCEPTED, S.IN_PROGRESS].includes(task.status)) {
      throw ApiError.conflict(`This task is ${STATUS_LABEL[task.status]} — it can't be completed from here`);
    }
    const proof = [...new Set([...(task.evidenceUrls || []), ...evidenceUrls])];
    if (task.evidenceRequired && !proof.length) {
      throw ApiError.badRequest('Upload proof of completion — this task requires evidence');
    }
    const openItems = task.checklistItems.filter((c) => !c.completed);
    if (openItems.length) {
      throw ApiError.badRequest(`Tick every checklist item first (${openItems.length} still open)`);
    }

    const now = new Date();
    const next = task.verificationRequired ? S.AWAITING_VERIFICATION : S.COMPLETED;
    await revision(task, user, { newStatus: next, reason: remark || (next === S.COMPLETED ? 'Completed' : 'Submitted for verification') });
    task.status = next;
    task.evidenceUrls = proof;
    task.completedAt = now; // the doer's actual finish time — what on-time is measured against
    if (remark) task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Submitted: ${remark}`, now);
    await task.save();
    if (remark) await DelegationRemark.create({ delegation: task._id, author: user.id, body: remark, attachments: evidenceUrls });

    notifyInvolved(task, user.id, {
      title: next === S.COMPLETED ? 'Task completed' : 'Task submitted for your approval',
      message:
        next === S.COMPLETED
          ? `${user.name} completed "${task.title}" (${task.code}).`
          : `${user.name} submitted "${task.title}" (${task.code}) — please verify and approve or send it back.`,
      kind: next === S.COMPLETED ? 'completed' : 'approval',
    });
    audit(task, user.id, 'status_change', next === S.COMPLETED ? 'Completed' : 'Submitted for verification');
    return task;
  },

  /** Assigner/admin accepts submitted work. */
  async approve(id, { remark }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAssigner && !rel.isAdmin) throw ApiError.forbidden('Only the assigner or an admin can approve this task');
    if (task.status !== S.AWAITING_VERIFICATION) {
      throw ApiError.conflict(`Task is ${STATUS_LABEL[task.status]} — only tasks awaiting verification can be approved`);
    }
    const now = new Date();
    const line = `Approved by ${user.name}${remark ? `: ${remark}` : ''}`;
    await revision(task, user, { newStatus: S.COMPLETED, reason: line });
    task.status = S.COMPLETED;
    task.completedAt = task.completedAt || now;
    task.managementRemark = appendRemarkLine(task.managementRemark, line, now);
    await task.save();

    notifyInvolved(task, user.id, { title: 'Task approved', message: `${user.name} approved "${task.title}" (${task.code}).`, kind: 'completed' });
    audit(task, user.id, 'status_change', line);
    return task;
  },

  /** Assigner/admin rejects submitted work — back to pending with a reason. */
  async sendBack(id, { reason }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAssigner && !rel.isAdmin) throw ApiError.forbidden('Only the assigner or an admin can send this task back');
    if (task.status !== S.AWAITING_VERIFICATION) {
      throw ApiError.conflict(`Task is ${STATUS_LABEL[task.status]} — only tasks awaiting verification can be sent back`);
    }
    const now = new Date();
    // "Sent back by" is what the performance report counts as a rejection.
    const line = `Sent back by ${user.name}: ${reason}`;
    await revision(task, user, { newStatus: S.PENDING, reason: line });
    task.status = S.PENDING;
    task.completedAt = undefined;
    task.managementRemark = appendRemarkLine(task.managementRemark, line, now);
    resetEscalation(task);
    await task.save();
    await systemRemark(task, user, line);

    notifyInvolved(task, user.id, {
      title: 'Task sent back for rework',
      message: `${user.name} sent "${task.title}" (${task.code}) back. Reason: ${reason}`,
      kind: 'rejected',
    });
    audit(task, user.id, 'status_change', line);
    return task;
  },

  /** Reopen a completed task. */
  async reopen(id, { reason }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAssigner && !rel.isAdmin) throw ApiError.forbidden('Only the assigner or an admin can reopen this task');
    if (task.status !== S.COMPLETED) throw ApiError.conflict('Only a completed task can be reopened');
    const line = `Reopened by ${user.name}: ${reason}`;
    await revision(task, user, { newStatus: S.IN_PROGRESS, reason: line });
    task.status = S.IN_PROGRESS;
    task.completedAt = undefined;
    resetEscalation(task);
    task.managementRemark = appendRemarkLine(task.managementRemark, line);
    await task.save();
    await systemRemark(task, user, line);

    notifyInvolved(task, user.id, { title: 'Task reopened', message: `${user.name} reopened "${task.title}" (${task.code}). ${reason}`, kind: 'reopened' });
    audit(task, user.id, 'status_change', line);
    return task;
  },

  /**
   * Move a deadline. The server decides what that means:
   *   no due date yet     → it's the initial planning date
   *   same business week  → uses a revision slot (two per task)
   *   a different week    → this task closes as Shifted and a fresh copy opens
   */
  async reviseDueDate(id, { newDate, reason, evidenceUrl }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !rel.isAssigner && !rel.isDoer) {
      throw ApiError.forbidden('Only the assigner, the doer or an admin can change this deadline');
    }
    if (task.status === S.SHIFTED) throw ApiError.conflict('This task was already shifted — continue on the task that replaced it');
    if (task.status === S.COMPLETED) throw ApiError.conflict('A completed task cannot be rescheduled. Reopen it first.');

    const parsed = parseDue(newDate);
    if (!parsed) throw ApiError.badRequest('The new date is not a valid date');
    const now = new Date();
    if (evidenceUrl) task.evidenceUrls = [...new Set([...(task.evidenceUrls || []), evidenceUrl])];

    // Case 1 — first deadline.
    if (!task.dueDate) {
      await revision(task, user, { newDueDate: parsed, reason: `Initial date set — ${reason}` });
      task.dueDate = parsed;
      task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Initial date set: ${reason}`, now);
      resetEscalation(task);
      await task.save();
      await this.retimeReminders(task);
      audit(task, user.id, 'revision', `Due date set to ${fmtDay(parsed)} — ${reason}`);
      return { outcome: 'initial-date-set', task };
    }

    // Case 2 — same week: consume a revision slot.
    if (isSameWeek(task.dueDate, parsed)) {
      const used = (task.revision1 ? 1 : 0) + (task.revision2 ? 1 : 0);
      if (used >= MAX_SAME_WEEK_REVISIONS) {
        throw new ApiError(409, 'Both same-week revisions are used. Move the date to a different week — that shifts the task and opens a new one.', {
          code: 'REVISION_LIMIT_REACHED',
        });
      }
      const slot = task.revision1 ? 'revision2' : 'revision1';
      const n = slot === 'revision1' ? 1 : 2;
      await revision(task, user, { newDueDate: parsed, reason: `Same-week revision ${n} — ${reason}` });
      task[slot] = parsed;
      task.dueDate = parsed;
      task.revisionCount += 1;
      task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Revision ${n} by ${user.name}: ${reason}`, now);
      resetEscalation(task);
      await task.save();
      await this.retimeReminders(task);

      notifyInvolved(task, user.id, {
        title: 'Deadline revised',
        message: `${user.name} moved "${task.title}" (${task.code}) to ${fmtDay(parsed)} (same week). Reason: ${reason}`,
        kind: 'revision',
      });
      audit(task, user.id, 'revision', `Same-week revision ${n} → ${fmtDay(parsed)} — ${reason}`);
      return { outcome: 'revised', slotUsed: slot, revisionsRemaining: MAX_SAME_WEEK_REVISIONS - (used + 1), task };
    }

    // Case 3 — different week: close this one as Shifted, open a clone.
    const code = await nextCode('delegation', 'DLG');
    const clone = await Delegation.create({
      code,
      title: task.title,
      description: task.description,
      assigner: task.assigner,
      doer: task.doer,
      inLoop: task.inLoop,
      branch: task.branch,
      group: task.group,
      parent: task.parent,
      recurrence: task.recurrence,
      category: task.category,
      tags: task.tags,
      priority: task.priority,
      status: S.PENDING,
      dueDate: parsed,
      checklistItems: task.checklistItems.map((c) => ({ text: c.text, completed: c.completed })),
      evidenceRequired: task.evidenceRequired,
      verificationRequired: task.verificationRequired,
      voiceNoteUrl: task.voiceNoteUrl,
      referenceDocs: task.referenceDocs,
      evidenceUrls: evidenceUrl ? [evidenceUrl] : [],
      shiftedFrom: task._id,
      // Carry the conversation forward so context isn't lost.
      coordinatorRemark: appendRemarkLine(null, `Shifted from ${task.code} by ${user.name}: ${reason}`, now),
      managementRemark: task.managementRemark,
      followUpCount: task.followUpCount,
      createdBy: user.id,
    });

    await revision(task, user, { newStatus: S.SHIFTED, newDueDate: parsed, reason: `Shifted to a different week — ${reason}` });
    task.status = S.SHIFTED;
    task.shiftedTo = clone._id;
    task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, `Shifted to ${code} (${fmtDay(parsed)}) by ${user.name}: ${reason}`, now);
    await task.save();

    // Move pending reminders' configuration onto the new task.
    const configs = await DelegationReminder.find({ delegation: task._id, sentAt: null }).lean();
    await DelegationReminder.deleteMany({ delegation: task._id, sentAt: null });
    await writeReminders(clone._id, clone.dueDate, configs.map(({ channel, value, unit, trigger }) => ({ channel, value, unit, trigger })));
    // Sub-tasks follow their parent to the new row.
    await Delegation.updateMany({ parent: task._id, deletedAt: null }, { parent: clone._id });

    notifyInvolved(clone, user.id, {
      title: 'Task shifted to a new week',
      message: `${user.name} shifted "${task.title}" to ${fmtDay(parsed)}. ${task.code} is closed and ${code} opened. Reason: ${reason}`,
      kind: 'revision',
    });
    audit(clone, user.id, 'status_change', `Shifted from ${task.code} to ${fmtDay(parsed)} — ${reason}`);
    return { outcome: 'shifted', closed: task, created: clone };
  },

  async retimeReminders(task) {
    const configs = await DelegationReminder.find({ delegation: task._id, sentAt: null }).lean();
    if (!configs.length) return;
    await writeReminders(task._id, task.dueDate, configs.map(({ channel, value, unit, trigger }) => ({ channel, value, unit, trigger })));
  },

  /**
   * "Dependent on others" (before work starts). Naming a person hands the task
   * to them — they own the dependency now — and loops the previous doer in.
   * Without a person the task parks as Dependent until resumed.
   */
  async markDependent(id, body, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !rel.isDoer && !rel.isAssigner) throw ApiError.forbidden('Only the doer can mark this task dependent');
    if (![S.PENDING, S.ACCEPTED].includes(task.status)) {
      throw ApiError.conflict('Only a task that has not started can be marked dependent — use "Blocked by" once work is under way');
    }

    let person = null;
    if (body.personId) {
      person = await User.findById(body.personId).select('name');
      if (!person) throw ApiError.badRequest('The selected person no longer exists');
      if (String(person._id) === idOf(task.doer)) throw ApiError.badRequest('That person already owns this task');
    }

    const parts = [];
    if (person) parts.push(`Person: ${person.name}`);
    if (body.dependentOnTask) parts.push(`Task: ${body.dependentOnTask}`);
    if (body.pendingApproval) parts.push(`Approval: ${body.pendingApproval}`);
    if (body.requiredTeam) parts.push(`Team: ${body.requiredTeam}`);
    const summary = parts.join(' | ');
    const reassigning = Boolean(person);
    const next = reassigning ? S.PENDING : S.DEPENDENT;
    const previousDoer = idOf(task.doer);

    await revision(task, user, {
      newStatus: next,
      reason: reassigning ? `Handed to ${person.name} (dependency) — ${body.remark}` : `Marked dependent — ${body.remark}`,
    });
    await DelegationRemark.create({ delegation: task._id, author: user.id, body: `Dependency — ${summary}: ${body.remark}` });

    task.status = next;
    task.revisionCount += 1;
    task.dependencyDetails = {
      personId: person?._id,
      personName: person?.name,
      dependentOnTask: body.dependentOnTask,
      pendingApproval: body.pendingApproval,
      requiredTeam: body.requiredTeam,
      remark: body.remark,
      summary,
    };
    if (reassigning) {
      task.doer = person._id;
      task.inLoop = [...new Set([...(task.inLoop || []).map(String).filter((u) => u !== String(person._id)), previousDoer])];
    }
    await task.save();

    const title = reassigning ? 'Task handed over (dependency)' : 'Task marked dependent';
    notificationService.notify({
      recipients: [...involvedIds(task), previousDoer],
      exclude: user.id,
      title,
      message: `${user.name}: "${task.title}" (${task.code}) — ${summary}. ${body.remark}${reassigning ? ` It is now with ${person.name} to accept.` : ''}`,
      module: 'delegation',
      kind: 'dependency',
      refId: task._id,
      link: `/delegation/tasks/${task._id}`,
    });
    audit(task, user.id, 'status_change', `${title} — ${summary}. ${body.remark}`);
    return { task, reassigned: reassigning };
  },

  /** "Blocked by" (mid-work) — a person, department, vendor or consultant is holding it up. */
  async setBlocked(id, body, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !rel.isDoer && !rel.isAssigner) throw ApiError.forbidden('Only the doer can flag this task as blocked');
    if (![S.PENDING, S.ACCEPTED, S.IN_PROGRESS, S.BLOCKED].includes(task.status)) {
      throw ApiError.conflict(`A task that is ${STATUS_LABEL[task.status]} can't be flagged as blocked`);
    }
    const parts = [];
    if (body.person) parts.push(`${body.person} (Person)`);
    if (body.department) parts.push(`${body.department} (Department)`);
    if (body.vendor) parts.push(`${body.vendor} (Vendor)`);
    if (body.consultant) parts.push(`${body.consultant} (Consultant)`);
    const summary = parts.join(', ');

    const flip = task.status !== S.BLOCKED;
    if (flip) await revision(task, user, { newStatus: S.BLOCKED, reason: `Blocked — ${body.reason}` });
    await DelegationRemark.create({ delegation: task._id, author: user.id, body: `Blocked by ${summary}: ${body.reason}` });
    task.status = S.BLOCKED;
    if (flip) task.revisionCount += 1;
    task.blockedByDetails = { ...body, summary };
    await task.save();

    notifyInvolved(task, user.id, {
      title: 'Task blocked',
      message: `${user.name} flagged "${task.title}" (${task.code}) as blocked by ${summary}: ${body.reason}`,
      kind: 'blocked',
    });
    audit(task, user.id, 'status_change', `Blocked by ${summary}: ${body.reason}`);
    return task;
  },

  /** Straight handover of ownership; the outgoing doer stays in the loop. */
  async reassign(id, { newDoerId, reason }, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !rel.isAssigner) throw ApiError.forbidden('Only the assigner or an admin can reassign this task');
    if ([S.COMPLETED, S.SHIFTED].includes(task.status)) throw ApiError.conflict(`A ${STATUS_LABEL[task.status].toLowerCase()} task cannot be reassigned`);
    if (idOf(task.doer) === String(newDoerId)) throw ApiError.badRequest('That person already owns this task');
    const next = await User.findById(newDoerId).select('name');
    if (!next) throw ApiError.badRequest('That person no longer exists');

    const previous = idOf(task.doer);
    const line = `Reassigned to ${next.name} by ${user.name}${reason ? `: ${reason}` : ''}`;
    await revision(task, user, { reason: line });
    task.doer = next._id;
    task.inLoop = [...new Set([...(task.inLoop || []).map(String).filter((u) => u !== String(next._id)), previous])];
    task.coordinatorRemark = appendRemarkLine(task.coordinatorRemark, line);
    await task.save();

    notifyInvolved(task, user.id, { title: 'Task reassigned', message: `"${task.title}" (${task.code}): ${line}`, kind: 'assigned' });
    audit(task, user.id, 'status_change', line);
    return task;
  },

  /**
   * Append to a remark channel. A management remark is a chase — it bumps the
   * follow-up counter and may carry a status change (assigner/admin only).
   */
  async channelRemark(id, channel, { remark, status }, user) {
    const { task, rel } = await load(id, user);
    const isMgmt = channel === REMARK_CHANNELS.MANAGEMENT;
    const field = isMgmt ? 'managementRemark' : 'coordinatorRemark';
    const label = isMgmt ? 'Management follow-up' : 'Coordinator note';
    const now = new Date();

    task[field] = appendRemarkLine(task[field], `${user.name}: ${remark}`, now);
    if (isMgmt) task.followUpCount += 1;
    if (isMgmt && status && status !== task.status) {
      if (!rel.isAdmin && !rel.isAssigner) throw ApiError.forbidden('Only the assigner or an admin can change the status with a remark');
      if (![S.PENDING, S.ACCEPTED, S.IN_PROGRESS, S.BLOCKED, S.DEPENDENT].includes(status)) {
        throw ApiError.badRequest('Use approve / reopen for closing statuses');
      }
      await revision(task, user, { newStatus: status, reason: `${label}: ${remark}` });
      task.status = status;
    }
    await task.save();
    await DelegationRemark.create({ delegation: task._id, author: user.id, body: remark, kind: channel });

    notifyInvolved(task, user.id, {
      title: `New ${label.toLowerCase()}`,
      message: `${user.name} on "${task.title}" (${task.code}): ${remark}`,
      kind: 'remark',
    });
    audit(task, user.id, 'remark', `[${label}] ${remark}`);
    return task;
  },

  /** Coordinator's follow-up call log — an observation, never a status change. */
  async logFollowup(id, body, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !user.opsFlags?.coordinator) {
      throw ApiError.forbidden('Only operations coordinators can log follow-up calls');
    }
    const row = await DelegationFollowup.create({
      delegation: task._id,
      follower: user.id,
      callStatus: body.callStatus,
      observedStatus: body.observedStatus,
      response: body.response,
      systemUpdated: body.systemUpdated,
      nextFollowUpDate: body.nextFollowUpDate ? parseDue(body.nextFollowUpDate) : undefined,
      escalationRequired: Boolean(body.escalationRequired),
    });
    if (body.escalationRequired) {
      notificationService.notify({
        recipients: [idOf(task.assigner)],
        exclude: user.id,
        title: 'Follow-up flagged for escalation',
        message: `${user.name} called about "${task.title}" (${task.code}) and flagged it for escalation.${body.response ? ` Response: ${body.response}` : ''}`,
        module: 'delegation',
        kind: 'escalation',
        refId: task._id,
        link: `/delegation/tasks/${task._id}`,
      });
    }
    audit(task, user.id, 'remark', `Follow-up call — ${body.callStatus.replace('_', ' ')}${body.escalationRequired ? ' · escalation required' : ''}`);
    return row.populate('follower', 'name avatarColor');
  },

  /** Replace the reminder schedule. */
  async setReminders(id, reminders, user) {
    const { task, rel } = await load(id, user);
    if (!rel.isAdmin && !rel.isAssigner && !rel.isDoer) throw ApiError.forbidden('You cannot change reminders on this task');
    await writeReminders(task._id, task.dueDate, reminders);
    return DelegationReminder.find({ delegation: task._id }).sort({ fireAt: 1 });
  },

  /** Convenience: full detail after any lifecycle action. */
  detail: (id, user) => delegationService.getById(id, user),
};

export default lifecycle;
