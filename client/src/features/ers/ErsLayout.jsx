import { Outlet } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useCurrentRouteMeta } from '../../lib/moduleRoutes.jsx';
import { ersRoutesConfig } from './config/ers.routes.config.js';

/**
 * The ERS module's shell.
 *
 * The client's reference mockup shipped its own sidebar and topbar; both are
 * deliberately NOT ported — the app already has a sidebar, and a second
 * navigation living inside a page is a second place to get lost.
 *
 * The APP's topbar, though, was missing here entirely: this shell was
 * `<Outlet />` alone on the belief that AppShell provided one, and it does
 * not. So these screens had no title, no back button, no bell and no way to
 * sign out. One bar, rendered here, titled from the module's own route config
 * so it always matches the nav item that opened it.
 */
export function ErsLayout() {
  const meta = useCurrentRouteMeta(ersRoutesConfig);
  return (
    <>
      <Topbar title={meta?.title ? `Employee Performance — ${meta.title}` : 'Employee Performance'} />
      <Outlet />
    </>
  );
}

export default ErsLayout;
