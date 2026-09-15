import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { propertyFmsRoutesConfig } from './propertyFms.routes.config.js';

/** The sidebar's Property FMS items — permission-filtered and order-sorted
 *  from the same config routing and breadcrumbs use. */
export function usePropertyFmsNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(propertyFmsRoutesConfig, user);
}

export default usePropertyFmsNavItems;
