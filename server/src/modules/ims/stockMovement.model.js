import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Every change to every count, in the order it happened.
 *
 * This is the source of truth; `StockLevel.onHand` is a cached running total
 * of it (see the note on that model). An append-only ledger rather than an
 * editable table, for the reason every stock system eventually learns: the
 * question people actually bring is never "how many are there" — the shelf
 * answers that — it is "there should be nine and there are six, what
 * happened", and only a record of what happened can answer it.
 *
 * NOTHING HERE IS EVER EDITED OR DELETED. A mistaken entry is corrected by
 * posting its opposite, exactly as a ledger is corrected, so the trail shows
 * both the error and the fix. A movement that could be quietly rewritten would
 * make the history worth no more than the number it explains.
 */

/**
 * The five things that can happen to a count, and why these five.
 *
 *   in       — stock arrives: a delivery, a return from an outlet, opening stock.
 *   out      — stock leaves: issued to a game build, consumed, written off.
 *   adjust   — a physical count disagreed with the system; this is the delta
 *              that reconciles them. Kept apart from in/out on purpose — a
 *              stocktake correction is not a receipt, and mixing them makes
 *              "how much did we actually buy this month" unanswerable.
 *   transfer_out / transfer_in — the two halves of a move between locations,
 *              written as a pair sharing one `transferRef`. Two rows rather
 *              than one because each location's own ledger has to read
 *              correctly on its own, and a single row would appear in one
 *              location's history and vanish from the other's.
 */
export const MOVEMENT_TYPES = ['in', 'out', 'adjust', 'transfer_in', 'transfer_out'];

/** The direction each type moves the count. Exported so the service and the
    page's badge colours read from one table rather than two copies of a rule. */
export const MOVEMENT_SIGN = Object.freeze({
  in: 1, transfer_in: 1, out: -1, transfer_out: -1, adjust: 0,
});

/**
 * Why it moved. Free text would make the "what are we losing stock to"
 * question unanswerable within a month, so the reasons are a closed list —
 * grouped by the type they belong to, with `note` carrying the specifics.
 */
export const MOVEMENT_REASONS = Object.freeze({
  in: ['purchase', 'opening_stock', 'return_from_site', 'transfer_receipt', 'found'],
  out: ['issued_to_site', 'consumed', 'damaged', 'lost', 'returned_to_vendor', 'sold'],
  adjust: ['stock_count', 'correction'],
  transfer_in: ['transfer'],
  transfer_out: ['transfer'],
});

const stockMovementSchema = new Schema(
  {
    item: {
      type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true,
    },
    location: {
      type: Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true,
    },

    type: { type: String, enum: MOVEMENT_TYPES, required: true, index: true },
    reason: { type: String, trim: true, maxlength: 60, default: '' },

    /**
     * How many moved, ALWAYS POSITIVE. The direction lives in `type`, not in
     * the sign, so a filter for "everything that left this month" is one
     * equality test rather than a sign check that somebody will eventually get
     * backwards. `adjust` is the one exception and carries `delta` instead.
     */
    qty: { type: Number, required: true, min: 0 },

    /** The signed change this row made — +qty, -qty, or the stocktake delta. */
    delta: { type: Number, required: true },

    /* The count before and after, frozen at the moment it was written. Stored
       rather than derived because that is what makes the ledger auditable: if
       the cached balance ever drifts, these say exactly which row it drifted
       at. Re-deriving them later from a corrected history would hide the
       very thing somebody is looking for. */
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    /** Unit cost at the moment of the movement, where it was known. Snapshotted
        so a later price correction does not silently rewrite last year's value. */
    unitPrice: { type: Number, min: 0, default: null },

    /** The other end of a transfer, and the pairing key that ties the two rows. */
    counterparty: { type: Schema.Types.ObjectId, ref: 'InventoryLocation', default: null },
    transferRef: { type: String, trim: true, maxlength: 40, default: null, index: true },

    /** A PO number, a challan, a project — whatever the paper says. Free text
        on purpose: it is a pointer into someone else's system, not into ours. */
    reference: { type: String, trim: true, maxlength: 120, default: '' },
    note: { type: String, maxlength: 1000, default: '' },

    /** Who did it. Not optional in practice — every route that writes one is
        authenticated — and the first thing asked when a count looks wrong. */
    by: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    /** When it happened, which may be before when it was typed in. */
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

/* The two ledger reads: one item's history at one place, and "what happened
   here lately". Both are newest-first, so the sort is part of the index. */
stockMovementSchema.index({ item: 1, location: 1, at: -1 });
stockMovementSchema.index({ location: 1, at: -1 });

export const StockMovement = model('StockMovement', stockMovementSchema);
export default StockMovement;
