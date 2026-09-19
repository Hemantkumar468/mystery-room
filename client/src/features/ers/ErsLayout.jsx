import { Outlet } from 'react-router-dom';

/**
 * The ERS module's shell. Thin on purpose, the same call PurchaseLayout and
 * ImsLayout make: the sidebar, topbar and breadcrumbs come from the app shell.
 *
 * The client's reference mockup shipped its own sidebar and topbar; both are
 * deliberately NOT ported. The app already has them, and a second navigation
 * living inside a page is a second place for somebody to get lost.
 */
export function ErsLayout() {
  return <Outlet />;
}

export default ErsLayout;
