import mongoose from 'mongoose';
import { logger } from '../../config/logger.js';
import {
  currentTenant, isUnscoped, hasTenantContext, withTenant, withoutTenant,
} from './tenantContext.js';

/**
 * Company isolation, applied to a schema.
 *
 * ONE RULE, ONE PLACE. Same shape as `attachPhoneNormalisation`,
 * `resolveAssignee` and the `isSeed` argument: the invariant lives here and
 * the call sites cannot opt out of it. A tenant filter that each service adds
 * by hand is a filter that one service eventually forgets, and the symptom of
 * forgetting is not a crash — it is another company's customer list rendered
 * on screen, looking entirely normal.
 *
 * WHAT IT DOES to every schema it is attached to:
 *
 *   - adds an indexed `tenant` field;
 *   - stamps it from the current context on save, so nothing can be written
 *     into the wrong company or into none;
 *   - injects it into the filter of every find, count, distinct, update,
 *     delete and aggregate.
 *
 * HOW STRICT IT IS, and why that changes by itself. With a single company on
 * the deployment there is nothing to leak, so a query that runs outside any
 * context is allowed through — otherwise every job, script and test would have
 * to be rewritten today to guard against a risk that does not exist yet. The
 * moment a SECOND tenant is created, `armStrictness()` flips this and an
 * unscoped query throws instead.
 *
 * That is deliberate: it fails loudly at exactly the moment somebody is doing
 * tenancy work and is in a position to fix it, rather than quietly at the
 * moment a customer sees data that is not theirs. Work that genuinely spans
 * companies says so with `withoutTenant(reason)`.
 */

/** Flipped by armStrictness() once more than one company exists. */
let strict = false;

/** Cleared whenever the set of companies changes. */
let cachedDefaultTenant = null;

/** Models carrying a tenant field, for the completeness test to enumerate. */
const scopedModels = new Set();

export function isStrict() {
  return strict;
}

export function tenantScopedModelNames() {
  return [...scopedModels];
}

/**
 * Decide whether an unscoped query is tolerable, by counting companies.
 *
 * Called at boot and after a tenant is created. Counting once rather than per
 * query: this is on the path of every database call in the process.
 */
export async function armStrictness() {
  const { Tenant } = await import('./tenant.model.js');
  const count = await Tenant.countDocuments({ isActive: { $ne: false } });
  const next = count > 1;
  if (next !== strict) {
    logger.warn(
      next
        ? `Tenant strictness ARMED — ${count} companies exist, so any query outside a tenant context will now throw. `
          + 'Work that legitimately spans companies must be wrapped in withoutTenant(reason).'
        : 'Tenant strictness relaxed — a single company on this deployment.',
    );
  }
  strict = next;
  // The set of companies just changed, so the cached answer for sessionless
  // requests is no longer trustworthy.
  cachedDefaultTenant = null;
  return strict;
}

/** For tests: force the setting without needing two tenant rows. */
export function setStrictForTesting(value) {
  strict = Boolean(value);
}

/**
 * The company for a request that arrives with NO SESSION.
 *
 * Public endpoints — the web enquiry form, the Meta lead webhook, the
 * telephony callbacks — have no user, so nothing tells them which company they
 * belong to. Left alone they write documents with no tenant at all, and a
 * record with no tenant is invisible to every scoped query: the enquiry is
 * accepted, stored, and then never appears on anybody's screen. That is not a
 * hypothetical either. It is what this code did the first time it ran.
 *
 * While ONE company exists the answer is unambiguous, so it is used. From the
 * second onward there is no honest default, and guessing would file a stranger's
 * enquiry into the wrong company's database — so this refuses, loudly, and the
 * mapping (form key → company, virtual number → company) has to be made real.
 */
export async function resolveTenantWithoutSession(what) {
  if (cachedDefaultTenant) return cachedDefaultTenant;

  const { Tenant } = await import('./tenant.model.js');
  const active = await withoutTenant(
    'resolving which company a request with no session belongs to',
    () => Tenant.find({ isActive: { $ne: false } }).select('_id isDefault').limit(3).lean(),
  );

  if (!active.length) {
    throw new Error('No company exists on this deployment yet — run `npm run migrate:tenancy -- --apply`.');
  }
  if (active.length > 1) {
    throw new Error(
      `${what} arrives with no session, and ${active.length} companies now exist, so which one it `
      + 'belongs to can no longer be inferred. Map it explicitly — a form key or a virtual number '
      + 'has to name its company — rather than letting one company\'s enquiry land in another\'s database.',
    );
  }

  cachedDefaultTenant = String((active.find((t) => t.isDefault) || active[0])._id);
  return cachedDefaultTenant;
}

/**
 * Express middleware for a router that has no `authenticate` in front of it.
 *
 * @param {string} what  named in the error if the company cannot be inferred
 */
export function publicTenantContext(what) {
  return (req, _res, next) => {
    resolveTenantWithoutSession(what)
      .then((tenant) => withTenant(tenant, next))
      .catch(next);
  };
}

/**
 * The tenant a query should be limited to, or null to leave it alone.
 * Throws when strict and nobody has said which company this is.
 */
function scopeFor(where) {
  if (isUnscoped()) return null;

  const tenant = currentTenant();
  if (tenant) return tenant;

  if (strict) {
    throw new Error(
      `A ${where} ran without a tenant context while more than one company exists on this deployment. `
      + 'Wrap request handling in tenantContextMiddleware, or, if this genuinely spans companies, '
      + 'in withoutTenant("why").',
    );
  }
  // Single company: nothing to leak. Recorded once so it is visible that the
  // guard is currently permissive rather than currently working.
  if (!hasTenantContext()) warnOnce(where);
  return null;
}

const warned = new Set();
function warnOnce(where, message) {
  if (warned.has(where) || warned.size > 40) return;
  warned.add(where);
  // A missing filter on a READ is harmless with one company, so it is debug.
  // A missing company on a WRITE orphans the row either way, so it is a warn.
  if (message) logger.warn(message);
  else logger.debug(`Tenant context absent for ${where} — permitted while a single company exists.`);
}

/**
 * Attach company isolation to one schema.
 *
 * @param {import('mongoose').Schema} schema
 * @param {{ modelName?: string }} [opts]
 */
export function attachTenancy(schema, opts = {}) {
  if (schema.path('tenant')) return schema; // already attached

  schema.add({
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
  });

  /* Every existing NON-UNIQUE index gets `tenant` in FRONT of it.
     MongoDB uses a compound index only from its leftmost field, so
     `{ assignedTo: 1, status: 1 }` cannot serve a query that also filters on
     tenant without scanning — and since the plugin adds that filter to every
     query, leaving the indexes alone would quietly turn each of them into a
     collection scan the first time a second company appears.

     UNIQUE INDEXES ARE LEFT EXACTLY AS THEY ARE, and that is not laziness.
     A `sparse unique` index skips a document only when it is missing EVERY
     indexed field. Prefixing one with `tenant` — which is now always set —
     means no document is ever skipped, so the sparseness silently evaporates
     and every row with a null value collides with every other. That is not
     theoretical: it is what this code did on its first run, and 391 activity
     rows sharing `providerEventId: null` stopped the migration dead.

     Uniqueness here is global on purpose. `providerEventId` is a provider's
     own id and a ticket number comes from one counter, so neither can collide
     across companies. Making a field unique PER company is a real decision
     about that field — `partialFilterExpression` on the field itself — and not
     something a generic plugin should infer. */
  for (const [fields, options] of schema.indexes()) {
    if ('tenant' in fields) continue;
    if (options?.unique) continue;
    // TTL indexes must be single-field — MongoDB refuses a compound one
    // outright. Worth stating because the refusal is the good outcome: a TTL
    // that silently stopped expiring would leave the ring registry growing
    // forever with nothing to show for it.
    if (options?.expireAfterSeconds !== undefined) continue;
    // A text index has one form per collection and cannot be prefixed either.
    if (Object.values(fields).includes('text')) continue;
    schema.index({ tenant: 1, ...fields }, { ...options, name: undefined });
  }

  /**
   * Stamp on create/save — and complain loudly if there is nothing to stamp.
   *
   * A document written with no company is invisible to every scoped query.
   * Nothing throws, nothing is logged, and the row sits there looking normal:
   * the same silence as the spaced phone numbers and the dead jobs.
   *
   * It happens when a WRITE occurs inside `withoutTenant`. Reading across
   * companies is the point of that helper; writing across them is meaningless,
   * because the new row has to belong to exactly one. A sweep should read
   * unscoped and then do each record's work inside `withRecordTenant(record)`.
   *
   * Loud rather than fatal while a single company exists — refusing the write
   * would turn an invisible notification into a failed job, which is worse for
   * a deployment that cannot leak anything anyway. Once strictness is armed it
   * throws, because then the row genuinely belongs to somebody.
   */
  /* ON VALIDATE, NOT ON SAVE. `insertMany` does not run save middleware — it
     validates each document and inserts in bulk. A stamp hung on `save` misses
     it entirely, which is precisely how the notification sweep wrote rows with
     no company while this guard sat there reporting nothing. `validate` runs
     for create, save and insertMany alike. */
  schema.pre('validate', function stampTenant(next) {
    if (!this.tenant) {
      const tenant = currentTenant();
      if (tenant) this.tenant = tenant;
      else if (this.isNew) {
        const name = opts.modelName || 'A document';
        const detail = `${name} is being created with no company. It will be invisible to every `
          + 'scoped query. A sweep that spans companies should wrap each record\'s work in '
          + 'withRecordTenant(record).';
        if (strict) return next(new Error(detail));
        warnOnce(`orphan:${name}`, detail);
      }
    }
    return next();
  });

  /**
   * Narrow a query's filter to one company.
   *
   * `setQuery` rather than `this.where({ tenant })` — `where` takes a path and
   * a value, not an object, so passing it one is silently ignored. That is how
   * the first version of this plugin managed to throw correctly in strict mode
   * while filtering absolutely nothing in normal mode: the half that shouts
   * worked, and the half that protects did not.
   */
  const narrow = (query, tenant) => {
    const filter = query.getFilter?.() || {};
    // A caller that named the tenant itself wins — migrations do this
    // deliberately when moving records between companies.
    if (filter.tenant !== undefined) return;
    query.setQuery({ ...filter, tenant });
  };

  /** Filter every read. */
  schema.pre(/^(find|count|distinct|estimatedDocumentCount)/, function filterByTenant(next) {
    const tenant = scopeFor(`${opts.modelName || 'query'} read`);
    if (tenant) narrow(this, tenant);
    next();
  });

  /** Filter every write that goes through a query rather than a document. */
  schema.pre(/^(updateOne|updateMany|replaceOne|findOneAnd|deleteOne|deleteMany)/, function filterWrites(next) {
    const tenant = scopeFor(`${opts.modelName || 'query'} write`);
    if (tenant) narrow(this, tenant);

    // An upsert that matched nothing must create the document inside the same
    // company, not outside every company.
    if (tenant && this.getUpdate?.()) {
      const update = this.getUpdate();
      if (!Array.isArray(update)) {
        update.$setOnInsert = { ...(update.$setOnInsert || {}), tenant };
        this.setUpdate(update);
      }
    }
    next();
  });

  /** Filter aggregations, which do not go through the query hooks at all. */
  schema.pre('aggregate', function filterAggregate(next) {
    const tenant = scopeFor(`${opts.modelName || 'aggregate'} pipeline`);
    if (tenant) {
      const asId = new mongoose.Types.ObjectId(String(tenant));
      // Unshifted so it runs before any $lookup or $group — filtering after a
      // grouping stage would produce totals that had already counted another
      // company's rows.
      this.pipeline().unshift({ $match: { tenant: asId } });
    }
    next();
  });

  if (opts.modelName) scopedModels.add(opts.modelName);
  return schema;
}

export default attachTenancy;
