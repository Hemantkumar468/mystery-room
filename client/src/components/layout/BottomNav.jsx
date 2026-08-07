import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
// Icons for the PMS destinations come from PMS_NAV itself; only EMS (defined
// inline below) and the sheet's own controls need their own imports.
import { Wallet, MoreHorizontal, X } from 'lucide-react';
import { PMS_NAV, ADMIN_NAV, FUTURE_NAV } from './Sidebar.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { NAV_KEYS, canSeeNav, filterNav } from '../../lib/navPolicy.js';

/**
 * Mobile-only primary navigation (<768px) — replaces the sidebar entirely
 * rather than hiding behind a hamburger/drawer, per this project's
 * router-first navigation rule (no drawers for PRIMARY nav). Five icons max
 * (a bottom bar with more than that reads as cramped/un-native): the four
 * modules used most, plus a "More" sheet for everything else — this is a
 * SECONDARY-nav overflow pattern, not a hidden primary nav, so it doesn't
 * conflict with the no-hamburger rule above.
 */
/** Look up by destination key, never by array index — the sidebar's order is
 *  presentation and has already been reordered once, which silently swapped
 *  entries in this bar. */
const navByKey = (key) => PMS_NAV.find((i) => i.key === key);

const EMS_ITEM = { key: NAV_KEYS.EMS, to: '/ems', label: 'EMS', icon: Wallet };

/**
 * Which destinations earn one of the four permanent slots, in preference
 * order. Filtered by role before slicing, so a role that cannot see EMS simply
 * promotes whatever comes next rather than rendering a gap — an Employee gets
 * My Tasks / Projects / Properties / Calendar, an MD keeps the original bar.
 */
const PRIMARY_PREFERENCE = [
  NAV_KEYS.MY_TASKS,
  NAV_KEYS.DASHBOARD,
  NAV_KEYS.PROJECTS,
  NAV_KEYS.EMS,
  NAV_KEYS.CALENDAR,
  NAV_KEYS.PROPERTIES,
];

const MAX_PRIMARY = 4;

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);

  // Built per-render rather than at module scope: these used to be module
  // constants, which meant the mobile bar could not know who was signed in and
  // showed every role the same five destinations.
  const primaryItems = PRIMARY_PREFERENCE
    .filter((key) => canSeeNav(user, key))
    .map((key) => (key === NAV_KEYS.EMS ? EMS_ITEM : navByKey(key)))
    .filter(Boolean)
    .slice(0, MAX_PRIMARY);

  const primaryKeys = new Set(primaryItems.map((i) => i.key));
  const moreLinks = [...filterNav(PMS_NAV, user), ...filterNav(ADMIN_NAV, user)]
    .filter((item) => !primaryKeys.has(item.key))
    .concat(canSeeNav(user, NAV_KEYS.EMS) && !primaryKeys.has(NAV_KEYS.EMS) ? [EMS_ITEM] : []);

  // Auto-close on navigation (picking a destination from the sheet) and lock
  // background scroll while it's open, same as any real bottom sheet.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [moreOpen]);

  const moreActive = moreLinks.some((item) => location.pathname.startsWith(item.to));

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary">
        {primaryItems.map((item) => (
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
              {moreLinks.map((item) => (
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
