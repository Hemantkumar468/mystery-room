import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  TASK_STATUS,
  TASK_STATUS_VALUES,
  PRIORITY,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
} from '../../../core/constants/index.js';

const { Schema, model } = mongoose;

const checklistItemSchema = new Schema(
  {
    label: { type: String, required: true },
    done: { type: Boolean, default: false },
    required: { type: Boolean, default: false },
  },
  { _id: true },
);

/** A file uploaded to S3. `publicId` (the S3 key) is kept so it can be deleted later. */
const attachmentSchema = new Schema(
  {
    url: { type: String, required: true }, // S3 object URL
    publicId: { type: String, required: true }, // S3 key (for destroy)
    resourceType: { type: String, default: 'image' }, // image | video | raw
    originalName: { type: String },
    mimetype: { type: String },
    bytes: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * A comment posted on a task. `kind: 'update'` is a progress narration with
 * optional photos (the Execution UI's "Add Update"); `kind: 'comment'`
 * (default) is a plain discussion remark — same underlying document, just a
 * lighter-weight post with no photos attached.
 */
const commentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    kind: { type: String, enum: ['comment', 'update'], default: 'comment' },
    photos: [attachmentSchema],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** A pasted URL reference (Google Drive doc, spec link, etc.) — no upload. */
const linkSchema = new Schema(
  {
    label: { type: String },
    url: { type: String, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * A pending/decided deadline-extension request. The assignee asks to move
 * `plannedEnd` to `requestedEnd`; whoever assigned/manages the task approves or
 * rejects. On approve, the service moves plannedEnd and clears status→pending.
 */
const extensionRequestSchema = new Schema(
  {
    requestedEnd: { type: Date, required: true },
    previousEnd: { type: Date },
    reason: { type: String },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    decisionNote: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** One transfer of a task from one doer to another — kept as an audit trail. */
const transferSchema = new Schema(
  {
    from: { type: Schema.Types.ObjectId, ref: 'User' },
    to: { type: Schema.Types.ObjectId, ref: 'User' },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const taskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    code: { type: String, index: true },
    templateTaskKey: { type: String },
    stageKey: { type: String, required: true, index: true },
    stageName: { type: String },

    title: { type: String, required: true, trim: true },
    description: { type: String },

    /**
     * What / Who / When / How for THIS assignment, snapshotted from the
     * template task at creation. Shown on the task itself, so a doer opening
     * their work from My Tasks reads the job description in the same four
     * terms the phase and the master flow use. See templateTaskSchema#brief.
     */
    brief: {
      what: { type: String },
      who: { type: String },
      when: { type: String },
      how: { type: String },
    },

    /** Which form on this task's stage it opens (an assessmentType key). */
    formKey: { type: String },
    // See template.model.js — copied through at cascade.
    appPath: { type: String },

    /**
     * Snapshot of the template's approval rule for this task — see
     * templateTaskSchema#approval. `required: false` means completing the task
     * finishes it outright (no approval queue); `approver` names who signs off,
     * for display.
     */
    approval: {
      required: { type: Boolean, default: true },
      approver: { type: String },
    },

    status: { type: String, enum: TASK_STATUS_VALUES, default: TASK_STATUS.TODO, index: true },
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM, index: true },
    department: { type: String, enum: DEPARTMENT_VALUES },

    // Business-facing readiness grouping (see READINESS_CATEGORIES) — used
    // by the Phase 8 Store Readiness dashboard/category pages. Free text on
    // the schema, no fixed taxonomy enforced here.
    taskCategory: { type: String, trim: true },

    assignee: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /**
     * Every doer as a real account. `assignee` stays the first of them so every
     * single-owner code path keeps working; My Tasks and the status guard read
     * BOTH. When one doer completes the task it leaves the others' lists — see
     * task.service#myTasks and `completedBy` below.
     */
    assigneeRefs: [{ type: Schema.Types.ObjectId, ref: 'User', index: true }],
    assignees: [{ type: String }],
    backupAssignees: [{ type: String }],
    primaryAssignee: { type: String },
    backupAssignee: { type: String },
    /** Which of the doers actually finished it, and when — the audit answer to
     *  "who did this?" on a task several people were holding. */
    completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
    /**
     * Flagged true at project instantiation if the primary assignee was
     * marked unavailable in the template. Clears when a new assignee is set.
     */
    reassignNeeded: { type: Boolean, default: false, index: true },

    plannedStart: { type: Date },
    plannedEnd: { type: Date, index: true },
    actualStart: { type: Date },
    actualEnd: { type: Date },

    estimatedHours: { type: Number, default: 0, min: 0 },
    actualHours: { type: Number, default: 0, min: 0 },

    // Buddy / CC — additional users kept in the loop on this task, beyond the
    // primary assignee (and the roster backupAssignee). Real User refs so the
    // "my tasks / watching" queries and notifications can use them.
    watchers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    dependencies: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    checklist: [checklistItemSchema],
    comments: [commentSchema],
    attachments: [attachmentSchema],
    links: [linkSchema],

    // Deadline-extension request + the audit trail of task transfers.
    extensionRequest: { type: extensionRequestSchema, default: null },
    transferHistory: [transferSchema],

    // Set when the task is completed — snapshots on-time performance for MIS.
    completedOnTime: { type: Boolean },

    // Approval pipeline stamps (mirrors Record's single-last-decision pattern —
    // full history lives in the shared activityService, not a second array here).
    // Two tiers: `approvedBy/At/approvalRemarks` is the department-manager
    // decision (Phase 6); `managementApprovedBy/At/approvalRemarks` is the
    // second, cross-department tier (Phase 7) that follows it. Rejection at
    // either tier reuses the same rejectedBy/At/rejectReason.
    submittedForApprovalBy: { type: Schema.Types.ObjectId, ref: 'User' },
    submittedForApprovalAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    approvalRemarks: { type: String },
    // Typed full-name confirmation captured at approval time — currently only
    // collected by Phase 9's Go-Live Checklist UI (see task.service.js#decide's
    // stageKey==='p9' guard); left undefined for every other phase's tasks.
    approvalSignature: { type: String },
    managementApprovedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    managementApprovedAt: { type: Date },
    managementApprovalRemarks: { type: String },
    managementApprovalSignature: { type: String },
    rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: { type: Date },
    rejectReason: { type: String },

    order: { type: Number, default: 0 },
    tags: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignee: 1, status: 1 });
// Every stage-completion gate and every phase page loads a project's tasks
// for one stage ({ project, stageKey }) — the single-field indexes forced
// Mongo to pick one and filter the rest in memory. The status suffix also
// covers the very common "…and only the unfinished ones" narrowing.
taskSchema.index({ project: 1, stageKey: 1, status: 1 });
// Overdue sweeps and the deadline panels sort/filter by due date per project.
taskSchema.index({ project: 1, plannedEnd: 1 });

/** Live overdue flag — never persisted, always current. */
/**
 * Live overdue flag. "Not overdue" means the assignee's work is finished —
 * which in this app almost never leaves a task sitting at `done`: marking it
 * complete immediately submits it for approval, so a delivered task spends
 * its life in waiting_approval → waiting_management_approval → approved.
 * Excluding only `done` therefore counted every delivered-and-approved task
 * as overdue. `rejected` is excluded too: its lateness is moot until the work
 * is resumed. Mirrors isTaskDelayed() in client/src/lib/ui.js.
 */
export const NOT_OVERDUE_STATUSES = [
  TASK_STATUS.DONE, TASK_STATUS.WAITING_APPROVAL,
  TASK_STATUS.WAITING_MANAGEMENT_APPROVAL, TASK_STATUS.APPROVED, TASK_STATUS.REJECTED,
];

taskSchema.virtual('isOverdue').get(function () {
  return !NOT_OVERDUE_STATUSES.includes(this.status) && this.plannedEnd && this.plannedEnd < new Date();
});

taskSchema.virtual('checklistProgress').get(function () {
  const total = this.checklist?.length || 0;
  if (!total) return null;
  const done = this.checklist.filter((c) => c.done).length;
  return Math.round((done / total) * 100);
});

// Manage timestamps and the on-time flag as status transitions occur.
taskSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === TASK_STATUS.IN_PROGRESS && !this.actualStart) {
      this.actualStart = new Date();
    }
    if (this.status === TASK_STATUS.DONE) {
      this.actualEnd = this.actualEnd || new Date();
      this.completedOnTime = this.plannedEnd ? this.actualEnd <= this.plannedEnd : true;
    }
  }
  next();
});

attachTenancy(taskSchema, { modelName: 'Task' });

export const Task = model('Task', taskSchema);
export default Task;
