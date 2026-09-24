import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { crmRoutesConfig } from './crm.routes.config.js';

/** The `<Route>` children App.jsx renders under `/crm/*`. Built from the same
 *  config the sidebar and breadcrumbs read, so the three cannot disagree. */
export const crmRouteElements = buildRouteElements(crmRoutesConfig, '/crm');

export default crmRouteElements;
