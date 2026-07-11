import { Target, AlertTriangle, Check } from 'lucide-react';
import { Avatar } from '../../components/ui/primitives.jsx';
import {
  eventTone,
  isOverdue,
  isDone,
  eventSubtitle,
  spanDays,
  startOf,
  endOf,
  dayIndexOf,
} from './calendarUtils.js';

/**
 * One row in the day dossier.
 *
 * `ghost` is set for spans merely passing through the selected day — they read
 * at reduced weight and drop the avatar, so a 45-day task doesn't shout with
 * identical force on all 45 of its days. It only reaches full weight on the
 * day it starts, ends, or slips.
 */
export function EventCard({ ev, day, onSelect, index = 0, ghost = false }) {
  const tone = eventTone(ev);
  const overdue = isOverdue(ev);
  const done = isDone(ev);
  const milestone = ev.type === 'milestone';
  const accent = overdue ? 'var(--danger)' : tone.color;

  const span = spanDays(ev);
  const subtitle = eventSubtitle(ev);

  // A day-N-of-M read, which is the only honest progress signal we have:
  // every event is all-day, so there is no clock to show.
  let progress = null;
  if (span > 1 && day) {
    const idx = Math.min(Math.max(dayIndexOf(ev, day), 0), span - 1);
    progress = {
      pct: (idx / (span - 1)) * 100,
      label: `Day ${idx + 1} of ${span} · ends ${endOf(ev).format('D MMM')}`,
    };
  }

  return (
    <button
      className={[
        'cal-card',
        milestone ? 'milestone' : '',
        done ? 'done' : '',
        overdue ? 'overdue' : '',
        ghost ? 'ghost' : '',
      ].join(' ')}
      style={{ '--tone': accent, '--tone-soft': tone.soft, '--i': Math.min(index, 8) }}
      onClick={() => onSelect(ev)}
      title={`${ev.title}${subtitle ? ` · ${subtitle}` : ''}`}
    >
      <span className="cal-card-rail" />

      <span className="cal-card-body">
        <span className="cal-card-top">
          {milestone ? (
            <Target size={12} strokeWidth={2.75} />
          ) : overdue ? (
            <AlertTriangle size={12} strokeWidth={2.75} />
          ) : done ? (
            <Check size={12} strokeWidth={3} />
          ) : (
            <span className="cal-card-dot" />
          )}
          <span className="cal-card-title">{ev.title}</span>
        </span>

        <span className="cal-card-meta">
          {subtitle && <span className="cal-card-sub">{subtitle}</span>}
          <span className="cal-card-status">
            {overdue ? `Overdue · due ${endOf(ev).format('D MMM')}` : tone.label}
          </span>
        </span>

        {progress && (
          <span className="cal-card-span" aria-hidden="true">
            <span className="cal-card-track">
              <i className="cal-card-fill" style={{ width: `${progress.pct}%` }} />
              <i className="cal-card-marker" style={{ left: `${progress.pct}%` }} />
            </span>
            <span className="cal-card-span-label">{progress.label}</span>
          </span>
        )}
      </span>

      {ev.assignee && !ghost && (
        <Avatar name={ev.assignee.name} color={ev.assignee.avatarColor || 'var(--ink-500)'} size={22} />
      )}
    </button>
  );
}

/** Exported for the drawer's "starts / ends" line. */
export const spanLabel = (ev) =>
  spanDays(ev) > 1 ? `${startOf(ev).format('D MMM')} → ${endOf(ev).format('D MMM')}` : endOf(ev).format('D MMM');

export default EventCard;
