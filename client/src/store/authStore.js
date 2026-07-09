import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Auth state. The access token lives in memory + localStorage for reloads;
 * the refresh token is an httpOnly cookie the browser sends automatically.
 */
export const useAuthStore = create(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setAuth: ({ user, accessToken }) => set({ user, accessToken }),
      setToken: (accessToken) => set({ accessToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null, accessToken: null }),
    }),
    {
      name: 'mr-erp-auth',
      partialize: (s) => ({ accessToken: s.accessToken, user: s.user }),
    },
  ),
);

export default useAuthStore;
