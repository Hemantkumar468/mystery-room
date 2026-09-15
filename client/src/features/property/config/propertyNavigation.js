import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { propertyRoutesConfig } from './property.routes.config.js';

/** The sidebar's Property items — permission-filtered and order-sorted from
 *  the same config routing and breadcrumbs use. */
export function usePropertyNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(propertyRoutesConfig, user);
}

export default usePropertyNavItems;
