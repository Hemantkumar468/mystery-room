import { useCallback, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
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
  Wallet,
  ListTodo,
  ChevronDown,
  ChevronLeft,
  Check,
  Play,
  Lock,
} from 'lucide-react';
import { useProject } from '../../app/api/projectsApi.js';
import { useGetPendingApprovalsQuery } from '../../app/api/recordsApi.js';
import { useGetMyTasksQuery } from '../../app/api/tasksApi.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { NAV_KEYS, canSeeNav, filterNav } from '../../lib/navPolicy.js';
import {
  STAGES_CONFIG, getStageAccess, getStagePath, projectPhases,
} from '../../features/projects/stagesConfig.jsx';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectSelectedProjectId, selectedProjectSet } from '../../app/slices/projectContextSlice.js';
import { selectSidebarExpanded, sidebarExpandedSet } from '../../app/slices/uiSlice.js';
import { ModuleNavGroup, CollapsibleModuleSection } from './ModuleNavGroup.jsx';
import { useEmsNavItems } from '../../features/expenses/config/emsNavigation.js';

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
  // Properties sits directly under Projects: it is the same p1 records, seen
  // across every project instead of inside one. Someone asking "what sites are
  // we looking at in Agra?" had to open projects one at a time to answer it.
  { key: NAV_KEYS.PROPERTIES, to: '/properties', label: 'Properties', icon: Building2 },
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
  const emsNavItems = useEmsNavItems();

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
  const setSelectedProject = useCallback((id) => dispatch(selectedProjectSet(id)), [dispatch]);
  const setSidebarExpanded = useCallback((v) => dispatch(sidebarExpandedSet(v)), [dispatch]);

  // Remember the last opened project so the sidebar can still resolve it
  // on pages with no :id in the URL (e.g. Dashboard) and across refreshes.
  useEffect(() => {
    if (activeProjectId && activeProjectId !== lastProjectId) {
      setSelectedProject(activeProjectId);
    }
  }, [activeProjectId, lastProjectId, setSelectedProject]);

  const targetProjectId = isProjectsListPage ? null : (activeProjectId || lastProjectId);

  // Fetch project context for stage status indicators
  const { data: project, isError: projectError } = useProject(targetProjectId);

  // A persisted project id that no longer resolves (e.g. after a DB reseed)
  // is stale — drop it so the sidebar falls back to the plain "Projects" link
  // instead of a dead phase list whose clicks lead to a missing project.
  useEffect(() => {
    if (projectError && lastProjectId && lastProjectId === targetProjectId) {
      setSelectedProject(null);
    }
  }, [projectError, lastProjectId, targetProjectId, setSelectedProject]);

  // True for the project overview page and every phase route under it —
  // the sidebar should transform into that project's phase nav as soon as
  // the project is opened, not only once a specific phase is entered.
  const isInsideProject = !!activeProjectId;
  // Narrower: true only once inside a specific phase route (used to keep the
  // top-level "Projects" nav-item from double-highlighting alongside a phase).
  // A dedicated phase page, or the generic `?stage=` view the newer phases use.
  const isInsideProjectPhase = STAGES_CONFIG.some((stage) => location.pathname.includes(`/${stage.path}`))
    || location.search.includes('stage=');

  // Sync expanded state with navigation (e.g. opening a project or moving
  // between its phases, or collapsing back to generic on the bare projects list)
  useEffect(() => {
    if (isProjectsListPage && expanded) {
      setSidebarExpanded(false);
    } else if (isInsideProject && !expanded) {
      setSidebarExpanded(true);
    }
  }, [isInsideProject, isProjectsListPage, location.pathname, expanded, setSidebarExpanded]);

  // Derive the value actually used for rendering so a project route renders
  // expanded on the very first paint, without waiting a tick for the effect
  // above to persist it to the store.
  const effectiveExpanded = isProjectsListPage ? false : (expanded || isInsideProject);

  // The phase submenu is only meaningful when a real project is in context:
  // either we're on a project route (URL is authoritative, even mid-load) or a
  // valid selected project has actually loaded. Otherwise the 10 phases would
  // be a phantom list that can't resolve to any project when clicked.
  const showPhaseNav = isInsideProject || (!!project && !!targetProjectId);

  // Clicking the "Projects" nav item always goes to the all-projects list —
  // the one predictable way to "see every project", whether or not a project
  // is currently open. (Previously it did nothing while inside a project, so
  // the only way back to the list was the "Back to Projects" sub-link, which
  // wasn't discoverable.) The chevron beside it still toggles the phase
  // submenu in place — see togglePhaseSubmenu below.
  const handleProjectsClick = (e) => {
    e.preventDefault();
    if (isProjectsListPage) return; // already here
    navigate('/projects');
  };

  // Expand / collapse the 10-phase submenu without leaving the current page.
  // Only meaningful when a project is in context but we're not inside it (e.g.
  // Dashboard showing the last-opened project as a shortcut) — inside a
  // project the nav stays expanded by spec, so this is a no-op there.
  const togglePhaseSubmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isInsideProject) return;
    setSidebarExpanded(!effectiveExpanded);
  };

  const handleBackToProjects = (e) => {
    e.preventDefault();
    navigate('/projects');
  };

  const handleStageClick = (e, stage, access) => {
    e.preventDefault();
    if (access === 'locked') return;
    if (!targetProjectId) {
      navigate('/projects');
      return;
    }
    // getStagePath, not a hand-built `/${stage.path}` — phases that have no
    // dedicated page (the client flow's new ones) have no `path`, and this
    // used to navigate to the literal "/projects/<id>/undefined".
    navigate(getStagePath(targetProjectId, stage.key));
  };

  // Extracted so it can render both as the collapsed-rail fallback (flat,
  // directly-clickable icons — see the CollapsibleModuleSection usage below
  // for why PMS deliberately doesn't collapse to one icon like EMS) and as
  // the expanded module's body.
  const pmsNavList = (
    <nav className="col gap-1">
      {pmsNav.map((item) => {
          if (item.key === NAV_KEYS.PROJECTS) {
            // Collapsed: no room for the phase submenu — render a plain icon
            // link straight to the projects list.
            if (collapsed) {
              const active = location.pathname.startsWith('/projects');
              return (
                <NavLink
                  key={item.to}
                  to="/projects"
                  title="Projects"
                  className={`nav-item ${active ? 'active' : ''}`}
                >
                  <item.icon size={18} />
                </NavLink>
              );
            }
            // No real project in context → don't render a phantom phase list.
            // "Projects" becomes a plain link to the projects list so the user
            // picks a project first; phases appear once one is opened.
            if (!showPhaseNav) {
              const active = location.pathname.startsWith('/projects');
              return (
                <NavLink
                  key={item.to}
                  to="/projects"
                  title="Projects"
                  className={`nav-item ${active ? 'active' : ''}`}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                </NavLink>
              );
            }
            const isProjectsActive = location.pathname.startsWith('/projects') && !isInsideProjectPhase;
            return (
              <div key={item.to} className="col">
                <button
                  type="button"
                  onClick={handleProjectsClick}
                  className={`nav-item ${isProjectsActive ? 'active' : ''}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                  }}
                >
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <item.icon size={17} />
                    <span>{item.label}</span>
                  </div>
                  {/* Chevron is its own control: it toggles the phase submenu
                      in place instead of navigating, so the label click can
                      always go to the projects list. stopPropagation keeps the
                      parent button's navigation from also firing. */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={effectiveExpanded ? 'Collapse project phases' : 'Expand project phases'}
                    onClick={togglePhaseSubmenu}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') togglePhaseSubmenu(e); }}
                    style={{ display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 2 }}
                  >
                    <ChevronDown
                      size={15}
                      style={{
                        transition: 'transform 0.2s ease',
                        transform: effectiveExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    />
                  </span>
                </button>

                {/* Submenu: back-link + selected project name + all 10 phases */}
                <div
                  className="sidebar-submenu"
                  style={{
                    maxHeight: effectiveExpanded ? '760px' : '0px',
                    opacity: effectiveExpanded ? 1 : 0,
                    pointerEvents: effectiveExpanded ? 'auto' : 'none',
                  }}
                >
                  {isInsideProject && (
                    <a href="#" className="sidebar-back-link" onClick={handleBackToProjects}>
                      <ChevronLeft size={13} />
                      <span>Back to Projects</span>
                    </a>
                  )}
                  {project && (
                    <a
                      href="#"
                      className="sidebar-project-name"
                      onClick={(e) => { e.preventDefault(); navigate(`/projects/${targetProjectId}`); }}
                      title={project.name}
                    >
                      <span>{project.name}</span>
                    </a>
                  )}
                  {/* The PROJECT's own phases, in its own order, with its own
                      names — not a hardcoded ten. A project on the 16-phase
                      client flow shows sixteen; one on the older playbook shows
                      ten; a template edited tomorrow shows whatever it defines,
                      with no change here. */}
                  {projectPhases(project).map((stage, i) => {
                    const access = getStageAccess(project?.stages, stage.key);
                    const stageHref = getStagePath(targetProjectId, stage.key);
                    // Match on the resolved destination rather than a `path`
                    // the new phases don't have.
                    const isStageActive = stageHref.includes('?stage=')
                      ? location.search.includes(`stage=${encodeURIComponent(stage.key)}`)
                      : location.pathname === stageHref.split('?')[0];
                    // Template names already carry the client's numbering
                    // ("Phase 4B — Vendor Identification"). Only number the ones
                    // that don't, instead of stamping a position-based "Phase N"
                    // over a name that says something different.
                    const selfNumbered = /^phase\b/i.test(stage.name || '');

                    // Resolve status indicator
                    let statusIcon = null;
                    let iconColor = 'var(--sidebar-text)';

                    if (access === 'completed') {
                      statusIcon = <Check size={11} strokeWidth={3} />;
                      iconColor = '#059669'; // green
                    } else if (access === 'locked') {
                      statusIcon = <Lock size={10} />;
                      iconColor = 'var(--sidebar-text-subtle, #9CA3AF)';
                    } else if (access === 'current') {
                      statusIcon = <Play size={10} fill="#4F46E5" />;
                      iconColor = '#4F46E5'; // indigo — matches STAGE_STATUS_META.in_progress
                    } else {
                      statusIcon = <Play size={10} fill="#4F46E5" />;
                      iconColor = '#4F46E5';
                    }

                    return (
                      <a
                        key={stage.key}
                        href="#"
                        onClick={(e) => handleStageClick(e, stage, access)}
                        className={`submenu-item submenu-item-phase ${isStageActive ? 'active' : ''}${access === 'locked' ? ' submenu-item-locked' : ''}`}
                        title={access === 'locked' ? `${stage.name} — locked until Property Identification is Marked Done` : stage.name}
                        aria-disabled={access === 'locked'}
                      >
                        <div
                          className="submenu-icon-wrap"
                          style={{
                            color: isStageActive ? 'var(--primary)' : iconColor,
                            background: access === 'completed' && !isStageActive ? '#DCFCE7' : (access === 'current' || access === 'accessible') && !isStageActive ? '#EEF2FF' : 'transparent',
                            borderRadius: '50%',
                            width: 20,
                            height: 20,
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {statusIcon}
                        </div>
                        <div className="submenu-phase-text">
                          {!selfNumbered && <span className="submenu-phase-label">Phase {i + 1}</span>}
                          <span className="submenu-phase-name">{stage.name}</span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          }

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

      {/* The heading goes with its section: an "Administration" label above an
          empty list is what every non-MD used to see. */}
      {adminNav.length > 0 && !collapsed && <div className="nav-group-label">Administration</div>}
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

      {/* EMS's own items are already permission-filtered by useEmsNavItems;
          this gate is the module-level one — whether the role sees Finance at
          all. Both must pass, and an empty list renders no heading. */}
      {canSeeNav(currentUser, NAV_KEYS.EMS) && emsNavItems.length > 0 && (
        <>
          {!collapsed && <div className="nav-group-label">Finance</div>}
          <nav className="col gap-1">
            <ModuleNavGroup moduleKey="ems" label="EMS" icon={Wallet} items={emsNavItems} basePath="/ems" collapsed={collapsed} />
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
