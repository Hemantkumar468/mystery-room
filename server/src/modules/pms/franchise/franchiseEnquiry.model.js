import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * One franchise enquiry: an outsider saying "I have a place in my city —
 * I want to open a Mystery Rooms there".
 *
 * This is the SHORT road into the pipeline. The normal flow earns its Phase
 * 1-2 (scout ten properties, assess four ways) because nothing is known yet;
 * a franchisee arrives WITH the property and the commitment, so their
 * submission carries the property capture itself, goes straight to the MD,
 * and an approval births a real project standing at Phase 3 (LOI) with the
 * first two phases marked done by the system.
 *
 * Kept forever, decided or not: the trail of who wanted in, where, and why a
 * no was a no is exactly the market map the expansion team mines later.
 */
const franchiseEnquirySchema = new Schema(
  {
    /* Who is asking. */
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    background: { type: String, trim: true, maxlength: 2000 }, // who they are, what they run today

    /* The property they bring. */
    city: { type: String, required: true, trim: true, maxlength: 60 },
    locality: { type: String, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 400 },
    carpetAreaSqft: { type: Number, min: 0 },
    floor: { type: String, trim: true, maxlength: 60 },
    ownership: { type: String, enum: ['owned', 'leased', 'family', 'other'], default: 'owned' },
    // Optional pin from the form's "use my location" button.
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    photos: [{
      _id: false,
      url: String,
      name: String,
      publicId: String,
    }],
    investmentReady: { type: String, trim: true, maxlength: 200 }, // their words on budget
    message: { type: String, trim: true, maxlength: 3000 },

    /* The decision. */
    status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted', index: true },
    rejectReason: { type: String, trim: true, maxlength: 1000 },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: { type: Date },
    /* The project an approval created — the enquiry's afterlife. */
    project: { type: Schema.Types.ObjectId, ref: 'Project' },
  },
  { timestamps: true },
);

franchiseEnquirySchema.index({ status: 1, createdAt: -1 });

attachTenancy(franchiseEnquirySchema, { modelName: 'FranchiseEnquiry' });

export const FranchiseEnquiry = model('FranchiseEnquiry', franchiseEnquirySchema);
export default FranchiseEnquiry;
