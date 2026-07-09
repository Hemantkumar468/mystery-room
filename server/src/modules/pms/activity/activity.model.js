import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/** Append-only audit trail for meaningful PMS mutations. */
const activitySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    entityType: { type: String, enum: ['project', 'task', 'template', 'stage'], required: true },
    entityId: { type: Schema.Types.ObjectId },
    action: { type: String, enum: Object.values(ACTIVITY_ACTIONS), required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ project: 1, createdAt: -1 });

export const Activity = model('Activity', activitySchema);
export default Activity;
