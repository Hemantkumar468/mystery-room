import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { propertyFmsRoutesConfig } from './propertyFms.routes.config.js';

/** The `<Route>` children App.jsx renders under `/property-fms/*` — built
 *  from the same config the sidebar and breadcrumbs read. */
export const propertyFmsRouteElements = buildRouteElements(propertyFmsRoutesConfig, '/property-fms');

export default propertyFmsRouteElements;
