import mongoose from 'mongoose';
import { LOST_REASON_VALUES } from '../crm.constants.js';

const { Schema, model } = mongoose;

/**
 * An opportunity being worked through a pipeline.
 *
 * The Lead is the enquiry; this is the money. They are separate because their
 * lifecycles are: a lead is qualified once and then done, while a deal moves
 * through stages, can be reopened, and can be one of several from the same
 * customer.
 */

/**
 * One stage transition, with how long the deal sat in the stage it left.
 *
 * THIS ARRAY IS THE MOST VALUABLE FIELD ON THE MODEL and the reason it is
 * written on every transition rather than derived later. `updatedAt` tells you
 * when a deal last moved; only this tells you it spent 21 days in Negotiation
 * when the median is 8. Sales velocity, bottleneck analysis, the forecast's
 * confidence and the stall detection the spec describes are all queries over
 * these rows — none of which can be reconstructed after the fact, because the
 * information simply was not recorded.
 *
 * `exitedAt` and `durationHours` are stamped on the PREVIOUS entry when the
 * next transition happens, so the open entry (the current stage) has both as
 * null. That is how "how long has this been sitting here" is answered without
 * a second field to keep in step.
 */
const stageHistorySchema = new Schema({
  stageId: { type: Schema.Types.ObjectId, required: true },
  stageName: {
    // Denormalised deliberately. A stage can be renamed or deleted from the
    // pipeline, and a history that then reads "unknown stage" loses exactly the
    // information it exists to keep.
    type: String, required: true, maxlength: 60,
  },
  enteredAt: { type: Date, required: true },
  exitedAt: { type: Date, default: null },
  /** Hours spent in this stage. Null while the deal is still in it. */
  durationHours: { type: Number, default: null },
  movedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { _id: false });

const dealSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },

    /** Which pipeline's rules this deal follows. Required — a deal with no
     *  pipeline has no stages, so it cannot be on any board. */
    pipeline: { type: Schema.Types.ObjectId, ref: 'Pipeline', required: true, index: true },
    /** The subdocument `_id` of a stage inside that pipeline. */
    stage: { type: Schema.Types.ObjectId, required: true, index: true },

    value: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: 'INR', maxlength: 3 },
    expectedCloseDate: { type: Date, index: true },

    /* ── Who ────────────────────────────────────────────── */
    lead: { type: Schema.Types.ObjectId, ref: 'Lead', index: true },
    contact: { type: Schema.Types.ObjectId, ref: 'Contact', index: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },

    /* ── Board position ─────────────────────────────────── */
    /**
     * Position within its column. GAPPED by 100s.
     *
     * Dropping a card between two others sets it to the midpoint of their two
     * orders — one write, whatever the column length. Sequential integers
     * would mean renumbering every card below the drop on every single drag,
     * which is 40 writes to move one card and a visible stall on the board.
     *
     * When two neighbours end up adjacent (a gap of 1), the column is
     * renormalised back to 100/200/300 — see dealService.
     */
    boardOrder: { type: Number, default: 0 },

    /* ── Movement ───────────────────────────────────────── */
    stageHistory: { type: [stageHistorySchema], default: [] },
    /** When the current stage was entered — a copy of the open history entry's
     *  `enteredAt`, kept flat so "days in stage" sorts and indexes without
     *  unwinding the array on every board load. */
    stageEnteredAt: { type: Date, index: true },

    /* ── Closing ────────────────────────────────────────── */
    /** Stamped by the service when the deal first reaches a terminal stage,
     *  cleared if it is reopened — so it always means "closed right now". */
    closedAt: { type: Date, index: true },
    /**
     * Why it was lost, from a fixed list.
     *
     * Mandatory on any move to a lost stage. Free text alone produces a report
     * nobody can act on — "customer said no" is not a reason, it is a summary
     * of the outcome. The fixed list is what makes "what is costing us deals"
     * answerable; `lostNotes` is where the specifics go.
     */
    lostReason: { type: String, enum: LOST_REASON_VALUES, default: undefined },
    lostNotes: { type: String, maxlength: 1000 },

    /**
     * Written by a seeder, not by a person.
     *
     * Demo deals are built from REAL leads, which is what makes them useful
     * for judging the board — and exactly what makes them indistinguishable
     * from real ones a month later. Without this flag they would be counted
     * silently in the first revenue report anybody runs.
     *
     * Nothing filters on it yet, deliberately: the flag has to exist BEFORE
     * the reports do, because it cannot be added retroactively to rows whose
     * origin has since been forgotten.
     */
    isSeed: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/** THE board query: one pipeline's deals, in column order. */
dealSchema.index({ pipeline: 1, stage: 1, boardOrder: 1 });
/** The agent's own list, and the stalled-deal sweep. */
dealSchema.index({ assignedTo: 1, closedAt: 1, stageEnteredAt: 1 });

export const Deal = model('Deal', dealSchema);
export default Deal;
