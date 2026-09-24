import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Append-only audit trail for the operations modules (delegation, checklist,
 * teams, groups…). Deliberately separate from the PMS `activities` collection
 * so neither module's history is mixed into the other's feed.
 */
const workLogSchema = new Schema(
  {
    module: { type: String, enum: ['delegation', 'checklist', 'org'], required: true, index: true },
    type: { type: String, required: true }, // created, status_change, remark, revision, deleted…
    title: { type: String, required: true },
    description: { type: String },
    actor: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    refType: { type: String }, // delegation, checklist_task, checklist_master, team, group…
    refId: { type: Schema.Types.ObjectId },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

workLogSchema.index({ createdAt: -1 });
workLogSchema.index({ refId: 1, createdAt: -1 });

export const WorkLog = model('WorkLog', workLogSchema, 'org_activity_log');
export default WorkLog;
