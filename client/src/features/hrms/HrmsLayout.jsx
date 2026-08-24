import { Outlet } from 'react-router-dom';
import './hrms.css';

/**
 * The HRMS module's shell. Thin on purpose, same reasoning as CrmLayout: the
 * sidebar, topbar and breadcrumbs come from the app shell, and module-specific
 * chrome would only make these pages look foreign.
 */
export function HrmsLayout() {
  return <Outlet />;
}

export default HrmsLayout;
