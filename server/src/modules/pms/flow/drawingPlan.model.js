import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * Who is assigned to a checklist drawing, and when it was planned — the one
 * thing `Record` cannot carry, because a checklist row has no Record until
 * something is actually filed against it (see flow.service.js#mergeDrawings).
 *
 * Created on first assignment, never bulk-seeded — the same "materialize on
 * write" principle the checklist itself already uses, so assigning a drawing
 * before it exists as a Record does not put 37 rows of noise into every
 * project on day one.
 */
const drawingPlanSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    /** The checklist row's stable identity — `DRAWING_CHECKLIST[i].no`. Never renumbered. */
    drawingNo: { type: Number, required: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    designerOwner: { type: Schema.Types.ObjectId, ref: 'User' },
    plannedDate: { type: Date },
    /** Free-form "HH:mm" (or "10:00 AM") — display-only, never parsed as a Date. */
    plannedTime: { type: String, maxlength: 20 },
    notes: { type: String, maxlength: 2000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

drawingPlanSchema.index({ project: 1, drawingNo: 1 }, { unique: true });

attachTenancy(drawingPlanSchema, { modelName: 'DrawingPlan' });

export const DrawingPlan = model('DrawingPlan', drawingPlanSchema);
export default DrawingPlan;
