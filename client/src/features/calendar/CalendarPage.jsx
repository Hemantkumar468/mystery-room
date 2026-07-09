import { useState, useMemo } from 'react';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight, Circle } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { useCalendar } from '../../lib/queries.js';
import { TASK_STATUS_META } from '../../lib/ui.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function eventColor(ev) {
  if (ev.type === 'milestone') return '#e0a13a';
  return TASK_STATUS_META[ev.status]?.color || '#6366f1';
}

export function CalendarPage() {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));

  const gridStart = cursor.startOf('month').startOf('isoWeek');
  const gridEnd = cursor.endOf('month').endOf('isoWeek');

  const { data, isLoading } = useCalendar({
    from: gridStart.toISOString(),
    to: gridEnd.toISOString(),
  });

  const days = useMemo(() => {
    const arr = [];
    let d = gridStart;
    while (d.isBefore(gridEnd) || d.isSame(gridEnd, 'day')) {
      arr.push(d);
      d = d.add(1, 'day');
    }
    return arr;
  }, [gridStart, gridEnd]);

  const eventsByDay = useMemo(() => {
    const map = {};
    (data?.events || []).forEach((ev) => {
      const key = dayjs(ev.start).format('YYYY-MM-DD');
      (map[key] = map[key] || []).push(ev);
    });
    return map;
  }, [data]);

  const today = dayjs();

  return (
    <>
      <Topbar
        title="Calendar"
        subtitle="Task deadlines & go-live milestones across all launches"
        actions={
          <div className="row gap-2">
            <button className="btn btn-ghost btn-icon" onClick={() => setCursor((c) => c.subtract(1, 'month'))}><ChevronLeft size={16} /></button>
            <span style={{ fontWeight: 650, minWidth: 130, textAlign: 'center' }}>{cursor.format('MMMM YYYY')}</span>
            <button className="btn btn-ghost btn-icon" onClick={() => setCursor((c) => c.add(1, 'month'))}><ChevronRight size={16} /></button>
            <button className="btn btn-subtle btn-sm" onClick={() => setCursor(dayjs().startOf('month'))}>Today</button>
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow fade-in col gap-3">
          <div className="row gap-4 sm muted">
            <span className="row gap-1"><Circle size={9} fill="#e0a13a" stroke="none" /> Go-Live milestone</span>
            <span className="row gap-1"><Circle size={9} fill="#6366f1" stroke="none" /> Task deadline</span>
            <span className="row gap-1"><Circle size={9} fill="#10b981" stroke="none" /> Completed</span>
          </div>

          {isLoading ? (
            <SkBlock h={620} />
          ) : (
            <div className="cal-grid">
              {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
              {days.map((d) => {
                const key = d.format('YYYY-MM-DD');
                const evs = eventsByDay[key] || [];
                const isThisMonth = d.month() === cursor.month();
                const isToday = d.isSame(today, 'day');
                return (
                  <div key={key} className={`cal-cell ${isThisMonth ? '' : 'dim'} ${isToday ? 'today' : ''}`}>
                    <span className="cal-date">{d.date()}</span>
                    {evs.slice(0, 4).map((ev) => (
                      <div key={ev.id} className="cal-event" style={{ background: eventColor(ev) }} title={`${ev.title}${ev.project ? ` · ${ev.project.code}` : ''}`}>
                        {ev.title}
                      </div>
                    ))}
                    {evs.length > 4 && <span className="tiny subtle">+{evs.length - 4} more</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default CalendarPage;
