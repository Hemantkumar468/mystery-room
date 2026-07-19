import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Sidebar } from './Sidebar.jsx';

export function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('mr-sidebar-collapsed') === '1',
  );

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('mr-sidebar-collapsed', next ? '1' : '0');
      return next;
    });

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
    </div>
  );
}

export default AppShell;
