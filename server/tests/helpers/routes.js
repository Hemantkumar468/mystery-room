/**
 * What is actually mounted on the app.
 *
 * WHY THIS EXISTS, AND WHAT IT REPLACES. The first version of the registration
 * tests hit each path over HTTP without a token and treated 401 as "the route
 * exists" and 404 as "it does not". That was wrong, and wrong in the worst
 * way: every CRM router sits behind a blanket `router.use(authenticate)`, so
 * the 401 is returned BEFORE any route matching happens. `/crm/tickets` and
 * `/crm/this-route-does-not-exist` both answered 401, which means those
 * assertions would have passed for a module that had never been written.
 *
 * That is precisely the failure the Agenda outage taught — a check that sits
 * inside the boundary it claims to be testing, staying green while the thing
 * it names is missing. Authenticating first does not fix it either: a handler
 * that legitimately answers "not found" for a made-up id is indistinguishable
 * over HTTP from a route that was never mounted.
 *
 * So this asks Express directly. A path is registered or it is not, and there
 * is nothing for the answer to be confused with.
 */

/** Express 4 keeps the stack on `_router`; 5 exposes `router`. */
function stackOf(app) {
  const router = app?._router || app?.router;
  if (!router?.stack) {
    throw new Error('Could not read the Express route stack — the app was not built as expected.');
  }
  return router.stack;
}

/**
 * Every mounted route, as a Set of `"GET /api/v1/crm/tickets"` strings.
 *
 * Mount prefixes are recovered from each router layer's own regexp, because
 * Express does not keep the literal prefix anywhere else.
 */
export function registeredRoutes(app) {
  const found = new Set();

  const prefixOf = (layer) => {
    const source = layer?.regexp?.source;
    if (!source || layer.regexp.fast_slash) return '';
    // "^\/api\/v1\/crm\/?(?=\/|$)" → "/api/v1/crm"
    const match = source
      .replace(/^\^/, '')
      .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
      .replace(/\$$/, '')
      .replace(/\\\//g, '/');
    return match.startsWith('/') ? match : '';
  };

  const walk = (layer, prefix) => {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/\/+/g, '/');
      for (const method of Object.keys(layer.route.methods)) {
        found.add(`${method.toUpperCase()} ${path}`);
      }
      return;
    }
    if (layer.handle?.stack) {
      const next = `${prefix}${prefixOf(layer)}`;
      for (const child of layer.handle.stack) walk(child, next);
    }
  };

  for (const layer of stackOf(app)) walk(layer, '');
  return found;
}

/**
 * Assert a list of `[method, path]` pairs are all mounted.
 *
 * @param {object} app        an app from createApp()
 * @param {Array<[string,string]>} expected
 * @param {{ok: Function, no: Function}} assert  the suite's own reporters
 * @param {string} [prefix]   mount prefix, e.g. '/api/v1'
 */
export function assertRoutesRegistered(app, expected, { ok, no }, prefix = '/api/v1') {
  const mounted = registeredRoutes(app);
  for (const [method, path] of expected) {
    const key = `${method.toUpperCase()} ${prefix}${path}`.replace(/\/+/g, '/');
    if (mounted.has(key)) ok(`${method} ${path} is mounted`);
    else {
      // Show the near misses: a typo in a path is far more common than a route
      // that was genuinely never written, and a bare "missing" hides that.
      const near = [...mounted].filter((m) => m.includes(path.split('/')[2] || path)).slice(0, 4);
      no(`${method} ${path} is mounted`, near.length ? `not found. Nearby: ${near.join(', ')}` : 'not found, and nothing similar is mounted');
    }
  }
  return mounted;
}

export default registeredRoutes;
