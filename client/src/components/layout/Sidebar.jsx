import { useEffect } from 'react';
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
import { useProject } from '../../lib/queries.js';
import { STAGES_CONFIG, getStageAccess } from '../../features/projects/stagesConfig.jsx';
import { useProjectContextStore } from '../../store/projectContextStore.js';

const PMS_NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/mis', label: 'MIS & Analytics', icon: BarChart3 },
];

const ADMIN_NAV = [
  { to: '/employees', label: 'Employees', icon: Users },
];

const FUTURE_NAV = [
  { label: 'CRM', icon: Contact },
  { label: 'HRMS', icon: Boxes },
  { label: 'Bookings', icon: ShoppingBag },
  { label: 'Finance', icon: Wallet },
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

  const lastProjectId = useProjectContextStore((s) => s.selectedProjectId);
  const setSelectedProject = useProjectContextStore((s) => s.setSelectedProject);
  const expanded = useProjectContextStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = useProjectContextStore((s) => s.setSidebarExpanded);

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

  const handleProjectsClick = (e) => {
    e.preventDefault();
    // Expansion is non-negotiable at both ends: always collapsed on the bare
    // list, always expanded while inside a project (per spec, navigating
    // between phases must never collapse the nav — use "Back to Projects"
    // to leave). Manual toggling only makes sense elsewhere (e.g. Dashboard
    // showing the last-opened project as a shortcut).
    if (isProjectsListPage || isInsideProject) return;
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

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="brand-block">
        <img src="/logo.png" alt="Mystery Rooms" className="brand-logo" />
      </div>

      {!collapsed && <div className="nav-group-label">Project Management</div>}
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
                  <ChevronDown
                    size={15}
                    style={{
                      transition: 'transform 0.2s ease',
                      transform: effectiveExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  />
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
