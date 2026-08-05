import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';

/**
 * Generic, module-agnostic collapsible sidebar section. Config in
 * (label/icon/items), rendered nav out — CRM/HRMS/Inventory/Finance can
 * mount another one of these with zero changes to this component, only a
 * new `items` array from that module's own config (see
 * lib/moduleRoutes.jsx#buildNavItems). Sidebar.jsx still needs one new line
 * to mount each additional module's group — that part isn't zero-touch, and
 * isn't claimed to be; what's reusable without modification is this
 * rendering component itself.
 *
 * Auto-expands whenever the current URL falls under `basePath`; otherwise
 * follows local, unpersisted toggle state — this is a cosmetic UI toggle,
 * not state that needs to survive navigation or be shared, unlike the
 * Projects phase submenu (which persists via Redux because it's tied to a
 * specific open project, a genuinely different concern).
 */
export function ModuleNavGroup({ label, icon: Icon, items, basePath, collapsed = false }) {
  const location = useLocation();
  const isActiveModule = location.pathname.startsWith(basePath);
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const expanded = isActiveModule || manuallyOpen;

  if (items.length === 0) return null;

  if (collapsed) {
    return (
      <NavLink to={items[0].to} title={label} className={`nav-item ${isActiveModule ? 'active' : ''}`}>
        {Icon && <Icon size={18} />}
      </NavLink>
    );
  }

  return (
    <div className="col">
      <button
        type="button"
        onClick={() => setManuallyOpen((open) => !open)}
        className={`nav-item ${isActiveModule ? 'active' : ''}`}
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
          maxHeight: expanded ? '760px' : '0px',
          opacity: expanded ? 1 : 0,
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        {items.map((item) => (
          <NavLink
            key={item.key || item.to}
            to={item.to}
            className={({ isActive }) => `submenu-item ${isActive ? 'active' : ''}`}
          >
            {item.icon && <item.icon size={15} />}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default ModuleNavGroup;
