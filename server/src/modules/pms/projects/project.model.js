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
    // Set by an explicit "Mark Done" action. While true, recompute() leaves this
    // stage's status alone — task-driven auto-completion no longer applies until
    // a manager/admin reopens it.
    completedManually: { type: Boolean, default: false },
    // Audit of the most recent "Reopen" action — kept alongside completedBy/At
    // (never overwriting them) so both the last completion and the reopen that
    // followed it stay visible.
    reopenedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reopenedAt: { type: Date },
    // NOTE: captureMode/recordNoun are declared once, above — a second
    // declaration here used to silently clobber the enum-validated one (a
    // duplicate key in an object literal wins), leaving captureMode
    // unvalidated even though every stage-completion gate branches on its
    // exact string value.
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

    // Required for every real project; a draft may not have picked a city
    // yet, so the constraint relaxes only while status === DRAFT. See
    // project.service.js#publishDraft, which re-validates this is filled
    // in (via the strict createProjectSchema) before a draft can leave
    // DRAFT status — so this relaxation can never let a non-draft project
    // exist without a city.
    city: {
      type: String,
      required: function cityRequiredUnlessDraft() { return this.status !== PROJECT_STATUS.DRAFT; },
      index: true,
    },
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

    // Same relaxation as `city` above — required unless still a draft.
    plannedStartDate: {
      type: Date,
      required: function plannedStartRequiredUnlessDraft() { return this.status !== PROJECT_STATUS.DRAFT; },
    },
    targetEndDate: { type: Date },
    actualStartDate: { type: Date },
    actualEndDate: { type: Date },

    // Set once, by Phase 9's Launch Store flow (project.service.js#completeStage's
    // `p9` branch) when status flips to STORE_LIVE. Never cleared afterward — a
    // one-way door, same as the status value itself.
    storeLiveAt: { type: Date },
    storeLiveBy: { type: Schema.Types.ObjectId, ref: 'User' },

    // Set once, by Phase 10's Archive Project flow
    // (project.service.js#archiveProject) when status flips to ARCHIVED. The
    // final one-way door of the lifecycle — never cleared, same as storeLiveAt.
    archivedAt: { type: Date },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Free-text closure note captured at archive time (optional).
    archiveRemarks: { type: String },

    // Phase 10 Project Closure sign-off — stamped when the p10 stage itself
    // is completed (project.service.js#completeStage's `p10` branch), which
    // is a distinct, earlier event from archiving. Archiving is the final
    // one-way door; closure is the sign-off that unlocks it.
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // Reviewer remarks carried over from the approved Project Sign-Off
    // closure module — real captured data, never fabricated.
    closureRemarks: { type: String },

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
