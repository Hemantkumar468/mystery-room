import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * The supply vendor master — who we buy each kind of thing from.
 *
 * Transcribed from SHEET/F Vendor.xlsx (see seed/vendorMasterData.js) and
 * maintained on Master Data → Vendors → "Vendor master" from then on. One row
 * is one supplier for one kind of item: "Balloon → Utsav Trading Balloon →
 * 9654054385". The same firm may legitimately appear twice under two items
 * (Engenius Lab supplies both "Modules" and "Modules and Sensor" in the
 * sheet), which is why identity is item + vendor, not the vendor alone.
 *
 * WHY THIS IS NOT THE p12 VENDOR RECORD. There are two different things both
 * called "vendor" here, and collapsing them would lose one of them:
 *
 *   - A p12 Record is a vendor ENGAGED ON A PROJECT — quoted amount, payment
 *     terms, contract status. It is project data and it is produced by the
 *     flow (see modules/pms/vendors/vendor.service.js).
 *   - This is the standing company list a buyer picks FROM before any of that
 *     exists — the phone number you ring when you need 200 medals. It is
 *     master data, set up once and corrected occasionally, exactly like the
 *     game catalogue beside it.
 *
 * The BOQ's Vendor dropdown reads both, so a supplier in this master can be
 * chosen on an order without first being typed into a project's Phase 4B.
 *
 * NOT TENANT-SCOPED, deliberately — the same call as `Game`. This is the
 * company's own supplier list, and the seeder that loads it runs outside any
 * request and therefore outside a tenant context; stamping it would make every
 * seeded row invisible to the scoped queries that read it.
 */
const vendorMasterSchema = new Schema(
  {
    /**
     * Stable machine key, `slug(item)--slug(vendor)`. What re-seeding matches
     * on, so loading the sheet twice refreshes rows instead of duplicating
     * them. Not shown anywhere — people read the item and the vendor name.
     */
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },

    /**
     * The sheet's own "S.no", kept as given. Two rows share a serial where the
     * sheet listed a second supplier under one number (Refurbished has both
     * Vardhman Computer and Jawahar Arora), so this is a label, not a key —
     * `sortOrder` is what actually orders the list.
     */
    serial: { type: Number, min: 0 },
    /** Position in the list. Seeded in steps of 10 so a row can be slotted between two others. */
    sortOrder: { type: Number, default: 0, index: true },

    /** What they supply — "Balloon", "Push Buttons", "3D Printing Prop". */
    item: { type: String, required: true, trim: true, maxlength: 160 },
    /** The firm, as it should appear on a purchase order. */
    vendorName: { type: String, required: true, trim: true, maxlength: 200 },

    /* Contact details. Only the number came from the sheet; the rest are here
       because a master that cannot answer "who do I email?" sends people back
       to the spreadsheet it replaced. */
    contactNumber: { type: String, trim: true, maxlength: 60 },
    contactPerson: { type: String, trim: true, maxlength: 120 },
    email: { type: String, trim: true, maxlength: 160 },
    city: { type: String, trim: true, maxlength: 120 },
    gst: { type: String, trim: true, uppercase: true, maxlength: 20 },
    notes: { type: String, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* The two searches this list exists to serve: "who supplies X" and "what do we
   buy from Y". Both are prefix-anchored on a small collection, so one compound
   index over the pair carries them. */
vendorMasterSchema.index({ item: 1, vendorName: 1 });

/**
 * The row's identity: "3D Printing Prop" + "Cordinate cad Design" →
 * "3d-printing-prop--cordinate-cad-design".
 *
 * Lives on the model rather than beside the route because the seeder needs it
 * too, and a seed script that imports a router drags Express, the auth
 * middleware and everything they touch into a standalone `node` process to
 * borrow one pure function.
 */
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const vendorCode = (item, vendorName) => `${slug(item)}--${slug(vendorName)}`;

export const VendorMaster = model('VendorMaster', vendorMasterSchema);
export default VendorMaster;
