import mongoose from 'mongoose';
import { attachTenancy } from '../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * WHO DOES ONE RECURRING JOB — "the Feasibility assessment goes to these
 * people, with these two covering".
 *
 * ONE DOCUMENT PER JOB, not per task. There are thousands of tasks and a
 * couple of dozen jobs; this says who the JOB belongs to, and every task
 * created from it afterwards inherits that. Saving it per task would mean
 * re-deciding the same thing on every new property, which is exactly the
 * work this screen exists to stop.
 *
 * IT DOES NOT MOVE WORK THAT ALREADY EXISTS. Changing an assignment governs
 * tasks created from that moment on; tasks already out there are somebody's
 * open work and are re-pointed only by the sync, and only while nobody has
 * started them (see projectService.syncAssessmentTasks). Silently emptying
 * one person's list into another's would be the kind of change nobody can
 * see happening.
 *
 * DOERS AND BUDDIES ARE DIFFERENT THINGS. Every doer gets the task in their
 * own My Tasks and the first to finish closes it for the rest — that is how
 * `assigneeRefs` already behaves. A buddy is cover: they become a watcher,
 * so they can see it and step in, without it sitting in their list as work
 * they owe. Conflating the two would double everybody's apparent workload.
 */
const fmsAssignmentSchema = new Schema(
  {
    /** Which FMS, for grouping on the screen: 'property', later 'purchase'. */
    fms: { type: String, required: true, trim: true, index: true },

    /**
     * The job, as `<stageKey>:<taskKey>` — the two fields a Task already
     * carries from its template, so no translation is needed to match them.
     */
    item: { type: String, required: true, trim: true },

    /** Everyone the work goes to. First-to-finish closes it for the rest. */
    doers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /** Cover. They watch the task and can pick it up; it is not their debt. */
    buddies: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /** Why this split — shown under the row, for whoever reads it next year. */
    note: { type: String, trim: true, maxlength: 300, default: '' },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* One row per job per company. The unique index is what makes the upsert in
   fms.service#save safe when two people save the screen at once. */
fmsAssignmentSchema.index({ tenant: 1, item: 1 }, { unique: true });

attachTenancy(fmsAssignmentSchema, { modelName: 'FmsAssignment' });

export const FmsAssignment = model('FmsAssignment', fmsAssignmentSchema);
export default FmsAssignment;
