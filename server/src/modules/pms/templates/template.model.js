import mongoose from 'mongoose';
import {
  TEMPLATE_STATUS,
  PRIORITY,
  PRIORITY_VALUES,
  DEPARTMENT_VALUES,
  MASTER_DATA_FIELD_TYPES,
  STAGE_CAPTURE_MODE,
  STAGE_CAPTURE_MODE_VALUES,
} from '../../../core/constants/index.js';

const { Schema } = mongoose;

/** A field the template designer requires to be captured at a given stage. */
const masterDataFieldSchema = new Schema(
  {
    key: { type: String, required: true }, // stable machine key, e.g. "carpet_area"
    label: { type: String, default: '' }, // human label — blank renders the field with no visible label
    type: {
      type: String,
      enum: Object.values(MASTER_DATA_FIELD_TYPES),
      default: MASTER_DATA_FIELD_TYPES.TEXT,
    },
    required: { type: Boolean, default: false },
    options: [{ type: String }], // for select / multiselect
    placeholder: { type: String },
    helpText: { type: String },
    section: { type: String }, // groups fields under a header in collection forms
    multiple: { type: Boolean }, // file fields: allow multiple uploads
    accept: { type: String }, // file fields: accept filter, e.g. "image/*"
    min: { type: Number }, // number fields: lowest allowed value, e.g. a /10 score field's 0
    max: { type: Number }, // number fields: highest allowed value, e.g. a /10 score field's 10
    recordAudio: { type: Boolean }, // file fields: capture via microphone instead of a file picker
    // Conditional display: only shown when `values[showIf.field]` is one of
    // `showIf.in` — drives the Commercial Information type-specific fields
    // without any hardcoded per-type logic in the frontend. Wrapped in its own
    // Schema with `default: undefined` so Mongoose doesn't auto-vivify an
    // empty `{ in: [] }` subdocument (its usual behavior for any nested path
    // containing an array) for fields that never declare a `showIf`.
    showIf: {
      type: new Schema(
        {
          field: { type: String },
          in: [{ type: String }],
        },
        { _id: false },
      ),
      default: undefined,
    },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * One assessment form nested under a stage (e.g. Feasibility/Financial under
 * Site Evaluation) — each carries its own independent masterDataSchema, so a
 * single stage can host several unrelated dynamic forms without becoming
 * several top-level stages in the Stage Stepper/SLA tracking.
 */
const assessmentTypeSchema = new Schema(
  {
    key: { type: String, required: true }, // stable machine key, e.g. "feasibility"
    name: { type: String, required: true }, // human label, e.g. "Feasibility Assessment"
    subtitle: { type: String }, // optional short description shown under the name on its card
    masterDataSchema: [masterDataFieldSchema],
    // Names a `select` field in this type's own masterDataSchema (e.g. "noc_type")
    // when a single record type actually tracks several required sub-items
    // (Commercial Finalization's NOC Management: one record per NOC type;
    // Commercial Approvals: one record per approval level). When set, that
    // field's `options` become the required checklist — the type only counts
    // as fully approved once every option has its own Approved record (see
    // approvedTypeCount in recordUi.js). Unset for every ordinary
    // one-record-per-type assessment, which keeps its existing "at least one
    // Approved record" rule.
    subKeyField: { type: String },
  },
  { _id: false },
);

/** A single tick-box under a task. `required` rows must be ticked before the task can be done. */
const checklistItemSchema = new Schema(
  {
    label: { type: String, required: true },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
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
    /**
     * Which readiness module this blueprint task belongs to (Store Readiness
     * groups its checklist by category: construction, utilities, it_systems…).
     * Without this field Mongoose silently dropped the value on save, so the
     * stored template lost the very grouping the p8 gate and dashboard need —
     * which is why the category list had to be duplicated in client code.
     */
    taskCategory: { type: String, trim: true },
    estimatedDays: { type: Number, default: 1, min: 0 }, // planned working days
    priority: { type: String, enum: PRIORITY_VALUES, default: PRIORITY.MEDIUM },
    assignees: [{ type: String }], // employee IDs from the mock/HRMS roster
    primaryAssignee: { type: String },
    backupAssignee: { type: String },
    /** True when primary was marked unavailable at template design time — used to flag tasks at project instantiation. */
    primaryAssigneeUnavailable: { type: Boolean, default: false },
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
    // Independent dynamic forms nested under this one stage (e.g. Site
    // Evaluation's Feasibility/Financial/Technical/Operational assessments).
    // Each Record for this stage then carries an `assessmentType` key naming
    // which of these it answers, plus `parentRecordId` linking it back to the
    // record (e.g. a shortlisted property) it assesses.
    assessmentTypes: [assessmentTypeSchema],
    // 'single' = one record per project (default); 'collection' = many Record rows.
    captureMode: {
      type: String,
      enum: STAGE_CAPTURE_MODE_VALUES,
      default: STAGE_CAPTURE_MODE.SINGLE,
    },
    recordNoun: { type: String, default: 'Record' }, // UI label, e.g. "Property"
    requiresApproval: { type: Boolean, default: false },
    approverRoles: [{ type: String }],
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
    /**
     * Exactly one template may carry this flag. It is the playbook a new project
     * starts from unless the creator picks another. Enforced in templateService.
     */
    isDefault: { type: Boolean, default: false, index: true },
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

templateSchema.virtual('totalChecklistItems').get(function () {
  return (
    this.stages?.reduce(
      (sum, s) => sum + (s.tasks?.reduce((n, t) => n + (t.checklist?.length || 0), 0) || 0),
      0,
    ) || 0
  );
});

/** Rough end-to-end duration = sum of stage SLAs (stages assumed sequential). */
templateSchema.virtual('estimatedDurationDays').get(function () {
  return this.stages?.reduce((sum, s) => sum + (s.slaDays || 0), 0) || 0;
});

export const Template = mongoose.model('Template', templateSchema);
export default Template;
