/**
 * Framework-agnostic holder for the access token.
 *
 * `lib/api.js` needs the current token on every request and a way to signal
 * "auth is unrecoverable" — but it must not import from `app/`, because
 * `app/api/axiosBaseQuery.js` imports `lib/api.js` and the reverse edge would
 * close a dependency cycle (api → store → api).
 *
 * This module is the seam between them. It knows nothing about Redux, and
 * Redux writes into it. Previously `lib/api.js` reached directly into the
 * Zustand store, which is exactly the coupling that has to go.
 *
 * Persistence lives here too, so there is ONE place that decides how the
 * session is written to disk.
 */

const STORAGE_KEY = 'mr-erp-auth-v2';
/** Zustand's persisted key, read once so existing sessions survive the migration. */
const LEGACY_KEY = 'mr-erp-auth';

let accessToken = null;
let onAuthFailure = null;
let onTokenRefreshed = null;

export const getAccessToken = () => accessToken;

/**
 * Plain setter — deliberately silent. Used by the store's own listener when
 * Redux originated the change, and once at boot.
 */
export const setAccessToken = (token) => {
  accessToken = token ?? null;
};

/**
 * Used ONLY by `lib/api.js` after a silent 401 refresh, where axios is the
 * originator and Redux knows nothing about the new token yet. Notifying gets
 * it into Redux and localStorage; without this the refreshed session would
 * work until the next reload and then vanish.
 *
 * Separate from `setAccessToken` so the notify path cannot feed back into
 * itself — Redux writes silently, axios writes loudly. One direction each.
 */
export const applyRefreshedToken = (token) => {
  accessToken = token ?? null;
  if (onTokenRefreshed) onTokenRefreshed(accessToken);
};

export const setTokenRefreshedHandler = (fn) => {
  onTokenRefreshed = typeof fn === 'function' ? fn : null;
};

/**
 * Called by the axios interceptors when the session cannot be recovered —
 * no token to send, or the refresh itself failed. The app registers a
 * handler (see app/store.js) that runs the full logout cascade; without one
 * this is a no-op, so `lib/api.js` stays usable in isolation and in tests.
 */
export const setAuthFailureHandler = (fn) => {
  onAuthFailure = typeof fn === 'function' ? fn : null;
};

export const notifyAuthFailure = (reason) => {
  accessToken = null;
  if (onAuthFailure) onAuthFailure(reason);
};

/* ───────────────────────────── persistence ───────────────────────────── */

/** Write the session, or clear it when `session` is null. */
export function persistSession(session) {
  try {
    if (!session?.accessToken) localStorage.removeItem(STORAGE_KEY);
    else {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ accessToken: session.accessToken, user: session.user ?? null }),
      );
    }
  } catch {
    // Private-mode / quota failures must never break auth; the session simply
    // won't survive a reload.
  }
}

/**
 * Read the persisted session at boot.
 *
 * Falls back to Zustand's old envelope (`{ state: { accessToken, user } }`)
 * so anyone already signed in stays signed in across this migration, then
 * rewrites it in the new shape and drops the legacy key. Without this every
 * active session would be logged out the moment this ships.
 */
export function loadPersistedSession() {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      accessToken = parsed?.accessToken ?? null;
      return { accessToken, user: parsed?.user ?? null };
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      const session = {
        accessToken: parsed?.state?.accessToken ?? null,
        user: parsed?.state?.user ?? null,
      };
      accessToken = session.accessToken;
      if (session.accessToken) persistSession(session);
      localStorage.removeItem(LEGACY_KEY);
      return session;
    }
  } catch {
    // Corrupt storage — start signed out rather than crashing on boot.
  }
  return { accessToken: null, user: null };
}

export function clearPersistedSession() {
  accessToken = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}
