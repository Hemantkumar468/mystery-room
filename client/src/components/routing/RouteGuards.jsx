import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '../../app/hooks.js';
import { selectIsAuthenticated, selectCurrentUser } from '../../app/slices/authSlice.js';
import { hasPermission } from '../../lib/permissions.js';
import { useAccess } from '../../hooks/useAccess.js';
import { ACCESS } from '../../lib/access.js';

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

/**
 * Route gate for the saved access policy — the half that answers a typed URL.
 *
 * Hiding a step in the sidebar hides the LINK; the page behind it still
 * renders for anyone who knows the address, which is exactly the hole the
 * nav-only filtering left before this module existed. Wrapping the route
 * closes it, off the same key the sidebar filtered on.
 *
 * Redirects rather than showing a refusal screen, matching Gate in App.jsx:
 * somebody who followed a link that is no longer theirs is best served by
 * being put back somewhere useful, and whoever changed the policy already
 * knows they changed it.
 *
 * A surface the catalogue does not know is ALLOWED through — see
 * lib/access.js#levelOf for why unknown is not the same answer as no.
 */
export function RequireAccess({ surface, level = ACCESS.VIEW, redirectTo = '/', children }) {
  const access = useAccess();
  if (!access.can(surface, level)) return <Navigate to={redirectTo} replace />;
  return children;
}
