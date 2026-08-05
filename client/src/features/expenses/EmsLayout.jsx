import { Outlet } from 'react-router-dom';

/**
 * EMS's module shell — deliberately thin. PageHeader/Breadcrumb/etc. are
 * each page's own concern via ModulePageShell (components/layout/
 * ModulePageShell.jsx); this layout's only job is to exist as the mount
 * point for the /ems/* route subtree, so EMS reads as a first-class module
 * with its own layout file rather than routes bolted onto App.jsx directly.
 */
export function EmsLayout() {
  return <Outlet />;
}

export default EmsLayout;
