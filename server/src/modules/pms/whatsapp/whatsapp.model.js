import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * WhatsApp notification data.
 *
 * Four collections, one job each:
 *
 *   WhatsappTemplate  what the provider will accept (a mirror, refreshed by sync)
 *   WhatsappEventMap  which ERP event uses which template, and with what values
 *   WhatsappLog       what was actually sent, and whether it arrived
 *   WhatsappSetting   the switches — one document per company
 *
 * Background, including why templates are mandatory and why "sent" is not
 * "delivered": docs/WHATSAPP_SETTINGS_SPEC.md
 */

/* ------------------------------------------------------------------ */
/* Templates — a local mirror of what SmartWhap has approved           */
/* ------------------------------------------------------------------ */

/**
 * Never authored here. WhatsApp templates are written and approved on the
 * provider's dashboard (their API exposes no create endpoint), so this
 * collection is a cache refreshed by sync — plus the few fields that are ours
 * alone: `description` and `isActive`.
 */
const templateSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    language: { type: String, required: true, trim: true, default: 'en' },
    category: {
      type: String,
      enum: ['UTILITY', 'AUTHENTICATION', 'MARKETING', 'UNKNOWN'],
      default: 'UNKNOWN',
      index: true,
    },
    status: {
      type: String,
      // DRAFT and REMOVED are ours, not the provider's. DRAFT is a template
      // composed here but not yet on SmartWhap (their API cannot create one),
      // so it is something to paste into their dashboard — never something to
      // send with. REMOVED marks one that disappeared upstream; it is never
      // deleted, because logs still point at it by name.
      enum: ['DRAFT', 'APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'REMOVED'],
      default: 'PENDING',
      index: true,
    },
    /** How many {{n}} the body carries. An event mapping must supply exactly
     *  this many values or the send fails at the provider. */
    variableCount: { type: Number, default: 0 },
    /** The approved text, kept so the UI can preview without a round trip. */
    bodyPreview: { type: String, default: '' },
    /** Ours: what this template is for, in the team's own words. */
    description: { type: String, trim: true, default: '' },
    /** Ours: lets an admin retire a template from the pickers without
     *  touching the provider. */
    isActive: { type: Boolean, default: true },
    /** Composed here: the sample values and footer the dashboard form needs.
     *  Only ever set on rows this app authored. */
    bodySampleValues: { type: [String], default: [] },
    footer: { type: String, default: '' },
    /** Who composed the draft, so the next person knows who to ask. */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    providerId: { type: String },
    lastSyncedAt: { type: Date },
  },
  { timestamps: true },
);

attachTenancy(templateSchema, { modelName: 'WhatsappTemplate' });

// A template is identified by name AND language: the same name exists once per
// language, and sending with the wrong one is rejected by WhatsApp.
//
// Scoped by company, and declared AFTER attachTenancy for a reason: that helper
// prefixes every non-unique index with `tenant` but deliberately leaves unique
// ones alone, because uniqueness-per-company is a decision each model has to
// make for itself. Here it is per company — two companies have separate
// SmartWhap accounts, so both may hold a template called pms_task_assigned.
// Left global, the first company to sync would block the second's.
templateSchema.index({ tenant: 1, name: 1, language: 1 }, { unique: true });

export const WhatsappTemplate = model('WhatsappTemplate', templateSchema);

/* ------------------------------------------------------------------ */
/* Event map — ERP event -> template + values                          */
/* ------------------------------------------------------------------ */

/**
 * The events a notification can be raised for. Adding a row here is how the
 * system grows to HRMS, Leave and Payroll — the sending machinery does not
 * change.
 */
export const WHATSAPP_EVENTS = Object.freeze({
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_REMINDER: 'TASK_REMINDER',
  TASK_OVERDUE: 'TASK_OVERDUE',
  TASK_COMPLETED: 'TASK_COMPLETED',
});

/** Who the message goes to, resolved at send time against the event's payload. */
export const RECIPIENT_RULES = Object.freeze(['assignee', 'manager', 'md', 'actor']);

/**
 * The ERP fields a template variable may be bound to. A closed list on purpose:
 * a free-text path is a typo waiting to render "undefined" into a message that
 * reaches a customer's phone.
 */
export const PARAM_SOURCES = Object.freeze([
  'recipient.name',
  'task.title',
  'task.phase',
  'task.property',
  'task.project',
  'task.dueDate',
  'task.status',
  'task.url',
  'task.completedBy',
  'task.completedOn',
  'alert.text',     // "2 days" / "due today" / "overdue by 3 days"
  'custom',         // literal text held in paramMapping[i].value
]);

const paramBindingSchema = new Schema(
  {
    /** Which {{n}} this fills — 1-based, matching WhatsApp's numbering. */
    position: { type: Number, required: true, min: 1, max: 10 },
    source: { type: String, enum: PARAM_SOURCES, required: true },
    /** Only read when source === 'custom'. */
    value: { type: String, default: '' },
  },
  { _id: false },
);

const eventMapSchema = new Schema(
  {
    // No `index: true` here — the unique index below already covers it, and
    // declaring both makes Mongoose warn about a duplicate.
    eventKey: {
      type: String,
      enum: Object.values(WHATSAPP_EVENTS),
      required: true,
    },
    templateName: { type: String, required: true, trim: true },
    language: { type: String, required: true, default: 'en' },
    paramMapping: { type: [paramBindingSchema], default: [] },
    recipientRule: { type: String, enum: RECIPIENT_RULES, default: 'assignee' },
    isEnabled: { type: Boolean, default: false },
    /** Days before the due date a TASK_REMINDER goes out. Ignored by events
     *  that are not scheduled. */
    leadTimeDays: { type: Number, default: 1, min: 0, max: 30 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

attachTenancy(eventMapSchema, { modelName: 'WhatsappEventMap' });

// One mapping per event, per company. Two rows for TASK_ASSIGNED would mean two
// messages for one task and nobody would work out why. Declared after
// attachTenancy and scoped by tenant — see the note on the template index.
eventMapSchema.index({ tenant: 1, eventKey: 1 }, { unique: true });

export const WhatsappEventMap = model('WhatsappEventMap', eventMapSchema);

/* ------------------------------------------------------------------ */
/* Log — what was sent, and what became of it                          */
/* ------------------------------------------------------------------ */

/**
 * The answer to "was the doer actually told?".
 *
 * `status` starts at `queued`, becomes `sent` when the provider accepts it,
 * and only later becomes `delivered` or `failed` — WhatsApp decides delivery
 * separately from acceptance. Nothing may report a notification as received on
 * the strength of a send.
 */
const logSchema = new Schema(
  {
    eventKey: { type: String, index: true },
    templateName: { type: String },
    language: { type: String },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    phone: { type: String },
    params: { type: [String], default: [] },
    /** What this message was about — lets the sender skip a duplicate and the
     *  UI link back to the work. */
    task: { type: Schema.Types.ObjectId, ref: 'Task', index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project' },

    messageId: { type: String },      // wamid, the WhatsApp id
    chatMessageId: { type: Number },  // the provider's row id — needed to read status
    chatId: { type: Number },

    status: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'],
      default: 'queued',
      index: true,
    },
    /** The provider's own wording on failure, e.g. "more than 24 hours have
     *  passed since the customer last replied to this number." Kept verbatim:
     *  paraphrasing it has cost hours of debugging before. */
    statusMessage: { type: String },
    error: { type: Schema.Types.Mixed },
    retryCount: { type: Number, default: 0 },
    /** True when test mode redirected this away from the real recipient. */
    redirected: { type: Boolean, default: false },
    /** Who pressed the button, when this came from the test panel. */
    triggeredBy: { type: Schema.Types.ObjectId, ref: 'User' },

    sentAt: { type: Date },
    deliveredAt: { type: Date },
  },
  { timestamps: true },
);

logSchema.index({ createdAt: -1 });
// The duplicate guard: one message per task per event per day. A job that runs
// twice must not message the same person twice.
logSchema.index({ task: 1, eventKey: 1, createdAt: -1 });
// Feeds the status-refresh sweep, which only looks at messages still in flight.
logSchema.index({ status: 1, createdAt: -1 });

attachTenancy(logSchema, { modelName: 'WhatsappLog' });

export const WhatsappLog = model('WhatsappLog', logSchema);

/* ------------------------------------------------------------------ */
/* Settings — one document per company                                 */
/* ------------------------------------------------------------------ */

/**
 * Runtime switches, editable by the MD without a deploy.
 *
 * These can only ever NARROW what the environment allows: with
 * WHATSAPP_ENABLED=false or no token, nothing is sent whatever this says.
 */
const settingSchema = new Schema(
  {
    isEnabled: { type: Boolean, default: false },
    /** No messages between these hours (24h clock, server time). A task
     *  assigned at 23:00 should not wake anybody up. */
    quietHoursStart: { type: Number, default: 21, min: 0, max: 23 },
    quietHoursEnd: { type: Number, default: 8, min: 0, max: 23 },
    /** The blunt protection against annoying people into blocking the number,
     *  which is how a WhatsApp business number dies. */
    maxMessagesPerUserPerDay: { type: Number, default: 6, min: 1, max: 50 },
    /** Overdue days after which the manager is copied in. */
    escalateAfterDays: { type: Number, default: 3, min: 1, max: 30 },
    /** Base for the {{n}} task link. Kept in the database, not the template,
     *  so the domain can change without re-approval by Meta. */
    taskLinkBaseUrl: { type: String, default: '' },
    lastSyncedAt: { type: Date },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

attachTenancy(settingSchema, { modelName: 'WhatsappSetting' });

export const WhatsappSetting = model('WhatsappSetting', settingSchema);

export default {
  WhatsappTemplate,
  WhatsappEventMap,
  WhatsappLog,
  WhatsappSetting,
  WHATSAPP_EVENTS,
  RECIPIENT_RULES,
  PARAM_SOURCES,
};
