import mongoose from 'mongoose';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/** Append-only audit trail for meaningful mutations across every ERP module
 * that reuses this one shared collection (PMS today; EMS from Step 2.1 —
 * see docs/EMS-ARCHITECTURE.md Section 11 — 'branch' is the first non-PMS
 * entityType, more follow as EMS's later steps land). */
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
// EMS entities (Branch and beyond) have no project context — this is the
// lookup the future Approval Timeline / audit views actually use for them.
activitySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const Activity = model('Activity', activitySchema);
export default Activity;
