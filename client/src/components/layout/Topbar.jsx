import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { logoutThunk } from '../../app/slices/logoutThunk.js';
import { Avatar } from '../ui/primitives.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { NotificationBell } from './NotificationBell.jsx';

export function Topbar({ title, subtitle, actions }) {
  // Selector rather than the whole store: this component previously
  // subscribed to every auth field and re-rendered on any of them.
  const user = useAppSelector(selectCurrentUser);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const onLogout = async () => {
    // Ends the server session (clearing the httpOnly refresh cookie) and
    // wipes both caches before navigating — see logoutThunk.
    await dispatch(logoutThunk('user'));
    navigate('/login', { replace: true });
  };

  return (
    <header className="topbar">
      <div className="col grow">
        <div className="page-title">{title}</div>
        {subtitle && <div className="sm muted">{subtitle}</div>}
      </div>

      <div className="row gap-3">
        {actions}
        <ThemeToggle />
        <NotificationBell />
        <div className="row gap-2" style={{ paddingLeft: 12, borderLeft: '1px solid var(--border)' }}>
          <Avatar name={user?.name} color={user?.avatarColor} />
          <div className="col" style={{ lineHeight: 1.2 }}>
            <span className="sm" style={{ fontWeight: 600 }}>{user?.name}</span>
            <span className="tiny muted upper">{user?.role}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onLogout} title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default Topbar;
