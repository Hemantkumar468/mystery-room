import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, ClipboardCheck, Gavel, Undo2, CheckCircle2, AlertTriangle, Clock, Inbox,
} from 'lucide-react';
import {
  useGetNotificationsQuery, useGetUnreadNotificationCountQuery,
  useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation,
} from '../../app/api/notificationsApi.js';
import { useNotificationStream } from '../../hooks/useNotificationStream.js';
import { fromNow } from '../../lib/format.js';
import '../../styles/notifications.css';

/**
 * The bell.
 *
 * WHAT WAS WRONG WITH IT. Every row was a title and a message, each written
 * by whichever call site happened to raise it, so the list read as a pile of
 * unrelated sentences — "A task is yours", "Escalated (19522%): ZZTKT-93CZ9
 * Half way". Both true; neither answers the only question a person has while
 * glancing at a bell, which is "is this mine, and what do I do about it?"
 *
 * So a row now has one shape, drawn from the four fields the notification
 * carries (see the notification model): an icon for the KIND of thing, the
 * title, what it is ABOUT, what to DO, and when it is due. A row missing
 * those extras — anything raised before they existed — simply renders without
 * them rather than breaking.
 *
 * LIVE, not polled. useNotificationStream holds a request open and redraws
 * this the moment something lands; the 30s interval below is the floor if
 * that is ever blocked, not the mechanism. See that hook for why it is a long
 * poll and not a socket.
 */

const POLL_MS = 30000;

/**
 * The icon says what KIND of interruption this is before a word is read:
 * work arriving, a decision wanted, an answer coming back. Three kinds is
 * about the limit of what anybody distinguishes at 14px.
 */
const KIND = {
  task_assigned: { Icon: ClipboardCheck, tone: 'work', label: 'Your work' },
  approval_needed: { Icon: Gavel, tone: 'decide', label: 'Needs your decision' },
  work_returned: { Icon: Undo2, tone: 'back', label: 'Sent back' },
  decision_made: { Icon: CheckCircle2, tone: 'done', label: 'Decided' },
  crm_ticket_escalated: { Icon: AlertTriangle, tone: 'warn', label: 'Escalated' },
  crm_ticket_warning: { Icon: AlertTriangle, tone: 'warn', label: 'Warning' },
  crm_task_due: { Icon: Clock, tone: 'work', label: 'Due' },
};
const DEFAULT_KIND = { Icon: Inbox, tone: 'work', label: '' };

/** "20 Oct" — the bell has one line for a date, so it gets the short one. */
const dueLabel = (d) => {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function Row({ n, onSelect }) {
  const kind = KIND[n.type] || DEFAULT_KIND;
  const { Icon } = kind;
  const due = dueLabel(n.due);
  const overdue = n.due && new Date(n.due) < new Date();

  return (
    <button
      type="button"
      className={`nb-row${n.read ? '' : ' is-unread'}`}
      onClick={() => onSelect(n)}
    >
      <span className={`nb-ico t-${kind.tone}`} aria-hidden="true"><Icon size={14} /></span>

      <span className="nb-body">
        <span className="nb-title">{n.title}</span>

        {/* WHAT IT IS ABOUT. The property, the project — the thing that makes
            "Feasibility Assessment is yours" answerable without opening it. */}
        {n.entity && <span className="nb-entity" title={n.entity}>{n.entity}</span>}

        {/* WHAT TO DO. One sentence, clamped — the full text is on the page
            the row opens, and a bell that scrolls is a bell nobody finishes. */}
        {n.message && <span className="nb-msg">{n.message}</span>}

        <span className="nb-meta">
          {kind.label && <span className={`nb-tag t-${kind.tone}`}>{kind.label}</span>}
          <span className="nb-when">{fromNow(n.createdAt)}</span>
          {n.actorName && <span className="nb-actor">by {n.actorName}</span>}
          {due && (
            <span className={`nb-due${overdue ? ' is-late' : ''}`}>
              <Clock size={10} aria-hidden="true" /> {overdue ? 'was due' : 'due'} {due}
            </span>
          )}
        </span>
      </span>

      {!n.read && <span className="nb-dot" aria-label="Unread" />}
    </button>
  );
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  /* The live wire. Mounted here because the bell is on every authenticated
     screen, so one hook covers the whole app. */
  useNotificationStream(true);

  const { data: count } = useGetUnreadNotificationCountQuery(undefined, { pollingInterval: POLL_MS });
  const { data: notifications } = useGetNotificationsQuery({ limit: 12 }, { pollingInterval: POLL_MS });
  const [markRead] = useMarkNotificationReadMutation();
  const [markAllRead] = useMarkAllNotificationsReadMutation();

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    /* Escape closes it too: a panel that can only be dismissed by aiming at
       the page behind it is one keyboard users cannot get out of. */
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onSelect = (n) => {
    if (!n.read) markRead(n._id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const rows = notifications || [];
  const unread = count || 0;

  return (
    <div className="nb" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost btn-icon nb-btn"
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={17} />
        {unread > 0 && <span className="nb-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <span className="nb-head-title">
              Notifications
              {unread > 0 && <span className="nb-head-count">{unread} new</span>}
            </span>
            {unread > 0 && (
              <button type="button" className="nb-markall" onClick={() => markAllRead()}>
                Mark all read
              </button>
            )}
          </div>

          {!rows.length ? (
            <div className="nb-empty">
              <Inbox size={20} aria-hidden="true" />
              <span>You are all caught up</span>
              <small>Work assigned to you, and decisions waiting on you, land here.</small>
            </div>
          ) : (
            <div className="nb-list">
              {rows.map((n) => <Row key={n._id} n={n} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
