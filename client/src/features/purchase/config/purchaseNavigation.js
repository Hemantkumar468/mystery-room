import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { useAccess } from '../../../hooks/useAccess.js';
import { purchaseRoutesConfig } from './purchase.routes.config.js';

/** The sidebar's Purchase items — permission-filtered and order-sorted from
 *  the same config routing and breadcrumbs use. */
export function usePurchaseNavItems() {
  const user = useAppSelector(selectCurrentUser);
  /* Subscribes this hook to the access policy. The filtering itself happens
     inside buildNavItems (which reads the plain mirror in lib/access.js, so
     it stays a pure function) — this is what makes the sidebar RE-RENDER
     when an admin changes the policy, instead of showing the old items until
     the next navigation. */
  useAccess();

  return buildNavItems(purchaseRoutesConfig, user);
}

export default usePurchaseNavItems;
