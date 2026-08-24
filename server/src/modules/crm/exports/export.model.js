import mongoose from 'mongoose';
import { attachTenancy } from '../../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * A request to take customer data out of the system.
 *
 * WHY THIS IS A RECORD AND NOT A BUTTON. A CSV of every lead is the entire
 * customer database in one file, on somebody's laptop, forever. The most
 * common way a CRM leaks is not a breach — it is an export on the last day of
 * someone's notice period. Making it a request that leaves a permanent trace,
 * with a reason attached, changes the behaviour long before anybody has to
 * refuse one.
 *
 * THE FILE IS NOT STORED HERE. The job writes it to S3 and the row keeps the
 * key and an expiry. A link that works forever is the same leak with extra
 * steps, so the presigned URL lasts an hour and is minted on demand rather
 * than saved.
 */
const exportRequestSchema = new Schema(
  {
    /** What they asked for: 'leads' | 'contacts' | 'deals'. */
    dataset: { type: String, required: true, enum: ['leads', 'contacts', 'deals'] },
    /** The filter, as the list screen would express it. Stored so an approver
     *  can see exactly what will be produced, not a vague description of it. */
    filters: { type: Schema.Types.Mixed, default: {} },

    /**
     * How many rows the request matched WHEN IT WAS MADE.
     *
     * Counted up front, because the approval threshold depends on it and an
     * approver has to know what they are approving. Re-counted at build time
     * too — the data moves — but this is the number the decision was based on
     * and it stays.
     */
    rowCount: { type: Number, required: true },

    /** Required above a thousand rows, and always worth having. */
    reason: { type: String, trim: true, maxlength: 500 },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    requestedByName: { type: String, trim: true, maxlength: 120 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'ready', 'failed', 'expired'],
      default: 'pending',
      index: true,
    },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedReason: { type: String, trim: true, maxlength: 500 },

    /** Where the built file lives, and when it stops being reachable. */
    s3Key: { type: String, trim: true },
    builtAt: { type: Date },
    expiresAt: { type: Date, index: true },
    /** Counted, because one download is a person doing their job and forty is
     *  something else. */
    downloads: { type: Number, default: 0 },

    error: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'crm_export_requests' },
);

exportRequestSchema.index({ status: 1, createdAt: -1 });

attachTenancy(exportRequestSchema, { modelName: 'ExportRequest' });

export const ExportRequest = model('ExportRequest', exportRequestSchema);
export default ExportRequest;
