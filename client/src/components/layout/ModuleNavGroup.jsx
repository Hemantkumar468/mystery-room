import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectActiveModuleKey, activeModuleSet } from '../../app/slices/uiSlice.js';

/**
 * Generic collapsible-header + accordion mechanics, module-agnostic. Owns:
 * the shared Redux accordion slot (`ui.activeModuleKey` — a single key, so
 * claiming it for one module implicitly closes any other), auto-expand when
 * the current route falls under this module (via the caller's `isActive`
 * predicate, since not every module has a single clean URL prefix — see
 * `ModuleNavGroup`'s `basePath`-based predicate vs. Sidebar.jsx's PMS
 * predicate, which has to check several route prefixes because PMS's
 * "Dashboard" is `/`, not a prefix every other route would also match), and
 * the rail/collapsed-sidebar fallback (`renderCollapsed`, since different
 * modules want different collapsed treatments — EMS collapses to one icon,
 * PMS deliberately keeps its 5 icons flat/directly-clickable rather than
 * hiding them behind a group).
 *
 * `children` is the expanded body — arbitrary, not just a flat item list, so
 * modules with their own nested submenus (PMS's Projects phase list) can
 * reuse this without restructuring around it.
 */
export function CollapsibleModuleSection({
  moduleKey,
  label,
  icon: Icon,
  collapsed = false,
  isActive,
  renderCollapsed,
  maxHeightExpanded = 760,
  children,
}) {
  const location = useLocation();
  const dispatch = useAppDispatch();
  const moduleActive = isActive(location.pathname);
  const activeModuleKey = useAppSelector(selectActiveModuleKey);
  const expanded = activeModuleKey === moduleKey;

  // Claims the accordion slot on the *transition* into this module's routes
  // (edge-triggered, not "while active") — mirrors Sidebar.jsx's
  // isInsideProject effect for the phase submenu. Edge-triggered on purpose:
  // if it re-fired on every render where moduleActive is still true, a
  // manual collapse click while already on one of this module's own pages
  // (e.g. clicking "PMS" while on /projects) would get immediately
  // overridden back open by this effect, since moduleActive never changed —
  // exactly the click-to-hide bug this was fixed for.
  const wasActive = useRef(false);
  useEffect(() => {
    if (moduleActive && !wasActive.current) {
      dispatch(activeModuleSet(moduleKey));
    }
    wasActive.current = moduleActive;
  }, [moduleActive, moduleKey, dispatch]);

  const toggle = () => dispatch(activeModuleSet(expanded ? null : moduleKey));

  if (collapsed) {
    return renderCollapsed();
  }

  return (
    <div className="col">
      <button
        type="button"
        onClick={toggle}
        className={`nav-item ${moduleActive ? 'active' : ''}`}
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
          {Icon && <Icon size={17} />}
          <span>{label}</span>
        </div>
        <ChevronDown
          size={15}
          style={{ transition: 'transform 0.2s ease', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      <div
        className="sidebar-submenu"
        style={{
          maxHeight: expanded ? `${maxHeightExpanded}px` : '0px',
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Thin wrapper over CollapsibleModuleSection for the common case: a flat
 * item list plus a single URL prefix (`basePath`) to detect "is this module
 * active." CRM/HRMS/Inventory can mount another one of these with zero
 * changes to this component, only a new `items` array from that module's
 * own config (see lib/moduleRoutes.jsx#buildNavItems). Sidebar.jsx still
 * needs one new line to mount each additional module's group — that part
 * isn't zero-touch, and isn't claimed to be; what's reusable without
 * modification is this rendering component itself.
 */
export function ModuleNavGroup({ moduleKey, label, icon: Icon, items, basePath, collapsed = false }) {
  const location = useLocation();
  const isActiveModule = location.pathname.startsWith(basePath);

  if (items.length === 0) return null;

  // The collapsed rail's single icon has to land somewhere real — skip past
  // any `soon` items at the front of the list (e.g. EMS's own Dashboard,
  // still a placeholder) rather than always using items[0].
  const firstReal = items.find((item) => !item.soon) || items[0];

  return (
    <CollapsibleModuleSection
      moduleKey={moduleKey}
      label={label}
      icon={Icon}
      collapsed={collapsed}
      isActive={(pathname) => pathname.startsWith(basePath)}
      renderCollapsed={() => (
        <NavLink to={firstReal.to} title={label} className={`nav-item ${isActiveModule ? 'active' : ''}`}>
          {Icon && <Icon size={18} />}
        </NavLink>
      )}
    >
      {items.map((item) => (
        item.soon ? (
          <div
            key={item.key || item.to}
            className="submenu-item"
            title={`${item.label} — coming soon`}
            style={{ opacity: 0.45, cursor: 'not-allowed' }}
          >
            {item.icon && <item.icon size={15} />}
            <span>{item.label}</span>
            <span className="nav-badge">Soon</span>
          </div>
        ) : (
          <NavLink
            key={item.key || item.to}
            to={item.to}
            className={({ isActive: navActive }) => `submenu-item ${navActive ? 'active' : ''}`}
          >
            {item.icon && <item.icon size={15} />}
            <span>{item.label}</span>
          </NavLink>
        )
      ))}
    </CollapsibleModuleSection>
  );
}

export default ModuleNavGroup;
