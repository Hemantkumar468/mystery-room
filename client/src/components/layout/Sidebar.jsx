import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  LayoutTemplate,
  CalendarDays,
  BarChart3,
  Boxes,
  Users,
  Wallet,
  ShoppingBag,
} from 'lucide-react';

const PMS_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/mis', label: 'MIS & Analytics', icon: BarChart3 },
];

// Future ERP modules — shown disabled to signal the platform roadmap.
const FUTURE_NAV = [
  { label: 'CRM', icon: Users },
  { label: 'HRMS', icon: Boxes },
  { label: 'Bookings', icon: ShoppingBag },
  { label: 'Finance', icon: Wallet },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/logo.png" alt="Mystery Rooms" className="brand-logo" />
        <span className="brand-tag">Enterprise Suite · PMS</span>
      </div>

      <div className="nav-group-label">Project Management</div>
      <nav className="col gap-1">
        {PMS_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon size={17} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="nav-group-label">More Modules</div>
      <nav className="col gap-1">
        {FUTURE_NAV.map((item) => (
          <div key={item.label} className="nav-item" style={{ opacity: 0.45, cursor: 'not-allowed' }}>
            <item.icon size={17} />
            {item.label}
            <span className="nav-badge">Soon</span>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="tiny" style={{ color: 'rgba(255,255,255,0.4)', padding: '0 8px' }}>
          v0.1 · Module 1 of 6
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
