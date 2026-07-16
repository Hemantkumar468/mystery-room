import { useNavigate } from 'react-router-dom';
import { LogOut, Bell } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { Avatar } from '../ui/primitives.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';

export function Topbar({ title, subtitle, actions }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
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
        <ThemeToggle />
        <button className="btn btn-ghost btn-icon" title="Notifications">
          <Bell size={17} />
        </button>
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
