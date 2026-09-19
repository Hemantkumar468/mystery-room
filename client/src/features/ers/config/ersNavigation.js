import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { ersRoutesConfig } from './ers.routes.config.js';

/** The sidebar's ERS items — permission-filtered and order-sorted from the
 *  same config routing and breadcrumbs read. */
export function useErsNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(ersRoutesConfig, user);
}

export default useErsNavItems;
