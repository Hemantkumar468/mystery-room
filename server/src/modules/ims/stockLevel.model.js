import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * How much of one item is at one location, and how much there ought to be.
 *
 * One row per item × location. This is the number the whole module exists to
 * keep honest, and the single rule that keeps it honest is: NOTHING WRITES
 * `onHand` DIRECTLY. Every change goes through imsService.move(), which
 * appends a StockMovement and adjusts this row in the same operation. A
 * service that "just nudges the count" for a quick fix is how a stock system
 * starts disagreeing with its own ledger, and once the two disagree there is
 * no way to find out which was right.
 *
 * WHY THE BALANCE IS STORED AT ALL rather than summed from the ledger on
 * demand. "What do we have" is asked constantly — on every page load, for
 * every row, and by the low-stock sweep — while movements are appended a few
 * dozen times a day. Re-summing a growing ledger for a read that frequent gets
 * slower forever. The ledger remains the source of truth and can rebuild this
 * at any time (see imsService.recount), which is what makes storing it safe.
 *
 * SAFETY STOCK IS PER LOCATION, not per item, and that is the point of it. The
 * central warehouse holding six spare EM locks is prudent; a single outlet
 * holding six is money sitting in a cupboard. The same item therefore carries
 * a different floor in each place it sits, set by whoever runs that place.
 */
const stockLevelSchema = new Schema(
  {
    item: {
      type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true, index: true,
    },
    location: {
      type: Schema.Types.ObjectId, ref: 'InventoryLocation', required: true, index: true,
    },

    /**
     * The count. Never assigned outside imsService.move() — see above.
     *
     * `min: 0` is deliberate and is enforced again in the service before the
     * write: a negative physical count is not a small error to be tolerated
     * and corrected later, it is a signal that two people are counting the
     * same shelf and one of them is wrong. The service refuses the issue and
     * says what is actually there.
     */
    onHand: { type: Number, default: 0, min: 0, required: true },

    /**
     * The floor — the level at or below which this location should reorder.
     *
     * Zero means "not set", and that is treated as "no opinion" rather than
     * "never reorder": an item with no floor is never reported as low, because
     * a low-stock list padded with items nobody has thought about is a list
     * people stop reading. Setting it is the deliberate act that opts an item
     * into the alerting.
     */
    safetyStock: { type: Number, default: 0, min: 0 },

    /** How many to buy when it trips — what the reorder suggestion actually proposes. */
    reorderQty: { type: Number, default: 0, min: 0 },

    /** Where on the floor it lives. "Rack B / Shelf 3". Saves a search, costs nothing. */
    bin: { type: String, trim: true, maxlength: 80, default: '' },

    /** When the count last moved, for the "not counted since" question. */
    lastMovementAt: { type: Date, default: null },
    /** When somebody last physically counted it, as opposed to transacting it. */
    lastCountedAt: { type: Date, default: null },

    notes: { type: String, maxlength: 1000, default: '' },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* The row's identity. Unique, so two concurrent stock-ins for the same item at
   the same location cannot create two rows that each hold half the truth —
   which is the failure this module would never detect on its own. */
stockLevelSchema.index({ item: 1, location: 1 }, { unique: true });

/* The main grid's read: one location, its items. */
stockLevelSchema.index({ location: 1, onHand: 1 });

export const StockLevel = model('StockLevel', stockLevelSchema);
export default StockLevel;
