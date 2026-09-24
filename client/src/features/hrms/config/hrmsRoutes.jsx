import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { hrmsRoutesConfig } from './hrms.routes.config.js';

/** The `<Route>` children App.jsx renders under `/hrms/*` — built from the
 *  same config the sidebar and breadcrumbs read, so they cannot disagree. */
export const hrmsRouteElements = buildRouteElements(hrmsRoutesConfig, '/hrms');

export default hrmsRouteElements;
