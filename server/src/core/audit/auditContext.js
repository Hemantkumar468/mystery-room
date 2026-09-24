import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is doing the thing being audited.
 *
 * SAME REASONING AS THE TENANT CONTEXT, and the same mechanism. The audit hook
 * fires inside a Mongoose middleware four layers below the route; the actor is
 * known only at the route. Threading a `user` argument down through every
 * service method to reach it would mean every future service has to remember,
 * and the failure mode of forgetting is an audit row that says a change was
 * made by nobody — which is worse than no row, because it looks complete.
 *
 * A write with no actor is still recorded. A migration, a seed and a nightly
 * sweep all genuinely have no user behind them, and "the system did it" is a
 * true and useful answer.
 */

const store = new AsyncLocalStorage();

/** Await inside the context — see the note in tenantContext.js about lazy
 *  Mongoose queries escaping a `run()` that has already returned. */
async function inside(fn) {
  return fn();
}

/**
 * Run `fn` with every audited write attributed to this user.
 * @param {{_id?: unknown, id?: unknown, name?: string, role?: string}} user
 * @param {{ip?: string}} [meta]
 */
export function withActor(user, fn, meta = {}) {
  if (!user) return inside(fn);
  return store.run(
    {
      id: user._id || user.id,
      name: user.name,
      role: user.role,
      ip: meta.ip,
    },
    () => inside(fn),
  );
}

/** The current actor, or null when the system is acting on its own. */
export function currentActor() {
  return store.getStore() || null;
}

/**
 * Express middleware. Mounted immediately after `authenticate`, so every
 * request handler runs inside it.
 */
export function auditContextMiddleware(req, _res, next) {
  if (!req.user) return next();
  return withActor(req.user, next, { ip: req.ip });
}

export default withActor;
