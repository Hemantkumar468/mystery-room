import { Outlet } from 'react-router-dom';
import './purchase.css';

/**
 * The Purchase module's shell. Thin on purpose, same reasoning as HrmsLayout:
 * the sidebar, topbar and breadcrumbs come from the app shell, and
 * module-specific chrome would only make these pages look foreign.
 */
export function PurchaseLayout() {
  return <Outlet />;
}

export default PurchaseLayout;
