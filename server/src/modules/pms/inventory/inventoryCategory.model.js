import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * The curated category list the inventory master is filed under.
 *
 * WHY THIS EXISTS AS A COLLECTION when `InventoryItem.category` is already a
 * string. Two things a distinct-values query cannot do, and both are things
 * the stores team asked for:
 *
 *   - A category can exist BEFORE anything is in it. Setting up "Safety Gear"
 *     and then adding six items to it is the natural order of work; derived
 *     categories can only ever appear one item too late.
 *   - A category can be RENAMED. Derived from the items, "Stationary" can only
 *     be corrected to "Stationery" by editing 48 rows and hoping none is
 *     missed — and the 49th, typed slightly differently, silently becomes a
 *     50th category. Renaming here rewrites the items with it, in one call.
 *
 * The items keep the string. This is the list the dropdown offers and the
 * spelling everything is pulled towards, not a foreign key — see the note on
 * `InventoryItem.category` for why a hard reference would have blocked the
 * migration outright.
 *
 * NOT TENANT-SCOPED, for the same reason as the items it files.
 */
const inventoryCategorySchema = new Schema(
  {
    /**
     * Stable machine key, `slug(name)`. What a re-run of the migration matches
     * on, so loading the export twice refreshes categories instead of stacking
     * a second set beside them. Not shown anywhere — people read the name.
     */
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },

    /** As it should read in the dropdown and on the item — "Game Elements". */
    name: { type: String, required: true, trim: true, maxlength: 160 },

    /** What belongs in it, for the person filing an item they have not filed before. */
    description: { type: String, trim: true, maxlength: 600, default: '' },

    /** Position in the list. Seeded in steps of 10 so one can be slotted between two others. */
    sortOrder: { type: Number, default: 0, index: true },

    /** Retired categories stop being offered on the form; items already filed
        under one keep reading exactly as they do now. */
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/**
 * "Game Elements" → "game-elements". Lives on the model rather than beside the
 * route because the migration needs it too, and a seed script that imports a
 * router drags Express and the whole auth middleware into a standalone `node`
 * process to borrow one pure function.
 */
export const categoryCode = (name) => String(name ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const InventoryCategory = model('InventoryCategory', inventoryCategorySchema);
export default InventoryCategory;
