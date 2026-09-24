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
  Sun,
  Send,
  Radio,
  ListTodo,
  UsersRound,
  Repeat,
  Trash2,
  ClipboardCheck,
  Trophy,
  Network,
  Building2,
  Settings2,
  History,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';

const PMS_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/mis', label: 'MIS & Analytics', icon: BarChart3 },
];

const DELEGATION_NAV = [
  { to: '/delegation/my-work', label: 'My Work', icon: Sun },
  { to: '/delegation/delegated', label: 'Delegated by me', icon: Send },
  { to: '/delegation/loop', label: 'In the loop', icon: Radio },
  { to: '/delegation/all', label: 'All tasks', icon: ListTodo },
  { to: '/delegation/groups', label: 'Groups', icon: UsersRound },
  { to: '/delegation/repeats', label: 'Repeat rules', icon: Repeat },
  { to: '/delegation/trash', label: 'Trash', icon: Trash2 },
];

const CHECKLIST_NAV = [{ to: '/checklist', label: 'Checklist', icon: ClipboardCheck }];

const ORG_NAV = [
  { to: '/performance', label: 'Performance', icon: Trophy },
  { to: '/org/teams', label: 'Teams & People', icon: Network },
  { to: '/org/branches', label: 'Branches', icon: Building2 },
  { to: '/org/settings', label: 'Ops settings', icon: Settings2 },
  { to: '/org/activity', label: 'Activity log', icon: History, roles: ['admin', 'manager'] },
];

// Future ERP modules — shown disabled to signal the platform roadmap.
const FUTURE_NAV = [
  { label: 'CRM', icon: Users },
  { label: 'HRMS', icon: Boxes },
  { label: 'Bookings', icon: ShoppingBag },
  { label: 'Finance', icon: Wallet },
];

function NavGroup({ label, items, role }) {
  return (
    <>
      <div className="nav-group-label">{label}</div>
      <nav className="col gap-1">
        {items
          .filter((item) => !item.roles || item.roles.includes(role))
          .map((item) => (
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
    </>
  );
}

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <img src="/logo.png" alt="Mystery Rooms" className="brand-logo" />
        <span className="brand-tag">Enterprise Suite</span>
      </div>

      <NavGroup label="Project Management" items={PMS_NAV} role={role} />
      <NavGroup label="Delegation" items={DELEGATION_NAV} role={role} />
      <NavGroup label="Checklist" items={CHECKLIST_NAV} role={role} />
      <NavGroup label="Organisation" items={ORG_NAV} role={role} />

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
          v0.2 · PMS · Delegation · Checklist
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
