import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { imsRoutesConfig } from './ims.routes.config.js';

/** The sidebar's Inventory items — permission-filtered and order-sorted from
 *  the same config routing and breadcrumbs read. */
export function useImsNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(imsRoutesConfig, user);
}

export default useImsNavItems;
