import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * The in-app notification — the bell icon's contents. Fanned out one document
 * per recipient by notificationService.notify() — see that file for the
 * resolveRecipients() convention (project owner + members + every admin; this
 * app has no CEO/Finance-Head/Ops-Head roles to target).
 *
 * This is the primary channel and is never conditional on email working.
 * core/services/mail.service.js exists for anything that also wants to go out
 * by mail, and is best-effort: skipped entirely when no SMTP server is
 * configured, with the row here written either way.
 */
const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    type: {
      type: String,
      enum: ['launch_completed', 'critical_issue_found', 'approval_needed', 'project_archived', 'stage_completed',
        // Work landing on somebody. Until this existed a task could be assigned
        // and the person never told — the activity feed recorded it, but the
        // activity feed is a project audit log, not anybody's inbox.
        'task_assigned',
        // CRM: a follow-up task coming due (crm/tasks/reminder.job.js)
        'crm_task_due',
        // CRM: the SLA ladder on a ticket (crm/tickets/ticket.service.js).
        // Both rungs live here or notify() throws and the escalation is
        // recorded on the ticket but reaches nobody.
        'crm_ticket_warning', 'crm_ticket_escalated',
        // Property FMS. A handoff in that flow is the one thing people
        // asked to be told about and the one thing it never announced:
        // work landing on a doer, a decision landing on the MD, and the
        // answer coming back. See propertyNotify.js for the wording.
        'work_returned', 'decision_made'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String }, // e.g. `/projects/:id/store-launch`

    /**
     * WHAT THE BELL NEEDS TO DRAW A CONSISTENT LINE, rather than each caller
     * inventing its own sentence.
     *
     * The bell used to show whatever string a call site happened to pass, so
     * it filled up with things like "Escalated (19522%): ZZTKT-93CZ9 Half
     * way" — true, and useless to the person reading it. These let the
     * notification say the same four things every time: which system it came
     * from, what it is about, who caused it, and when it is due.
     *
     * All optional, so every existing call site keeps working unchanged and
     * simply renders without the extras.
     */
    module: { type: String },      // 'property' | 'crm' | 'delegation' | …
    entity: { type: String },      // the thing it is about — "gandhi naagr · Amritsar"
    actorName: { type: String },   // who caused it, for "by Prateek"
    due: { type: Date },           // when the work is due, if it is work
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

attachTenancy(notificationSchema, { modelName: 'Notification' });

export const Notification = model('Notification', notificationSchema);
export default Notification;
