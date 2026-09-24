import { Target, AlertTriangle, Check } from 'lucide-react';
import {
  eventTone,
  isOverdue,
  isDone,
  eventSubtitle,
  spanDays,
  startOf,
  endOf,
  dayIndexOf,
  urgencyLabel,
  spanPosition,
} from './calendarUtils.js';

/**
 * One row in the day dossier.
 *
 * `ghost` is set for spans merely passing through the selected day — they read
 * at reduced weight and drop the avatar, so a 45-day task doesn't shout with
 * identical force on all 45 of its days. It only reaches full weight on the
 * day it starts, ends, or slips.
 */
export function EventCard({ ev, day, onSelect, index = 0, ghost = false, urgent = false }) {
  const tone = eventTone(ev);
  const overdue = isOverdue(ev);
  const done = isDone(ev);
  const milestone = ev.type === 'milestone';
  const accent = overdue ? 'var(--danger)' : tone.color;

  const span = spanDays(ev);
  const subtitle = eventSubtitle(ev);

  /**
   * The meta line answers where, when and who, in that order — the three
   * questions asked of a row before it is opened. Place leads because the
   * portfolio spans cities and the same task title recurs in every one of
   * them; the project code it used to lead with identified nothing a reader
   * holds in their head.
   */
  const metaBits = [
    ev.project?.city || ev.project?.code,
    urgencyLabel(ev, day) ||
      (span > 1 && day
        ? `day ${spanPosition(ev, day).index} of ${span}`
        : null),
    span > 1 && day ? `ends ${endOf(ev).format('D MMM')}` : null,
    ev.assignee?.name,
  ].filter(Boolean);

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
        urgent ? 'urgent' : '',
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

        {/* The bar sits above the meta line so a running card reads
            title → how far → the details, top to bottom. */}
        {progress && !urgent && (
          <span className="cal-card-span" aria-hidden="true">
            <span className="cal-card-track">
              <i className="cal-card-fill" style={{ width: `${progress.pct}%` }} />
            </span>
          </span>
        )}

        <span className="cal-card-meta">
          <span className={`cal-card-sub${urgent ? ' urgent' : ''}`}>
            {metaBits.join(' · ')}
          </span>
        </span>
      </span>
    </button>
  );
}

/** Exported for the drawer's "starts / ends" line. */
export const spanLabel = (ev) =>
  spanDays(ev) > 1 ? `${startOf(ev).format('D MMM')} → ${endOf(ev).format('D MMM')}` : endOf(ev).format('D MMM');

export default EventCard;
