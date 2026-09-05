import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { franchiseRoutesConfig } from './franchise.routes.config.js';

/** The sidebar's Franchise items — permission-filtered and order-sorted from
 *  the same config routing and breadcrumbs use. */
export function useFranchiseNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(franchiseRoutesConfig, user);
}

export default useFranchiseNavItems;
