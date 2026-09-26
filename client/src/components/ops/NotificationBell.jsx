import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, CheckCheck, Trash2 } from 'lucide-react';
import { useNotifications, useNotificationActions } from '../../lib/opsQueries.js';
import { fromNow } from '../../lib/format.js';

const KIND_COLOR = {
  assigned: 'var(--primary)',
  approval: '#6366f1',
  completed: 'var(--success)',
  rejected: 'var(--danger)',
  blocked: 'var(--danger)',
  escalation: 'var(--danger)',
  reminder: 'var(--warning)',
  remark: 'var(--info)',
};

/** Top-bar bell: live unread count + a dropdown inbox. */
export function NotificationBell() {
  const { data } = useNotifications();
  const { read, readAll, clear } = useNotificationActions();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const items = data?.data || [];
  const unread = data?.meta?.unread || 0;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openItem = (n) => {
    if (!n.isRead) read.mutate(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="notif" ref={ref}>
      <button className="btn btn-ghost btn-icon" title="Delegation & checklist alerts" onClick={() => setOpen((o) => !o)} aria-label={`Delegation & checklist alerts (${unread} unread)`}>
        <ClipboardCheck size={17} />
        {unread > 0 && <span className="notif-dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel fade-in">
          <div className="row between notif-head">
            <span className="section-title">Delegation &amp; checklist</span>
            <span className="row gap-1">
              <button className="btn btn-ghost btn-sm" onClick={() => readAll.mutate()} disabled={!unread} title="Mark all as read">
                <CheckCheck size={14} /> Read all
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => clear.mutate()} disabled={!items.length} title="Clear all">
                <Trash2 size={14} />
              </button>
            </span>
          </div>
          <div className="notif-list">
            {items.map((n) => (
              <button key={n._id} className={`notif-item ${n.isRead ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <span className="notif-kind" style={{ background: KIND_COLOR[n.kind] || 'var(--ink-400)' }} />
                <span className="col grow" style={{ minWidth: 0, textAlign: 'left' }}>
                  <span className="sm" style={{ fontWeight: 650 }}>{n.title}</span>
                  <span className="tiny muted notif-msg">{n.message}</span>
                  <span className="tiny subtle">{fromNow(n.createdAt)}</span>
                </span>
              </button>
            ))}
            {!items.length && <div className="empty sm" style={{ padding: 28 }}>You're all caught up</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
