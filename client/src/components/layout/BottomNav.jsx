import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
// Icons for the PMS destinations come from PMS_NAV itself; only EMS (defined
// inline below) and the sheet's own controls need their own imports.
import { Wallet, MoreHorizontal, X } from 'lucide-react';
import { PMS_NAV, ADMIN_NAV, FUTURE_NAV } from './Sidebar.jsx';

/**
 * Mobile-only primary navigation (<768px) — replaces the sidebar entirely
 * rather than hiding behind a hamburger/drawer, per this project's
 * router-first navigation rule (no drawers for PRIMARY nav). Five icons max
 * (a bottom bar with more than that reads as cramped/un-native): the four
 * modules used most, plus a "More" sheet for everything else — this is a
 * SECONDARY-nav overflow pattern, not a hidden primary nav, so it doesn't
 * conflict with the no-hamburger rule above.
 */
/** Look up by destination, never by array index — the sidebar's order is
 *  presentation and has already been reordered once, which silently swapped
 *  entries in this bar. */
const nav = (to) => PMS_NAV.find((i) => i.to === to);

const PRIMARY_ITEMS = [
  nav('/'),          // Dashboard
  nav('/projects'),
  { to: '/ems', label: 'EMS', icon: Wallet },
  nav('/calendar'),
].filter(Boolean);

// Real, working destinations not already in the primary bar.
const MORE_LINKS = [
  nav('/properties'),
  nav('/mis'),
  nav('/templates'),
  ...ADMIN_NAV,
].filter(Boolean);

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Auto-close on navigation (picking a destination from the sheet) and lock
  // background scroll while it's open, same as any real bottom sheet.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  const moreActive = MORE_LINKS.some((item) => location.pathname.startsWith(item.to));

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <item.icon size={20} strokeWidth={2.1} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-nav-item${moreActive ? ' active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          aria-expanded={moreOpen}
        >
          <MoreHorizontal size={20} strokeWidth={2.1} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="overlay overlay--sheet" onMouseDown={() => setMoreOpen(false)}>
          <div className="bottom-sheet" onMouseDown={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <div className="row between" style={{ padding: '0 var(--space-4) var(--space-3)', alignItems: 'center' }}>
              <span className="section-title">More</span>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setMoreOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <div className="bottom-sheet-list">
              {MORE_LINKS.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  className="bottom-sheet-item"
                  onClick={() => navigate(item.to)}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </button>
              ))}

              {/* Only rendered when there is something to list — the heading
                  used to sit above six greyed-out rows, and now above none. */}
              {FUTURE_NAV.length > 0 && (
                <>
                  <div className="bottom-sheet-divider">Coming soon</div>
                  {FUTURE_NAV.map((item) => (
                    <div key={item.label} className="bottom-sheet-item bottom-sheet-item--soon">
                      <item.icon size={18} />
                      <span>{item.label}</span>
                      <span className="nav-badge" style={{ marginLeft: 'auto', color: 'var(--text-subtle)', background: 'var(--surface-2)' }}>Soon</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BottomNav;
