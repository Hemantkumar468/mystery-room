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
    /**
     * Number fields: keep this field equal to the number of values chosen in
     * the named multiselect (e.g. game_count counts selected_games). Purely
     * data-driven — the form watches the named field and updates this one; the
     * user can still overtype it.
     */
    countOf: { type: String },
    // Keys whose product fills this field (the BOQ's Amount ← quantity × rate).
    // Sibling of countOf above: both are derived values the form recomputes and
    // the user may still type over. An array, not a pair, so a three-factor
    // total needs no new key.
    productOf: [{ type: String }],
    // For a select fed by optionsFromStage: `{ targetFieldKey: sourceFieldKey }`
    // — picking an option copies the source record's mapped values into this
    // form (Phase 6's 'Item from BOQ' filling vendor/items/quantity/rate/value
    // from the chosen Phase 5 line). Values stay editable after the fill.
    fillFrom: { type: Map, of: String },
    /**
     * Textarea fields: show the small AI helper (Suggest a draft / Improve
     * what's written). Opt-in per field, because the helper only earns its
     * space where free-text judgement is being asked for.
     */
    aiAssist: { type: Boolean },
    /**
     * Select fields: options come from another stage's records instead of a
     * static list — `{ stageKey: 'p12', field: 'vendor_name' }` makes the BOQ's
     * Vendor a dropdown over the live vendor master. Data captured once is
     * picked, never retyped — and an exact name is what lets downstream
     * lookups (the purchase-order page's vendor match) work every time.
     * Wrapped with `default: undefined` so Mongoose doesn't auto-vivify an
     * empty subdocument on fields that never declare it.
     */
    optionsFromStage: {
      type: new Schema({
        stageKey: { type: String },
        field: { type: String },
        // 'project' (default) reads only this project's records; 'global'
        // reads the stage across every project, for company-wide masters
        // such as the vendor list.
        scope: { type: String, enum: ['project', 'global'], default: 'project' },
      }, { _id: false }),
      default: undefined,
    },
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

    /**
     * The task's ONE approval, decided at template design time.
     *
     * `required: false` — completing the task IS the end of it: no queue, no
     *   second person. For tasks that are themselves a decision ("Approve the
     *   project plan"), demanding an approval of the approval was exactly the
     *   approval-on-approval loop that made the flow exhausting.
     * `approver` — plain-language name of who signs it off ("MD",
     *   "Operations Head"), shown wherever the task waits. Display guidance;
     *   enforcement stays the existing capability check, so a template typo
     *   can never lock a task against everyone.
     */
    approval: {
      required: { type: Boolean, default: true },
      approver: { type: String },
    },

    /**
     * The four management questions at the level the DOER sees them.
     *
     * The stage carries the phase-level table; this is the same four questions
     * for one person's own assignment, which is what actually opens from My
     * Tasks. "Do the feasibility assessment — you, 2 days, on the feasibility
     * form" is the whole job description, and it has to travel with the task
     * rather than being looked up from the phase and mentally narrowed.
     */
    brief: {
      what: { type: String },
      who: { type: String },
      when: { type: String },
      how: { type: String },
    },

    /**
     * Which form this task opens — an `assessmentTypes[].key` on the task's own
     * stage (e.g. 'feasibility'), or unset when the stage has a single form.
     *
     * This is what makes a task actionable instead of merely descriptive: the
     * doer clicks their task and lands on the form they are meant to fill, not
     * on a phase page they then have to navigate.
     */
    formKey: { type: String },
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

    /**
     * The four management questions, per step of this phase — the spine of the
     * client's functional flow document, which prints a What/Who/When/How table
     * for every single phase.
     *
     * Stored as data rather than prose so the SAME rows render on the phase
     * page, in the MD's master flow view, and in the doer's task list, instead
     * of each screen re-describing the phase in its own words and drifting.
     * A phase with no rows renders no strip — never a placeholder.
     */
    whatWhoWhenHow: [
      new Schema(
        {
          what: { type: String, required: true }, // the step
          who: { type: String, required: true }, // role responsible, in plain language
          when: { type: String, required: true }, // timeline as the business states it
          how: { type: String, required: true }, // method — form, upload, visit, approval
        },
        { _id: false },
      ),
    ],

    /**
     * Phases sharing a `parallelGroup` run simultaneously rather than queueing.
     * The client's flow branches in two places — drawings ‖ vendor identification,
     * and procurement ‖ civil works — because the rent-free fit-out period is the
     * working window and waiting would burn it. Null means "runs on its own".
     */
    parallelGroup: { type: String },

    /**
     * A hard approval gate at the END of this phase. The client's flowchart marks
     * exactly three (after Site Evaluation, Commercial Closure and Readiness).
     * Absent on every other phase — approvals elsewhere are ordinary task sign-offs.
     */
    gate: {
      label: { type: String }, // e.g. "Gate 2 — LOI Approved"
      approver: { type: String }, // plain language, e.g. "MD"
      unlocks: { type: String }, // what clearing it releases
    },

    /** Plain-language definition of done, straight from the flow document. */
    exitCriteria: { type: String },

    requiresApproval: { type: Boolean, default: false },
    approverRoles: [{ type: String }],
    /**
     * Set on a stage to exclude it from a template's `autoAssignTasks` cascade
     * while still auto-generating every other phase — for a stage whose work
     * genuinely cannot be known up front. Nothing uses it yet; it exists so the
     * cascade has an escape hatch that isn't "turn it off for the whole template".
     */
    manualTasksOnly: { type: Boolean, default: false },
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

    /**
     * Run the template as a plan: creating a project from it immediately
     * generates every task in every phase, with its owner, buddy, lead time and
     * checklist already set — so nobody hand-allocates work that the template
     * already describes.
     *
     * OFF by default, deliberately. Project creation used to cascade tasks for
     * every template and was changed so tasks only exist because a person
     * allocated one (see materializeFromTemplate). Flipping that back globally
     * would suddenly generate hundreds of tasks on every project made from the
     * existing playbooks. Opting in per template lets the client-flow template
     * behave as the client specified while the older ones keep their current
     * behaviour unchanged.
     */
    autoAssignTasks: { type: Boolean, default: false },

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
