import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { DLG_FREQUENCIES, WEEKDAYS } from '../../lib/opsUi.js';
import { previewRecurrence } from '../../lib/opsQueries.js';
import { fmtDate } from '../../lib/format.js';

const MONTH_DATES = [...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'last'];

function DayPicker({ value = [], onChange }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <div className="day-picker">
      {WEEKDAYS.map((d) => (
        <button type="button" key={d.value} className={value.includes(d.value) ? 'on' : ''} onClick={() => toggle(d.value)}>
          {d.short}
        </button>
      ))}
    </div>
  );
}

function DatePicker({ value = [], onChange }) {
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <div className="day-picker">
      {MONTH_DATES.map((d) => (
        <button type="button" key={d} className={value.includes(d) ? 'on' : ''} onClick={() => toggle(d)} style={{ minWidth: d === 'last' ? 56 : 34 }}>
          {d === 'last' ? 'Last' : d}
        </button>
      ))}
    </div>
  );
}

export const emptyRepeat = () => ({
  frequency: 'weekly',
  startDate: dayjs().format('YYYY-MM-DD'),
  endDate: '',
  weeklyDays: [dayjs().day()],
  monthDates: [String(dayjs().date())],
  intervalDays: 2,
  custom: { every: 'week', value: 2, weekdays: [dayjs().day()], dates: ['1'] },
});

/** Strip the fields a frequency doesn't use before sending to the API. */
export function cleanRepeat(r) {
  const out = { frequency: r.frequency, startDate: r.startDate };
  if (r.endDate) out.endDate = r.endDate;
  if (r.frequency === 'weekly') out.weeklyDays = r.weeklyDays;
  if (r.frequency === 'monthly') out.monthDates = r.monthDates;
  if (r.frequency === 'periodically') out.intervalDays = Number(r.intervalDays) || 1;
  if (r.frequency === 'custom') {
    out.custom = { every: r.custom.every, value: Number(r.custom.value) || 1 };
    if (r.custom.every === 'week') out.custom.weekdays = r.custom.weekdays;
    else out.custom.dates = r.custom.dates;
  }
  return out;
}

/** Repeat-rule editor with a live preview of the next dates. */
export function RepeatEditor({ value, onChange }) {
  const [preview, setPreview] = useState([]);
  const set = (patch) => onChange({ ...value, ...patch });
  const setCustom = (patch) => onChange({ ...value, custom: { ...value.custom, ...patch } });

  useEffect(() => {
    const t = setTimeout(() => {
      previewRecurrence(cleanRepeat(value))
        .then(setPreview)
        .catch(() => setPreview([]));
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div className="col gap-3">
      <div className="form-grid">
        <div className="field">
          <label className="label">Repeats</label>
          <select className="select" value={value.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            {DLG_FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="row gap-3">
          <div className="field grow">
            <label className="label">Starts</label>
            <input className="input" type="date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </div>
          <div className="field grow">
            <label className="label">Ends (optional)</label>
            <input className="input" type="date" value={value.endDate} min={value.startDate} onChange={(e) => set({ endDate: e.target.value })} />
          </div>
        </div>
      </div>

      {value.frequency === 'weekly' && (
        <div className="field">
          <label className="label">On these days</label>
          <DayPicker value={value.weeklyDays} onChange={(weeklyDays) => set({ weeklyDays })} />
        </div>
      )}
      {value.frequency === 'monthly' && (
        <div className="field">
          <label className="label">On these dates</label>
          <DatePicker value={value.monthDates} onChange={(monthDates) => set({ monthDates })} />
        </div>
      )}
      {value.frequency === 'periodically' && (
        <div className="field" style={{ maxWidth: 220 }}>
          <label className="label">Every N days</label>
          <input className="input" type="number" min={1} max={365} value={value.intervalDays} onChange={(e) => set({ intervalDays: e.target.value })} />
        </div>
      )}
      {value.frequency === 'custom' && (
        <div className="col gap-3">
          <div className="row gap-2 sm">
            Every
            <input className="input" type="number" min={1} max={52} style={{ width: 80 }} value={value.custom.value} onChange={(e) => setCustom({ value: e.target.value })} />
            <select className="select" style={{ width: 130 }} value={value.custom.every} onChange={(e) => setCustom({ every: e.target.value })}>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
            </select>
          </div>
          {value.custom.every === 'week' ? (
            <DayPicker value={value.custom.weekdays} onChange={(weekdays) => setCustom({ weekdays })} />
          ) : (
            <DatePicker value={value.custom.dates} onChange={(dates) => setCustom({ dates })} />
          )}
        </div>
      )}
      {value.frequency === 'yearly' && (
        <div className="sm muted">Every year on {dayjs(value.startDate).format('D MMMM')}.</div>
      )}

      <div className="col gap-1">
        <span className="tiny subtle upper">Next occurrences</span>
        <div className="preview-dates">
          {preview.length ? preview.map((d) => <span key={d} className="chip chip-sm">{fmtDate(d)}</span>) : <span className="tiny muted">Pick when it should repeat</span>}
        </div>
      </div>
    </div>
  );
}

export default RepeatEditor;
