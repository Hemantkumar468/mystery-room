import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Moon, Sun, LogOut } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.js';
import { useAuthStore } from '../../store/authStore.js';
import { Avatar } from '../ui/primitives.jsx';
import { NotificationBell } from '../ops/NotificationBell.jsx';

export function Topbar({ title, subtitle, actions }) {
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const onLogout = () => {
    logout();
    // Don't let the next person who signs in see this user's cached data.
    queryClient.clear();
    navigate('/login');
  };

  return (
    <header className="topbar">
      <div className="col grow">
        <div className="page-title">{title}</div>
        {subtitle && <div className="sm muted">{subtitle}</div>}
      </div>

      <div className="row gap-3">
        {actions}
        <button className="btn btn-ghost btn-icon" onClick={toggle} title="Toggle theme">
          {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
        </button>
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
