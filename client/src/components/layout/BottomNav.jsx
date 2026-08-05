import { NavLink } from 'react-router-dom';
import { PMS_NAV, ADMIN_NAV } from './Sidebar.jsx';

/**
 * Mobile-only primary navigation (<768px) — replaces the sidebar entirely
 * rather than hiding behind a hamburger/drawer, per this project's
 * router-first navigation rule (no drawers for primary nav). Renders the
 * exact same destinations as the desktop Sidebar's PMS_NAV/ADMIN_NAV so no
 * route becomes unreachable on a phone; the 10-phase project sub-nav isn't
 * duplicated here — it's already reachable via the project detail page's
 * own stage stepper once "Projects" is opened.
 */
const ITEMS = [...PMS_NAV, ...ADMIN_NAV];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
        >
          <item.icon size={20} strokeWidth={2.1} />
          <span>{item.label === 'MIS & Analytics' ? 'MIS' : item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default BottomNav;
