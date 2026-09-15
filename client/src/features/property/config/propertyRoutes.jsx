import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { propertyRoutesConfig } from './property.routes.config.js';

/** The `<Route>` children App.jsx renders under `/property/*` — built from the
 *  same config the sidebar and breadcrumbs read, so they cannot disagree. */
export const propertyRouteElements = buildRouteElements(propertyRoutesConfig, '/property');

export default propertyRouteElements;
