import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/** Mirrors docs/EMS-ARCHITECTURE.md Section 3 — Branch is an independent
 * master entity; `project` is an optional soft link (set manually today,
 * auto-set by a future STORE_LIVE hook once that's safe to enable — see the
 * blueprint's Risks section), never a required dependency. */
export const BRANCH_KINDS = ['store', 'hq', 'warehouse', 'other'];
export const BRANCH_STATUSES = ['active', 'inactive'];

const branchSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Server-generated only (see branch.service.js#generateBranchCode) —
     * never accepted from the client; branch.validation.js has no `code`
     * field, so any client-sent value is stripped before it reaches here. */
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    kind: { type: String, enum: BRANCH_KINDS, default: 'store' },
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
    /** Free text, matching Project.city's own convention exactly (not a
     * hard enum) — the frontend suggests from the same INDIAN_CITIES list
     * Project's create form already uses, but never blocks a typed value. */
    city: { type: String, trim: true, maxlength: 80 },
    address: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: BRANCH_STATUSES, default: 'active', index: true },
    costCenterCode: { type: String, trim: true, maxlength: 40 },
    openedAt: { type: Date },
    manager: { type: Schema.Types.ObjectId, ref: 'User' },
    /** True only when a future STORE_LIVE hook creates this row automatically;
     * every branch created through this module's own API is false. */
    autoCreated: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

branchSchema.index({ project: 1 }, { sparse: true });
branchSchema.index({ status: 1, city: 1 });

export const Branch = model('Branch', branchSchema);
export default Branch;
