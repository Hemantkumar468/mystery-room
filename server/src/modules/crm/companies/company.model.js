import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';
import { attachAudit } from '../../../core/audit/audit.js';

const { Schema, model } = mongoose;

/**
 * The business behind the contacts.
 *
 * Minimal at this phase on purpose: intake only needs somewhere to hang a
 * company name and a location so territory routing has something to test. The
 * industry/size/revenue fields the listing screens want arrive with the CRUD
 * phase, not here.
 */
const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160, index: true },
    website: { type: String, trim: true, maxlength: 300 },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },

    city: { type: String, trim: true, maxlength: 80, index: true },
    region: { type: String, trim: true, maxlength: 80 },
    address: { type: String, trim: true, maxlength: 300 },
    pincode: { type: String, trim: true, maxlength: 12 },

    /**
     * GeoJSON, for territory routing and the coverage map.
     *
     * `2dsphere` rather than two number fields: "which leads are within 40km
     * of this branch" is a query Mongo can answer directly, and cannot answer
     * at all against a pair of loose lat/lng columns.
     *
     * Note the order — GeoJSON is [longitude, latitude], the reverse of how
     * everyone says it out loud.
     */
    location: {
      type: { type: String, enum: ['Point'], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },

    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

companySchema.index({ location: '2dsphere' });
companySchema.index({ owner: 1, updatedAt: -1 });

/* Who changed what, and what it was before — see core/audit/audit.js. The
 * previous value is the half that matters: the new one is already in the
 * record, the old one is destroyed by the write. */
attachAudit(companySchema, { modelName: 'Company', label: 'name' });
attachTenancy(companySchema, { modelName: 'Company' });

export const Company = model('Company', companySchema);
export default Company;
