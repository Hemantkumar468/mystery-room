import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '../../config/logger.js';

/**
 * Which company the current unit of work belongs to.
 *
 * AsyncLocalStorage rather than a parameter threaded through every call. The
 * filter has to reach `Lead.find()` in a service four layers below the route,
 * and a parameter that has to be passed by hand is a parameter somebody
 * eventually does not pass — which is exactly the failure mode being designed
 * out. Node keeps this bound across awaits, so one `run()` at the edge covers
 * everything the request touches.
 *
 * THREE STATES, and the difference matters:
 *
 *   - a tenant is set     → every query is filtered to it;
 *   - explicitly unscoped → a job, a migration or a sweep that legitimately
 *     spans companies, wrapped in `withoutTenant(reason)` so the exemption is
 *     named, greppable, and logged rather than accidental;
 *   - nothing at all      → see `assertScopable` in tenancy.js. Today that is
 *     harmless because one company exists; the moment a second one does it
 *     becomes an error.
 */

const store = new AsyncLocalStorage();

/**
 * Await `fn`'s result INSIDE the context.
 *
 * This is not ceremony. A Mongoose query is lazy: `Lead.find(...)` builds a
 * Query and does not touch the database until something awaits it. So
 * `store.run(ctx, () => Lead.find(...))` returns the unexecuted Query, `run`
 * exits, and the query then executes with no context at all — reading every
 * company's rows while looking completely correct at the call site.
 *
 * That is exactly what the first version of this file did. It was caught only
 * because strict mode threw on the same queries that were silently returning
 * everything in normal mode. Awaiting here keeps the context alive for the
 * execution, so callers can write the natural thing.
 */
async function inside(fn) {
  return fn();
}

/** Run `fn` with every query inside it filtered to one company. */
export function withTenant(tenantId, fn) {
  if (!tenantId) throw new Error('withTenant needs a tenant id.');
  return store.run({ tenant: String(tenantId), unscoped: false }, () => inside(fn));
}

/**
 * Run `fn` across ALL companies, on purpose.
 *
 * For nightly sweeps, migrations and the seed — work that is about the
 * deployment rather than about one customer. The reason is required and is
 * logged the first time each distinct one is used, so this cannot become the
 * quiet default that turns the whole guard off.
 */
const announced = new Set();
export function withoutTenant(reason, fn) {
  if (!reason) throw new Error('withoutTenant needs a reason — an unscoped query has to justify itself.');
  if (!announced.has(reason)) {
    announced.add(reason);
    logger.info(`Tenant scoping deliberately bypassed: ${reason}`);
  }
  return store.run({ tenant: null, unscoped: true }, () => inside(fn));
}

/**
 * Run per-record work inside the company that RECORD belongs to.
 *
 * The shape every sweep needs. A nightly job legitimately spans companies, so
 * it reads inside `withoutTenant` — but the things it then WRITES (a
 * notification, an activity, a follow-up task) belong to one company: the one
 * the record it is acting on belongs to. Without this the writes inherit the
 * unscoped context, land with no tenant at all, and become invisible to
 * everybody. That is not hypothetical — it is how 421 notifications and
 * activities ended up orphaned the first week this existed.
 *
 * @param {{tenant?: unknown}} record  the row being processed
 */
export function withRecordTenant(record, fn) {
  const tenant = record?.tenant;
  if (!tenant) return inside(fn);
  return withTenant(tenant, fn);
}

/** The company for the current work, or null. */
export function currentTenant() {
  return store.getStore()?.tenant ?? null;
}

/** True inside `withoutTenant`. */
export function isUnscoped() {
  return store.getStore()?.unscoped === true;
}

/** True when something has been said either way. */
export function hasTenantContext() {
  return store.getStore() !== undefined;
}

/**
 * Express middleware: bind the session's company for the rest of the request.
 *
 * FROM THE SESSION, NEVER THE REQUEST BODY — the same rule as `ownerId`,
 * `assignedTo` and `isSeed`. A tenant a caller can name is a tenant a caller
 * can pick, and picking somebody else's is the whole attack.
 *
 * Mounted after `authenticate`. An unauthenticated request has no company, and
 * the routes it can reach do not read tenant-scoped data.
 */
export function tenantContextMiddleware(req, res, next) {
  const tenant = req.user?.tenant;
  if (!tenant) return next();
  return withTenant(tenant, () => next());
}

export default { withTenant, withoutTenant, currentTenant };
