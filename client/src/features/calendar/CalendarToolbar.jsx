import { useRef, useState } from 'react';
import {
  Search, SlidersHorizontal, Download, X, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useDismiss } from '../../hooks/useDismiss.js';
import { FiltersPanel } from './FiltersPanel.jsx';
import { activeFilterCount } from './calendarUtils.js';

/**
 * The slim strip above the dossier. Everything that used to compete with the
 * calendar for the top of the page — the stepper, the period picker, the
 * view switcher — now lives on the calendar itself or is gone.
 */
export function CalendarToolbar({
  summary,
  query,
  onQuery,
  searchRef,
  filters,
  setFilters,
  facets,
  railOpen,
  onToggleRail,
  onExport,
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterRef = useRef(null);
  useDismiss(filterRef, filtersOpen, () => setFiltersOpen(false));

  const count = activeFilterCount(filters);

  return (
    <div className="cal-toolbar">
      <div className="cal-toolbar-left">
        <button
          className="btn btn-ghost btn-icon cal-rail-toggle"
          onClick={onToggleRail}
          title={railOpen ? 'Hide calendar' : 'Show calendar'}
          aria-label={railOpen ? 'Hide calendar' : 'Show calendar'}
        >
          {railOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
        </button>

        {summary.total > 0 && (
          <div className="cal-summary">
            <span className="cal-summary-pill">{summary.total} today</span>
            {summary.overdue > 0 && <span className="cal-summary-pill danger">{summary.overdue} overdue</span>}
            {summary.milestones > 0 && <span className="cal-summary-pill gold">{summary.milestones} go-live</span>}
          </div>
        )}
      </div>

      <div className="cal-toolbar-right">
        <div className="cal-search">
          <Search size={15} />
          <input
            ref={searchRef}
            className="cal-search-input"
            placeholder="Search events…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query ? (
            <button className="cal-search-clear" onClick={() => onQuery('')} aria-label="Clear search">
              <X size={13} />
            </button>
          ) : (
            <kbd className="cal-kbd">/</kbd>
          )}
        </div>

        <div className="cal-pop-anchor" ref={filterRef}>
          <button
            className={`btn btn-subtle btn-sm cal-filter-btn ${filtersOpen || count ? 'active' : ''}`}
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal size={14} />
            Filters
            {count > 0 && <span className="cal-filter-count">{count}</span>}
          </button>

          {filtersOpen && (
            <div className="cal-popover cal-filter-pop" role="dialog" aria-label="Filter events">
              <FiltersPanel filters={filters} setFilters={setFilters} facets={facets} />
            </div>
          )}
        </div>

        <button className="btn btn-ghost btn-icon" onClick={onExport} title="Export visible events (.ics)">
          <Download size={16} />
        </button>
      </div>
    </div>
  );
}

export default CalendarToolbar;
