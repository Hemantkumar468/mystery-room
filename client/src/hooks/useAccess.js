import { useAppSelector } from '../app/hooks.js';
import { selectAccess } from '../app/slices/accessSlice.js';

/**
 * The permission map, bound to helpers, for components.
 *
 * USE THIS RATHER THAN the plain functions in lib/access.js anywhere a React
 * component is deciding what to draw. The plain functions read a module-level
 * mirror, which is correct but invisible to React — a component that only
 * called them would keep rendering yesterday's sidebar after an admin changed
 * the policy, because nothing told it to re-render. This subscribes.
 *
 *   const access = useAccess();
 *   access.showsModule('ims')                  // in the sidebar at all?
 *   access.step('property-assessment')         // can they open Step 3?
 *   access.step('property-assessment', 'edit') // can they WORK it?
 *   access.stage('hrms-offer')                 // may they see Offer?
 *
 * Unknown surfaces answer TRUE. A screen nobody has added to the catalogue is
 * ungated rather than invisible — shipping a page and forgetting to register
 * it should look like a missing permission, not like a missing page.
 */
export function useAccess() {
  return useAppSelector(selectAccess);
}

export default useAccess;
