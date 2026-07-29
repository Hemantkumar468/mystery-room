import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectSidebarCollapsed, sidebarCollapsedToggled } from '../../app/slices/uiSlice.js';
import { Sidebar } from './Sidebar.jsx';
import { ToastHost } from '../ui/ToastHost.jsx';

/**
 * Sidebar collapse used to be a local `useState` here, hand-persisted to
 * `localStorage['mr-sidebar-collapsed']` — while the sidebar's OTHER half
 * (`sidebarExpanded`) lived in a separate Zustand store. One concept split
 * across two mechanisms; both halves now live in `uiSlice`.
 */
export function AppShell({ children }) {
  const collapsed = useAppSelector(selectSidebarCollapsed);
  const dispatch = useAppDispatch();
  const toggle = () => dispatch(sidebarCollapsedToggled());

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar collapsed={collapsed} />
      <button
        type="button"
        className="sidebar-toggle"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={15} strokeWidth={2.6} /> : <ChevronLeft size={15} strokeWidth={2.6} />}
      </button>
      <div className="main">{children}</div>
      <ToastHost />
    </div>
  );
}

export default AppShell;
