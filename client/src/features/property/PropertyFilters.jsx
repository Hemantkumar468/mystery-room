import { RotateCcw } from 'lucide-react';

/**
 * SORT, SOURCE AND STATUS — the three controls every property step gets.
 *
 * WHAT WAS THERE BEFORE. A button labelled "Filters" that cleared the filters.
 * It named one thing and did the opposite, and there was nothing behind it: no
 * way to sort, no way to see only the brokers' sites, no way to pull up
 * everything still awaiting review. Search and City were the whole of it.
 *
 * ALL THREE RUN ON THE SERVER, and that is the point rather than an
 * implementation note. The queue is paginated — twenty-five rows of fifty-four
 * — so a control that filtered or sorted in the browser would only ever see
 * the page it was standing on: "oldest first" would sort twenty-five rows out
 * of fifty-four and put the wrong one at the top, and "Shortlisted" would find
 * rows on page 1 and nothing on page 2 while the footer still said 54. Every
 * one of these narrows the whole step, and the count under the table is the
 * count of what matched.
 *
 * THE OPTIONS ARE BUILT FROM THE DATA, not from a list of everything that
 * could theoretically exist. Cities and statuses come back with the queue and
 * only include what is actually in it; offering "Rejected" on a step with
 * nothing rejected sends somebody looking for rows that are not there.
 */

/**
 * The sorts worth offering, each as one line a person would say.
 *
 * Two fields with a direction is how the server models this, and "Sort by:
 * Date / Direction: Descending" is two controls for one thought. These are the
 * pairs anybody actually asks for, spelled out.
 *
 * Every `key` here is in the server's SORT_KEYS. A key that is not gets
 * refused by the edge, which is exactly the bug the Average column had.
 */
export const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest first', key: 'createdAt', dir: 'desc' },
  { id: 'oldest', label: 'Oldest first', key: 'createdAt', dir: 'asc' },
  { id: 'az', label: 'Property A–Z', key: 'title', dir: 'asc' },
  { id: 'za', label: 'Property Z–A', key: 'title', dir: 'desc' },
  { id: 'cityaz', label: 'City A–Z', key: 'city', dir: 'asc' },
  { id: 'cityza', label: 'City Z–A', key: 'city', dir: 'desc' },
  { id: 'biggest', label: 'Largest area first', key: 'area', dir: 'desc' },
  { id: 'smallest', label: 'Smallest area first', key: 'area', dir: 'asc' },
];

/** Who the site came from. Same words as Step 1's tabs and the Source badge. */
export const SOURCE_OPTIONS = [
  { key: 'franchise', label: 'Franchisee' },
  { key: 'broker', label: 'Broker' },
  { key: 'other', label: 'Other' },
  /* One entry, not two: `company` is the server's word for both of the
     roads we open a store down. Same merge as Step 1's tab strip. */
  { key: 'company', label: 'Company Owned' },
];

/** The id of whichever option matches the sort currently in force. */
const idOf = (sort) => SORT_OPTIONS.find((o) => o.key === sort?.key && o.dir === sort?.dir)?.id || '';

/**
 * WHEN THE PROPERTY CAME IN — named ranges, plus one that asks.
 *
 * A pair of date inputs is two controls and four keystrokes for "this
 * month", which is what people actually want nine times in ten. The named
 * ranges answer those in one click; "Custom range…" opens the two inputs for
 * the tenth.
 *
 * Resolved here rather than on the server so the dates travel as plain
 * `from`/`to`, which means a filtered queue stays a URL somebody can share
 * and the server never has to know what "this month" meant on the day it was
 * pressed.
 */
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const DATE_PRESETS = [
  { id: 'all', label: 'All time' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastmonth', label: 'Last month' },
  { id: 'quarter', label: 'Last 3 months' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom range…' },
];

export function resolveDates(preset) {
  const now = new Date();
  const back = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
  switch (preset) {
    case '7d': return { from: iso(back(7)), to: iso(now) };
    case '30d': return { from: iso(back(30)), to: iso(now) };
    case 'month':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
    case 'lastmonth':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        /* Day 0 of this month is the last day of last month — and it is the
           one date arithmetic people get wrong by hand. */
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'quarter':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())), to: iso(now) };
    case 'year':
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    default: return { from: undefined, to: undefined };
  }
}

/** The capture form's own three words. */
export const PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];

export function PropertyFilters({ q, showSource = true, className = '' }) {
  const current = idOf(q.sort);

  return (
    <span className={`pf-bar ${className}`}>
      <label className="pf-field">
        <span className="pf-label">Sort</span>
        <select
          className="pc2-select"
          value={current}
          onChange={(e) => {
            const o = SORT_OPTIONS.find((x) => x.id === e.target.value);
            if (o) q.setSort({ key: o.key, dir: o.dir });
          }}
        >
          {/* Only shown when the sort came from clicking a column header, which
              no named option describes. Picking one replaces it. */}
          {!current && <option value="">Sorted by column</option>}
          {SORT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>

      {showSource && (
        <label className="pf-field">
          <span className="pf-label">Source</span>
          <select className="pc2-select" value={q.source || ''} onChange={(e) => q.setSource(e.target.value)}>
            <option value="">All sources</option>
            {SOURCE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
      )}

      <label className="pf-field">
        <span className="pf-label">Status</span>
        <select className="pc2-select" value={q.status || ''} onChange={(e) => q.setStatus(e.target.value)}>
          <option value="">All status</option>
          {(q.statuses || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      {/* PRIORITY — the field the capture form now asks for, and the one an
          MD sorts a thirty-row queue by. A filter for it is the difference
          between "which three should I look at first" taking a click or a
          read of every row. */}
      {q.setPriority && (
        <label className="pf-field">
          <span className="pf-label">Priority</span>
          <select className="pc2-select" value={q.priority || ''} onChange={(e) => q.setPriority(e.target.value)}>
            <option value="">All priority</option>
            {PRIORITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      )}

      {/* WHEN IT CAME IN. One select for the nine-in-ten cases, two date
          boxes only once somebody asks for a range no preset covers. */}
      {q.setDates && (
        <>
          <label className="pf-field">
            <span className="pf-label">Date</span>
            <select
              className="pc2-select"
              value={q.dates?.preset || 'all'}
              onChange={(e) => {
                const preset = e.target.value;
                if (preset === 'custom') {
                  q.setDates({ preset, from: q.dates?.from, to: q.dates?.to });
                  return;
                }
                q.setDates({ preset, ...resolveDates(preset) });
              }}
            >
              {DATE_PRESETS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>

          {q.dates?.preset === 'custom' && (
            <span className="pf-dates">
              <input
                type="date"
                className="pc2-select pf-date"
                aria-label="From date"
                value={q.dates?.from || ''}
                max={q.dates?.to || undefined}
                onChange={(e) => q.setDates({ ...q.dates, preset: 'custom', from: e.target.value || undefined })}
              />
              <span className="pf-dates-to">to</span>
              <input
                type="date"
                className="pc2-select pf-date"
                aria-label="To date"
                value={q.dates?.to || ''}
                min={q.dates?.from || undefined}
                onChange={(e) => q.setDates({ ...q.dates, preset: 'custom', to: e.target.value || undefined })}
              />
            </span>
          )}
        </>
      )}

      {/* Only once something is set: a permanently visible Clear on an
          unfiltered table is a button that does nothing.

          JUST "Clear". It used to carry the number of filters in force —
          "Clear 1" — which reads as a quantity the button will clear rather
          than a count of what is set, and at a glance looks like a stray
          digit beside a word. What is filtered is already visible in the
          controls themselves; the button only has to say what it does. */}
      {q.active > 0 && (
        <button
          type="button"
          className="pc2-btn pf-clear"
          onClick={() => q.clear?.()}
          title="Clear the search, city, source and status, and go back to newest first"
        >
          <RotateCcw size={12} /> Clear
        </button>
      )}
    </span>
  );
}

export default PropertyFilters;
