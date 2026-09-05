import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { purchaseRoutesConfig } from './purchase.routes.config.js';

/** The sidebar's Purchase items — permission-filtered and order-sorted from
 *  the same config routing and breadcrumbs use. */
export function usePurchaseNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(purchaseRoutesConfig, user);
}

export default usePurchaseNavItems;
