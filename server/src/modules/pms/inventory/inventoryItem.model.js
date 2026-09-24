import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * The inventory master — every distinct thing Mystery Rooms stocks.
 *
 * Migrated from SHEET/Report_Inventory_Mystery Rooms (Main Inventory)_*.xlsx,
 * the BoxHero export the stores team has been keeping, and maintained on
 * Master Data → Inventory from then on. One row is one SKU: "SKU-VC5ZE5AI /
 * Masking Tape 2 inch / Stationary / Piece / Janta Pustak Bhandar".
 *
 * WHAT THIS IS NOT. It is a CATALOGUE, not a stock ledger. It answers "what do
 * we stock, under what code, in what unit, from whom" — not "how many are in
 * Gurgaon right now". Quantities move per outlet and per day, and they live in
 * the IMS module (modules/ims/): a `StockLevel` per item × location, kept by an
 * append-only `StockMovement` ledger. Putting a `quantity` field on THIS
 * document would make it the answer to a question it cannot keep current, and
 * every reader would trust the stale number anyway.
 *
 * The two halves meet at `_id` — a stock row references this item and reads its
 * name, unit and price from here, so correcting a name on this page corrects it
 * everywhere at once and no count is ever touched.
 *
 * WHY `sku` IS THE IDENTITY rather than the name. The names in the export are
 * hand-typed and three pairs already collide — "Candle Stand", "Wall Fan"
 * and "Hanging Doll Model 14" each appear twice under different codes,
 * because they are genuinely two different objects. The SKUs do not collide,
 * and they are what is printed on the bin labels and scanned in BoxHero.
 * Re-running the migration matches on `sku`, so importing the export twice
 * refreshes rows instead of doubling the master.
 *
 * NOT TENANT-SCOPED, deliberately — the same call as `Game` and
 * `VendorMaster`. This is the company's own catalogue, and the migration that
 * loads it runs outside any request and therefore outside a tenant context;
 * stamping it would make every migrated row invisible to the scoped queries
 * that read it.
 */
const inventoryItemSchema = new Schema(
  {
    /**
     * The stock-keeping code, as printed on the bin. Uppercased so a SKU typed
     * in lower case on the Add form matches the one the export wrote — a
     * duplicate that differs only in case is a duplicate nobody can see.
     */
    sku: {
      type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40, index: true,
    },

    /** What it is, in the stores team's own words. */
    name: { type: String, required: true, trim: true, maxlength: 240 },

    /**
     * Free text rather than a reference into `InventoryCategory`.
     *
     * The export's categories are strings, 51 rows have none at all, and 22 of
     * them are compound ("Electronics , Game Elements") — a hard reference
     * would have to invent a category for every one of those before a single
     * row could be migrated. The category master beside this is the CURATED
     * list the dropdown offers; this field is what the row actually says. The
     * two are reconciled on screen, where somebody can see the odd ones.
     */
    category: { type: String, trim: true, maxlength: 160, default: '', index: true },

    /**
     * BoxHero's own flag, carried across as-is. "Listed" means the item is on
     * the active picking list; "Unlisted" means it is stocked but not offered.
     * 967 of the 1,322 rows are Unlisted, so defaulting a new row to Listed
     * would quietly disagree with the list it is joining.
     */
    visibility: { type: String, enum: ['Listed', 'Unlisted'], default: 'Unlisted', index: true },

    /** Piece, Set, Meter, Packet… The export's own spelling, tidied on import. */
    unit: { type: String, trim: true, maxlength: 60, default: '' },

    /* Who we buy it from. Text, not a reference into VendorMaster, for the same
       reason a purchase order stores the vendor's name: 150 distinct supplier
       names appear here and most are not in the vendor master yet, and a row
       that cannot be migrated until its supplier exists is a row that does not
       get migrated. The Vendors page remains the place a supplier's details
       live; this is the name on the item. */
    vendorName: { type: String, trim: true, maxlength: 200, default: '' },
    /** Whatever the export had beside the vendor — almost always a phone number. */
    vendorDetails: { type: String, trim: true, maxlength: 200, default: '' },

    /**
     * Indicative unit cost in rupees, for reading a stock position in money.
     *
     * NOT A PRICE LIST and not what anything is billed at — the BoxHero export
     * carried no cost at all, so every one of the 1,322 migrated rows starts
     * null and stays null until somebody fills it in. `null` is therefore a
     * real answer meaning "we have not priced this", which is why it is not
     * defaulted to 0: a master where a third of the rows read ₹0 makes every
     * total it feeds silently wrong, and nobody can tell the free things from
     * the unpriced ones.
     */
    price: { type: Number, min: 0, default: null },

    /**
     * A picture of the thing, by URL. The stores team recognises a part on
     * sight long before they recognise "SKU-VKQDVU1A", and a catalogue of
     * 1,322 near-identical fittings is the case where that matters most.
     * A URL rather than an upload: the images live wherever the company
     * already keeps them, and this master should not become a file store.
     */
    imageUrl: { type: String, trim: true, maxlength: 600, default: '' },

    notes: { type: String, maxlength: 2000, default: '' },

    /**
     * Archived rather than deleted, which is the opposite call to the vendor
     * master next door and is deliberate. A vendor row is a phone number and
     * nothing points at it. A SKU is printed on a bin, scanned into BoxHero
     * and written onto past indents — deleting it makes historical paperwork
     * unreadable, and somebody re-adding it later gets a NEW code for the same
     * physical thing. Archiving keeps the code reserved and readable.
     */
    active: { type: Boolean, default: true, index: true },

    /** 'sheet' for a migrated row, 'manual' for one added on the page. Lets the
        migration report honestly on what it did and did not touch. */
    source: { type: String, enum: ['sheet', 'manual'], default: 'manual' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* The list's default reading order, and the filter it is read through most —
   "show me Game Elements, alphabetically". One compound index carries both. */
inventoryItemSchema.index({ category: 1, name: 1 });
/* "Which of these do we buy from China Prop?" — the second question the stores
   team asks of this list, and the one that decides a re-order call. */
inventoryItemSchema.index({ vendorName: 1, name: 1 });
/* The search box matches the name, so it leads; `active` is in front of it
   because every query the page issues excludes archived rows. */
inventoryItemSchema.index({ active: 1, name: 1 });

/* ── SKU generation ──────────────────────────────────────────────────────── */

/**
 * BoxHero's own alphabet. I and O are kept rather than dropped, because the
 * 1,322 migrated codes already contain both and a generator that cannot
 * produce them would make new codes visibly a different species.
 */
const SKU_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** `SKU-VC5ZE5AI` — the shape the export uses, so old and new codes read alike. */
export function generateSku() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += SKU_ALPHABET[Math.floor(Math.random() * SKU_ALPHABET.length)];
  return `SKU-${s}`;
}

/**
 * A code nothing in the master is using yet.
 *
 * 36^8 is 2.8 × 10^12, so a collision at this scale is vanishingly unlikely —
 * but "vanishingly unlikely" over a bulk import of a few hundred rows is still
 * a coin somebody eventually loses, and the failure would be a unique-index
 * error in the middle of a paste with no obvious cause. `taken` carries the
 * codes minted earlier in the same batch, which are not in the database yet.
 */
export async function uniqueSku(taken = new Set()) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const sku = generateSku();
    if (taken.has(sku)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (!(await InventoryItem.exists({ sku }))) { taken.add(sku); return sku; }
  }
  throw new Error('Could not mint a free SKU after 20 attempts.');
}

export const InventoryItem = model('InventoryItem', inventoryItemSchema);
export default InventoryItem;
