import { Outlet } from 'react-router-dom';

/**
 * The IMS module's shell. Thin on purpose, the same call PurchaseLayout makes:
 * the sidebar, topbar and breadcrumbs come from the app shell, and
 * module-specific chrome would only make these pages look foreign.
 */
export function ImsLayout() {
  return <Outlet />;
}

export default ImsLayout;
