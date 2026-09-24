import mongoose from 'mongoose';
import {
  CHECKLIST_FREQUENCY_VALUES,
  CHECKLIST_STATUS,
  CHECKLIST_STATUS_VALUES,
} from '../../core/constants/ops.js';

const { Schema, model } = mongoose;

/**
 * A routine: "who does what, how often, where". Creating one materialises
 * every dated occurrence (ChecklistTask) through its end date, so the routine
 * itself stays editable — change the doer from next month without touching
 * history.
 */
const masterSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true }, // CHK-00012
    taskName: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 2000 },
    doer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    frequency: { type: String, enum: CHECKLIST_FREQUENCY_VALUES, required: true },
    startDate: { type: String, required: true }, // 'YYYY-MM-DD'
    endDate: { type: String, required: true }, // generation horizon
    // Scheduling options.
    weeklyOffs: [{ type: Number, min: 0, max: 6 }], // days never scheduled (0 = Sunday)
    anchorWeekday: { type: Number, min: 0, max: 6 }, // weekly/fortnightly — default Saturday
    anchorDay: { type: Number, min: 1, max: 31 }, // monthly — default the 28th
    autoRenew: { type: Boolean, default: true }, // extend a year ahead as the end date nears

    proofRequired: { type: Boolean, default: false },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    department: { type: String, trim: true },
    site: { type: String, trim: true, maxlength: 160 }, // outlet / room / area the routine covers
    group: { type: Schema.Types.ObjectId, ref: 'WorkGroup', index: true },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

masterSchema.index({ branch: 1, isActive: 1 });

/** One dated occurrence of a routine. Completion = actualDate stamped. */
const taskSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // CT-000123
    master: { type: Schema.Types.ObjectId, ref: 'ChecklistMaster', index: true },
    doer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    taskName: { type: String, required: true },
    frequency: { type: String, enum: CHECKLIST_FREQUENCY_VALUES },
    plannedKey: { type: String, required: true }, // 'YYYY-MM-DD' — the business day
    plannedDate: { type: Date, required: true }, // 00:00 of that day, business timezone
    actualDate: { type: Date }, // null = still open
    proofRequired: { type: Boolean, default: false },
    documentUrl: { type: String },
    status: { type: String, enum: CHECKLIST_STATUS_VALUES, default: CHECKLIST_STATUS.PENDING, index: true },
    // Closed without counting as a miss (outlet shut, room down for repair).
    isNonFunctional: { type: Boolean, default: false },
    managementRemark: { type: String },
    coordinatorRemark: { type: String },
    followUpCount: { type: Number, default: 0 },
    reassignedFrom: { type: Schema.Types.ObjectId, ref: 'User' },
    reassignedAt: { type: Date },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    department: { type: String },
    site: { type: String },
    group: { type: Schema.Types.ObjectId, ref: 'WorkGroup' },
  },
  { timestamps: true },
);

taskSchema.index({ branch: 1, plannedDate: 1 });
taskSchema.index({ doer: 1, plannedDate: 1 });
taskSchema.index({ branch: 1, actualDate: 1 });
taskSchema.index({ master: 1, plannedKey: 1 });
taskSchema.index({ plannedKey: 1, actualDate: 1 });

/** Managed list of sites for the "which outlet / room / area" field. */
const siteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
siteSchema.index({ branch: 1, name: 1 }, { unique: true });

export const ChecklistMaster = model('ChecklistMaster', masterSchema, 'chk_masters');
export const ChecklistTask = model('ChecklistTask', taskSchema, 'chk_tasks');
export const ChecklistSite = model('ChecklistSite', siteSchema, 'chk_sites');
