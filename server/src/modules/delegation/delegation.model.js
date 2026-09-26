import mongoose from 'mongoose';
import { attachTenancy } from '../../core/tenancy/tenancy.js';
import {
  DELEGATION_STATUS,
  DELEGATION_STATUS_VALUES,
  DELEGATION_OPEN_STATUSES,
} from '../../core/constants/ops.js';
import { PRIORITY, PRIORITY_VALUES } from '../../core/constants/index.js';

const { Schema, model } = mongoose;

const checklistItemSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    completed: { type: Boolean, default: false },
  },
  { _id: true },
);

/**
 * One delegated task: an assigner hands work to a doer, optionally copying
 * people "in the loop", filing it under a group, and splitting it into
 * sub-tasks. Lives in its own collection, independent of PMS project tasks.
 */
const delegationSchema = new Schema(
  {
    code: { type: String }, // DLG-000123 — the ID people quote (unique per company, indexed below)
    title: { type: String, required: true, trim: true, maxlength: 250 },
    description: { type: String, trim: true, maxlength: 5000 },

    assigner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    doer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inLoop: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    group: { type: Schema.Types.ObjectId, ref: 'WorkGroup', index: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Delegation', index: true },
    recurrence: { type: Schema.Types.ObjectId, ref: 'DelegationRecurrence' },

    category: { type: String, trim: true, maxlength: 60 },
    tags: [{ type: String, trim: true, maxlength: 60 }],
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM },
    status: {
      type: String,
      enum: DELEGATION_STATUS_VALUES,
      default: DELEGATION_STATUS.PENDING,
      index: true,
    },

    dueDate: { type: Date, index: true },
    // Same-week date revisions (max two). A cross-week move shifts the task instead.
    revision1: { type: Date },
    revision2: { type: Date },
    revisionCount: { type: Number, default: 0 },
    shiftedFrom: { type: Schema.Types.ObjectId, ref: 'Delegation' },
    shiftedTo: { type: Schema.Types.ObjectId, ref: 'Delegation' },

    // Append-only remark channels; every line starts with "dd/MM/yyyy HH:mm - ".
    managementRemark: { type: String }, // chases — each one bumps followUpCount
    coordinatorRemark: { type: String }, // informational notes and system trail
    followUpCount: { type: Number, default: 0 },

    checklistItems: [checklistItemSchema],
    evidenceRequired: { type: Boolean, default: false },
    evidenceUrls: [{ type: String }],
    verificationRequired: { type: Boolean, default: false },
    voiceNoteUrl: { type: String },
    referenceDocs: [{ type: String }],

    // "Dependent on others" — why the doer can't start yet.
    dependencyDetails: {
      personId: { type: Schema.Types.ObjectId, ref: 'User' },
      personName: String,
      dependentOnTask: String,
      pendingApproval: String,
      requiredTeam: String,
      remark: String,
      summary: String,
    },
    // "Blocked by" — who/what stopped the work mid-way.
    blockedByDetails: {
      person: String,
      department: String,
      vendor: String,
      consultant: String,
      reason: String,
      summary: String,
    },

    // Overdue escalation: 0 none · 1 reporting manager (3d) · 2 directors (7d) · 3 review meeting (15d).
    escalationTier: { type: Number, default: 0 },
    escalatedAt: { type: Date },

    completedAt: { type: Date }, // stamped when the doer declares done
    deletedAt: { type: Date, index: true }, // soft delete
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

delegationSchema.index({ branch: 1, deletedAt: 1, createdAt: -1 });
delegationSchema.index({ doer: 1, status: 1 });
delegationSchema.index({ assigner: 1, status: 1 });
delegationSchema.index({ inLoop: 1 });
delegationSchema.index({ status: 1, dueDate: 1 });

delegationSchema.virtual('isOverdue').get(function isOverdue() {
  return DELEGATION_OPEN_STATUSES.includes(this.status) && this.dueDate && this.dueDate < new Date();
});

delegationSchema.virtual('checklistProgress').get(function checklistProgress() {
  const total = this.checklistItems?.length || 0;
  if (!total) return null;
  return Math.round((this.checklistItems.filter((c) => c.completed).length / total) * 100);
});

attachTenancy(delegationSchema, { modelName: 'Delegation' });
// Codes come from a per-company counter, so they are unique within a company.
delegationSchema.index({ tenant: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
export const Delegation = model('Delegation', delegationSchema, 'dlg_delegations');
export default Delegation;
