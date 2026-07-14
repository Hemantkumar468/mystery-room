import mongoose from 'mongoose';
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

const commentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** A file uploaded to Cloudinary. `publicId` is kept so it can be deleted later. */
const attachmentSchema = new Schema(
  {
    url: { type: String, required: true }, // Cloudinary secure_url
    publicId: { type: String, required: true }, // Cloudinary public_id (for destroy)
    resourceType: { type: String, default: 'image' }, // image | video | raw
    originalName: { type: String },
    mimetype: { type: String },
    bytes: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
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

    status: { type: String, enum: TASK_STATUS_VALUES, default: TASK_STATUS.TODO, index: true },
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM, index: true },
    department: { type: String, enum: DEPARTMENT_VALUES },

    assignee: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignees: [{ type: String }],
    primaryAssignee: { type: String },
    backupAssignee: { type: String },
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

    dependencies: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    checklist: [checklistItemSchema],
    comments: [commentSchema],
    attachments: [attachmentSchema],

    // Set when the task is completed — snapshots on-time performance for MIS.
    completedOnTime: { type: Boolean },

    order: { type: Number, default: 0 },
    tags: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ assignee: 1, status: 1 });

/** Live overdue flag — never persisted, always current. */
taskSchema.virtual('isOverdue').get(function () {
  return this.status !== TASK_STATUS.DONE && this.plannedEnd && this.plannedEnd < new Date();
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

export const Task = model('Task', taskSchema);
export default Task;
