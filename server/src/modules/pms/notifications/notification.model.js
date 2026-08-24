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
        // CRM: a follow-up task coming due (crm/tasks/reminder.job.js)
        'crm_task_due',
        // CRM: the SLA ladder on a ticket (crm/tickets/ticket.service.js).
        // Both rungs live here or notify() throws and the escalation is
        // recorded on the ticket but reaches nobody.
        'crm_ticket_warning', 'crm_ticket_escalated'],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    link: { type: String }, // e.g. `/projects/:id/store-launch`
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

attachTenancy(notificationSchema, { modelName: 'Notification' });

export const Notification = model('Notification', notificationSchema);
export default Notification;
