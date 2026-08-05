/**
 * Generic, module-agnostic permission-check helper. Consumed by RouteGuards,
 * PermissionGate, and moduleRoutes.jsx's nav/breadcrumb builders — one place
 * that turns a route's declared `permission` requirement into a yes/no for
 * the current user, so every module (EMS today, CRM/HRMS/Inventory/Finance
 * later) shares the exact same rule instead of each hand-rolling role checks.
 *
 * This is a UX-only gate, same as every other frontend permission check in
 * this app (see lib/ui.js) — the backend's own authorize() middleware
 * (server/src/core/middleware/auth.js) is the real security boundary.
 *
 * `requirement` shape: {allowed: string[]} | {check: (user) => boolean} | null|undefined.
 * No requirement means the route/action is open to any authenticated user.
 */
export function hasPermission(user, requirement) {
  if (!requirement) return true;
  if (typeof requirement.check === 'function') return Boolean(requirement.check(user));
  if (Array.isArray(requirement.allowed)) {
    return Boolean(user && requirement.allowed.includes(user.role));
  }
  return true;
}

export default hasPermission;
