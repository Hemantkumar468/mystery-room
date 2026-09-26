import dayjs from 'dayjs';
import { CalendarRange } from 'lucide-react';

export const DATE_PRESETS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'lastMonth', label: 'Last Month' },
  { value: 'custom', label: 'Custom Date Range' },
];

const fmt = (d) => d.format('YYYY-MM-DD');

/**
 * Turn a preset into a concrete { from, to } pair of 'YYYY-MM-DD' keys
 * (undefined = open-ended). "Last 7 days" includes today.
 */
export function resolveDateRange(preset, customFrom, customTo) {
  const today = dayjs().startOf('day');
  switch (preset) {
    case 'today':
      return { from: fmt(today), to: fmt(today) };
    case 'yesterday': {
      const y = today.subtract(1, 'day');
      return { from: fmt(y), to: fmt(y) };
    }
    case 'last7':
      return { from: fmt(today.subtract(6, 'day')), to: fmt(today) };
    case 'last30':
      return { from: fmt(today.subtract(29, 'day')), to: fmt(today) };
    case 'thisMonth':
      return { from: fmt(today.startOf('month')), to: fmt(today.endOf('month')) };
    case 'lastMonth': {
      const m = today.subtract(1, 'month');
      return { from: fmt(m.startOf('month')), to: fmt(m.endOf('month')) };
    }
    case 'custom':
      return { from: customFrom || undefined, to: customTo || undefined };
    default:
      return { from: undefined, to: undefined };
  }
}

/** Short human label for the active range, e.g. "Last 7 Days" or "01 Sep – 15 Sep". */
export function describeDateRange(value = {}) {
  if (!value.preset || value.preset === 'all') return 'All Time';
  if (value.preset !== 'custom') return DATE_PRESETS.find((p) => p.value === value.preset)?.label;
  const f = value.from ? dayjs(value.from).format('DD MMM') : '…';
  const t = value.to ? dayjs(value.to).format('DD MMM') : '…';
  return `${f} – ${t}`;
}

/**
 * One date filter with quick options. `value` = { preset, from, to } where
 * from/to are always the resolved keys, so callers can send them as-is.
 * The From/To inputs only appear for a custom range.
 */
export function DateRangeFilter({ label = 'Date', value = { preset: 'all' }, onChange }) {
  const preset = value.preset || 'all';
  const setPreset = (p) => {
    if (p === 'custom') {
      onChange({ preset: 'custom', from: value.from, to: value.to });
    } else {
      onChange({ preset: p, ...resolveDateRange(p) });
    }
  };
  const setCustom = (patch) => {
    const next = { ...value, preset: 'custom', ...patch };
    // Keep the range the right way round.
    if (next.from && next.to && next.from > next.to) {
      if (patch.from) next.to = next.from;
      else next.from = next.to;
    }
    onChange(next);
  };

  return (
    <div className="filter-select date-range-filter">
      <span className="tiny subtle upper">{label}</span>
      <div className="row gap-2">
        <label className="date-range-select">
          <CalendarRange size={14} className="subtle" />
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label={label}>
            {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <input className="input date-input" type="date" aria-label="From date" value={value.from || ''} max={value.to || undefined} onChange={(e) => setCustom({ from: e.target.value || undefined })} />
            <span className="tiny subtle">to</span>
            <input className="input date-input" type="date" aria-label="To date" value={value.to || ''} min={value.from || undefined} onChange={(e) => setCustom({ to: e.target.value || undefined })} />
          </>
        )}
      </div>
    </div>
  );
}

export default DateRangeFilter;
