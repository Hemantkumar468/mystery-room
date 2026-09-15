import { Outlet } from 'react-router-dom';
import './propertyFms.css';

/**
 * The Property FMS module's shell. Thin on purpose, same reasoning as
 * FranchiseLayout — the sidebar, topbar and breadcrumbs come from the app
 * shell; this just brings the module's stylesheet along for every page under it.
 */
export function PropertyFmsLayout() {
  return <Outlet />;
}

export default PropertyFmsLayout;
