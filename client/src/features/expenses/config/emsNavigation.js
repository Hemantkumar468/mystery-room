import { useAppSelector } from '../../../app/hooks.js';
import { selectCurrentUser } from '../../../app/slices/authSlice.js';
import { buildNavItems } from '../../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './ems.routes.config.js';

/** Sidebar reads EMS's nav items through this hook — permission-filtered
 * and order-sorted from the same config routing/breadcrumbs use. */
export function useEmsNavItems() {
  const user = useAppSelector(selectCurrentUser);
  return buildNavItems(emsRoutesConfig, user);
}

export default useEmsNavItems;
