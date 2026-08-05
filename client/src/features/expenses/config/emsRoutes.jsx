import { Route, Navigate } from 'react-router-dom';
import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './ems.routes.config.js';

/**
 * `/ems` itself has no config entry (it isn't a real screen) — it redirects
 * to Branches, the one EMS screen that's actually real (Step 2.1); every
 * other screen is still `soon: true` in ems.routes.config.js. Update this
 * once Dashboard (Step 1) ships with real content.
 */
export const emsRouteElements = [
  <Route key="ems-index" index element={<Navigate to="/ems/branches" replace />} />,
  ...buildRouteElements(emsRoutesConfig, '/ems'),
];

export default emsRouteElements;
