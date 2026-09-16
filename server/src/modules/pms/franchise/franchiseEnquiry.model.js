import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/** An uploaded file reference (photo, video or document). */
const mediaRef = {
  _id: false,
  url: String,
  name: String,
  publicId: String,
};

/**
 * One property the applicant brings. An applicant may bring several — each is
 * its own subdocument WITH an _id, because the MD's decision later points at
 * specific ones ("shortlist these three", "go to LOI with this one").
 */
const propertySchema = new Schema(
  {
    label: { type: String, trim: true, maxlength: 120 }, // their name for it, e.g. "DB Mall shop"
    city: { type: String, required: true, trim: true, maxlength: 60 },
    locality: { type: String, trim: true, maxlength: 120 },
    address: { type: String, required: true, trim: true, maxlength: 400 },
    carpetAreaSqft: { type: Number, min: 0 },
    floor: { type: String, trim: true, maxlength: 60 },
    ownership: { type: String, enum: ['owned', 'leased', 'family', 'other'], default: 'owned' },
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    photos: [mediaRef],
    videos: [mediaRef],
    documents: [mediaRef],
    /* Big walkthrough videos rarely fit an upload — a Google Drive (or any
       cloud) link carries them instead. Stored as plain URLs. */
    driveLinks: [{ type: String, trim: true, maxlength: 500 }],
    remarks: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: true },
);

/**
 * One franchise enquiry: an outsider saying "I want to open a Mystery Rooms".
 *
 * Two kinds of applicant walk through the same door:
 *  - WITH property (one or many): their submission doubles as the property
 *    capture. The MD can shortlist several for assessment (project starts at
 *    Phase 1-2), or take a single obvious winner straight to LOI (Phase 3).
 *  - WITHOUT property, interested: we keep where they want it and what they
 *    plan; an approval starts a project at Phase 1 — the property search.
 *
 * Kept forever, decided or not: the trail of who wanted in, where, and why a
 * no was a no is exactly the market map the expansion team mines later.
 */
const franchiseEnquirySchema = new Schema(
  {
    /**
     * Which door this came in through.
     *
     * A broker sending us a shop and a franchisee applying to run one submit
     * the SAME thing — a person, a phone number and one or more properties —
     * and both need to land in the property queue. A second model would have
     * duplicated the property sub-schema, the media handling and the public
     * submit route to record a difference of intent, so intent is a field.
     *
     * It changes two things and nothing else: the property queue labels the
     * row by it, and a 'broker' row is never treated as a franchise lead (a
     * broker is not applying for a franchise, so there is no lead to approve
     * or reject). Defaulted rather than required, because every enquiry that
     * existed before this field was a franchise application.
     */
    source: {
      type: String,
      enum: ['franchise', 'broker'],
      default: 'franchise',
      index: true,
    },

    /* Who is asking. */
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    background: { type: String, trim: true, maxlength: 2000 }, // who they are, what they run today

    /* The fork: property in hand, or interest only. */
    hasProperty: { type: Boolean, default: true },
    properties: [propertySchema],

    /* Interest-only applicants (hasProperty: false). */
    interestCity: { type: String, trim: true, maxlength: 60 },
    interestArea: { type: String, trim: true, maxlength: 200 },
    plan: { type: String, trim: true, maxlength: 2000 }, // what they intend, in their words

    /* ── Legacy single-property fields (enquiries submitted before the
          multi-property form). Read through normalizeEnquiry(), never written
          by new code. ── */
    city: { type: String, trim: true, maxlength: 60 },
    locality: { type: String, trim: true, maxlength: 120 },
    address: { type: String, trim: true, maxlength: 400 },
    carpetAreaSqft: { type: Number, min: 0 },
    floor: { type: String, trim: true, maxlength: 60 },
    ownership: { type: String, enum: ['owned', 'leased', 'family', 'other'] },
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    photos: [mediaRef],

    investmentReady: { type: String, trim: true, maxlength: 200 }, // their words on budget
    message: { type: String, trim: true, maxlength: 3000 },

    /* The decision. */
    status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted', index: true },
    rejectReason: { type: String, trim: true, maxlength: 1000 },
    /* HOW it was approved — which of the three roads the project took. */
    decisionMode: { type: String, enum: ['assess', 'loi', 'scout'] },
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
