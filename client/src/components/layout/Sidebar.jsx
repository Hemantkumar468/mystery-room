import { NavLink } from 'react-router-dom';
import dayjs from '../../lib/dayjs.js';
import {
  LayoutDashboard,
  FolderKanban,
  LayoutTemplate,
  CalendarDays,
  BarChart3,
  Building2,
  CheckSquare,
  Users,
  ListTodo,
  MapPinned,
  ArrowLeftRight,
  GanttChartSquare,
  Handshake,
} from 'lucide-react';
import { useGetPendingApprovalsQuery } from '../../app/api/recordsApi.js';
import { useGetMyTasksQuery } from '../../app/api/tasksApi.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { NAV_KEYS, canSeeNav, filterNav } from '../../lib/navPolicy.js';
import { useAppSelector } from '../../app/hooks.js';
import { ModuleNavGroup, CollapsibleModuleSection } from './ModuleNavGroup.jsx';
import { useCrmNavItems } from '../../features/crm/config/crmNavigation.js';

/** Exported so BottomNav.jsx (the mobile nav) renders the same destinations
 * from one source of truth instead of a second, driftable copy.
 *
 * `key` ties each entry to lib/navPolicy.js, which decides who sees it — the
 * order here is the display order for everyone who sees the entry at all. */
export const PMS_NAV = [
  // First by weight, not habit. For an Employee this is the only page that
  // matters and the one they land on; for everyone else their own assigned
  // work still outranks a portfolio overview.
  { key: NAV_KEYS.MY_TASKS, to: '/my-tasks', label: 'My Tasks', icon: ListTodo, badge: 'myTasks' },
  { key: NAV_KEYS.DASHBOARD, to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { key: NAV_KEYS.PROJECTS, to: '/projects', label: 'Projects', icon: FolderKanban },
  // The plan itself, on a date axis. Sits beside Projects because it is the
  // same portfolio seen as time rather than as a list.
  { key: NAV_KEYS.GANTT, to: '/gantt', label: 'Timeline (Gantt)', icon: GanttChartSquare },
  // The report OF the projects — pick a project, see planned vs actual per phase.
  { key: NAV_KEYS.PLAN_VS_ACTUAL, to: '/plan-vs-actual', label: 'Plan vs Actual', icon: ArrowLeftRight },
  // Properties sits directly under Projects: it is the same p1 records, seen
  // across every project instead of inside one. Someone asking "what sites are
  // we looking at in Agra?" had to open projects one at a time to answer it.
  { key: NAV_KEYS.PROPERTIES, to: '/properties', label: 'Properties', icon: Building2 },
  // The vendor MASTER — every vendor across every project, plus onboarding.
  { key: NAV_KEYS.VENDORS, to: '/vendors', label: 'Vendors', icon: Handshake },
  // The same portfolio, geographically. Sits with Projects/Properties rather
  // than with MIS because it is a view of the network, not a report about it.
  { key: NAV_KEYS.NETWORK_MAP, to: '/network-map', label: 'Network Map', icon: MapPinned },
  // This is the one page whose contents are someone's outstanding obligation
  // rather than a place to look things up. `badge` names the live count the
  // Sidebar resolves below.
  { key: NAV_KEYS.APPROVALS, to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals' },
  { key: NAV_KEYS.CALENDAR, to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { key: NAV_KEYS.MIS, to: '/mis', label: 'MIS & Analytics', icon: BarChart3 },
  { key: NAV_KEYS.TEMPLATES, to: '/templates', label: 'Templates', icon: LayoutTemplate },
];

export const ADMIN_NAV = [
  { key: NAV_KEYS.EMPLOYEES, to: '/employees', label: 'Employees', icon: Users },
];

/* Deliberately excludes Dashboard ('/') — that's the post-login landing
   route, and PMS should sit collapsed there until the user opens it
   themselves, not force-expand just because '/' is technically a PMS page.
   Real PMS pages (Projects/Templates/Calendar/MIS) still auto-expand it. */
const PMS_AUTO_EXPAND_PATHS = ['/projects', '/properties', '/templates', '/calendar', '/mis'];
const isPmsActive = (pathname) => PMS_AUTO_EXPAND_PATHS.some((prefix) => pathname.startsWith(prefix));

/**
 * Deliberately empty.
 *
 * The sidebar used to end with a "More Modules" block listing CRM, HRMS,
 * Bookings, Reports, Documents and Settings, each greyed out behind a "Soon"
 * badge. Six dead rows is a third of the nav spent on things nobody can click,
 * and it makes the five that do work harder to find — the reader has to
 * discover which half of the list is real.
 *
 * Adding a module later is: build it, then add it to the arrays above. The
 * export stays so BottomNav's "More" sheet keeps its contract; an empty array
 * simply renders nothing.
 */
export const FUTURE_NAV = [];

export function Sidebar({ collapsed = false }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Extract active project ID from URL if inside projects
  const match = location.pathname.match(/^\/projects\/([a-fA-F0-9]{24})/);
  const activeProjectId = match ? match[1] : null;
  // The bare projects list — sidebar always collapses back to a generic
  // "Projects" entry here, even if a project was previously open.
  const isProjectsListPage = location.pathname === '/projects';

  const dispatch = useAppDispatch();
  const lastProjectId = useAppSelector(selectSelectedProjectId);
  const expanded = useAppSelector(selectSidebarExpanded);
  const crmNavItems = useCrmNavItems();

  // Only fetched for roles that can actually decide — a badge showing work an
  // Employee cannot action would be noise they can never clear.
  const currentUser = useAppSelector(selectCurrentUser);
  const { data: pendingApprovals } = useGetPendingApprovalsQuery(undefined, {
    skip: !can.decide(currentUser?.role),
  });
  const pendingCount = pendingApprovals?.length || 0;

  // Same rule as the approvals badge: only fetched for roles that actually see
  // the entry, so a Viewer never issues the request. The count is what is
  // overdue or due today — a badge showing every open task would sit there
  // permanently and stop meaning anything.
  const { data: myWork } = useGetMyTasksQuery(undefined, {
    skip: !canSeeNav(currentUser, NAV_KEYS.MY_TASKS),
  });
  const myTasksCount = (myWork?.open || []).filter(
    (t) => t.plannedEnd && dayjs(t.plannedEnd).isBefore(dayjs().endOf('day')),
  ).length;

  // Both nav lists, narrowed to this user. Rendering happens off these, never
  // off the raw arrays — see lib/navPolicy.js.
  const pmsNav = filterNav(PMS_NAV, currentUser);
  const adminNav = filterNav(ADMIN_NAV, currentUser);

  // Extracted so it can render both as the collapsed-rail fallback (flat,
  // directly-clickable icons — see the CollapsibleModuleSection usage below
  // for why PMS deliberately doesn't collapse to one icon like EMS) and as
  // the expanded module's body.
  const pmsNavList = (
    <nav className="col gap-1">
      {pmsNav.map((item) => {
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <item.icon size={17} />
              {!collapsed && <span>{item.label}</span>}
              {/* Live count, not decoration — this is the number the queue
                  exists to drive down, so it belongs where it is seen on
                  every page rather than only once you arrive. */}
              {!collapsed && item.badge === 'approvals' && pendingCount > 0 && (
                <span className="nav-count">{pendingCount > 99 ? '99+' : pendingCount}</span>
              )}
              {/* Overdue-or-due-today only, and red rather than the neutral
                  approvals count — this one is the reader's own slippage. */}
              {!collapsed && item.badge === 'myTasks' && myTasksCount > 0 && (
                <span className="nav-count nav-count--urgent" title={`${myTasksCount} overdue or due today`}>
                  {myTasksCount > 99 ? '99+' : myTasksCount}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>
  );

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="brand-block">
        <img src="/logo.png" alt="Mystery Rooms" className="brand-logo" />
      </div>

      <CollapsibleModuleSection
        moduleKey="pms"
        label="PMS"
        icon={FolderKanban}
        collapsed={collapsed}
        isActive={isPmsActive}
        maxHeightExpanded={3000}
        renderCollapsed={() => pmsNavList}
      >
        {pmsNavList}
      </CollapsibleModuleSection>

      <nav className="col gap-1">
        {adminNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon size={17} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* CRM — franchise enquiries. Two gates, both of which must pass: the
          module-level one here (does this role see CRM at all) and the
          per-item filtering useCrmNavItems already applied. An empty list
          renders no heading rather than a label above nothing. */}
      {canSeeNav(currentUser, NAV_KEYS.CRM) && crmNavItems.length > 0 && (
        <>
          <nav className="col gap-1">
            <ModuleNavGroup
              moduleKey="crm"
              label="CRM"
              icon={Handshake}
              items={crmNavItems}
              basePath="/crm"
              collapsed={collapsed}
            />
          </nav>
        </>
      )}

      {/* No "More Modules" block. See FUTURE_NAV above for why, and for how to
          add a module once it actually exists. */}

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="tiny" style={{ color: 'rgba(255,255,255,0.4)', padding: '0 8px' }}>
            v0.1
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
