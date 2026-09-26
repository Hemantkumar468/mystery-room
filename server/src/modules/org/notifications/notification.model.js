import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { NOTIFICATION_MODULES } from '../../../core/constants/ops.js';

const { Schema, model } = mongoose;

/** In-app notification — the bell in the top bar. */
const notificationSchema = new Schema(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    module: { type: String, enum: NOTIFICATION_MODULES, default: 'system' },
    // What happened — assigned, status_change, remark, reminder, escalation…
    kind: { type: String, default: 'info' },
    refId: { type: Schema.Types.ObjectId },
    link: { type: String }, // client route to open, e.g. /delegation/tasks/:id
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1 });
// Old notifications clean themselves up after 90 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

attachTenancy(notificationSchema, { modelName: 'OpsNotification' });
export const Notification = model('OpsNotification', notificationSchema, 'org_notifications');
export default Notification;
