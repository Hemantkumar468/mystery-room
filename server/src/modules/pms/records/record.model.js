import mongoose from 'mongoose';
import { RECORD_STATUS, RECORD_STATUS_VALUES } from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/**
 * One uploaded/attached asset on a record. In M1 we store a *reference*
 * (a URL or a filename the doer captured); the binary-upload pipeline
 * (presigned URLs / object storage) lands in a later milestone.
 */
const attachmentSchema = new Schema(
  {
    fieldKey: { type: String }, // which form field it belongs to, e.g. "photos"
    name: { type: String }, // display name / original filename
    url: { type: String }, // reference/URL
    kind: { type: String, default: 'file' }, // image | video | file
  },
  { _id: true },
);

/**
 * A single row of a `collection`-mode stage — e.g. one candidate property in
 * Phase 1 (Property Identification). Its dynamic answers live in `values`,
 * validated at the route boundary against the stage's `masterDataSchema`.
 *
 * The lifecycle status is the funnel gate: a `p1` record marked `shortlisted`
 * is what advances a property into Phase 2. Nothing is deleted on rejection —
 * the row stays with its reason and decider for a full audit trail.
 */
const recordSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    stageKey: { type: String, required: true, index: true }, // "p1"

    /** Human title for the table (derived from `values`, e.g. the property name). */
    title: { type: String, trim: true },

    /** The dynamic answers — one form instance. */
    values: { type: Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: RECORD_STATUS_VALUES,
      default: RECORD_STATUS.SUBMITTED,
      index: true,
    },

    attachments: [attachmentSchema],

    // Decision (the gate) — who acted, when, and why.
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionReason: { type: String },

    /** Link back to the source row in a previous stage (carry-forward; future p2). */
    parentRecordId: { type: Schema.Types.ObjectId, ref: 'Record', index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

recordSchema.index({ project: 1, stageKey: 1, status: 1 });

export const Record = model('Record', recordSchema);
export default Record;
