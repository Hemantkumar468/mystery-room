import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import {
  useGetNotificationsQuery, useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation,
} from '../../app/api/notificationsApi.js';
import { fromNow } from '../../lib/format.js';

const POLL_MS = 30000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  const { data: count } = useGetUnreadNotificationCountQuery(undefined, { pollingInterval: POLL_MS });
  const { data: notifications } = useGetNotificationsQuery({ limit: 8 }, { pollingInterval: POLL_MS });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const onSelect = (n) => {
    if (!n.read) markRead(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="row" style={{ position: 'relative' }} ref={rootRef}>
      <button
        className="btn btn-ghost btn-icon"
        title="Notifications"
        onClick={() => setOpen((o) => !o)}
        style={{ position: 'relative' }}
      >
        <Bell size={17} />
        {count > 0 && (
          <span
            className="tiny"
            style={{
              position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, borderRadius: 8,
              background: 'var(--danger)', color: '#fff', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontWeight: 700, fontSize: 9, padding: '0 3px',
            }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute', top: '110%', right: 0, width: 320, maxHeight: 400,
            overflowY: 'auto', zIndex: 40, boxShadow: 'var(--shadow-2)',
          }}
        >
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <span className="sm" style={{ fontWeight: 650 }}>Notifications</span>
            {count > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => markAllRead()}>
                Mark all read
              </button>
            )}
          </div>
          {!notifications?.length ? (
            <div className="empty sm" style={{ padding: '20px 12px' }}>No notifications yet</div>
          ) : (
            <div className="col">
              {notifications.map((n) => (
                <button
                  type="button"
                  key={n._id}
                  onClick={() => onSelect(n)}
                  className="col gap-1"
                  style={{
                    textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)',
                    background: n.read ? 'transparent' : 'var(--info-soft)', cursor: 'pointer', border: 'none',
                  }}
                >
                  <span className="sm" style={{ fontWeight: 600 }}>{n.title}</span>
                  <span className="tiny muted">{n.message}</span>
                  <span className="tiny subtle">{fromNow(n.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
