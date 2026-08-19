import axios from 'axios';
import { getAccessToken, applyRefreshedToken, notifyAuthFailure } from './tokenStore.js';

// VITE_API_BASE_URL is the one place the backend's address is configured —
// set per environment in .env (local) / .env.production (deploy), never
// hardcoded here. Falls back to the relative '/api/v1' (same-origin, routed
// via vite.config.js's dev proxy in local dev, or a same-domain reverse
// proxy in production) if the variable is ever unset, so a missing .env
// degrades to the old same-origin behavior instead of breaking outright.
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

/**
 * How close to expiry counts as "already expired".
 *
 * The access token lives 15 minutes, and a request that leaves here valid can
 * still arrive after expiry on a slow link. Renewing 30s early closes that
 * window at no cost.
 */
const EXPIRY_SKEW_MS = 30_000;

/**
 * Read a JWT's `exp` WITHOUT verifying it.
 *
 * Deliberately not verification — the client cannot check a signature it has
 * no key for, and the server re-verifies every request regardless. This only
 * answers "is this token still worth sending?", so anything unparseable
 * returns null and gets sent as-is, leaving the server to be the one that
 * rejects it.
 */
function expiresAtOf(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * One refresh at a time, shared by every caller.
 *
 * The slot is cleared in `finally` — a single place — rather than by each
 * awaiter after its own `await`. The previous shape had every one of N
 * concurrent callers null the shared slot on the way out, so a request that
 * 401'd a tick later could open a second refresh against a cookie the first
 * had already rotated.
 */
let refreshing = null;
function refreshOnce() {
  if (!refreshing) {
    refreshing = api
      .post('/auth/refresh')
      .then((r) => r.data.data.accessToken)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/**
 * Attach the access token, renewing it first when it has already expired.
 *
 * Without this pre-check, the first page load after the 15-minute token life
 * ran out fired the whole screen's queries carrying a token already known to
 * be dead: every one 401'd, all of them queued behind a single refresh, then
 * all replayed. The session did recover — but at twice the requests and a wall
 * of red 401s in the console that looks exactly like a real auth failure and
 * cannot be told apart from one. Reading `exp` locally turns that into one
 * refresh and no failed calls.
 */
api.interceptors.request.use(async (cfg) => {
  // /auth/logout must stay in this allowlist: it needs no bearer token
  // server-side (no `authenticate` middleware on that route), and an
  // automatic logout (refresh failed / no token) clears the in-memory token
  // via notifyAuthFailure BEFORE logoutThunk's POST to /auth/logout fires —
  // without this, that call gets cancelled below and the httpOnly refresh
  // cookie is never cleared server-side on a forced logout.
  //
  // It also stops this interceptor recursing: the refresh POST below re-enters
  // here and must return early rather than try to refresh itself.
  const isPublicCall = cfg.url === '/auth/login' || cfg.url === '/auth/refresh' || cfg.url === '/auth/logout';
  if (isPublicCall) return cfg;

  let token = getAccessToken();

  if (token) {
    const expiresAt = expiresAtOf(token);
    if (expiresAt !== null && expiresAt - Date.now() <= EXPIRY_SKEW_MS) {
      try {
        token = await refreshOnce();
        applyRefreshedToken(token);
      } catch {
        // The refresh cookie is gone or was rejected — the session is over.
        // Falling through to the branch below keeps exactly one place in this
        // file that ends a session.
        token = null;
      }
    }
  }

  if (!token) {
    notifyAuthFailure('no-token');
    return Promise.reject(new axios.Cancel('No access token available. Redirecting to login.'));
  }

  cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/**
 * Safety net for a 401 that could not be predicted.
 *
 * The request interceptor already renews a token it can see is expired, so
 * this now covers only what `exp` cannot reveal: a token revoked server-side,
 * a signing-key rotation, or a device clock far enough out that the token
 * looked valid. It refreshes once and replays the original request.
 */
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;
    const isAuthCall = config?.url?.includes('/auth/');
    if (response?.status === 401 && !config._retry && !isAuthCall) {
      config._retry = true;
      try {
        const token = await refreshOnce();
        applyRefreshedToken(token);
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch (e) {
        notifyAuthFailure('refresh-failed');
        return Promise.reject(e);
      }
    }
    return Promise.reject(error);
  },
);

/** Unwrap the { success, data, meta } envelope into { data, meta }. */
export async function unwrap(promise) {
  const res = await promise;
  return { data: res.data.data, meta: res.data.meta };
}

export default api;
