import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectSidebarCollapsed, sidebarCollapsedToggled } from '../../app/slices/uiSlice.js';
import { useMeQuery } from '../../app/api/authApi.js';
import { useBreakpoint } from '../../hooks/useBreakpoint.js';
import { Sidebar } from './Sidebar.jsx';
import { BottomNav } from './BottomNav.jsx';
import { ToastHost } from '../ui/ToastHost.jsx';

/**
 * Sidebar collapse used to be a local `useState` here, hand-persisted to
 * `localStorage['mr-sidebar-collapsed']` — while the sidebar's OTHER half
 * (`sidebarExpanded`) lived in a separate Zustand store. One concept split
 * across two mechanisms; both halves now live in `uiSlice`.
 *
 * Below tablet width the sidebar itself stops being the right control:
 * mobile (<768px) drops it entirely for a bottom nav (see BottomNav.jsx —
 * a routed nav, not a drawer, per this project's no-drawers-for-primary-nav
 * rule); tablet (768–1023px) keeps it but forces the icon-only rail,
 * overriding the user's manual expand/collapse preference — there simply
 * isn't width to spare for the full 260px rail at that size. Laptop/desktop
 * are untouched: the manual toggle behaves exactly as before.
 */
export function AppShell({ children }) {
  const collapsedPref = useAppSelector(selectSidebarCollapsed);
  const dispatch = useAppDispatch();
  const toggle = () => dispatch(sidebarCollapsedToggled());
  const breakpoint = useBreakpoint();
  const isMobile = breakpoint === 'mobile';
  const isTablet = breakpoint === 'tablet';
  const collapsed = isTablet ? true : collapsedPref;

  // Re-reads the signed-in user once per mount (page load / hard refresh),
  // so a role or department change made by an admin reaches this session
  // without forcing a logout. AppShell only renders inside RequireAuth, so
  // this is always an authenticated call. authApi's `me.onQueryStarted`
  // dispatches `userRefreshed` on success and is a no-op on failure (the
  // 401 interceptor in lib/api.js already owns hard auth failures).
  useMeQuery();

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}${isMobile ? ' app-shell--mobile' : ''}`}>
      {!isMobile && <Sidebar collapsed={collapsed} />}
      {!isMobile && !isTablet && (
        <button
          type="button"
          className="sidebar-toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={15} strokeWidth={2.6} /> : <ChevronLeft size={15} strokeWidth={2.6} />}
        </button>
      )}
      <div className="main">{children}</div>
      {isMobile && <BottomNav />}
      <ToastHost />
    </div>
  );
}

export default AppShell;
