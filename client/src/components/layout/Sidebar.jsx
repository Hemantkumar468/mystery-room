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
  Table2,
  Handshake,
  BookOpen,
  UserPlus,
  ShoppingCart,
  Store,
  Gamepad2,
  Database,
  MessageCircle,
  Settings,
  PenSquare,
  Workflow
} from 'lucide-react';
import { useGetPendingApprovalsQuery } from '../../app/api/recordsApi.js';
import { useGetMyTasksQuery } from '../../app/api/tasksApi.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { NAV_KEYS, canSeeNav, filterNav } from '../../lib/navPolicy.js';
import { useAppSelector } from '../../app/hooks.js';
import { ModuleNavGroup, CollapsibleModuleSection } from './ModuleNavGroup.jsx';
import { useHrmsNavItems } from '../../features/hrms/config/hrmsNavigation.js';
import { usePurchaseNavItems } from '../../features/purchase/config/purchaseNavigation.js';
import { useFranchiseNavItems } from '../../features/franchise/config/franchiseNavigation.js';
import { usePropertyNavItems } from '../../features/property/config/propertyNavigation.js';
// CRM hidden for now.
// import { useCrmNavItems } from '../../features/crm/config/crmNavigation.js';

/** Exported so BottomNav.jsx (the mobile nav) renders the same destinations
 * from one source of truth instead of a second, driftable copy.
 *
 * `key` ties each entry to lib/navPolicy.js, which decides who sees it — the
 * order here is the display order for everyone who sees the entry at all. */
export const PMS_NAV = [
  // The portfolio overview leads the list, with each person's own queue
  // directly beneath it. An Employee still lands on My Tasks; this is the
  // reading order of the nav, not where anyone starts.
  { key: NAV_KEYS.DASHBOARD, to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { key: NAV_KEYS.MY_TASKS, to: '/my-tasks', label: 'My Tasks', icon: ListTodo, badge: 'myTasks' },
  { key: NAV_KEYS.PROJECTS, to: '/projects', label: 'Projects', icon: FolderKanban },
  // The plan itself, on a date axis. Sits beside Projects because it is the
  // same portfolio seen as time rather than as a list.
  { key: NAV_KEYS.GANTT, to: '/gantt', label: 'Timeline (Gantt)', icon: GanttChartSquare },
  // The report OF the projects — pick a project, see planned vs actual per phase.
  { key: NAV_KEYS.PLAN_VS_ACTUAL, to: '/plan-vs-actual', label: 'Plan vs Actual', icon: ArrowLeftRight },
  // The audit walk: pick a launch, step through its phases, read every
  // entry as spreadsheet rows — who filed what, when, what was decided.
  { key: NAV_KEYS.DATA_EXPLORER, to: '/data-explorer', label: 'Data Explorer', icon: Table2 },
  // Properties sits directly under Projects: it is the same p1 records, seen
  // across every project instead of inside one. Someone asking "what sites are
  // we looking at in Agra?" had to open projects one at a time to answer it.
  { key: NAV_KEYS.PROPERTIES, to: '/properties', label: 'Properties', icon: Building2 },
  // Property sourcing is NOT here — it is its own module below, beside
  // Purchase and Franchise. Finding a site happens before there is a project
  // to run, and the people doing it are not the people running builds.
  // Vendors used to sit here. It is master data — the standing supply list the
  // procurement flow picks FROM — so it moved to the Master Data section below,
  // beside Games. See MASTER_NAV.
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
  // Role-aware guides + interactive tours of the real screens. Last on
  // purpose: help is reached for when needed, never competing with the work.
  { key: NAV_KEYS.GUIDE, to: '/guide', label: 'User Guide', icon: BookOpen },
];

/**
 * Master data — the company-wide lists projects pick FROM, rather than data a
 * project produces. Its own section because it is maintained on a different
 * rhythm: set up once, corrected occasionally, read constantly.
 *
 * Vendors joined Games here rather than staying in the PMS list. It is the
 * same kind of thing by every test that matters: it is company-wide rather
 * than per-project, it is maintained by the people who maintain the game
 * catalogue, and the procurement flow READS it the way Phase 3B reads Games.
 * Sitting in PMS made it look like a report on the projects, which is the one
 * thing it is not.
 */
/**
 * Design & Drawings FMS — the 37-drawing checklist, as a management
 * dashboard across every project. Its own top-level module (matching
 * Property/Purchase/Franchise) rather than a page inside PMS's collapsible
 * group: it is reached from outside any one project, the same way Purchase
 * is. Just the one destination today (the dashboard); ModuleNavGroup still
 * renders it as a proper collapsible section so it looks and behaves like
 * every other module in this list rather than a lone exception.
 */
export const DESIGN_DRAWINGS_NAV = [
  { key: NAV_KEYS.DESIGN_DRAWINGS, to: '/design-drawings', label: 'Dashboard', icon: LayoutDashboard },
  /* The FMS itself: the three-step rail a drawing actually moves along —
     checklist → review → approved. Its own entry rather than something you
     reach by drilling into a project from the dashboard, because the people
     who work it (architects filing drawings, the PM reviewing them) come here
     to DO the work, not to read a portfolio report. */
  { key: NAV_KEYS.DESIGN_DRAWINGS_FMS, to: '/design-drawings/fms', label: 'FMS', icon: Workflow },
];

export const MASTER_NAV = [
  { key: NAV_KEYS.GAMES, to: '/games', label: 'Games', icon: Gamepad2 },
  { key: NAV_KEYS.VENDORS, to: '/vendors', label: 'Vendors', icon: Handshake },
];

/** Every route the Master Data section owns — see ModuleNavGroup's `basePath`. */
const MASTER_PATHS = ['/games', '/vendors'];

export const ADMIN_NAV = [
  { key: NAV_KEYS.EMPLOYEES, to: '/employees', label: 'Employees', icon: Users },
];

/**
 * Settings — configuration, not work.
 *
 * Its own section rather than another top-level row, because these pages are
 * set up once and then left alone: mixed into the daily list they add noise to
 * the nav without ever being the thing somebody came for. The section is also
 * where the next channel or integration goes, so the nav does not grow a new
 * root entry each time.
 */
export const SETTINGS_NAV = [
  { key: NAV_KEYS.WHATSAPP, to: '/settings/whatsapp', label: 'WhatsApp', icon: MessageCircle },
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
  // const crmNavItems = useCrmNavItems();  // CRM hidden for now
  const hrmsNavItems = useHrmsNavItems();
  const purchaseNavItems = usePurchaseNavItems();
  const franchiseNavItems = useFranchiseNavItems();
  const propertyNavItems = usePropertyNavItems();

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
  const designDrawingsNavItems = DESIGN_DRAWINGS_NAV.filter((i) => canSeeNav(currentUser, i.key));
  const masterNav = MASTER_NAV.filter((i) => canSeeNav(currentUser, i.key));
  const settingsNav = SETTINGS_NAV.filter((i) => canSeeNav(currentUser, i.key));
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
      {/* CRM hidden for now — uncomment this block (and the import/hook above) to show it again.
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
      */}

      {/* Master data — the lists projects pick FROM. Same gate as everything
          else: a role that cannot see the key gets no heading, not an empty one. */}
      {masterNav.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="master"
            label="Master Data"
            icon={Database}
            items={masterNav}
            basePath={MASTER_PATHS}
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* Property (FMS) — sourcing a site: capture, assessment, commercial
          closure. Its own module rather than a PMS page, because it runs
          before a project exists and most of what it handles never becomes
          one. Same two-gate rule as every module. */}
      {canSeeNav(currentUser, NAV_KEYS.PROPERTY_CAPTURE) && propertyNavItems.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="property"
            label="Property"
            icon={Building2}
            items={propertyNavItems}
            basePath="/property"
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* Design & Drawings FMS — the 37-drawing checklist master, across every
          project. Sits right after Property: a site is sourced there, then
          its drawings are tracked here once a project exists. */}
      {designDrawingsNavItems.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="design-drawings"
            label="Design & Drawings FMS"
            icon={PenSquare}
            items={designDrawingsNavItems}
            basePath="/design-drawings"
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* Purchase — every project's orders, deliveries and GRNs, company-wide.
          The same Phase 5/6 data each project's tracker shows, reached without
          opening projects one at a time. Same two-gate rule as every module. */}
      {canSeeNav(currentUser, NAV_KEYS.PURCHASE) && purchaseNavItems.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="purchase"
            label="Purchase"
            icon={ShoppingCart}
            items={purchaseNavItems}
            basePath="/purchase"
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* Franchise (FMS) — the enquiry queue and the decision that births a
          project. Sits beside Purchase and HRMS as its own system, even
          though a yes lands the MD straight back in PMS. */}
      {canSeeNav(currentUser, NAV_KEYS.FRANCHISE) && franchiseNavItems.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="franchise"
            label="Franchise"
            icon={Store}
            items={franchiseNavItems}
            basePath="/franchise"
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* HRMS — hiring for new centres. Same two-gate rule as every module:
          the role must see HRMS at all, and the items are already filtered. */}
      {canSeeNav(currentUser, NAV_KEYS.HRMS) && hrmsNavItems.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="hrms"
            label="HRMS"
            icon={UserPlus}
            items={hrmsNavItems}
            basePath="/hrms"
            collapsed={collapsed}
          />
        </nav>
      )}

      {/* Settings — last, because configuration is what you go looking for,
          never what you were already doing. Same two gates as every other
          section: the role must see the key, and an empty list renders no
          heading rather than a label above nothing. */}
      {settingsNav.length > 0 && (
        <nav className="col gap-1">
          <ModuleNavGroup
            moduleKey="settings"
            label="Settings"
            icon={Settings}
            items={settingsNav}
            basePath="/settings"
            collapsed={collapsed}
          />
        </nav>
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
