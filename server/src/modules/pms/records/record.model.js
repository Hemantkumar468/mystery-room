import mongoose from 'mongoose';
import { RECORD_STATUS, RECORD_STATUS_VALUES } from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/** A file captured for a record field (Cloudinary reference or plain URL). */
const recordAttachmentSchema = new Schema(
  {
    fieldKey: { type: String }, // which schema field it belongs to (e.g. "photos")
    name: { type: String },
    url: { type: String },
    publicId: { type: String },
    kind: { type: String }, // image | video | raw
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * Record — one row of a collection-mode stage (e.g. a candidate property).
 * The dynamic answers live in the embedded, free-form `values` object; the
 * stage's masterDataSchema defines their shape.
 */
const recordSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    stageKey: { type: String, required: true, index: true },
    // Which of the stage's `assessmentTypes` this record answers (e.g.
    // "feasibility") — unset for stages with a single flat masterDataSchema.
    assessmentType: { type: String, index: true },
    seq: { type: Number, index: true }, // stable per-project display number (P-001…), set once at create
    title: { type: String }, // derived from values, for the table
    values: { type: Object, default: {} },
    status: {
      type: String,
      enum: RECORD_STATUS_VALUES,
      default: RECORD_STATUS.SUBMITTED,
      index: true,
    },
    attachments: [recordAttachmentSchema],

    submittedAt: { type: Date },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // generic last decider
    decidedAt: { type: Date },
    decisionReason: { type: String },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectReason: { type: String },
    shortlistedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    shortlistedAt: { type: Date },

    // Links an assessment record (e.g. Site Evaluation) back to the record it
    // assesses (e.g. the shortlisted Property Identification record).
    parentRecordId: { type: Schema.Types.ObjectId, ref: 'Record' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // stamped on every save
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // stamped on submit
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

recordSchema.index({ project: 1, stageKey: 1, status: 1 });

export const Record = model('Record', recordSchema);
export default Record;
