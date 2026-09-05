import { PMS_NAV, MASTER_NAV, ADMIN_NAV } from './Sidebar.jsx';
import { hrmsRoutesConfig } from '../../features/hrms/config/hrms.routes.config.js';
import { purchaseRoutesConfig } from '../../features/purchase/config/purchase.routes.config.js';
import { franchiseRoutesConfig } from '../../features/franchise/config/franchise.routes.config.js';

/**
 * Every path the sidebar itself links to.
 *
 * These are the app's top-level destinations: the sidebar is always on screen
 * and every one of them is one click away from every other, so a back arrow on
 * them points at browsing history rather than at any structure the user can
 * see. "Back" from Dashboard to My Tasks is not going up a level, it is undoing
 * a sidebar click — Topbar uses this to stand its arrow down on these pages and
 * keep it for the detail and report pages the sidebar cannot reach.
 *
 * Derived from the nav arrays the sidebar renders, never a second hand-written
 * list — a moved route or a new entry has to stay in step by construction.
 * Module route configs (HRMS, Purchase and Franchise today; CRM joins by
 * adding its config here when Sidebar.jsx's CRM block is uncommented)
 * contribute the entries they mark `sidebar: true`; parameterised paths are
 * detail pages, not nav entries.
 */
const MODULE_CONFIGS = [hrmsRoutesConfig, purchaseRoutesConfig, franchiseRoutesConfig];

const TOP_LEVEL_PATHS = new Set([
  ...[...PMS_NAV, ...MASTER_NAV, ...ADMIN_NAV].map((item) => item.to),
  ...MODULE_CONFIGS.flatMap((config) =>
    config
      .filter((entry) => entry.sidebar && !entry.path.includes(':'))
      .map((entry) => entry.path),
  ),
]);

/** Trailing slashes don't make a different page: '/projects/' is '/projects'. */
const normalisePath = (pathname) => {
  if (typeof pathname !== 'string' || pathname === '') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** Is this pathname one of the sidebar's own destinations? */
export function isTopLevelNavPath(pathname) {
  return TOP_LEVEL_PATHS.has(normalisePath(pathname));
}

export default isTopLevelNavPath;
