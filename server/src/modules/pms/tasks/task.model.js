import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import {
  TASK_STATUS,
  TASK_STATUS_VALUES,
  TASK_APPROVAL,
  TASK_APPROVAL_VALUES,
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
    openPhaseOnly: { type: Boolean }, // see template.model.js

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

    /* Three values, set by a person. See TASK_STATUS. */
    status: { type: String, enum: TASK_STATUS_VALUES, default: TASK_STATUS.PENDING, required: true, index: true },

    /* Sign-off, on its own axis — a task can be complete and unsigned. Only
       the submit/decide endpoints write this; the generic PATCH cannot.

       NAMED `approvalState`, NOT `approval`: `approval` above is already taken
       by the template's approval RULE ({ required, approver }). Two fields of
       the same name in one Mongoose schema is not an error — the second simply
       wins, and the template rule would have vanished with nothing logged. */
    approvalState: { type: String, enum: TASK_APPROVAL_VALUES, default: TASK_APPROVAL.NONE, index: true },

    /* The deadline, as a DATETIME — a deadline at 6pm is the same kind of
       fact as a meeting at 6pm, and a date-only field made "due today" mean
       something different to everyone who read it. */
    dueAt: { type: Date, default: null, index: true },

    /* System fields: written by the state change, never by a form. Both are
       on the system-field denylist so the renderer cannot expose them. */
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    /* Optional depth. A task may hang under another task in the same phase;
       the tree renders it one level in. Null for almost every task. */
    parentTaskRef: { type: Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    /* The ONE record this task is about. A Phase 2 assessment task is for one
       shortlisted property (projectService.syncAssessmentTasks), so it opens that
       property directly. Null on every task that covers its phase as a whole. */
    subjectRecord: { type: Schema.Types.ObjectId, ref: 'Record', default: null, index: true },
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

/**
 * THE SAME BLIND SPOT ON TASKS. The property queue loads the tasks for a
 * STAGE across many projects at once ({ stageKey, project: { $in: [...] } })
 * and the per-property assessment tasks by subject ({ stageKey, subjectRecord:
 * { $in: [...] } }). Every index above leads with `project` or `assignee`, so
 * the $in form could not use one and four scans of `tasks` ran on every load
 * of the queue.
 */
taskSchema.index({ stageKey: 1, project: 1 });
taskSchema.index({ stageKey: 1, subjectRecord: 1 });
// One assessment task per property per assessment — a second sync racing the
// first cannot give a property two Feasibility tasks.
taskSchema.index(
  { project: 1, templateTaskKey: 1, subjectRecord: 1 },
  { unique: true, partialFilterExpression: { subjectRecord: { $type: 'objectId' } } },
);
/**
 * Overdue is a DATE question, not a state question.
 *
 * The old version excluded five "delivered" statuses, because a delivered
 * task sat in the approval pipeline and would otherwise have read as late
 * forever. With sign-off on its own field there is one thing to ask: is it
 * finished, and is the deadline behind us. A `pending` task past its date IS
 * overdue — the clock goes red and the state is untouched.
 */
taskSchema.virtual('isOverdue').get(function () {
  if (this.status === TASK_STATUS.COMPLETE) return false;
  const due = this.dueAt || this.plannedEnd;
  return Boolean(due) && due < new Date();
});

taskSchema.virtual('checklistProgress').get(function () {
  const total = this.checklist?.length || 0;
  if (!total) return null;
  const done = this.checklist.filter((c) => c.done).length;
  return Math.round((done / total) * 100);
});

/**
 * Stamp the system dates from the state change.
 *
 * `startedAt` is set once and never cleared — it records that work began,
 * and a task pushed back to pending did still begin. `completedAt` IS
 * cleared when a task leaves `complete`: "when was it finished" has no
 * answer while it is unfinished, and a stale value quietly poisons every
 * duration report that reads it.
 */
taskSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    const now = new Date();
    if (this.status === TASK_STATUS.PROCESSING && !this.startedAt) this.startedAt = now;
    if (this.status === TASK_STATUS.COMPLETE) {
      this.startedAt = this.startedAt || now;
      this.completedAt = this.completedAt || now;
      const due = this.dueAt || this.plannedEnd;
      this.completedOnTime = due ? this.completedAt <= due : true;
    } else {
      this.completedAt = null;
      this.completedOnTime = undefined;
    }
  }
  next();
});

attachTenancy(taskSchema, { modelName: 'Task' });

export const Task = model('Task', taskSchema);
export default Task;
