import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { purchaseRoutesConfig } from './purchase.routes.config.js';

/** The `<Route>` children App.jsx renders under `/purchase/*` — built from the
 *  same config the sidebar and breadcrumbs read, so they cannot disagree. */
export const purchaseRouteElements = buildRouteElements(purchaseRoutesConfig, '/purchase');

export default purchaseRouteElements;
