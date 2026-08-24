import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { hrmsRoutesConfig } from './hrms.routes.config.js';

/** The sidebar's HRMS items — permission-filtered and order-sorted from the
 *  same config routing and breadcrumbs use. */
export function useHrmsNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(hrmsRoutesConfig, user);
}

export default useHrmsNavItems;
