import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Target, AlertTriangle, ArrowUpRight, CalendarRange, Layers, Building2, MapPin } from 'lucide-react';
import { Avatar, PriorityBadge, StatusBadge } from '../../components/ui/primitives.jsx';
import { fmtDate, fromNow } from '../../lib/format.js';
import { eventTone, isOverdue, spanDays, startOf, endOf, deptLabel } from './calendarUtils.js';

function Row({ icon, label, children }) {
  return (
    <div className="cal-drawer-row">
      <span className="cal-drawer-icon">{icon}</span>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="tiny subtle upper">{label}</span>
        <span className="cal-drawer-value">{children}</span>
      </div>
    </div>
  );
}

export function EventDrawer({ event, onClose }) {
  useEffect(() => {
    if (!event) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [event, onClose]);

  if (!event) return null;

  const tone = eventTone(event);
  const overdue = isOverdue(event);
  const milestone = event.type === 'milestone';
  const days = spanDays(event);

  return (
    <div className="cal-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="cal-drawer"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={event.title}
        style={{ '--tone': overdue ? 'var(--danger)' : tone.color, '--tone-soft': tone.soft }}
      >
        <div className="cal-drawer-sheen" />

        <header className="cal-drawer-head">
          <span className="cal-drawer-type">
            {milestone ? <Target size={13} strokeWidth={2.75} /> : <Layers size={13} />}
            {milestone ? 'Go-Live Milestone' : 'Task Deadline'}
          </span>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <h2 className="cal-drawer-title">{event.title}</h2>

        <div className="row gap-2" style={{ flexWrap: 'wrap', marginBottom: 20 }}>
          {overdue && (
            <span className="badge" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              <AlertTriangle size={11} strokeWidth={2.75} /> Overdue {fromNow(endOf(event))}
            </span>
          )}
          {!milestone && <StatusBadge value={event.status} />}
          {!milestone && event.priority && <PriorityBadge value={event.priority} />}
          {event.department && <span className="badge">{deptLabel(event.department)}</span>}
        </div>

        <div className="cal-drawer-rows">
          <Row icon={<CalendarRange size={15} />} label={days > 1 ? `Schedule · ${days} days` : 'Scheduled'}>
            {days > 1 ? `${fmtDate(startOf(event))} → ${fmtDate(endOf(event))}` : fmtDate(endOf(event))}
          </Row>

          {event.stageName && (
            <Row icon={<Layers size={15} />} label="Stage">{event.stageName}</Row>
          )}

          {event.project && (
            <Row icon={<Building2 size={15} />} label="Project">
              <Link to={`/projects/${event.project.id}`} className="cal-drawer-link" onClick={onClose}>
                {event.project.name}
                <ArrowUpRight size={13} />
              </Link>
            </Row>
          )}

          {event.project?.city && (
            <Row icon={<MapPin size={15} />} label="City">{event.project.city}</Row>
          )}

          {event.assignee && (
            <Row icon={<Avatar name={event.assignee.name} color={event.assignee.avatarColor || 'var(--ink-500)'} size={20} />} label="Owner">
              {event.assignee.name}
            </Row>
          )}

          {event.code && <Row icon={<span className="cal-drawer-code">#</span>} label="Reference">{event.code}</Row>}
        </div>

        {event.project && (
          <Link to={`/projects/${event.project.id}`} className="btn btn-primary cal-drawer-cta" onClick={onClose}>
            Open project
            <ArrowUpRight size={15} />
          </Link>
        )}
      </aside>
    </div>
  );
}

export default EventDrawer;
