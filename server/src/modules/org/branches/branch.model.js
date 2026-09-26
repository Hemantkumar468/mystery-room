import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { BRANCH_TYPES, BRANCH_TYPE_VALUES } from '../../../core/constants/ops.js';

const { Schema, model } = mongoose;

/**
 * A place the business runs from — head office, a regional office, an outlet.
 * Delegation and checklist lists are partitioned by branch ("headquarters-wise"),
 * and a person's home branch decides which one their lists open on.
 */
const branchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 12 },
    type: { type: String, enum: BRANCH_TYPE_VALUES, default: BRANCH_TYPES.OUTLET },
    city: { type: String, trim: true },
    address: { type: String, trim: true },
    // Exactly one branch is the fallback for people with no home branch.
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

attachTenancy(branchSchema, { modelName: 'Branch' });
branchSchema.index({ isActive: 1, name: 1 });

// Codes are unique within a company (two companies may each have an "HO").
branchSchema.index({ tenant: 1, code: 1 }, { unique: true });

export const Branch = model('Branch', branchSchema, 'org_branches');
export default Branch;
