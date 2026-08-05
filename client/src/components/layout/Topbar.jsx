import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { logoutThunk } from '../../app/slices/logoutThunk.js';
import { Avatar } from '../ui/primitives.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { ConfirmDialog } from '../../features/projects/records/ConfirmDialog.jsx';
import { useIsMobile } from '../../hooks/useBreakpoint.js';

export function Topbar({ title, subtitle, actions }) {
  // Selector rather than the whole store: this component previously
  // subscribed to every auth field and re-rendered on any of them.
  const user = useAppSelector(selectCurrentUser);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // Mobile-only: avatar + name/role + logout crowded into two separate
  // icons side by side (Avatar, then a lone LogOut button) once the name/
  // role text is hidden at this width — collapse both into one tap target
  // that opens a small menu with the same info/action, same pattern as
  // NotificationBell's dropdown.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (!userMenuRef.current?.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [userMenuOpen]);

  const onLogout = async () => {
    // Ends the server session (clearing the httpOnly refresh cookie) and
    // wipes both caches before navigating — see logoutThunk.
    setPending(true);
    await dispatch(logoutThunk('user'));
    setPending(false);
    setConfirmOpen(false);
    navigate('/login', { replace: true });
  };

  return (
    <header className="topbar">
      {/* On mobile the page action (e.g. "+ New Project") moves to the very
          start of the bar instead of sitting bunched with the theme/bell/
          account icons at the end — especially useful on pages that also
          hide their title on mobile (ProjectsPage), where it fills what
          would otherwise be empty space. Desktop/tablet keep it at the end,
          unchanged. */}
      {isMobile && actions}
      <div className="col grow">
        {title && <div className="page-title">{title}</div>}
        {subtitle && <div className="sm muted">{subtitle}</div>}
      </div>

      <div className="row gap-3">
        {!isMobile && actions}
        <ThemeToggle />
        <NotificationBell />
        {isMobile ? (
          <div className="row" style={{ position: 'relative' }} ref={userMenuRef}>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              style={{ padding: 2 }}
              onClick={() => setUserMenuOpen((o) => !o)}
              title={user?.name}
              aria-label="Account menu"
            >
              <Avatar name={user?.name} color={user?.avatarColor} />
            </button>
            {userMenuOpen && (
              <div
                className="card"
                style={{
                  position: 'absolute', top: '110%', right: 0, minWidth: 200,
                  zIndex: 40, boxShadow: 'var(--shadow-2)', overflow: 'hidden',
                }}
              >
                <div className="col" style={{ padding: '12px', borderBottom: '1px solid var(--border)', lineHeight: 1.3 }}>
                  <span className="sm" style={{ fontWeight: 600 }}>{user?.name}</span>
                  <span className="tiny muted upper">{user?.role}</span>
                </div>
                <button
                  type="button"
                  className="row gap-2"
                  onClick={() => { setUserMenuOpen(false); setConfirmOpen(true); }}
                  style={{
                    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
                    cursor: 'pointer', alignItems: 'center', color: 'var(--danger)',
                  }}
                >
                  <LogOut size={15} /> Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="row gap-2 topbar-user" style={{ paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
            <Avatar name={user?.name} color={user?.avatarColor} />
            <div className="col" style={{ lineHeight: 1.2 }}>
              <span className="sm" style={{ fontWeight: 600 }}>{user?.name}</span>
              <span className="tiny muted upper">{user?.role}</span>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => setConfirmOpen(true)} title="Log out">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmLabel="Log out"
        pending={pending}
        onClose={() => setConfirmOpen(false)}
        onConfirm={onLogout}
      />
    </header>
  );
}

export default Topbar;
