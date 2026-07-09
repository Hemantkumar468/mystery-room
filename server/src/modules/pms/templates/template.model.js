import mongoose from 'mongoose';
import {
  TEMPLATE_STATUS,
  PRIORITY,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
  MASTER_DATA_FIELD_TYPES,
} from '../../../core/constants/index.js';

const { Schema } = mongoose;

/** A field the template designer requires to be captured at a given stage. */
const masterDataFieldSchema = new Schema(
  {
    key: { type: String, required: true }, // stable machine key, e.g. "carpet_area"
    label: { type: String, required: true }, // human label
    type: {
      type: String,
      enum: Object.values(MASTER_DATA_FIELD_TYPES),
      default: MASTER_DATA_FIELD_TYPES.TEXT,
    },
    required: { type: Boolean, default: false },
    options: [{ type: String }], // for select / multiselect
    placeholder: { type: String },
    helpText: { type: String },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const checklistItemSchema = new Schema(
  { label: { type: String, required: true }, required: { type: Boolean, default: false } },
  { _id: false },
);

/** A blueprint task inside a stage. Instantiated into a real Task per project. */
const templateTaskSchema = new Schema(
  {
    key: { type: String, required: true }, // unique within the stage
    title: { type: String, required: true },
    description: { type: String },
    order: { type: Number, default: 0 },
    department: { type: String, enum: DEPARTMENT_VALUES },
    estimatedDays: { type: Number, default: 1, min: 0 }, // planned working days
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM },
    dependencies: [{ type: String }], // other task keys in this template
    checklist: [checklistItemSchema],
  },
  { _id: false },
);

/** An ordered phase of the project (Sourcing, Fit-out, HR…). */
const templateStageSchema = new Schema(
  {
    key: { type: String, required: true }, // unique within the template
    name: { type: String, required: true },
    description: { type: String },
    order: { type: Number, default: 0 },
    color: { type: String, default: '#6E45FF' },
    slaDays: { type: Number, default: 7, min: 0 }, // target duration for the stage
    ownerDepartment: { type: String, enum: DEPARTMENT_VALUES },
    tasks: [templateTaskSchema],
    masterDataSchema: [masterDataFieldSchema], // data required to complete the stage
  },
  { _id: false },
);

const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String },
    category: { type: String, default: 'Franchise Launch' },
    icon: { type: String, default: 'Rocket' }, // lucide icon name for the UI
    color: { type: String, default: '#6E45FF' },
    status: {
      type: String,
      enum: Object.values(TEMPLATE_STATUS),
      default: TEMPLATE_STATUS.DRAFT,
      index: true,
    },
    version: { type: Number, default: 1 },
    stages: [templateStageSchema],
    isDefault: { type: Boolean, default: false },
    tags: [{ type: String }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

templateSchema.virtual('totalStages').get(function () {
  return this.stages?.length || 0;
});

templateSchema.virtual('totalTasks').get(function () {
  return this.stages?.reduce((sum, s) => sum + (s.tasks?.length || 0), 0) || 0;
});

/** Rough end-to-end duration = sum of stage SLAs (stages assumed sequential). */
templateSchema.virtual('estimatedDurationDays').get(function () {
  return this.stages?.reduce((sum, s) => sum + (s.slaDays || 0), 0) || 0;
});

export const Template = mongoose.model('Template', templateSchema);
export default Template;
