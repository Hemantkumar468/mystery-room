import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { hasPermission } from '../../lib/permissions.js';

/**
 * Component-level permission gate — conditionally renders a piece of UI (a
 * button, an action, a section) rather than redirecting away from a whole
 * route (that's RequireRole, see components/routing/RouteGuards.jsx). Same
 * `requirement` shape and same UX-only caveat: the backend is the real
 * enforcement point once real endpoints exist behind it.
 *
 * No call sites yet as of EMS Step 1 (no action buttons exist yet in the
 * module). Shipped now as scaffolding so Step 2+'s first Approve/Reject-
 * style button has a ready-made, already-reviewed pattern to use instead of
 * a new one being invented ad hoc partway through business-logic work.
 */
export function PermissionGate({ requirement, fallback = null, children }) {
  const user = useAppSelector(selectCurrentUser);
  return hasPermission(user, requirement) ? children : fallback;
}

export default PermissionGate;
