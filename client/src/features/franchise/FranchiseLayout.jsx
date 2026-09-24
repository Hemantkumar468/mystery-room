import { Outlet } from 'react-router-dom';
import './franchise.css';

/**
 * The Franchise module's shell. Thin on purpose, same reasoning as
 * HrmsLayout: the sidebar, topbar and breadcrumbs come from the app shell.
 * The public enquiry form (FranchiseApplyPage) renders OUTSIDE this shell —
 * it has no login and no sidebar.
 */
export function FranchiseLayout() {
  return <Outlet />;
}

export default FranchiseLayout;
