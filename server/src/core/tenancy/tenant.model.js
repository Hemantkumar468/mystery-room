import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A company this deployment serves.
 *
 * WHY THIS EXISTS BEFORE IT IS NEEDED. There is exactly one company today. The
 * field is being added now because adding it later is not a migration — it is
 * a rewrite. Backfilling 21 live collections is the easy half; the hard half is
 * auditing every query written between now and then, where a single one that
 * forgot the filter is a silent cross-company data leak that no test would
 * catch and no user would report, because the data looks perfectly normal.
 *
 * The cost of carrying an unused indexed ObjectId is close to nothing. The
 * cost of retrofitting it is the largest single item on the roadmap, and it
 * grows every week.
 *
 * NOT ITSELF TENANT-SCOPED, obviously — it is the thing being scoped to.
 */
const tenantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    /** Stable, URL-safe, and never reused — it may end up in a subdomain. */
    slug: {
      type: String, required: true, unique: true, lowercase: true, trim: true,
    },
    isActive: { type: Boolean, default: true },
    /**
     * The one every pre-existing record was backfilled onto.
     *
     * Marked rather than inferred: "the oldest tenant" stops being true the
     * moment somebody deletes it, and the backfill needs a target that is
     * still identifiable years later.
     */
    isDefault: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: 'tenants' },
);

/**
 * Adding or removing a company changes two cached decisions — whether strict
 * scoping is armed, and which company a sessionless request belongs to.
 *
 * Recomputed here rather than at each call site, because the call sites are
 * "wherever a tenant ever gets created", which is a list that will be wrong
 * within a month. The dynamic import breaks the cycle: tenancy.js needs this
 * model, so it cannot be imported at the top of this file.
 */
async function recomputeTenantDecisions() {
  const { armStrictness } = await import('./tenancy.js');
  await armStrictness();
}

tenantSchema.post('save', recomputeTenantDecisions);
tenantSchema.post('deleteOne', recomputeTenantDecisions);
tenantSchema.post('deleteMany', recomputeTenantDecisions);
tenantSchema.post('findOneAndDelete', recomputeTenantDecisions);

export const Tenant = model('Tenant', tenantSchema);
export default Tenant;
