import { Route, Navigate } from 'react-router-dom';
import { buildRouteElements } from '../../../lib/moduleRoutes.jsx';
import { emsRoutesConfig } from './ems.routes.config.js';

/**
 * `/ems` itself has no config entry (it isn't a real screen) — it always
 * redirects to the dashboard, same destination clicking the module in the
 * sidebar would land you on.
 */
export const emsRouteElements = [
  <Route key="ems-index" index element={<Navigate to="/ems/dashboard" replace />} />,
  ...buildRouteElements(emsRoutesConfig, '/ems'),
];

export default emsRouteElements;
