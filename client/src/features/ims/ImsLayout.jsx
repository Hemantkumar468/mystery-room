import { Outlet } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useCurrentRouteMeta } from '../../lib/moduleRoutes.jsx';
import { imsRoutesConfig } from './config/ims.routes.config.js';

/**
 * The IMS module's shell.
 *
 * It used to be `<Outlet />` alone, on the stated grounds that "the sidebar,
 * topbar and breadcrumbs come from the app shell". The sidebar does; the
 * topbar never did — AppShell renders no Topbar, so every screen in this
 * module opened with no title, no back button, no notification bell and no
 * way to sign out. The bar belongs here, once, rather than pasted into each
 * of the module's pages.
 *
 * The title is the route config's own — the same array the sidebar and the
 * breadcrumbs read — so a new screen names itself by being added there, and
 * the bar can never disagree with the nav item that opened it.
 */
export function ImsLayout() {
  const meta = useCurrentRouteMeta(imsRoutesConfig);
  return (
    <>
      <Topbar title={meta?.title ? `Inventory — ${meta.title}` : 'Inventory'} />
      <Outlet />
    </>
  );
}

export default ImsLayout;
