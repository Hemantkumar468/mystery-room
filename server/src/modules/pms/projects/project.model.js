import mongoose from 'mongoose';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  STAGE_STATUS,
  PRIORITY,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
  STAGE_CAPTURE_MODE,
  STAGE_CAPTURE_MODE_VALUES,
} from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/** Per-project snapshot of a template stage, plus its live execution state. */
const projectStageSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0, min: 0 },
    color: { type: String, default: '#6E45FF' },
    slaDays: { type: Number, default: 7, min: 0 },
    ownerDepartment: { type: String, enum: DEPARTMENT_VALUES },
    // Carried from the template so the UI knows to render a records table vs a single form.
    captureMode: {
      type: String,
      enum: STAGE_CAPTURE_MODE_VALUES,
      default: STAGE_CAPTURE_MODE.SINGLE,
    },
    recordNoun: { type: String, default: 'Record' },
    status: {
      type: String,
      enum: Object.values(STAGE_STATUS),
      default: STAGE_STATUS.NOT_STARTED,
    },
    plannedStart: { type: Date },
    plannedEnd: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    requiresApproval: { type: Boolean, default: false },
    approverRoles: [{ type: String }],
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // MR-PUN-001
    description: { type: String },

    template: {
      ref: { type: Schema.Types.ObjectId, ref: 'Template' },
      name: { type: String },
      version: { type: Number }, // snapshot version — plan is immutable per project
    },

    city: { type: String, required: true, index: true },
    address: { type: String },
    areaSqft: { type: Number, min: 0 },

    status: {
      type: String,
      enum: Object.values(PROJECT_STATUS),
      default: PROJECT_STATUS.PLANNING,
      index: true,
    },
    health: {
      type: String,
      enum: Object.values(PROJECT_HEALTH),
      default: PROJECT_HEALTH.ON_TRACK,
      index: true,
    },
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM },

    owner: { type: Schema.Types.ObjectId, ref: 'User' }, // accountable manager
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    plannedStartDate: { type: Date, required: true },
    targetEndDate: { type: Date },
    actualStartDate: { type: Date },
    actualEndDate: { type: Date },

    budget: {
      planned: { type: Number, default: 0, min: 0 },
      actual: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: 'INR' },
    },

    // Franchise-specific context (also capturable via master data).
    broker: {
      name: { type: String },
      phone: { type: String },
      commissionPct: { type: Number, min: 0, max: 100 },
    },

    stages: [projectStageSchema],

    /** Captured master data: { [stageKey]: { [fieldKey]: value } } */
    masterData: { type: Schema.Types.Mixed, default: {} },

    progress: { type: Number, default: 0, min: 0, max: 100 }, // derived, cached
    currentStageKey: { type: String },

    tags: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

projectSchema.index({ status: 1, health: 1 });

projectSchema.virtual('daysRemaining').get(function () {
  if (!this.targetEndDate) return null;
  return Math.ceil((this.targetEndDate - new Date()) / (1000 * 60 * 60 * 24));
});

projectSchema.virtual('budgetUtilization').get(function () {
  if (!this.budget?.planned) return 0;
  return Math.round((this.budget.actual / this.budget.planned) * 100);
});

export const Project = model('Project', projectSchema);
export default Project;
