import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A place stock physically sits.
 *
 * The central store in Delhi, and one row per outlet after that — Mystery
 * Rooms runs centres in a dozen cities, several of them franchise-owned, and
 * "how many fog machines do we have" has a different answer in each. The
 * BoxHero export this whole module grew out of is itself titled "Mystery Rooms
 * (Main Inventory)", which is the first of these locations by name.
 *
 * WHY THIS IS NOT THE PROJECT. A project is the BUILD of a centre — it starts
 * before there is a site and finishes at launch. A location is the centre once
 * it is running, and it outlives its project by years. Most of the stock
 * questions asked here are asked about places that finished being projects
 * long ago, and the central warehouse was never a project at all. `project` is
 * kept as an optional back-link so a newly launched centre can say which build
 * produced it, but nothing requires it.
 *
 * WHO CAN TOUCH IT. `managers` is the list of people who run this location's
 * stock day to day. It is not a permission by itself — the server's role check
 * is still the boundary — but it is what the movement ledger reads to answer
 * "whose count is this", and what the outlet filter defaults to when somebody
 * who runs exactly one location signs in.
 *
 * NOT TENANT-SCOPED, the same call as the item master it stocks.
 */
const inventoryLocationSchema = new Schema(
  {
    /** Short human code on every movement line — "MAIN", "GGN", "NOI-2". */
    code: {
      type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 20, index: true,
    },

    /** As it should read in a dropdown — "Mystery Rooms (Main Inventory)". */
    name: { type: String, required: true, trim: true, maxlength: 160 },

    /**
     * What KIND of place it is, because the three behave differently and the
     * difference is worth seeing at a glance:
     *   warehouse — the central store everything is issued FROM;
     *   outlet    — a company-run centre that consumes stock;
     *   franchise — a partner-run centre, which we supply but do not operate.
     */
    type: {
      type: String, enum: ['warehouse', 'outlet', 'franchise'], default: 'outlet', index: true,
    },

    city: { type: String, trim: true, maxlength: 120, index: true },
    address: { type: String, trim: true, maxlength: 400, default: '' },

    /** Who runs this location's stock. See the note above — a label, not a gate. */
    managers: [{ type: Schema.Types.ObjectId, ref: 'User' }],

    /** The build that produced this centre, where there was one. Optional by design. */
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },

    contactName: { type: String, trim: true, maxlength: 120, default: '' },
    contactPhone: { type: String, trim: true, maxlength: 40, default: '' },
    notes: { type: String, maxlength: 2000, default: '' },

    /** Position in every location dropdown. The warehouse is meant to lead. */
    sortOrder: { type: Number, default: 0, index: true },

    /**
     * Closed locations stop being offered for new movements, but their stock
     * rows and their history stay readable — a centre that shut last year
     * still has to answer "what did we send it, and what came back".
     */
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* The one listing this collection serves: the warehouse, then outlets by city. */
inventoryLocationSchema.index({ sortOrder: 1, name: 1 });

/** "Mystery Rooms (Main Inventory)" → "MYSTERY-ROOMS-MAIN-INVENTORY", trimmed. */
export const locationCode = (name) => String(name ?? '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  .slice(0, 20)
  .replace(/-$/, '');

export const InventoryLocation = model('InventoryLocation', inventoryLocationSchema);
export default InventoryLocation;
