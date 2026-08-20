import mongoose from 'mongoose';
import {
  LEAD_SOURCE, LEAD_SOURCE_VALUES, LEAD_STATUS, LEAD_STATUS_VALUES,
} from '../crm.constants.js';

const { Schema, model } = mongoose;

/**
 * An enquiry — someone who asked about a franchise, from any of the four
 * intake paths (web form, Meta ads, LinkedIn, manual entry).
 *
 * A lead is an EVENT: it arrives, it is worked, and it ends exactly once as
 * converted or disqualified. The person behind it is a Contact and the money
 * is a Deal, both of which outlive this record. That separation is why the
 * same person enquiring twice does not overwrite their own history.
 *
 * INTAKE INVARIANT: every lead reaches this collection through
 * intake/leadIntake.service.js, never through a direct `Lead.create()` from a
 * controller. Dedupe, phone normalisation and routing all live in that one
 * function, and a second creation path is how a lead ends up unassigned, or
 * duplicated, or with a phone number nothing can match against later.
 */
const leadSchema = new Schema(
  {
    /* ── Who ────────────────────────────────────────────── */
    name: { type: String, required: true, trim: true, maxlength: 120 },

    /**
     * E.164, normalised on the way in (`+919876543210`).
     *
     * Stored in ONE canonical form because it is the primary duplicate key.
     * "98765 43210", "+91 98765-43210" and "09876543210" are the same customer,
     * and a raw-string column makes that undetectable — which shows up as the
     * same person being called by three agents.
     */
    phone: { type: String, trim: true, index: true },
    /** Exactly what the customer typed, kept for display and for arguments
     *  about whether normalisation got it wrong. */
    phoneRaw: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, index: true },

    /**
     * Asked not to be contacted.
     *
     * A COMPLIANCE FACT, not a preference — checked before any call is placed
     * and refused rather than warned about.
     *
     * It lives on the lead as well as the contact because most people who say
     * "don't call me" say it while they are still an enquiry: they never
     * become a contact, so a flag that only existed there would be a flag that
     * never protected anybody. It was missing here at first, and the effect
     * was silent — the check read `undefined` and every call went through.
     */
    doNotDisturb: { type: Boolean, default: false },

    company: { type: String, trim: true, maxlength: 160 },
    designation: { type: String, trim: true, maxlength: 120 },

    /* ── Where ──────────────────────────────────────────── */
    city: { type: String, trim: true, maxlength: 80, index: true },
    region: { type: String, trim: true, maxlength: 80 },
    country: { type: String, trim: true, maxlength: 80, default: 'India' },

    /* ── What they want ─────────────────────────────────── */
    message: { type: String, maxlength: 4000 },
    productInterest: { type: String, trim: true, maxlength: 120 },
    /** What the enquirer says they can invest, in INR. An input to routing
     *  (above ₹5L goes to the enterprise team), not a commitment. */
    estimatedValue: { type: Number, min: 0 },
    segment: { type: String, trim: true, maxlength: 60, index: true },
    language: { type: String, trim: true, maxlength: 40 },

    /* ── Where it came from ─────────────────────────────── */
    source: {
      type: String, enum: LEAD_SOURCE_VALUES, default: LEAD_SOURCE.MANUAL, index: true,
    },
    /** The campaign, ad set, form name or referrer — unbounded by design, so
     *  it is free text rather than a second enum nobody can extend at 2 AM. */
    sourceDetail: { type: String, trim: true, maxlength: 200 },

    /**
     * Campaign attribution.
     *
     * Captured at intake and never recomputed. Without these the Source ROI
     * report has nothing to group by, and "which ads actually produced revenue"
     * stays unanswerable — which is the single question ad budget depends on.
     */
    utm: {
      source: { type: String, trim: true, maxlength: 120 },
      medium: { type: String, trim: true, maxlength: 120 },
      campaign: { type: String, trim: true, maxlength: 160 },
      term: { type: String, trim: true, maxlength: 160 },
      content: { type: String, trim: true, maxlength: 160 },
    },

    /** Which form or integration produced it, for killing one leaking source
     *  without touching the others. */
    formId: { type: String, trim: true, maxlength: 80, index: true },

    /**
     * The provider's own id for this submission (Meta's `leadgen_id`,
     * LinkedIn's submission id).
     *
     * Unique when present, which is what makes webhook delivery idempotent:
     * Meta retries on any non-2xx, and without this a slow response produces
     * two identical leads assigned to two different agents.
     */
    externalId: { type: String, trim: true, index: true, unique: true, sparse: true },

    /* ── Working state ──────────────────────────────────── */
    status: {
      type: String, enum: LEAD_STATUS_VALUES, default: LEAD_STATUS.NEW, index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** Which rule assigned it, so "why did I get this lead" has an answer. */
    routedBy: { type: String, trim: true, maxlength: 120 },
    assignedAt: { type: Date },

    /**
     * First human contact. Stamped once, never overwritten.
     *
     * `assignedAt → firstActivityAt` IS the response-time metric, and response
     * time predicts conversion better than almost anything else the CRM
     * measures. It is a stored field rather than a derived one so the
     * leaderboard does not have to scan the activity timeline per agent.
     */
    firstActivityAt: { type: Date },
    lastActivityAt: { type: Date, index: true },

    /** Set when the lead becomes a real relationship. Never cleared. */
    contact: { type: Schema.Types.ObjectId, ref: 'Contact', index: true },
    convertedAt: { type: Date },
    disqualifiedReason: { type: String, trim: true, maxlength: 200 },

    /**
     * Re-enquiries, when this lead was matched as a duplicate of an earlier one.
     *
     * A repeat enquiry is a buying signal. Splitting it into a second lead
     * hides that signal in exactly the moment it matters most, so the count
     * lives on the original record and the detail goes on its timeline.
     */
    reEnquiryCount: { type: Number, default: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/** "My open leads, newest first" — the agent's list view, and the stale-lead
 *  sweep's query. One compound index serves both. */
leadSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
/** The stale-reassign job: leads still `new` with nothing done to them. */
leadSchema.index({ status: 1, lastActivityAt: 1 });

export const Lead = model('Lead', leadSchema);
export default Lead;
