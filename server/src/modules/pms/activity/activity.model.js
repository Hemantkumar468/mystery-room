import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/** Append-only audit trail for meaningful mutations across every ERP module
 * that reuses this one shared collection. `entityType` is free text so a new
 * module can log against its own entities without a schema change. */
const activitySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    entityType: { type: String, enum: ['project', 'task', 'template', 'stage', 'record', 'branch'], required: true },
    entityId: { type: Schema.Types.ObjectId },
    action: { type: String, enum: Object.values(ACTIVITY_ACTIONS), required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activitySchema.index({ project: 1, createdAt: -1 });
// Entities with no project context are looked up this way instead.
activitySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

attachTenancy(activitySchema, { modelName: 'Activity' });

export const Activity = model('Activity', activitySchema);
export default Activity;
