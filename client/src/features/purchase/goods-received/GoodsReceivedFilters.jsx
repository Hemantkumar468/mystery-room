import { ChevronDown, Filter } from 'lucide-react';

/**
 * The project, and how much of the sheet you are currently looking at.
 *
 * One control until a project is chosen. The search that used to lead this
 * row narrowed a list that does not exist yet, and the page is reached from a
 * nav item that already names it, so nothing here repeats the page's name.
 *
 * The Filters button is a real disclosure for the status chips below, not
 * decoration: it carries a dot whenever a filter is narrowing the list, so
 * collapsing the row never hides the fact that the count on the right is
 * smaller than the whole.
 */
export function GoodsReceivedFilters({
  centre, onCentre, projects, countAt,
  showing, total, chipsOpen, onToggleChips, filtered,
}) {
  return (
    <div className="gr-filters">
      <span className="gr-select-wrap">
        {/* Nothing chosen is its own state, and it is the one the page opens
            in — so it says so rather than claiming to show everything. */}
        <select
          className={`gr-select${centre ? '' : ' is-ask'}`}
          value={centre}
          onChange={(e) => onCentre(e.target.value)}
          aria-label="Project"
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.city ? ` · ${p.city}` : ''}{countAt ? ` (${countAt(p.id)})` : ''}
            </option>
          ))}
        </select>
        <ChevronDown size={16} />
      </span>

      {/* Only once there is a sheet to count. "4 of 4 receipts" over a page
          showing none describes rows nobody can see. */}
      <span className="gr-count">{showing == null ? '' : `${showing} of ${total} receipts`}</span>

      <button
        type="button"
        className={`gr-filter-btn${filtered ? ' is-on' : ''}`}
        onClick={onToggleChips}
        aria-expanded={chipsOpen}
        aria-controls="gr-chips"
      >
        <Filter size={15} /> Filters
        {filtered && <span className="gr-dot" />}
      </button>
    </div>
  );
}

export default GoodsReceivedFilters;
