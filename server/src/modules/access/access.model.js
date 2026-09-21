import mongoose from 'mongoose';
import { ACCESS_VALUES, INHERIT } from '../../core/constants/access.js';
import { attachTenancy } from '../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * One saved policy: what a ROLE, or one named PERSON, may reach.
 *
 * ONE DOCUMENT PER SUBJECT, not one row per permission. A role's policy is
 * read on every request that asks a permission question, and forty separate
 * reads to answer one of them is the shape that makes people cache badly.
 * The whole grant map is small (forty short strings), it is written as a unit
 * from one screen, and it is read as a unit by the resolver.
 *
 * ONLY DIFFERENCES ARE STORED. A key absent from `grants` means "whatever the
 * catalogue says by default" for a role, and "whatever my role says" for a
 * person. That is what keeps a policy readable a year from now: the document
 * holds the decisions somebody actually made, not a frozen copy of every
 * default that was true on the day it was saved. A copy would silently stop
 * tracking the defaults, and nobody would notice until a new module appeared
 * and was invisible to everyone with a saved policy.
 *
 * WHY A PERSON CAN BE NAMED AT ALL, when roles exist. Because the business
 * does not divide cleanly by role: two site engineers on the same grade do
 * different halves of the property flow, and the honest answer is "this one
 * works Step 3" rather than inventing a role per person. The override is
 * deliberately a thin layer over the role, and `inherit` is a real stored
 * value so somebody can take a decision back without deleting the document.
 */
const accessPolicySchema = new Schema(
  {
    /** 'role' or 'user' - which of the two layers this document is. */
    subjectType: {
      type: String, enum: ['role', 'user'], required: true, index: true,
    },

    /**
     * The role slug ('manager') or the user's id as a string.
     *
     * A string either way, deliberately: a union field typed as ObjectId
     * would reject every role document, and typing it loosely is the smaller
     * lie than two near-identical collections.
     */
    subjectId: {
      type: String, required: true, trim: true, index: true,
    },

    /** surfaceKey -> level. `inherit` is only meaningful on a user document. */
    grants: {
      type: Map,
      of: { type: String, enum: [...ACCESS_VALUES, INHERIT] },
      default: () => new Map(),
    },

    /** Why this policy is the way it is - shown on the Settings screen. */
    note: { type: String, trim: true, maxlength: 400, default: '' },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/* One policy per subject per company. The unique index is what makes the
   upsert in access.service.js#save safe under two admins saving at once. */
accessPolicySchema.index({ tenant: 1, subjectType: 1, subjectId: 1 }, { unique: true });

attachTenancy(accessPolicySchema, { modelName: 'AccessPolicy' });

export const AccessPolicy = model('AccessPolicy', accessPolicySchema);
export default AccessPolicy;
