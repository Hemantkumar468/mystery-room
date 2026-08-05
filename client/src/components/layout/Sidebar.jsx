import { useCallback, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  LayoutTemplate,
  CalendarDays,
  BarChart3,
  Boxes,
  Users,
  Contact,
  Wallet,
  ShoppingBag,
  ChevronDown,
  ChevronLeft,
  Check,
  Play,
  FileBarChart,
  FolderOpen,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useProject } from '../../app/api/projectsApi.js';
import { STAGES_CONFIG, getStageAccess } from '../../features/projects/stagesConfig.jsx';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectSelectedProjectId, selectedProjectSet } from '../../app/slices/projectContextSlice.js';
import { selectSidebarExpanded, sidebarExpandedSet } from '../../app/slices/uiSlice.js';
import { ModuleNavGroup, CollapsibleModuleSection } from './ModuleNavGroup.jsx';
import { useEmsNavItems } from '../../features/expenses/config/emsNavigation.js';

/** Exported so BottomNav.jsx (the mobile nav) renders the same destinations
 * from one source of truth instead of a second, driftable copy. */
export const PMS_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/mis', label: 'MIS & Analytics', icon: BarChart3 },
];

export const ADMIN_NAV = [
  { to: '/employees', label: 'Employees', icon: Users },
];

/* Deliberately excludes Dashboard ('/') — that's the post-login landing
   route, and PMS should sit collapsed there until the user opens it
   themselves, not force-expand just because '/' is technically a PMS page.
   Real PMS pages (Projects/Templates/Calendar/MIS) still auto-expand it. */
const PMS_AUTO_EXPAND_PATHS = ['/projects', '/templates', '/calendar', '/mis'];
const isPmsActive = (pathname) => PMS_AUTO_EXPAND_PATHS.some((prefix) => pathname.startsWith(prefix));

/* 'Finance' intentionally isn't here — EMS (below, under its own active
   "Finance" nav group) occupies that slot now instead of sitting disabled. */
const FUTURE_NAV = [
  { label: 'CRM', icon: Contact },
  { label: 'HRMS', icon: Boxes },
  { label: 'Bookings', icon: ShoppingBag },
  { label: 'Reports', icon: FileBarChart },
  { label: 'Documents', icon: FolderOpen },
  { label: 'Settings', icon: SettingsIcon },
];

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
  const isInsideProjectPhase = STAGES_CONFIG.some((stage) => location.pathname.includes(`/${stage.path}`));

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

  const handleStageClick = (e, stage) => {
    e.preventDefault();
    if (!targetProjectId) {
      navigate('/projects');
      return;
    }
    navigate(`/projects/${targetProjectId}/${stage.path}`);
  };

  // Extracted so it can render both as the collapsed-rail fallback (flat,
  // directly-clickable icons — see the CollapsibleModuleSection usage below
  // for why PMS deliberately doesn't collapse to one icon like EMS) and as
  // the expanded module's body.
  const pmsNavList = (
    <nav className="col gap-1">
      {PMS_NAV.map((item) => {
          if (item.label === 'Projects') {
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
                  {STAGES_CONFIG.map((stage, i) => {
                    const access = getStageAccess(project?.stages, stage.key);
                    const isStageActive = location.pathname.includes(`/${stage.path}`);

                    // Resolve status indicator
                    let statusIcon = null;
                    let iconColor = 'var(--sidebar-text)';

                    if (access === 'completed') {
                      statusIcon = <Check size={11} strokeWidth={3} />;
                      iconColor = '#059669'; // green
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
                        onClick={(e) => handleStageClick(e, stage)}
                        className={`submenu-item submenu-item-phase ${isStageActive ? 'active' : ''}`}
                        title={stage.name}
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
                          <span className="submenu-phase-label">Phase {i + 1}</span>
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

      {!collapsed && <div className="nav-group-label">Administration</div>}
      <nav className="col gap-1">
        {ADMIN_NAV.map((item) => (
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

      {!collapsed && <div className="nav-group-label">Finance</div>}
      <nav className="col gap-1">
        <ModuleNavGroup moduleKey="ems" label="EMS" icon={Wallet} items={emsNavItems} basePath="/ems" collapsed={collapsed} />
      </nav>

      {!collapsed && <div className="nav-group-label">More Modules</div>}
      <nav className="col gap-1">
        {FUTURE_NAV.map((item) => (
          <div key={item.label} className="nav-item" title={item.label} style={{ opacity: 0.45, cursor: 'not-allowed' }}>
            <item.icon size={17} />
            {!collapsed && <span>{item.label}</span>}
            {!collapsed && <span className="nav-badge">Soon</span>}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="tiny" style={{ color: 'rgba(255,255,255,0.4)', padding: '0 8px' }}>
            v0.1 · Module 1 of 6
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
