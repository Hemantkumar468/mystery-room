import { QueryClient } from '@tanstack/react-query';
import { selectCurrentUser } from '../app/slices/authSlice.js';

/**
 * Server-state cache for the Delegation, Checklist and Organisation screens.
 *
 * The rest of the ERP caches through RTK Query (app/api); these screens were
 * built on TanStack Query and keep it, isolated to their own client here.
 */
export const opsQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Drop everything cached the moment the signed-in person changes — logout,
 * an expired session, or someone else signing in on the same browser. Keyed off
 * the auth slice rather than the logout button, so every way out is covered and
 * nobody ever sees the previous user's tasks.
 */
const userIdOf = (state) => {
  const user = selectCurrentUser(state);
  return String(user?.id ?? user?._id ?? '');
};

export function clearOpsCacheOnUserChange(store) {
  let lastUserId = userIdOf(store.getState());
  return store.subscribe(() => {
    const id = userIdOf(store.getState());
    if (id === lastUserId) return;
    lastUserId = id;
    opsQueryClient.clear();
  });
}

export default opsQueryClient;
