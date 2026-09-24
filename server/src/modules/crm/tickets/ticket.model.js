import mongoose from 'mongoose';
import {
  TICKET_STATUS, TICKET_STATUS_VALUES, TICKET_PRIORITY, TICKET_PRIORITY_VALUES,
  TICKET_SOURCE_VALUES, ENTITY_TYPE_VALUES,
} from '../crm.constants.js';
import { DEFAULT_CALENDAR } from './businessHours.js';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { attachAudit } from '../../../core/audit/audit.js';

const { Schema, model } = mongoose;

/**
 * The SLA policy — targets, and the working week they are measured against.
 *
 * A DOCUMENT, NOT AN ENUM, for the same reason pipeline stages are: "urgent
 * means one hour" is a decision the business changes, and shipping a code
 * change to alter it means it never gets altered. The calendar lives on the
 * policy rather than in config because a support desk and a sales desk can
 * legitimately keep different hours.
 *
 * TARGETS ARE IN WORKING MINUTES. See businessHours.js for why that is not the
 * same as minutes.
 */
const slaTargetSchema = new Schema({
  priority: { type: String, enum: TICKET_PRIORITY_VALUES, required: true },
  firstResponseMinutes: { type: Number, required: true, min: 0 },
  resolutionMinutes: { type: Number, required: true, min: 0 },
}, { _id: false });

const slaPolicySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    isDefault: { type: Boolean, default: false, index: true },
    targets: { type: [slaTargetSchema], default: [] },

    /** The working week these targets are counted against. */
    calendar: {
      timezone: { type: String, default: DEFAULT_CALENDAR.timezone },
      workDays: { type: [Number], default: () => [...DEFAULT_CALENDAR.workDays] },
      startMinute: { type: Number, default: DEFAULT_CALENDAR.startMinute },
      endMinute: { type: Number, default: DEFAULT_CALENDAR.endMinute },
      /** ISO dates, in the calendar's own zone. Diwali is not a breach. */
      holidays: { type: [String], default: [] },
    },
  },
  { timestamps: true, collection: 'crm_sla_policies' },
);

attachTenancy(slaPolicySchema, { modelName: 'SlaPolicy' });

export const SlaPolicy = model('SlaPolicy', slaPolicySchema);

/**
 * A customer problem, with a clock on it.
 *
 * SEPARATE FROM TASKS. A task is something one person owes; a ticket is
 * something the COMPANY owes a customer, it outlives whoever is holding it,
 * and it is measured. Modelling one as the other loses the measurement.
 *
 * THE CLOCK IS STORED, NOT COMPUTED AT READ TIME. `dueFirstResponseAt` and
 * `dueResolutionAt` are written when the ticket is created or re-prioritised,
 * because a list of two thousand tickets cannot recompute a business-hours
 * deadline per row per request, and because a target that silently changes
 * under a ticket makes "was this breached?" unanswerable after the fact. When
 * a policy is edited, existing tickets keep the deadline they were given.
 */
const ticketSchema = new Schema(
  {
    /** Human-readable, because people say it out loud on the phone. */
    number: { type: String, unique: true, index: true },

    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 8000 },

    status: {
      type: String, enum: TICKET_STATUS_VALUES, default: TICKET_STATUS.OPEN, index: true,
    },
    priority: {
      type: String, enum: TICKET_PRIORITY_VALUES, default: TICKET_PRIORITY.NORMAL, index: true,
    },
    category: { type: String, trim: true, maxlength: 60 },
    source: { type: String, enum: TICKET_SOURCE_VALUES, default: 'manual' },

    /** Who raised it, and what it hangs off. Polymorphic like activities: a
     *  ticket can belong to a contact, a company, or a live lead. */
    requester: { type: Schema.Types.ObjectId, ref: 'Contact', index: true },
    entityType: { type: String, enum: ENTITY_TYPE_VALUES },
    entityId: { type: Schema.Types.ObjectId },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },

    /* ── The clock ──────────────────────────────────────── */
    slaPolicy: { type: Schema.Types.ObjectId, ref: 'SlaPolicy' },
    dueFirstResponseAt: { type: Date, index: true },
    dueResolutionAt: { type: Date, index: true },

    /** When somebody first answered the CUSTOMER. Not when the ticket was
     *  opened, assigned, or read — an internal note is not a response, and
     *  counting it as one is how a desk reports 100% and still has angry
     *  customers. */
    firstRespondedAt: { type: Date },
    resolvedAt: { type: Date },
    closedAt: { type: Date },

    /**
     * Breaches, RECORDED rather than derived.
     *
     * Stamped by the sweep when a deadline passes. Derived at read time it
     * would silently rewrite history the moment anyone edited a policy or a
     * holiday list, and "we breached 4% last quarter" has to stay true.
     */
    firstResponseBreached: { type: Boolean, default: false, index: true },
    resolutionBreached: { type: Boolean, default: false, index: true },
    /** Working minutes actually taken — filled in when each milestone lands. */
    firstResponseMinutes: { type: Number },
    resolutionMinutes: { type: Number },

    /**
     * Time the clock was legitimately stopped, in working minutes.
     *
     * `pending` means waiting on the customer. Counting that against the desk
     * is how a team learns to never ask the customer a question, which is
     * worse service, not better.
     */
    pendingMinutes: { type: Number, default: 0 },
    pendingSince: { type: Date },

    /* ── Escalation ─────────────────────────────────────── */

    /**
     * How far up the ladder this ticket has been pushed. 0 = nobody told.
     *
     * Stored as the HIGHEST rung reached, and never lowered. A ticket that hit
     * 150% and was then answered does not become un-escalated: somebody was
     * pulled in, and the record of that is the point.
     */
    escalationLevel: { type: Number, default: 0, index: true },
    escalatedAt: { type: Date },
    /** Each rung, once. Kept so "who was told, and when" survives the ticket
     *  being resolved — which is when people start asking. */
    escalationHistory: [{
      level: { type: Number },
      atPercent: { type: Number },
      audience: { type: String },
      notified: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      at: { type: Date, default: Date.now },
      _id: false,
    }],

    /** When the pre-breach warning went out. Once per ticket — a warning that
     *  repeats every five minutes is an alert people mute. */
    warnedAt: { type: Date },

    /* ── CSAT ───────────────────────────────────────────── */

    /**
     * What the customer thought, asked once the ticket is resolved.
     *
     * ONE TAP. The rating IS the link they click in the resolution email, so
     * answering costs nothing — a form behind a login gets response rates in
     * the low single digits, and a CSAT nobody answers is worse than none
     * because the few who do answer are the angriest.
     */
    csat: {
      score: { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 1000 },
      ratedAt: { type: Date },
      askedAt: { type: Date },
    },
    /** The unguessable half of the rating link. Random, not derived from the
     *  ticket — a guessable one lets anybody score anybody's ticket. */
    csatToken: { type: String, trim: true, index: true, sparse: true },

    reopenCount: { type: Number, default: 0 },
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: 'crm_tickets' },
);

/** The desk's own list: my open tickets, most urgent deadline first. */
ticketSchema.index({ assignedTo: 1, status: 1, dueResolutionAt: 1 });
/** The breach sweep: anything still open with a deadline behind it. */
ticketSchema.index({ status: 1, firstResponseBreached: 1, dueFirstResponseAt: 1 });

/* Who changed what, and what it was before — see core/audit/audit.js. The
 * previous value is the half that matters: the new one is already in the
 * record, the old one is destroyed by the write. */
attachAudit(ticketSchema, { modelName: 'Ticket', label: 'subject' });
attachTenancy(ticketSchema, { modelName: 'Ticket' });

export const Ticket = model('Ticket', ticketSchema);
export default Ticket;
