import { Suspense } from 'react';
import { Route, useLocation, matchPath } from 'react-router-dom';
import { RequireRole } from '../components/routing/RouteGuards.jsx';
import { PageLoader } from '../components/ui/primitives.jsx';
import { hasPermission } from './permissions.js';

/**
 * Generic route-config → React Router / Sidebar / Breadcrumb glue.
 *
 * Every top-level module (EMS today, CRM/HRMS/Inventory/Finance later)
 * declares ONE config array of route descriptors:
 *
 *   { key, path, element, title, icon, breadcrumb, permission, sidebar,
 *     order, description, parentKey }
 *
 * `path` is the route's full absolute URL (e.g. "/ems/expenses/new").
 * `element` is a React.lazy() component. `permission` is
 * `{allowed:[...roles]} | {check:fn} | undefined` — consumed identically by
 * route guarding, nav filtering, and (for entries with no `parentKey`
 * ancestor left to walk) breadcrumb resolution, all via
 * lib/permissions.js#hasPermission.
 *
 * These functions are the ONLY way anything reads a module's config — the
 * router, the sidebar, and breadcrumbs all go through here, so there is
 * exactly one place that understands the config shape. Nothing in this file
 * imports from any specific module (features/expenses/…) — that's what
 * keeps it reusable as-is by the next module built after EMS.
 */

/**
 * Builds `<Route>` elements for a module's config, to be rendered as the
 * children of that module's `<Route path="{mountPath}/*" element={<Layout/>}>`.
 * `mountPath` (e.g. "/ems") is stripped from each entry's absolute `path` to
 * produce the relative path React Router expects for nested route children.
 */
export function buildRouteElements(config, mountPath) {
  const prefix = mountPath.endsWith('/') ? mountPath : `${mountPath}/`;
  return config.map((entry) => {
    const relativePath = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.path;
    const Lazy = entry.element;
    let node = (
      <Suspense fallback={<PageLoader />}>
        <Lazy />
      </Suspense>
    );
    if (entry.permission) {
      node = (
        <RequireRole requirement={entry.permission}>
          {node}
        </RequireRole>
      );
    }
    return <Route key={entry.key} path={relativePath} element={node} />;
  });
}

/**
 * Sidebar nav items for a module: only `sidebar: true` entries, filtered by
 * the current user's permission, sorted by `order`. Frontend permission
 * filtering here HIDES items the user can't reach rather than showing them
 * disabled — matches this app's standing "frontend only hides actions"
 * convention (the real enforcement is server-side, once real endpoints exist).
 */
export function buildNavItems(config, user) {
  return config
    .filter((entry) => entry.sidebar)
    .filter((entry) => hasPermission(user, entry.permission))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((entry) => ({ to: entry.path, label: entry.title, icon: entry.icon, key: entry.key, soon: !!entry.soon }));
}

/**
 * Walks a route's `parentKey` chain to build its breadcrumb trail, from the
 * config array and a pathname — pure function, no router context needed.
 * A `seen` guard prevents an infinite loop if a config ever has a circular
 * parentKey by mistake.
 */
export function resolveBreadcrumbTrail(config, pathname) {
  const byKey = new Map(config.map((entry) => [entry.key, entry]));
  const current = config.find((entry) => matchPath({ path: entry.path, end: true }, pathname));
  if (!current) return [];
  const trail = [];
  const seen = new Set();
  let node = current;
  while (node && !seen.has(node.key)) {
    seen.add(node.key);
    trail.unshift(node);
    node = node.parentKey ? byKey.get(node.parentKey) : null;
  }
  return trail;
}

/** Hook form of resolveBreadcrumbTrail, reading the current location. */
export function useBreadcrumbTrail(config) {
  const { pathname } = useLocation();
  return resolveBreadcrumbTrail(config, pathname);
}

/** Resolves the config entry matching the current URL — lets a page read its
 * own title/description/breadcrumb without duplicating that data locally. */
export function useCurrentRouteMeta(config) {
  const { pathname } = useLocation();
  return config.find((entry) => matchPath({ path: entry.path, end: true }, pathname)) ?? null;
}
