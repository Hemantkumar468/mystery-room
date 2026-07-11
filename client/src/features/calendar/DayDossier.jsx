import { useEffect, useMemo, useState } from 'react';
import { CalendarX2, ChevronDown, ArrowRight } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { ProgressRing } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { EventCard } from './EventCard.jsx';
import {
  DAY_GROUPS,
  DAY_GROUP_META,
  groupSelectedDay,
  nearestDayWithEvents,
  isDone,
  isOverdue,
} from './calendarUtils.js';

/**
 * The tone the selected day hands off to the hero's top border, so the eye
 * tracks from the cell it clicked into the panel that opened. Go-live outranks
 * fire, fire outranks routine.
 */
function dayTone(groups) {
  if (groups.golive.length) return 'var(--primary-strong)';
  if (groups.overdue.length) return 'var(--danger)';
  if (groups.due.length) return 'var(--warning)';
  const any = DAY_GROUPS.some((k) => groups[k].length);
  return any ? 'var(--secondary)' : 'var(--border-strong)';
}

function Group({ id, items, day, onSelect, collapsible, open, onToggle, startIndex }) {
  if (!items.length) return null;
  const meta = DAY_GROUP_META[id];
  const ghost = id === 'passing';

  const heading = (
    <>
      <span className="cal-day-group-dot" style={{ background: meta.tone }} />
      {meta.label}
      <span className="cal-day-group-n">{items.length}</span>
    </>
  );

  return (
    <section className="cal-day-group">
      {collapsible ? (
        <button
          className="cal-day-group-title as-button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`cal-group-${id}`}
        >
          {heading}
          <ChevronDown size={14} className={`cal-group-caret ${open ? 'open' : ''}`} />
        </button>
      ) : (
        <h3 className="cal-day-group-title">{heading}</h3>
      )}

      {(!collapsible || open) && (
        <div className="cal-day-list" id={`cal-group-${id}`}>
          {items.map((ev, i) => (
            <EventCard
              key={ev.id}
              ev={ev}
              day={day}
              index={startIndex + i}
              ghost={ghost}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function DayDossier({
  day,
  events,
  windowFrom,
  windowTo,
  dir,
  isLoading,
  onSelect,
  onSelectDay,
}) {
  const groups = useMemo(() => groupSelectedDay(events, day), [events, day.valueOf()]);

  const dayKey = day.format('YYYY-MM-DD');
  // Each day starts folded — the point of the fold is a four-row first glance.
  const [passingOpen, setPassingOpen] = useState(false);
  useEffect(() => setPassingOpen(false), [dayKey]);

  const all = DAY_GROUPS.flatMap((k) => groups[k]);
  const total = all.length;
  const doneCount = all.filter(isDone).length;
  const overdueCount = all.filter((ev) => isOverdue(ev)).length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;

  const isToday = day.isSame(dayjs(), 'day');
  const tone = dayTone(groups);

  const nearest = useMemo(
    () => (total === 0 ? nearestDayWithEvents(events, day, windowFrom, windowTo) : null),
    [total, events, day.valueOf(), windowFrom.valueOf(), windowTo.valueOf()],
  );

  return (
    <>
      <header className="cal-day-hero" style={{ '--day-tone': tone }}>
        <div className="cal-day-hero-date">
          <span className="cal-day-hero-dow">
            {day.format('dddd')}
            {isToday && <span className="cal-day-hero-chip">Today</span>}
          </span>
          <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
            <span className="cal-day-hero-num">{day.date()}</span>
            <span className="cal-day-hero-month">{day.format('MMMM YYYY')}</span>
          </div>
        </div>

        <div className="cal-day-stats">
          <div className="cal-day-stat">
            <span className="cal-day-stat-n">{total}</span>
            <span className="cal-day-stat-l">Events</span>
          </div>
          <div className="cal-day-stat">
            <span className="cal-day-stat-n" style={{ color: overdueCount ? 'var(--danger)' : undefined }}>
              {overdueCount}
            </span>
            <span className="cal-day-stat-l">Overdue</span>
          </div>
          <div className="cal-day-stat">
            <span className="cal-day-stat-n" style={{ color: groups.golive.length ? 'var(--primary)' : undefined }}>
              {groups.golive.length}
            </span>
            <span className="cal-day-stat-l">Go-Live</span>
          </div>

          {total > 0 && (
            <div className="cal-day-ring">
              <ProgressRing value={progress} size={44} stroke={4} />
              <span className="cal-day-ring-n">{progress}%</span>
            </div>
          )}
        </div>
      </header>

      <div className="cal-day-body" data-dir={dir} key={dayKey}>
        {isLoading ? (
          <div className="col gap-3">
            {Array.from({ length: 4 }, (_, i) => <SkBlock key={i} h={66} />)}
          </div>
        ) : total === 0 ? (
          <div className="empty cal-day-empty">
            <CalendarX2 size={30} strokeWidth={1.5} />
            <p>Nothing scheduled for {day.format('dddd, D MMMM')}.</p>
            {nearest && (
              <button className="btn btn-subtle btn-sm row gap-2" onClick={() => onSelectDay(nearest)}>
                Nearest work · {nearest.format('D MMM')}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          (() => {
            let cursor = 0;
            return DAY_GROUPS.map((id) => {
              const items = groups[id];
              const startIndex = cursor;
              cursor += items.length;
              return (
                <Group
                  key={id}
                  id={id}
                  items={items}
                  day={day}
                  startIndex={startIndex}
                  onSelect={onSelect}
                  collapsible={id === 'passing'}
                  open={passingOpen}
                  onToggle={() => setPassingOpen((o) => !o)}
                />
              );
            });
          })()
        )}
      </div>
    </>
  );
}

export default DayDossier;
