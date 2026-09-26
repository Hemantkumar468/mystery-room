import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * An ad-hoc working group (e.g. "Pune launch war-room", "Weekend ops"). Tasks
 * can be filed against a group; every member sees the group's tasks.
 */
const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    color: { type: String, default: '#14B8A6' },
    imageUrl: { type: String },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch' },
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

groupSchema.index({ members: 1 });

attachTenancy(groupSchema, { modelName: 'WorkGroup' });
export const WorkGroup = model('WorkGroup', groupSchema, 'org_groups');
export default WorkGroup;
