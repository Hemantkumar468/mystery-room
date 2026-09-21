import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { ersRoutesConfig } from './ers.routes.config.js';

/** The `<Route>` children App.jsx renders under `/ers/*` — built from the same
 *  config the sidebar and breadcrumbs read, so they cannot disagree. */
export const ersRouteElements = buildRouteElements(ersRoutesConfig, '/ers');

export default ersRouteElements;
