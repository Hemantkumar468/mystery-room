import mongoose from 'mongoose';
import { RECORD_STATUS, RECORD_STATUS_VALUES } from '../../../core/constants/index.js';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

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
    /**
     * The task this record was filed FOR, when it was filed from one.
     *
     * Without it there is no way to say which entries a given doer submitted
     * for a given task. `Task.formKey` names which FORM a task opens, and the
     * task carries a stageKey — but that pair is many-to-many: ten properties
     * filed on one phase all match the phase's task equally well, so an
     * approver reviewing a task could only ever be shown "everything filed on
     * this phase" and left to guess which of it was the submission.
     *
     * Optional and unindexed-by-default would make the approval lookup a
     * collection scan, so it is indexed; optional because plenty of records are
     * still filed straight from a phase page with no task in play, and every
     * record predating this field has none. Callers must therefore treat a
     * missing value as "unknown", never as "not this task" — see
     * approval.service.js#submissionFor, which falls back to phase-scoped
     * records and labels them as such rather than showing nothing.
     */
    task: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
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

    // Append-only log of every TRACKING change (recordService.updateTracking):
    // which field, from what, to what, by whom, when. This is what lets the
    // order tracker say "Dispatched — marked by Ramesh, 21 Aug 14:05" and
    // answer "who entered this GRN?" months later. Never edited, only appended.
    changeLog: [{
      _id: false,
      field: { type: String },
      label: { type: String },
      from: { type: Schema.Types.Mixed },
      to: { type: Schema.Types.Mixed },
      note: { type: String },
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: { type: Date },
    }],
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

recordSchema.index({ project: 1, stageKey: 1, status: 1 });
// The approval pipeline resolves one module at a time for one property
// ({ project, stageKey, parentRecordId, assessmentType }) — both the
// tier-ordering check and every per-module status lookup hit this shape.
recordSchema.index({ project: 1, stageKey: 1, parentRecordId: 1, assessmentType: 1 });

/**
 * THE TWO SHAPES THE PROPERTY QUEUE ASKS IN - both were collection scans.
 *
 * Every index above leads with `project`, and neither of the queue's queries
 * knows a project: it asks for EVERY p1 record newest-first, then for their
 * children by parent. Mongo cannot use a compound index whose first key is
 * absent from the filter, so both ran as full scans of `records` and both grew
 * linearly with the collection - which is why the queue took the same ~700ms
 * whether the page asked for one row or two hundred.
 *
 * `createdAt: -1` is part of the first index rather than a separate sort: it
 * is the queue's only order, and with it in the key the sort is free.
 */
recordSchema.index({ stageKey: 1, createdAt: -1 });
recordSchema.index({ parentRecordId: 1, stageKey: 1 });

attachTenancy(recordSchema, { modelName: 'Record' });

export const Record = model('Record', recordSchema);
export default Record;
