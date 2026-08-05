import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../app/hooks.js';
import { selectIsAuthenticated, selectCurrentUser } from '../../app/slices/authSlice.js';
import { hasPermission } from '../../lib/permissions.js';

/**
 * Auth-only gate. Moved here from App.jsx (where it was previously defined
 * inline) so RequireRole below has a shared home instead of duplicating the
 * "read auth state, redirect" pattern — behavior is byte-for-byte unchanged,
 * only the location moved. Every existing route this wraps keeps working
 * exactly as before.
 */
export function RequireAuth({ children }) {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

/**
 * Route-level permission gate. UX convenience only — the backend's own
 * authorize() checks are the real security boundary (see
 * server/src/core/middleware/auth.js). `requirement` is the same shape a
 * module's route config declares under `permission`
 * (see lib/moduleRoutes.jsx): {allowed:[...roles]} | {check:fn} | undefined.
 */
export function RequireRole({ requirement, redirectTo = '/', children }) {
  const user = useAppSelector(selectCurrentUser);
  if (!hasPermission(user, requirement)) return <Navigate to={redirectTo} replace />;
  return children;
}
