import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ChevronRight, ArrowLeft, Plus, X, MapPinned,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import {
  STATUS_META, FRANCHISE_STATUSES, STAGES,
  selectMapFilters, selectSelectedCity,
  searchSet, statusFiltersSet, regionFilterSet, stageFilterSet, projectFilterSet, propertyStatusFilterSet,
  locationSelected, flyRequested, addLeadOpened,
  selectScopedCountry, scopeWorldSet, scopeCountrySet,
} from '../../app/slices/mapSlice.js';
import { REGIONS } from './cityCoords.js';
import { useProjects } from '../../app/api/projectsApi.js';
import { COUNTRY_OPTIONS, country } from './countries.js';
import NewProjectModal from '../projects/NewProjectModal.jsx';
import { SITE_VIEW } from './mapStyles.js';
import { MapNotifications } from './MapNotifications.jsx';

/** How long the search input sits still before the store hears about it. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The bar across the top of the map.
 *
 * Everything here is a thing you do TO the map — where am I, find me a place,
 * narrow what I can see, add something, what happened. It sits over the canvas
 * rather than above it in the page so the map keeps the full height of the
 * viewport; on a laptop, a header that pushes the map down costs about a fifth
 * of the country.
 *
 * The layer and basemap controls deliberately stay in the side panel. They
 * change how the map is DRAWN rather than what it shows, they are set once and
 * left alone, and putting them up here would bury the filters people actually
 * use between two dropdowns they touch twice a month.
 *
 * Status is a multi-select because "open and delayed, not leads" is a real
 * question. Region and stage are single-select because an arbitrary subset of
 * a geography or a funnel is not.
 */
export function MapHeader({ level, locations, onBack }) {
  const dispatch = useAppDispatch();
  const filters = useAppSelector(selectMapFilters);
  const selectedCity = useAppSelector(selectSelectedCity);
  const scopedCountry = useAppSelector(selectScopedCountry);

  // Every project, for the Project filter — from the projects themselves,
  // NOT from what survived onto the map: a project whose city could not be
  // placed still has captured properties worth filtering to (MR-NEW-001
  // was invisible here for exactly that reason). Same query the map data
  // hook runs, so RTK serves it from cache.
  const { data: projResp } = useProjects({ limit: 200 });
  const projectOptions = useMemo(() => {
    const rows = projResp?.data?.items || projResp?.data || projResp || [];
    return (Array.isArray(rows) ? rows : [])
      .map((p) => ({ id: String(p._id), name: p.name || p.code, code: p.code || '' }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [projResp]);

  const [term, setTerm] = useState('');
  const [openResults, setOpenResults] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [projQuery, setProjQuery] = useState('');
  const projRef = useRef(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const searchRef = useRef(null);
  const statusRef = useRef(null);

  // Local value stays instant; the store hears about it once typing stops.
  // Dispatching per keystroke re-filters every pin on every letter.
  useEffect(() => {
    const t = setTimeout(() => dispatch(searchSet(term)), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term, dispatch]);

  useEffect(() => {
    const onDown = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setOpenResults(false);
      if (statusRef.current && !statusRef.current.contains(e.target)) setStatusOpen(false);
      if (projRef.current && !projRef.current.contains(e.target)) setProjOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpenResults(false); setStatusOpen(false); setProjOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return [];
    return locations
      .filter((l) => `${l.name} ${l.city}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [term, locations]);

  const goTo = (loc) => {
    dispatch(locationSelected(loc.id));
    dispatch(flyRequested({
      lng: loc.displayCoords.lng, lat: loc.displayCoords.lat, ...SITE_VIEW,
    }));
    setOpenResults(false);
  };

  const allStatuses = filters.statuses.length === FRANCHISE_STATUSES.length;
  const statusLabel = allStatuses
    ? 'All'
    : filters.statuses.length === 0
      ? 'None'
      : filters.statuses.length === 1
        ? STATUS_META[filters.statuses[0]].label
        : `${filters.statuses.length} selected`;

  const toggleStatus = (key) => {
    const next = filters.statuses.includes(key)
      ? filters.statuses.filter((s) => s !== key)
      : [...filters.statuses, key];
    dispatch(statusFiltersSet(next));
  };

  return (
    <>
      <header className="mr-map-header" role="region" aria-label="Map controls">
      {/* ── Breadcrumb ── */}
      <div className="mr-map-header__crumbs">
        {level === 'city' && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onBack}
            aria-label="Back to the India map"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <MapPinned size={16} className="muted" />
        <button
          type="button"
          className="mr-map-crumb"
          onClick={onBack}
          disabled={level === 'india'}
        >
          Franchise map
        </button>
        <ChevronRight size={12} className="muted" />
        <button
          type="button"
          className="mr-map-crumb"
          onClick={onBack}
          disabled={level === 'india'}
        >
          {scopedCountry ? (country(scopedCountry)?.name || scopedCountry) : 'World'}
        </button>
        {level === 'city' && (
          <>
            <ChevronRight size={12} className="muted" />
            <span className="mr-map-crumb mr-map-crumb--current">{selectedCity}</span>
          </>
        )}
      </div>

      {/* ── Search ── */}
      <div className="mr-map-header__search" ref={searchRef}>
        <Search size={14} className="mr-map-header__search-icon" />
        <input
          className="mr-map-header__input"
          value={term}
          placeholder="Search city or franchisee…"
          aria-label="Search city or franchisee"
          autoComplete="off"
          role="combobox"
          aria-expanded={openResults && matches.length > 0}
          onChange={(e) => { setTerm(e.target.value); setOpenResults(true); }}
          onFocus={() => setOpenResults(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length) { e.preventDefault(); goTo(matches[0]); }
          }}
        />
        {term && (
          <button
            type="button"
            className="mr-map-header__clear"
            aria-label="Clear search"
            onClick={() => { setTerm(''); setOpenResults(false); }}
          >
            <X size={13} />
          </button>
        )}
        {openResults && matches.length > 0 && (
          <ul className="mr-map-results" role="listbox">
            {matches.map((loc) => (
              <li key={loc.id} role="option" aria-selected="false">
                <button type="button" onClick={() => goTo(loc)}>
                  <span className="sm" style={{ fontWeight: 600 }}>{loc.name}</span>
                  <span className="tiny muted">{loc.city}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="mr-map-header__filters">
        {/*
          Scope: the whole world, or one country masked out of it.
          ------------------------------------------------------
          One control rather than two. A separate "World / Country" toggle
          beside a country picker would mean two clicks to answer one question,
          and a state where the picker says India while the toggle says World —
          visibly contradicting itself. Selecting a country IS switching scope;
          picking "Whole world" IS leaving it.
        */}
        <select
          className="mr-map-header__select"
          value={scopedCountry || ''}
          aria-label="Map scope"
          onChange={(e) => (e.target.value
            ? dispatch(scopeCountrySet(e.target.value))
            : dispatch(scopeWorldSet()))}
        >
          <option value="">🌍 Whole world</option>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>

        {/* Status is the one multi-select, so it gets a popover rather than a
            <select> — a native multiple-select is unusable at this size. */}
        <div className="mr-map-header__statuswrap" ref={statusRef}>
          <button
            type="button"
            className="mr-map-header__select"
            aria-haspopup="true"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((o) => !o)}
          >
            {`Status: ${statusLabel}`}
          </button>
          {statusOpen && (
            <div className="mr-map-header__statusmenu" role="group" aria-label="Status">
              {FRANCHISE_STATUSES.map((key) => {
                const on = filters.statuses.includes(key);
                return (
                  <label key={key} className="mr-map-header__check">
                    <input type="checkbox" checked={on} onChange={() => toggleStatus(key)} />
                    <span aria-hidden="true" className="mr-map-header__dot" style={{ background: STATUS_META[key].color }} />
                    {STATUS_META[key].label}
                  </label>
                );
              })}
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                onClick={() => dispatch(statusFiltersSet([...FRANCHISE_STATUSES]))}
              >
                Select all
              </button>
            </div>
          )}
        </div>

        <select
          className="mr-map-header__select"
          value={filters.region || ''}
          aria-label="Region"
          onChange={(e) => dispatch(regionFilterSet(e.target.value || null))}
        >
          <option value="">Region: All</option>
          {REGIONS.map((r) => <option key={r} value={r}>{`Region: ${r}`}</option>)}
        </select>

        {/* One project's scouting view: its pin plus every property captured
            for it, at the exact GPS each was filed from. Searchable, because
            the project list grows with every city. */}
        <div className="mr-map-header__status" ref={projRef}>
          <button
            type="button"
            className="mr-map-header__select"
            aria-haspopup="listbox"
            aria-expanded={projOpen}
            onClick={() => { setProjOpen((o) => !o); setProjQuery(''); }}
          >
            {`Project: ${projectOptions.find((p) => p.id === filters.project)?.name || 'All'}`}
          </button>
          {projOpen && (
            <div className="mr-map-header__statusmenu mr-map-projmenu" role="listbox" aria-label="Project">
              <input
                className="mr-map-projmenu__search"
                placeholder="Search projects…"
                value={projQuery}
                autoFocus
                onChange={(e) => setProjQuery(e.target.value)}
              />
              <button
                type="button"
                className={`mr-map-projmenu__opt${!filters.project ? ' is-on' : ''}`}
                onClick={() => { dispatch(projectFilterSet(null)); setProjOpen(false); }}
              >
                All projects
              </button>
              {projectOptions
                .filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(projQuery.trim().toLowerCase()))
                .map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    className={`mr-map-projmenu__opt${filters.project === p.id ? ' is-on' : ''}`}
                    onClick={() => { dispatch(projectFilterSet(p.id)); setProjOpen(false); }}
                  >
                    {p.name}
                    {p.code && <span className="mr-map-projmenu__code">{p.code}</span>}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Which property records show as pins — the Phase 1 capture list,
            or only what Phase 2 shortlisted / the MD approved. */}
        <select
          className="mr-map-header__select"
          value={filters.propertyStatus || ''}
          aria-label="Property stage"
          onChange={(e) => dispatch(propertyStatusFilterSet(e.target.value || null))}
        >
          <option value="">Properties: All captured</option>
          <option value="shortlisted">Properties: Shortlisted</option>
          <option value="approved">Properties: Approved (final)</option>
          <option value="review">Properties: Under review</option>
        </select>

        <select
          className="mr-map-header__select"
          value={filters.stage || ''}
          aria-label="Pipeline stage"
          onChange={(e) => dispatch(stageFilterSet(e.target.value || null))}
        >
          <option value="">Stage: All</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{`Stage: ${s.label}`}</option>)}
        </select>
      </div>

      {/* ── Actions ── */}
      <div className="mr-map-header__actions">
        <MapNotifications />
        {/* The SAME form the Projects page opens, not a second "lead" concept.
            A franchise opening starts life as a project either way, so having
            two different intake forms would put half the pipeline in a shape
            the PMS never sees. */}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setNewProjectOpen(true)}
        >
          <Plus size={13} /> New Project
        </button>
      </div>

    </header>

      {/* Rendered as a SIBLING of the header, never inside it.
          `.mr-map-header` is position:absolute with z-index:6, which makes it a
          stacking context — a modal nested in it is painted at the header's
          level, so the map's own overlays drew straight over the top half of
          the form. Outside the header it stacks against the page as intended. */}
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  );
}

export default MapHeader;
