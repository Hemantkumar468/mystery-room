import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { imsRoutesConfig } from './ims.routes.config.js';

/** The `<Route>` children App.jsx renders under `/ims/*` — built from the same
 *  config the sidebar and breadcrumbs read, so they cannot disagree. */
export const imsRouteElements = buildRouteElements(imsRoutesConfig, '/ims');

export default imsRouteElements;
