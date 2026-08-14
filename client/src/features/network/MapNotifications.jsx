import { useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import {
  selectMapNotifications, selectUnreadNotificationCount,
  notificationRead, notificationsAllRead, notificationsCleared,
} from '../../app/slices/mapSlice.js';
import { fromNow } from '../../lib/format.js';

/**
 * Map-domain notifications.
 *
 * WHY THIS IS NOT THE TOPBAR BELL. `components/layout/NotificationBell.jsx`
 * already exists and carries SERVER notifications — approvals waiting, stages
 * completed, a store gone live. Those are obligations. What happens on this
 * screen is different in kind: a lead was added, a filter is hiding
 * everything. Folding "you just dropped a pin" into the same queue as "a lease
 * needs your signature" devalues the queue that matters.
 *
 * So this is a second, local bell that never touches the server one. If map
 * events ever become things other people need to see, they belong in the
 * Topbar bell via the API — not here.
 */
export function MapNotifications() {
  const dispatch = useAppDispatch();
  const notifications = useAppSelector(selectMapNotifications);
  const unread = useAppSelector(selectUnreadNotificationCount);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Close on an outside click or Escape — the two ways anyone expects to
  // dismiss a dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mr-map-notif" ref={boxRef}>
      <button
        type="button"
        className="mr-map-notif__bell"
        aria-label={unread ? `Map activity, ${unread} unread` : 'Map activity'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="mr-map-notif__badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="mr-map-notif__panel" role="dialog" aria-label="Map activity">
          <div className="mr-map-notif__head">
            <strong className="sm">Map activity</strong>
            {notifications.length > 0 && (
              <span className="row gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  title="Mark all as read"
                  aria-label="Mark all as read"
                  onClick={() => dispatch(notificationsAllRead())}
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  title="Clear all"
                  aria-label="Clear all"
                  onClick={() => dispatch(notificationsCleared())}
                >
                  <X size={13} />
                </button>
              </span>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="mr-map-notif__empty sm muted">
              Nothing yet. Leads you add and alerts raised on this map appear here.
            </div>
          ) : (
            <ul className="mr-map-notif__list">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`mr-map-notif__item${n.read ? '' : ' is-unread'}`}
                    onClick={() => dispatch(notificationRead(n.id))}
                  >
                    <span className="sm" style={{ fontWeight: n.read ? 400 : 650 }}>{n.title}</span>
                    <span className="tiny muted">{n.message}</span>
                    <span className="tiny subtle">{fromNow(n.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default MapNotifications;
