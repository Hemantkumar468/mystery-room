import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Search, X, MapPin, RotateCcw } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { useGetAllPropertiesQuery } from '../../app/api/recordsApi.js';
import { RECORD_STATUS_META } from '../projects/records/recordUi.js';
import { fromNow, fmtCurrency, fmtNumber } from '../../lib/format.js';

/**
 * Every candidate property, across every launch — the place you come to when
 * the question is "what do we have in Pune under ₹2L?" rather than "how is the
 * Pune launch going".
 *
 * Properties only ever existed inside one project's Phase 1 page, so answering
 * that meant opening projects one at a time and holding the answer in your head.
 *
 * Read-only by design. Shortlist and reject stay on the project's own phase
 * page, where the reviewer has the stage context and the gate that depends on
 * the decision. A cross-project list is for finding, not deciding.
 */

/* ─── filters ─────────────────────────────────────────────────────────
 * Every option below is derived from the records actually loaded, never
 * hardcoded. A dropdown that offers "Basement" when no basement property
 * exists sends the reader to an empty result and makes them distrust the
 * filter. Each option also carries its own count for the same reason.
 */

const ALL = '__all__';

/** One filter dropdown. Renders nothing when there is only one option to pick. */
function FilterSelect({ label, value, onChange, options }) {
  if (options.length <= 1) return null;
  return (
    <label className="prop-filter">
      <span className="prop-filter-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * City, locality and floor are free text typed by whoever captured the
 * property, so `"Lucknow "` and `"Lucknow"` arrive as different strings and
 * split one city into two dropdown entries with one result each. Grouping is
 * done on a trimmed, case-folded key while the first-seen spelling is kept for
 * display, so the list reads naturally and the counts are right.
 */
const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Distinct values of `pick` across records, each with a count, sorted by size. */
function optionsFor(records, pick, labelOf = (v) => v) {
  const groups = new Map();
  for (const r of records) {
    const raw = pick(r);
    const key = norm(raw);
    if (!key) continue;
    const hit = groups.get(key);
    if (hit) hit.count += 1;
    else groups.set(key, { value: key, display: String(raw).trim(), count: 1 });
  }
  return [...groups.values()]
    .map((g) => ({ value: g.value, label: labelOf(g.display), count: g.count }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
}

const SORTS = [
  { key: 'updated', label: 'Recently updated' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'rent_asc', label: 'Rent — low to high' },
  { key: 'rent_desc', label: 'Rent — high to low' },
  { key: 'area_desc', label: 'Area — largest first' },
];

/** Rent is on one of two fields depending on whether the deal is rent or lease. */
const rentOf = (r) => Number(r.values?.monthly_rent ?? r.values?.lease_amount ?? 0) || 0;
const areaOf = (r) => Number(r.values?.carpet_area ?? 0) || 0;
const projectIdOf = (r) => String(r.project?._id || r.project?.id || r.project || '');

const EMPTY = { project: ALL, city: ALL, status: ALL, floor: ALL, type: ALL };

export function PropertiesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useGetAllPropertiesQuery();

  const [f, setF] = useState(EMPTY);
  const [sort, setSort] = useState('updated');
  const [search, setSearch] = useState('');

  const records = useMemo(() => data || [], [data]);
  const set = (key) => (value) => setF((prev) => ({ ...prev, [key]: value }));

  /**
   * Options are computed from the records that pass every OTHER filter, so
   * narrowing by Pune leaves City showing only what is reachable from there.
   * A cross-filtered dropdown never offers a combination that returns nothing.
   */
  // Both sides go through `norm` — the option values are normalised keys, so
  // comparing a raw record value against them would never match.
  const matches = (r, skip) =>
    (skip === 'project' || f.project === ALL || norm(projectIdOf(r)) === f.project)
    && (skip === 'city' || f.city === ALL || norm(r.values?.city) === f.city)
    && (skip === 'status' || f.status === ALL || norm(r.status) === f.status)
    && (skip === 'floor' || f.floor === ALL || norm(r.values?.floor) === f.floor)
    && (skip === 'type' || f.type === ALL || norm(r.values?.commercial_type) === f.type);

  const forFilter = (key) => records.filter((r) => matches(r, key));

  const projectOptions = optionsFor(
    forFilter('project'),
    projectIdOf,
    (id) => {
      const r = records.find((x) => norm(projectIdOf(x)) === norm(id));
      return r?.project?.name || r?.project?.code || 'Unknown launch';
    },
  );
  const cityOptions = optionsFor(forFilter('city'), (r) => r.values?.city);
  const statusOptions = optionsFor(
    forFilter('status'),
    (r) => r.status,
    (s) => RECORD_STATUS_META[s]?.label || s,
  );
  const floorOptions = optionsFor(forFilter('floor'), (r) => r.values?.floor);
  const typeOptions = optionsFor(forFilter('type'), (r) => r.values?.commercial_type);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = records.filter((r) => {
      if (!matches(r)) return false;
      if (!q) return true;
      return [
        r.title, r.values?.property_name, r.values?.city, r.values?.locality,
        r.values?.owner_name, r.values?.broker_name,
        r.project?.name, r.project?.code,
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    const by = {
      updated: (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
      name: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
      // Unpriced properties sort last either way — a missing rent is not "₹0",
      // and floating it to the top of a cheapest-first list would be a lie.
      rent_asc: (a, b) => (rentOf(a) || Infinity) - (rentOf(b) || Infinity),
      rent_desc: (a, b) => rentOf(b) - rentOf(a),
      area_desc: (a, b) => areaOf(b) - areaOf(a),
    };
    return [...rows].sort(by[sort] || by.updated);
  }, [records, f, search, sort]);

  const activeCount = Object.values(f).filter((v) => v !== ALL).length + (search.trim() ? 1 : 0);
  const clearAll = () => { setF(EMPTY); setSearch(''); };

  const cities = new Set(visible.map((r) => norm(r.values?.city)).filter(Boolean)).size;
  const priced = visible.map(rentOf).filter((n) => n > 0);

  const openRecord = (r) => {
    const pid = projectIdOf(r);
    if (pid) navigate(`/projects/${pid}/property-identification/${r._id}`);
  };

  return (
    <>
      <Topbar title="Properties" />

      <div className="content">
        <div className="content-wide col gap-3 fade-in">
          {/* Search leads: this page exists to be searched, so the box is the
              widest thing on it rather than tucked beside the filters. */}
          <div className="prop-searchbar">
            <Search size={17} className="subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by property, locality, city, owner, broker or launch…"
              aria-label="Search properties"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="prop-filterbar">
            <FilterSelect label="Launch" value={f.project} onChange={set('project')} options={projectOptions} />
            <FilterSelect label="City" value={f.city} onChange={set('city')} options={cityOptions} />
            <FilterSelect label="Status" value={f.status} onChange={set('status')} options={statusOptions} />
            <FilterSelect label="Floor" value={f.floor} onChange={set('floor')} options={floorOptions} />
            <FilterSelect label="Deal" value={f.type} onChange={set('type')} options={typeOptions} />

            <label className="prop-filter" style={{ marginLeft: 'auto' }}>
              <span className="prop-filter-label">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>

            {activeCount > 0 && (
              <button type="button" className="btn btn-subtle btn-sm" onClick={clearAll}>
                <RotateCcw size={13} /> Clear {activeCount}
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="card"><SkTable rows={8} /></div>
          ) : isError ? (
            <div className="card">
              <EmptyState
                icon={Building2}
                title="Couldn’t load properties"
                hint="The records service didn’t respond."
                action={<button className="btn btn-primary" onClick={() => refetch()}>Retry</button>}
              />
            </div>
          ) : !visible.length ? (
            <div className="card">
              <EmptyState
                icon={Building2}
                title={records.length ? 'Nothing matches these filters' : 'No properties captured yet'}
                hint={
                  records.length
                    ? 'Try widening the filters or clearing the search.'
                    : 'Properties are captured inside a launch, in Phase 1 — Property Identification.'
                }
                action={
                  records.length ? (
                    <button className="btn btn-subtle" onClick={clearAll}>Clear filters</button>
                  ) : (
                    <button className="btn btn-primary" onClick={() => navigate('/projects')}>
                      Go to launches
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <div className="card">
              {/* A one-line read of the current result set — how many, where,
                  and what they cost. Answers the question a search page is
                  asked before any individual row does. */}
              <div className="prop-summary">
                <b>{visible.length}</b>
                {visible.length === records.length ? ' properties' : ` of ${records.length} properties`}
                {cities > 0 && <> · {cities} {cities === 1 ? 'city' : 'cities'}</>}
                {priced.length > 1 && (
                  <> · {fmtCurrency(Math.min(...priced))} – {fmtCurrency(Math.max(...priced))}</>
                )}
              </div>

              <div className="pi-table-wrap">
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th>Location</th>
                      <th style={{ width: 110 }}>Area</th>
                      <th style={{ width: 130 }}>Cost</th>
                      <th style={{ width: 120 }}>Status</th>
                      <th style={{ width: 190 }}>Launch</th>
                      <th style={{ width: 110 }}>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => {
                      const meta = RECORD_STATUS_META[r.status] || { label: r.status, color: '#7c7784' };
                      const rent = rentOf(r);
                      const area = areaOf(r);
                      const isLease = r.values?.commercial_type === 'Lease';
                      return (
                        <tr key={r._id} onClick={() => openRecord(r)} style={{ height: 54 }}>
                          <td>
                            <div className="col" style={{ gap: 1, minWidth: 0 }}>
                              <span style={{ fontWeight: 650 }}>
                                {r.title || r.values?.property_name || 'Untitled property'}
                              </span>
                              {r.values?.floor && (
                                <span className="tiny muted">{r.values.floor} floor</span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className="prop-loc">
                              <MapPin size={12} className="subtle" />
                              {[r.values?.locality, r.values?.city].filter(Boolean).join(', ') || '—'}
                            </span>
                          </td>
                          <td className="tabular">
                            {area ? <>{fmtNumber(area)} <span className="tiny muted">sq.ft</span></> : '—'}
                          </td>
                          <td className="tabular">
                            {rent ? (
                              <div className="col" style={{ gap: 0, lineHeight: 1.25 }}>
                                <span style={{ fontWeight: 600 }}>{fmtCurrency(rent)}</span>
                                <span className="tiny muted">{isLease ? 'lease' : 'per month'}</span>
                              </div>
                            ) : '—'}
                          </td>
                          <td><Badge color={meta.color}>{meta.label}</Badge></td>
                          <td className="sm muted">
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                              {r.project?.name || r.project?.code || '—'}
                            </span>
                          </td>
                          <td className="tiny muted">{fromNow(r.updatedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default PropertiesPage;
