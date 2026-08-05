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

// Attach the in-memory access token to every request.
api.interceptors.request.use((cfg) => {
  // /auth/logout must stay in this allowlist: it needs no bearer token
  // server-side (no `authenticate` middleware on that route), and an
  // automatic logout (refresh failed / no token) clears the in-memory token
  // via notifyAuthFailure BEFORE logoutThunk's POST to /auth/logout fires —
  // without this, that call gets cancelled below and the httpOnly refresh
  // cookie is never cleared server-side on a forced logout.
  const isPublicCall = cfg.url === '/auth/login' || cfg.url === '/auth/refresh' || cfg.url === '/auth/logout';
  if (!isPublicCall) {
    const token = getAccessToken();
    if (!token) {
      notifyAuthFailure('no-token');
      return Promise.reject(new axios.Cancel('No access token available. Redirecting to login.'));
    }
    cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// Transparently refresh once on a 401, then replay the original request.
let refreshing = null;
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;
    const isAuthCall = config?.url?.includes('/auth/');
    if (response?.status === 401 && !config._retry && !isAuthCall) {
      config._retry = true;
      try {
        refreshing =
          refreshing || api.post('/auth/refresh').then((r) => r.data.data.accessToken);
        const token = await refreshing;
        refreshing = null;
        applyRefreshedToken(token);
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch (e) {
        refreshing = null;
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
