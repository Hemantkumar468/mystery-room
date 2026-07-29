import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useCalendar } from '../../app/api/calendarApi.js';
import { CalendarToolbar } from './CalendarToolbar.jsx';
import { MonthCalendar } from './MonthCalendar.jsx';
import { DayDossier } from './DayDossier.jsx';
import { EventDrawer } from './EventDrawer.jsx';
import {
  EMPTY_FILTERS,
  monthWindow,
  filterEvents,
  deriveFacets,
  summarize,
  eventsOn,
  downloadIcs,
} from './calendarUtils.js';

const RAIL_KEY = 'mr-erp-cal-rail';

export function CalendarPage() {
  const navigate = useNavigate();
  const [selectedDay, setSelectedDay] = useState(() => dayjs().startOf('day'));
  const [shownMonth, setShownMonth] = useState(() => dayjs().startOf('month'));
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== '0');
  const [dir, setDir] = useState('next');

  const searchRef = useRef(null);

  useEffect(() => localStorage.setItem(RAIL_KEY, railOpen ? '1' : '0'), [railOpen]);

  const [windowFrom, windowTo] = useMemo(() => monthWindow(shownMonth), [shownMonth.valueOf()]);

  const { data, isLoading, isFetching } = useCalendar({
    from: windowFrom.toISOString(),
    to: windowTo.toISOString(),
  });

  const allEvents = useMemo(() => data?.events || [], [data]);
  const events = useMemo(() => filterEvents(allEvents, filters), [allEvents, filters]);
  const facets = useMemo(() => deriveFacets(allEvents), [allEvents]);

  /** The strip counts the *selected day*, which is what the right pane shows. */
  const daySummary = useMemo(() => summarize(eventsOn(events, selectedDay)), [events, selectedDay.valueOf()]);

  /**
   * Selecting a day is the only way the panes can disagree, so it is the only
   * place that reconciles them: if the day falls outside the month we display,
   * the month follows it. That keeps the selected day inside the fetched
   * window — otherwise the dossier would render "nothing scheduled" for a day
   * whose events were simply never requested.
   */
  const selectDay = useCallback(
    (day) => {
      const d = day.startOf('day');
      setDir(d.isBefore(selectedDay) ? 'prev' : 'next');
      setSelectedDay(d);
      setShownMonth((m) => (d.isSame(m, 'month') ? m : d.startOf('month')));
    },
    [selectedDay],
  );

  /** Stepping the month carries the selection with it, so the two never drift. */
  const stepMonth = useCallback(
    (delta) => {
      const next = shownMonth.add(delta, 'month');
      const today = dayjs().startOf('day');
      setDir(delta > 0 ? 'next' : 'prev');
      setShownMonth(next);
      setSelectedDay(today.isSame(next, 'month') ? today : next.startOf('month'));
    },
    [shownMonth],
  );

  const jumpMonth = useCallback((month) => {
    const today = dayjs().startOf('day');
    setDir(month.isBefore(shownMonth) ? 'prev' : 'next');
    setShownMonth(month.startOf('month'));
    setSelectedDay(today.isSame(month, 'month') ? today : month.startOf('month'));
  }, [shownMonth]);

  const goToday = useCallback(() => {
    const today = dayjs().startOf('day');
    setDir(today.isBefore(selectedDay) ? 'prev' : 'next');
    setSelectedDay(today);
    setShownMonth(today.startOf('month'));
  }, [selectedDay]);

  /**
   * Page-level shortcuts only. Day-to-day arrow navigation belongs to the grid
   * (APG roving tabindex), so it never fights a scrolled list or a text field.
   */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;

      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 't') goToday();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToday]);

  const onExport = () => downloadIcs(events, `mystery-rooms-${shownMonth.format('YYYY-MM')}.ics`);

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            Calendar
          </span>
        }
        subtitle="Task deadlines & go-live milestones across all launches"
      />

      <div className="content cal-content">
        <div className={`cal-body ${railOpen ? '' : 'no-rail'}`}>
          <aside className="cal-monthpane" aria-label="Month calendar">
            <MonthCalendar
              shownMonth={shownMonth}
              selectedDay={selectedDay}
              events={events}
              onSelectDay={selectDay}
              onStepMonth={stepMonth}
              onJumpMonth={jumpMonth}
              onToday={goToday}
            />
          </aside>

          <section className={`cal-stage ${isFetching && !isLoading ? 'refreshing' : ''}`}>
            <CalendarToolbar
              summary={daySummary}
              query={filters.q}
              onQuery={(q) => setFilters((f) => ({ ...f, q }))}
              searchRef={searchRef}
              filters={filters}
              setFilters={setFilters}
              facets={facets}
              railOpen={railOpen}
              onToggleRail={() => setRailOpen((o) => !o)}
              onExport={onExport}
            />

            <DayDossier
              day={selectedDay}
              events={events}
              windowFrom={windowFrom}
              windowTo={windowTo}
              dir={dir}
              isLoading={isLoading}
              onSelect={setSelectedEvent}
              onSelectDay={selectDay}
            />
          </section>
        </div>
      </div>

      <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </>
  );
}

export default CalendarPage;
