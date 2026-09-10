import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  PROJECT_STATUS,
  PROJECT_HEALTH,
  STAGE_LIFECYCLE,
  STAGE_LIFECYCLE_VALUES,
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

    /**
     * Snapshotted from the template alongside everything else on this stage, so
     * a live project keeps the What/Who/When/How it started with even if the
     * master template is later edited — the same reason `tasks` and
     * `masterDataSchema` are copied rather than referenced.
     * See templateStageSchema for what each field means.
     */
    whatWhoWhenHow: [
      new Schema(
        {
          what: { type: String, required: true },
          who: { type: String, required: true },
          when: { type: String, required: true },
          how: { type: String, required: true },
        },
        { _id: false },
      ),
    ],
    parallelGroup: { type: String },
    /* Hangs off another phase and feeds nothing — see template.model.js. */
    branchOf: { type: String },
    /**
     * Extra arrows to DRAW into this phase, beyond the one its column implies.
     *
     * Purchase Orders is the case. Its dates follow Contracts — nothing is
     * ordered before a contract exists — but what a purchase order is RAISED
     * AGAINST is the approved BOQ: that is the document saying what to buy and
     * how much. A diagram that shows only the contract arrow answers "when can
     * ordering start" and hides "where do the orders come from".
     *
     * PURELY VISUAL. Every key here must already be a transitive ancestor, so
     * the arrow states a relationship the plan already has. It adds no
     * dependency, moves no date and changes no critical path — the renderer
     * checks that and silently drops any key that is not already an ancestor,
     * because an arrow claiming a dependency the schedule does not have is
     * worse than a missing arrow.
     */
    alsoDrawnFrom: [{ type: String }],
    gate: {
      label: { type: String },
      approver: { type: String },
      unlocks: { type: String },
    },
    exitCriteria: { type: String },

    /* WHERE THIS PHASE IS IN ITS LIFE — not how far along it is.
    
       Progress (pending/processing/complete) is DERIVED from this phase's
       tasks on every read — see projects/phaseProgress.js — and never
       stored. A stored progress value was a second opinion about something
       the tasks already answered, and the two drifted: stages marked
       complete over open tasks, stages stuck at "not started" because
       nobody had pressed a button.
    
       This field gates nothing. It says only whether the project this
       phase belongs to is being built, has opened, or has been put away. */
    lifecycle: {
      type: String,
      enum: STAGE_LIFECYCLE_VALUES,
      default: STAGE_LIFECYCLE.ACTIVE,
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
    /**
     * What kind of undertaking this is — it decides which phases even
     * apply. 'new_centre' runs the whole flow. 'franchise' arrives WITH a
     * property and a committed partner, so Phases 1-2 auto-complete.
     * 'renovation' happens inside a centre we already run — adding games,
     * refitting — so property, assessment and commercial (Phases 1-3)
     * auto-complete and the work starts at planning.
     */
    /* The existing centre this renovation happens INSIDE. The location
       facts (city, address, area, the approved site) are inherited from
       it on create — never retyped, so they can never drift. */
    renovatesProject: { type: Schema.Types.ObjectId, ref: 'Project' },
    kind: {
      type: String,
      enum: ['new_centre', 'franchise', 'renovation'],
      default: 'new_centre',
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

attachTenancy(projectSchema, { modelName: 'Project' });

export const Project = model('Project', projectSchema);
export default Project;
