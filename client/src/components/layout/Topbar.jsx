import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { logoutThunk } from '../../app/slices/logoutThunk.js';
import { Avatar } from '../ui/primitives.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { ConfirmDialog } from '../../features/projects/records/ConfirmDialog.jsx';
import { useIsMobile } from '../../hooks/useBreakpoint.js';

// `subtitle` is intentionally absent from the signature — see the render
// below. Pages still passing it are harmless; the prop is simply dropped.
export function Topbar({ title, actions }) {
  // Selector rather than the whole store: this component previously
  // subscribed to every auth field and re-rendered on any of them.
  const user = useAppSelector(selectCurrentUser);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // The account dropdown, at every width. Log out used to be its own button
  // in the bar, which gave a destructive action permanent space beside the
  // page's primary action and made it easy to hit by mistake. It now lives
  // one click deep behind the avatar, alongside the account details — the
  // same pattern as NotificationBell's dropdown.
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (!userMenuRef.current?.contains(e.target)) setUserMenuOpen(false);
    };
    // Escape closes it too — an open menu is a focus trap for keyboard users
    // otherwise, and it is the behaviour every other popover here has.
    const onKey = (e) => {
      if (e.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen]);

  /**
   * What to call this person in the UI.
   *
   * `role` is the permission level (admin/manager/executor/viewer) — it drives
   * authorization, not how someone is introduced. When an account carries a
   * real job title ("Managing Director"), that is the useful label and showing
   * the raw role beside it is just noise. Accounts without a title fall back to
   * the role so the slot is never empty.
   */
  const designation = user?.title || user?.role;

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
      {/* `.topbar-inner` applies the shared --page-max cap and --page-gutter,
          so the bar's contents line up with the cards on the page below it.
          The responsive layout lives inside it rather than replacing it —
          alignment and breakpoint behaviour are independent concerns. */}
      <div className="topbar-inner">
        {/* On mobile the page action (e.g. "+ New Project") moves to the very
            start of the bar instead of sitting bunched with the theme/bell/
            account icons at the end — especially useful on pages that also
            hide their title on mobile (ProjectsPage), where it fills what
            would otherwise be empty space. Desktop/tablet keep it at the end,
            unchanged. */}
        {isMobile && actions}
        {/* Title only. The subtitle line under it is deliberately not rendered
            anywhere: on most pages it restated the page's own name in a
            sentence ("Franchise expansion — portfolio command centre" under
            "Dashboard") and cost a row of vertical space on every screen.
            Callers may still pass `subtitle`; it is ignored rather than
            removed from ~30 call sites. */}
        {/* `minWidth: 0` is what makes this column shrinkable. A flex item
            defaults to min-width:auto, so a long title grew the column past
            the bar and shoved the theme/bell/account controls out of it
            instead of wrapping or clamping. */}
        <div className="col grow" style={{ minWidth: 0 }}>
          {title && <div className="page-title">{title}</div>}
        </div>

        <div className="row gap-3">
          {!isMobile && actions}
          <ThemeToggle />
          <NotificationBell />
          {/* One account menu at every width. Log out lives inside it rather
              than as its own button in the bar: a destructive, rarely-used
              action does not deserve permanent space next to the page's
              primary action, and sitting one click deep makes it far harder
              to hit by accident. The avatar is the affordance people already
              look for. */}
          <div className="topbar-user" style={{ position: 'relative' }} ref={userMenuRef}>
            <button
              type="button"
              className="row gap-2 topbar-user-trigger"
              onClick={() => setUserMenuOpen((o) => !o)}
              title={user?.name}
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <Avatar name={user?.name} color={user?.avatarColor} />
              {!isMobile && (
                <>
                  <div className="col" style={{ lineHeight: 1.2, textAlign: 'left' }}>
                    <span className="sm" style={{ fontWeight: 600 }}>{user?.name}</span>
                    {designation && <span className="tiny muted upper">{designation}</span>}
                  </div>
                  <ChevronDown
                    size={14}
                    className="muted"
                    style={{
                      transition: 'transform var(--transition)',
                      transform: userMenuOpen ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </>
              )}
            </button>

            {userMenuOpen && (
              <div className="card topbar-user-menu" role="menu">
                <div className="col topbar-user-menu-head">
                  <span className="sm" style={{ fontWeight: 600 }}>{user?.name}</span>
                  {user?.email && <span className="tiny muted">{user.email}</span>}
                  {(designation || user?.department) && (
                    <div className="row gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                      {designation && <span className="badge">{designation}</span>}
                      {user?.department && <span className="tiny muted upper">{user.department}</span>}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="row gap-2 topbar-user-menu-item"
                  onClick={() => { setUserMenuOpen(false); setConfirmOpen(true); }}
                >
                  <LogOut size={15} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
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
