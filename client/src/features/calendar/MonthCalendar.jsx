import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { useDismiss } from '../../hooks/useDismiss.js';
import {
  DOW_SHORT,
  MONTHS,
  daysBetween,
  monthWindow,
  monthLoad,
  loadTier,
  summarize,
  occursOn,
  milestoneChipLabel,
} from './calendarUtils.js';

const MINI_DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const KEY = (d) => d.format('YYYY-MM-DD');

/** Month + year jump, hung off the "July 2026" title. */
function PeriodPicker({ shownMonth, onPick }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(shownMonth.year());
  const ref = useRef(null);
  useDismiss(ref, open, () => setOpen(false));

  const toggle = () => {
    setYear(shownMonth.year());
    setOpen((o) => !o);
  };

  return (
    <div className="cal-pop-anchor" ref={ref}>
      <button className="cal-mp-title" onClick={toggle} aria-expanded={open} aria-haspopup="dialog">
        <span className="cal-mp-title-month">{shownMonth.format('MMMM')}</span>
        <span className="cal-mp-title-year">{shownMonth.format('YYYY')}</span>
        <ChevronDown size={14} className={`cal-caret ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="cal-popover cal-period-pop" role="dialog" aria-label="Choose month and year">
          <div className="cal-period-years">
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
              <ChevronLeft size={15} />
            </button>
            <span className="cal-period-y">{year}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="cal-period-months">
            {MONTHS.map((m, i) => {
              const active = year === shownMonth.year() && i === shownMonth.month();
              return (
                <button
                  key={m}
                  className={`cal-period-m ${active ? 'active' : ''}`}
                  style={{ '--i': i }}
                  onClick={() => {
                    onPick(shownMonth.year(year).month(i).date(1));
                    setOpen(false);
                  }}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The calendar, promoted to a first-class surface: six fixed weeks of real
 * buttons, each carrying the day's load meter and risk marks. It is a picker,
 * not a container — no event ever renders inside a cell.
 */
export function MonthCalendar({
  shownMonth,
  selectedDay,
  events,
  onSelectDay,
  onStepMonth,
  onJumpMonth,
  onToday,
}) {
  const gridRef = useRef(null);
  // Set when selection moved by keyboard, so focus follows without stealing it
  // from the mouse or from the dossier.
  const keyboardNav = useRef(false);

  const [from, to] = useMemo(() => monthWindow(shownMonth), [shownMonth.valueOf()]);
  const days = useMemo(() => daysBetween(from, to), [from.valueOf(), to.valueOf()]);
  const load = useMemo(() => monthLoad(events, days), [events, days]);

  /** Brief counts describe the month proper, not the leading/trailing spill. */
  const brief = useMemo(() => {
    const inMonth = events.filter((ev) =>
      days.some((d) => d.month() === shownMonth.month() && occursOn(ev, d)),
    );
    return summarize(inMonth);
  }, [events, days, shownMonth.month()]);

  const today = dayjs();
  const selectedKey = KEY(selectedDay);

  useEffect(() => {
    if (!keyboardNav.current) return;
    keyboardNav.current = false;
    gridRef.current?.querySelector(`[data-date="${selectedKey}"]`)?.focus();
  }, [selectedKey]);

  /** APG grid keys. Arrows walk days, PageUp/Down walk months. */
  const onKeyDown = (e) => {
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      keyboardNav.current = true;
      onSelectDay(selectedDay.add(moves[e.key], 'day'));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      keyboardNav.current = true;
      onSelectDay(e.key === 'Home' ? selectedDay.startOf('isoWeek') : selectedDay.endOf('isoWeek'));
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      onStepMonth(e.key === 'PageUp' ? -1 : 1);
    }
  };

  return (
    <>
      <div className="cal-mp">
        <div className="cal-mp-head">
          <div className="col" style={{ gap: 2, minWidth: 0 }}>
            <PeriodPicker shownMonth={shownMonth} onPick={onJumpMonth} />
            {/* The month's shape in one line, where the title already draws the
                eye — this replaces the three-row Tasks/Go-lives/Overdue block
                that sat below the grid, past the fold on shorter screens. */}
            <span className="cal-mp-brief-line">
              {brief.milestones > 0
                ? `${brief.milestones} go-live${brief.milestones === 1 ? '' : 's'} this month`
                : 'No go-lives this month'}
              {brief.overdue > 0 && (
                <>
                  {' · '}
                  <b style={{ color: 'var(--danger)' }}>
                    {brief.overdue} task{brief.overdue === 1 ? '' : 's'} overdue
                  </b>
                </>
              )}
            </span>
          </div>

          <div className="row gap-2">
            <button className="cal-mp-today" onClick={onToday}>
              Today<kbd className="cal-kbd">T</kbd>
            </button>
            <div className="cal-stepper">
              <button className="cal-step" onClick={() => onStepMonth(-1)} aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <button className="cal-step" onClick={() => onStepMonth(1)} aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="cal-mp-dow" aria-hidden="true">
          {MINI_DOW.map((d, i) => (
            <span key={i} className="cal-mp-cap" title={DOW_SHORT[i]}>{d}</span>
          ))}
        </div>

        {/*
          A group of buttons rather than role="grid": a real grid needs role="row"
          children, and faking those with `display: contents` has a history of
          dropping semantics. Roving tabindex + arrow keys give the same
          navigation without lying about the structure.
        */}
        <div
          className="cal-mp-grid"
          role="group"
          aria-label={`${shownMonth.format('MMMM YYYY')} — choose a day`}
          ref={gridRef}
          onKeyDown={onKeyDown}
        >
          {days.map((d) => {
            const key = KEY(d);
            const {
              count = 0, overdue = 0, tasks = 0, milestones = [],
              hasOverdue = false, hasMilestone = false,
            } = load.byDay.get(key) || {};
            const isSelected = key === selectedKey;
            const isToday = d.isSame(today, 'day');
            const outside = d.month() !== shownMonth.month();

            const label = [
              d.format('D MMMM'),
              count ? `${count} event${count > 1 ? 's' : ''}` : 'no events',
              overdue ? `${overdue} overdue` : null,
              milestones.length ? `go-live: ${milestones.map(milestoneChipLabel).join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(', ');

            return (
              <button
                key={key}
                data-date={key}
                type="button"
                className={[
                  'cal-mp-cell',
                  outside ? 'out' : '',
                  isToday ? 'today' : '',
                  isSelected ? 'selected' : '',
                ].join(' ')}
                data-load={loadTier(count, load.max)}
                // Roving tabindex: the grid is one tab stop, arrows do the rest.
                tabIndex={isSelected ? 0 : -1}
                aria-current={isToday ? 'date' : undefined}
                aria-pressed={isSelected}
                aria-label={label}
                onClick={() => onSelectDay(d)}
              >
                <span className="cal-mp-num">{d.date()}</span>

                {/* Spill days stay bare — the month proper has to read as one
                    slab, and counts on a neighbouring month invite misreading
                    them as this month's. */}
                {!outside && (
                  <span className="cal-mp-lines">
                    {overdue > 0 && (
                      <span className="cal-mp-line overdue">{overdue} overdue</span>
                    )}
                    {tasks > 0 && (
                      <span className="cal-mp-line">{tasks} task{tasks === 1 ? '' : 's'}</span>
                    )}
                  </span>
                )}

                {/* Naming the go-live is the whole point: a diamond told you
                    something landed, not which launch. Two fit; beyond that
                    the cell counts the remainder rather than growing. */}
                {!outside && milestones.length > 0 && (
                  <span className="cal-mp-chips">
                    {milestones.slice(0, 2).map((ev) => (
                      <span key={ev.id} className="cal-mp-chip" title={ev.title}>
                        {milestoneChipLabel(ev)}
                      </span>
                    ))}
                    {milestones.length > 2 && (
                      <span className="cal-mp-chip more">+{milestones.length - 2}</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Three swatches naming the three things a cell can say. The old legend
          explained a diamond, a dot and a count badge — two of which the cells
          no longer draw, because they now say it in words. */}
      <div className="cal-legend">
        <span className="cal-legend-item"><i className="cal-swatch golive" /> Go-live</span>
        <span className="cal-legend-item"><i className="cal-swatch overdue" /> Overdue</span>
        <span className="cal-legend-item"><i className="cal-swatch tasks" /> Tasks due</span>
      </div>
    </>
  );
}

export default MonthCalendar;
