import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { crmRoutesConfig } from './crm.routes.config.js';

/** The sidebar's CRM items — permission-filtered and order-sorted from the
 *  same config routing and breadcrumbs use. */
export function useCrmNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(crmRoutesConfig, user);
}

export default useCrmNavItems;
