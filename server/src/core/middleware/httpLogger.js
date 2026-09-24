import { logger } from '../../config/logger.js';
import { config } from '../../config/index.js';

/**
 * One log line per request, at a level that means something.
 *
 * This replaces a morgan format string, and the difference is not cosmetic:
 *
 *  - LEVEL FOLLOWS OUTCOME. A 500 logs at `error`, a 4xx at `warn`, a slow but
 *    successful request at `warn`, everything else at `http`. So "show me
 *    today's failures" is a level filter, not a grep over a wall of identical
 *    lines — which is what made the old log unreadable in production, where
 *    every request looked exactly as important as every other.
 *
 *  - THE FIELDS ARE FIELDS, not a sentence. In production the logger emits
 *    JSON, so `status`, `durationMs`, `userId` and `requestId` arrive as real
 *    keys that a log tool can filter and chart. A formatted string can only be
 *    grepped. Locally the same data prints as one readable line.
 *
 *  - IT NAMES THE ROUTE, not just the URL. `/pms/tasks/:id` groups; the
 *    thousand distinct ids it expands to do not. Both are logged: `route` to
 *    aggregate on, `url` to reproduce with.
 *
 * Mounted before the router but logging on `finish`, so `req.user` (set later
 * by the auth middleware) is populated by the time this runs.
 */

/** Query values are user input, and secrets end up in them. Never log them raw. */
const SENSITIVE = /token|password|secret|key|auth|otp/i;
const safeUrl = (req) => {
  const [path, query] = req.originalUrl.split('?');
  if (!query) return path;
  const kept = query.split('&').map((pair) => {
    const [k] = pair.split('=');
    return SENSITIVE.test(k) ? `${k}=***` : pair;
  });
  return `${path}?${kept.join('&')}`;
};

/**
 * `/api/v1/pms/tasks/:id` — the pattern, so a thousand ids aggregate into one
 * row instead of a thousand.
 *
 * Derived from the URL rather than from `req.route`, deliberately: Express
 * unwinds `req.baseUrl` once the router finishes, and this logs on `finish`,
 * so asking Express yields the bare fragment `/:id/tracking` with no idea
 * which resource it belonged to. Normalising the path needs no framework
 * internals and works for 404s too, which never matched a route at all.
 */
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z]{2,4}-[A-Z0-9]+-\d+/;           // MR-NOI-001-T001, and its kin
export const routeOf = (req) => {
  const path = req.originalUrl.split('?')[0];
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (OBJECT_ID.test(seg) || UUID.test(seg)) return ':id';
      if (CODE.test(seg)) return ':code';
      if (/^\d+$/.test(seg)) return ':n';
      return seg;
    })
    .join('/') || '/';
};

/**
 * Not worth a line each: the load balancer's liveness probe (every few
 * seconds, forever) and CORS preflights, which carry no outcome of their own.
 * Both are still counted, so "how many requests has this process served" stays
 * honest.
 */
const isNoise = (req) => req.originalUrl === '/health' || req.method === 'OPTIONS';

export const stats = { requests: 0, errors: 0, startedAt: Date.now() };

export function httpLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    stats.requests += 1;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const status = res.statusCode;
    const slow = durationMs >= config.log.slowMs;
    if (status >= 500) stats.errors += 1;
    if (isNoise(req)) return;

    const meta = {
      http: true, // the console formatter prints these as one line, not JSON
      requestId: req.id,
      method: req.method,
      url: safeUrl(req),
      route: routeOf(req),
      status,
      durationMs: Math.round(durationMs),
      bytes: Number(res.getHeader('content-length')) || 0,
      userId: req.user?.id || null,
      user: req.user?.email || 'anonymous',
      ip: req.ip,
      slow: slow || undefined,
    };

    // The human line, for a terminal. The fields above are what a log tool reads.
    const line = [
      `${req.method} ${meta.url}`,
      `${status}`,
      `${meta.durationMs}ms`,
      meta.bytes ? `${meta.bytes}b` : null,
      `user=${meta.user}`,
      `req=${String(req.id).slice(0, 8)}`,
      slow ? `SLOW(>${config.log.slowMs}ms)` : null,
    ].filter(Boolean).join(' ');

    /* A successful request logs at INFO, not at winston's `http` level, and
       that detail is the difference between having an access log and not
       having one: `http` sits BELOW `info` in the npm level ladder, so with
       the default LOG_LEVEL=info every 2xx was being computed, formatted and
       then silently discarded. The log appeared to contain nothing but
       failures — which is exactly the symptom that started this. */
    if (status >= 500) logger.error(line, meta);
    else if (status >= 400) logger.warn(line, meta);
    else if (slow) logger.warn(line, meta);
    else logger.info(line, meta);
  });

  next();
}

export default httpLogger;
