import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { franchiseRoutesConfig } from './franchise.routes.config.js';

/** The `<Route>` children App.jsx renders under `/franchise/*` — built from
 *  the same config the sidebar and breadcrumbs read, so they cannot disagree. */
export const franchiseRouteElements = buildRouteElements(franchiseRoutesConfig, '/franchise');

export default franchiseRouteElements;
