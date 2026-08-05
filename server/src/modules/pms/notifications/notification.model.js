import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * In-app-only notification (no email infra exists in this app). Fanned out
 * one document per recipient by notificationService.notify() — see that
 * file for the resolveRecipients() convention (project owner + members +
 * every admin; this app has no CEO/Finance-Head/Ops-Head roles to target).
 */
const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    type: {
      type: String,
      enum: ['launch_completed', 'critical_issue_found', 'approval_needed', 'project_archived', 'stage_completed'],
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

export const Notification = model('Notification', notificationSchema);
export default Notification;
