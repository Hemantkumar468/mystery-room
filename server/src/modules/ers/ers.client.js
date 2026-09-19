import { config } from '../../config/index.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { logger } from '../../config/logger.js';

/**
 * The one place this app talks to ERS 2.0 (feedback.mysteryrooms.co.in).
 *
 * WHY A SERVER-SIDE PROXY AT ALL, when the leaderboard endpoint answers without
 * a token. Two reasons, and the first is not a preference:
 *
 *   1. THEIR API SENDS NO CORS HEADERS. Verified against the live host — a
 *      200 from /api/leaderboard/v2 carries no `Access-Control-Allow-Origin`,
 *      and the OPTIONS preflight is answered 401. A browser will refuse every
 *      call regardless of what we do on our side.
 *   2. The endpoints we will need next (/api/feedback, /api/dashboard/stats)
 *      require an API key, and a key shipped to the browser is a key anyone
 *      can read out of the bundle.
 *
 * So the browser talks to us and we talk to them. The key, when the client
 * supplies one, lives in `ERS_API_KEY` and never leaves this process.
 *
 * READ-ONLY, DELIBERATELY. This module issues GETs and nothing else. The ERP
 * displays their ratings; it does not create, edit or moderate them, and there
 * is no code path here that could.
 */

const BASE = (config.ers?.baseUrl || 'https://feedback.mysteryrooms.co.in').replace(/\/$/, '');
const KEY = config.ers?.apiKey || '';

/**
 * A short memory of what upstream last said.
 *
 * The leaderboard is ONE upstream call that returns all 148 employees, and our
 * pages then search, sort and page over it — so a user typing in the search box
 * would otherwise fire an upstream request per keystroke against somebody
 * else's production server. 60 seconds is long enough to absorb a burst of
 * interaction and short enough that a rating recorded a minute ago shows up.
 */
const cache = new Map();
const TTL_MS = 60_000;

const cacheKey = (path, params) => `${path}?${new URLSearchParams(params)}`;

export function invalidateErsCache() {
  cache.clear();
}

/**
 * GET from ERS and hand back the parsed body.
 *
 * Their envelope is `{ success, message, data }` — the same shape as ours, but
 * it is THEIR shape, so it is unwrapped here rather than leaking into our
 * services. A non-2xx or `success: false` becomes one of our ApiErrors, so an
 * upstream outage reads like every other failure in this app instead of an
 * unhandled fetch rejection.
 */
export async function ersGet(path, params = {}, { cacheable = true } = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  const key = cacheKey(path, clean);

  if (cacheable) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  }

  const qs = new URLSearchParams(clean).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
      },
      /* Their host is outside our control; without a deadline one slow response
         holds a request thread of ours open indefinitely. */
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    logger.warn(`ERS unreachable: ${err.message} (${path})`);
    throw new ApiError(502, 'The employee review service did not respond.', { code: 'ERS_UNREACHABLE' });
  }

  const body = await res.json().catch(() => null);

  if (res.status === 401 || res.status === 403) {
    throw new ApiError(
      502,
      KEY
        ? 'The employee review service rejected our API key.'
        : 'That part of the employee review service needs an API key, which has not been configured yet (ERS_API_KEY).',
      { code: 'ERS_UNAUTHORIZED' },
    );
  }
  if (!res.ok || body?.success === false) {
    throw new ApiError(502, body?.message || `The employee review service returned ${res.status}.`, { code: 'ERS_UPSTREAM' });
  }

  if (cacheable) cache.set(key, { at: Date.now(), body });
  return body;
}

/** Whether a key is configured — the pages use this to explain a 502 honestly. */
export const ersHasKey = () => Boolean(KEY);

export default ersGet;
