import axios from 'axios';
import { useAuthStore } from '../store/authStore.js';

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
});

// Attach the in-memory access token to every request.
api.interceptors.request.use((cfg) => {
  const isPublicCall = cfg.url === '/auth/login' || cfg.url === '/auth/refresh';
  if (!isPublicCall) {
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      useAuthStore.getState().logout();
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
        useAuthStore.getState().setToken(token);
        config.headers.Authorization = `Bearer ${token}`;
        return api(config);
      } catch (e) {
        refreshing = null;
        useAuthStore.getState().logout();
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
