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
  { key: 'demand', label: 'New Store' },
  { key: 'captured', label: 'Capture Property' },
];

/** The id of whichever option matches the sort currently in force. */
const idOf = (sort) => SORT_OPTIONS.find((o) => o.key === sort?.key && o.dir === sort?.dir)?.id || '';

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
          <option value="">Any status</option>
          {(q.statuses || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>

      {/* Only once something is set, and it says what it will do and how much
          is currently filtered out. A permanently visible Clear on an unfiltered
          table is a button that does nothing. */}
      {q.active > 0 && (
        <button
          type="button"
          className="pc2-btn pf-clear"
          onClick={() => q.clear?.()}
          title="Clear the search, city, source and status, and go back to newest first"
        >
          <RotateCcw size={12} /> Clear {q.active}
        </button>
      )}
    </span>
  );
}

export default PropertyFilters;
