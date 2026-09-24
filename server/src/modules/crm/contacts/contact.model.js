import mongoose from 'mongoose';
import { attachPhoneNormalisation } from '../intake/phone.js';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { attachAudit } from '../../../core/audit/audit.js';

const { Schema, model } = mongoose;

/**
 * A person you deal with — the durable record behind one or more enquiries.
 *
 * The lead is the event; this is the relationship. The same person can arrive
 * through three campaigns over two years, and their phone number has to be
 * right in all three places at once, which it cannot be if it is copied onto
 * each lead.
 *
 * At intake this collection is what dedupe searches: a matching contact means
 * the enquiry is a RE-enquiry, which is a buying signal rather than a new
 * name to chase.
 */
const contactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120, index: true },

    /** E.164, same normalisation as Lead.phone — they are compared directly. */
    phone: { type: String, trim: true, index: true },
    phoneRaw: { type: String, trim: true, maxlength: 40 },
    /** Second number, because the office landline and the mobile they actually
     *  answer are usually different, and both get given out. */
    altPhone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 160, index: true },

    company: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    designation: { type: String, trim: true, maxlength: 120 },

    city: { type: String, trim: true, maxlength: 80, index: true },
    region: { type: String, trim: true, maxlength: 80 },
    address: { type: String, trim: true, maxlength: 300 },
    pincode: { type: String, trim: true, maxlength: 12 },

    /**
     * WhatsApp consent, with when and how it was given.
     *
     * A boolean alone is not enough: Meta's policy and the DPDP Act both make
     * this a fact you may have to EVIDENCE, and "we think they agreed" is not
     * evidence. Checked before every send — see the messaging service.
     */
    whatsappOptIn: { type: Boolean, default: false },
    whatsappOptInAt: { type: Date },
    whatsappOptInSource: { type: String, trim: true, maxlength: 120 },
    /** Asked not to be called. A compliance fact, not a preference. */
    doNotDisturb: { type: Boolean, default: false },

    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    notes: { type: String, maxlength: 4000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

contactSchema.index({ owner: 1, updatedAt: -1 });
contactSchema.index({ company: 1, name: 1 });

/**
 * Deliberately NOT unique on phone.
 *
 * A shared office line, a family running two franchises, a receptionist's
 * number on three enquiry forms — all legitimate, all the same number. A
 * unique index turns those into a save the user cannot complete and cannot
 * explain. Duplicates are surfaced for a human decision at intake instead.
 */

/** Both numbers are canonical on every write path — see the Lead model and
 *  attachPhoneNormalisation. altPhone keeps no raw copy: it has no column for
 *  one, and it is a secondary number rather than the match key. */
attachPhoneNormalisation(contactSchema, { phone: 'phoneRaw', altPhone: null });

/* Who changed what, and what it was before — see core/audit/audit.js. The
 * previous value is the half that matters: the new one is already in the
 * record, the old one is destroyed by the write. */
attachAudit(contactSchema, { modelName: 'Contact', label: 'name' });
attachTenancy(contactSchema, { modelName: 'Contact' });

export const Contact = model('Contact', contactSchema);
export default Contact;
