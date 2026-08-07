import mongoose from 'mongoose';
import { RECORD_STATUS, RECORD_STATUS_VALUES } from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

/** A file captured for a record field (S3 reference or plain URL). */
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

/** A user-authored note on a record — same shape as Task's commentSchema. */
const recordCommentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
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
    comments: [recordCommentSchema],

    submittedAt: { type: Date },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // generic last decider
    decidedAt: { type: Date },
    decisionReason: { type: String }, // optional reviewer remarks, distinct from rejectReason — only ever set on reject
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

    // Append-only audit trail of every decision ever taken on this record.
    // The `decidedBy`/`approvedBy`/`rejectedBy` stamps above only ever hold
    // the LATEST decision (each new one clears the last), so without this a
    // reject-then-approve cycle left no trace on the record itself — only in
    // the separate activity log. Never edited or removed, only appended.
    decisionHistory: [{
      _id: false,
      decision: { type: String },
      fromStatus: { type: String },
      toStatus: { type: String },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
      reason: { type: String }, // required rejection reason
      remarks: { type: String }, // optional reviewer remarks
    }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

recordSchema.index({ project: 1, stageKey: 1, status: 1 });
// The approval pipeline resolves one module at a time for one property
// ({ project, stageKey, parentRecordId, assessmentType }) — both the
// tier-ordering check and every per-module status lookup hit this shape.
recordSchema.index({ project: 1, stageKey: 1, parentRecordId: 1, assessmentType: 1 });

export const Record = model('Record', recordSchema);
export default Record;
