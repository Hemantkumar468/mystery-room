import { useEffect, useMemo, useState } from 'react';
import { CalendarX2, ArrowRight } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { EventCard } from './EventCard.jsx';
import {
  DAY_GROUPS,
  groupSelectedDay,
  dayPanelSections,
  nearestDayWithEvents,
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

/** How many Running cards show before the rest fold behind "Show N more". */
const RUNNING_PREVIEW = 2;

/**
 * One headed section of the day panel.
 *
 * `urgent` marks the cards that carry a deadline the reader has already missed
 * or must meet today — those get the danger-toned border, so the panel's one
 * strong colour always means "decide this".
 */
function PanelSection({ id, label, tone, items, day, onSelect, urgent, limit, onShowMore }) {
  if (!items.length) return null;

  const visible = limit ? items.slice(0, limit) : items;
  const hidden = items.length - visible.length;

  return (
    <section className="cal-day-group">
      <h3 className="cal-day-group-title">
        <span className="cal-day-group-dot" style={{ background: tone }} />
        {label}
        <span className="cal-day-group-n">{items.length}</span>
      </h3>

      <div className="cal-day-list" id={`cal-group-${id}`}>
        {visible.map((ev, i) => (
          <EventCard
            key={ev.id}
            ev={ev}
            day={day}
            index={i}
            ghost={!urgent && id === 'running'}
            urgent={urgent}
            onSelect={onSelect}
          />
        ))}
      </div>

      {hidden > 0 && (
        <button type="button" className="cal-day-more" onClick={onShowMore}>
          Show {hidden} more
        </button>
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
  const overdueCount = all.filter((ev) => isOverdue(ev)).length;
  const taskCount = all.filter((ev) => ev.type === 'task').length;

  const sections = useMemo(() => dayPanelSections(events, day), [events, day.valueOf()]);

  const isToday = day.isSame(dayjs(), 'day');
  const tone = dayTone(groups);

  const nearest = useMemo(
    () => (total === 0 ? nearestDayWithEvents(events, day, windowFrom, windowTo) : null),
    [total, events, day.valueOf(), windowFrom.valueOf(), windowTo.valueOf()],
  );

  return (
    <>
      {/* One date line and one sentence, replacing the three stat tiles and the
          completion ring. Those restated numbers the sections below already
          head, and cost the panel its whole first screen before a single piece
          of work appeared. */}
      <header className="cal-day-hero compact" style={{ '--day-tone': tone }}>
        <div className="cal-day-hero-date">
          <span className="cal-day-hero-title">
            {day.format('dddd D MMMM')}
            {isToday && <span className="cal-day-hero-chip">Today</span>}
          </span>
          <span className="cal-day-hero-sub">
            {taskCount === 0 ? 'No tasks' : `${taskCount} task${taskCount === 1 ? '' : 's'}`}
            {' · '}
            {groups.golive.length === 0
              ? 'no go-live'
              : `${groups.golive.length} go-live${groups.golive.length === 1 ? '' : 's'}`}
            {overdueCount > 0 && (
              <>
                {' · '}
                <b style={{ color: 'var(--danger)' }}>{overdueCount} overdue</b>
              </>
            )}
          </span>
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
          <>
            <PanelSection
              id="golive"
              label="Go-live"
              tone="var(--primary-strong)"
              items={sections.golive}
              day={day}
              onSelect={onSelect}
            />
            <PanelSection
              id="needsAction"
              label="Needs action"
              tone="var(--danger)"
              items={sections.needsAction}
              day={day}
              onSelect={onSelect}
              urgent
            />
            {/* Running is the group that folds: it is usually the longest and
                the least decision-bearing, so it shows a couple and offers the
                rest rather than pushing Needs Action off the panel. */}
            <PanelSection
              id="running"
              label="Running"
              tone="var(--text-subtle)"
              items={sections.running}
              day={day}
              onSelect={onSelect}
              limit={passingOpen ? undefined : RUNNING_PREVIEW}
              onShowMore={() => setPassingOpen(true)}
            />
          </>
        )}
      </div>
    </>
  );
}

export default DayDossier;
