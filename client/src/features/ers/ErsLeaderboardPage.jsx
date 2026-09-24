import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Trophy, Search, X as XIcon, TriangleAlert, RefreshCw, LayoutDashboard,
  Users, MessageSquare, Star, CircleCheck,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { Pager, SortHead, FilterSelect } from '../master/inventoryUi.jsx';
import { useErsLeaderboard, useRefreshErs, ERS_PERIODS, ERS_STATUS } from '../../app/api/ersApi.js';
import {
  Avatar, StatusPill, Stars, RankCell, InfoTip, CpsExplainer, n, score,
  ratingTone, positiveTone, cpsTone,
} from './ersUi.jsx';
import EmployeeDrawer from './EmployeeDrawer.jsx';

/**
 * ERS → Leaderboard. Every ranked employee, on their own page.
 *
 * Route: /ers/leaderboard
 *
 * The overview shows the top ten; this is all 148, with the filters and the
 * sort to interrogate them. Searched, filtered, sorted and paged on OUR server
 * (see ers.service.js) — the upstream API offers none of those, so doing it
 * server-side keeps the same contract every other table in this app has rather
 * than making this screen a special case.
 *
 * THE COUNTS DESCRIBE WHAT IS FILTERED, not the whole company. Filter to one
 * city and the strip above the table answers "how are THOSE people doing",
 * which is the only reading that makes sense once a filter is on.
 *
 * ARRIVES PRE-FILTERED FROM THE DASHBOARD. The status tiles there link here
 * with `?status=Perfect`, and the outlet cards with `?outletId=…`, so a
 * question asked on the overview is answered here without retyping it.
 */

/**
 * `width` is a MINIMUM, not a size — the table is `width: 100%`, so on a wide
 * screen every column grows past these. They only bite when space is short, so
 * they are tuned to the tightest real case: nine columns inside the ~1,068px a
 * 14" laptop has with the sidebar open. At the first set of widths they came to
 * 1,138px and the Status pill was cut off at the right edge — the one column
 * that has to be readable at a glance.
 */
const COLUMNS = [
  { key: 'rank', label: '#', sort: 'rank', width: 48 },
  { key: 'name', label: 'Employee', sort: 'name', width: 196, grow: '22%' },
  { key: 'position', label: 'Position', width: 130 },
  { key: 'outlet', label: 'Outlet', sort: 'outlet', width: 122 },
  {
    key: 'avgRating',
    label: 'Rating',
    sort: 'avg_rating',
    width: 94,
    tip: 'The raw average of every customer rating this person received. Green at 4.8 and above, amber from 4.0, red below — the same bands the Status column uses.',
  },
  { key: 'totalReviews', label: 'Reviews', sort: 'total_reviews', width: 82, align: 'right' },
  {
    key: 'positivePct',
    label: 'Positive',
    sort: 'positive_pct',
    width: 84,
    align: 'right',
    tip: 'Share of their ratings that were positive. Green at 99% and above, amber from 90%.',
  },
  {
    key: 'cps',
    label: 'CPS',
    sort: 'cps',
    width: 84,
    align: 'right',
    tip: 'CPS',
  },
  { key: 'status', label: 'Status', width: 112 },
];

export default function ErsLeaderboardPage() {
  const [params, setParams] = useSearchParams();

  const [period, setPeriod] = useState('month');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [brandId, setBrandId] = useState('');
  const [cityId, setCityId] = useState('');
  const [outletId, setOutletId] = useState(params.get('outletId') || '');
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /* Any change to WHAT is being asked for returns to page 1 — a page number is
     a position in a result set, and kept across a filter change it points into
     a different one. */
  useEffect(() => { setPage(1); }, [debounced, status, brandId, cityId, outletId, period, limit, sort]);

  const query = useMemo(() => ({
    period,
    ...(debounced ? { search: debounced } : {}),
    ...(status ? { status } : {}),
    ...(brandId ? { brandId } : {}),
    ...(cityId ? { cityId } : {}),
    ...(outletId ? { outletId } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    limit,
  }), [period, debounced, status, brandId, cityId, outletId, sort, page, limit]);

  const { data: raw, isLoading, isError, isFetching } = useErsLeaderboard(query);
  const refresh = useRefreshErs();

  const d = raw?.rows ? raw : (raw?.data ?? {});
  const rows = d.rows || [];
  const c = d.counts || {};
  const opts = d.filterOptions || {};

  const brands = (opts.brands || []).filter((b) => typeof b === 'object' && b.id);
  const cities = (opts.cities || []).filter((x) => typeof x === 'object' && x.id);
  const outlets = (opts.outlets || []).filter((o) => typeof o === 'object' && o.id);

  /* CPS is shaded against the top of the board rather than an absolute scale —
     see `cpsTone`. The server sends the WHOLE board's maximum, because taking
     it from the rows on screen would repaint page three entirely green. */
  const bestCps = d.topCps || 1;

  const activeFilters = [debounced, status, brandId, cityId, outletId].filter(Boolean).length;

  const clearFilters = useCallback(() => {
    setSearch(''); setStatus(''); setBrandId(''); setCityId(''); setOutletId('');
    setParams({}, { replace: true });
  }, [setParams]);

  const toggleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: key === 'name' || key === 'outlet' ? 'asc' : 'desc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      /* Third click goes back to the ranking itself, which is this page's
         natural order — "put it back how it was". */
      return { key: 'rank', dir: 'asc' };
    });
  }, []);

  const outletName = outlets.find((o) => String(o.id) === String(outletId))?.name || params.get('outlet');

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon ers-head-icon"><Trophy size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Leaderboard</h1>
            <p className="inv-head-sub">
              Every employee ranked by <b>CPS</b> — a composite of rating quality, review volume
              and consistency. Click any row for the full breakdown and their standing at outlet,
              city, state and national level.
            </p>
          </div>
        </div>

        <div className="inv-head-actions">
          <button
            type="button" className="btn btn-ghost btn-sm"
            disabled={refresh.isPending || isFetching}
            onClick={() => refresh.mutate({})}
          >
            <RefreshCw size={15} /> {refresh.isPending || isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/ers/overview" className="btn btn-ghost btn-sm">
            <LayoutDashboard size={15} /> Dashboard
          </Link>
        </div>
      </div>

      {/* Four counts, all over the FILTERED set. */}
      <div className="ers-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="ers-kpi" style={{ '--k': '#3b5bdb' }}>
          <span className="ers-kpi-top"><span className="ers-kpi-icon"><Users size={16} /></span></span>
          <span className="ers-kpi-label">Employees</span>
          <span className="ers-kpi-value">{n(c.shown)}</span>
          <span className="ers-kpi-sub">{activeFilters ? 'matching your filters' : 'ranked in total'}</span>
        </div>
        <div className="ers-kpi" style={{ '--k': '#6741d9' }}>
          <span className="ers-kpi-top"><span className="ers-kpi-icon"><MessageSquare size={16} /></span></span>
          <span className="ers-kpi-label">Reviews</span>
          <span className="ers-kpi-value">{n(c.reviews)}</span>
          <span className="ers-kpi-sub">behind these scores</span>
        </div>
        <div className="ers-kpi" style={{ '--k': '#b7791f' }}>
          <span className="ers-kpi-top"><span className="ers-kpi-icon"><Star size={16} /></span></span>
          <span className="ers-kpi-label">Average rating</span>
          <span className="ers-kpi-value">{Number(c.avgRating || 0).toFixed(2)}</span>
          <span className="ers-kpi-sub">across this selection</span>
        </div>
        <button
          type="button"
          className={`ers-kpi${status === 'Perfect' ? ' is-on' : ''}`}
          style={{ '--k': '#1f7a4d' }}
          onClick={() => setStatus(status === 'Perfect' ? '' : 'Perfect')}
          title="Show only the Perfect band"
        >
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><CircleCheck size={16} /></span>
            <span className="ers-kpi-chip">{c.shown ? Math.round((c.perfect / c.shown) * 100) : 0}%</span>
          </span>
          <span className="ers-kpi-label">Perfect</span>
          <span className="ers-kpi-value">{n(c.perfect)}</span>
          <span className="ers-kpi-sub">{n(c.good)} good · {n(c.needsImprovement)} below</span>
        </button>
      </div>

      {/* ── filters, one line ──────────────────────────────────────── */}
      <div className="inv-filters">
        <div className="inv-filters-row">
          <label className="inv-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search a name, code, position or outlet…"
            />
            {search && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => setSearch('')} aria-label="Clear search">
                <XIcon size={13} />
              </button>
            )}
          </label>

          <FilterSelect label="Period" value={period} onChange={setPeriod} width={124}>
            {ERS_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </FilterSelect>

          <FilterSelect label="Status" value={status} onChange={setStatus} width={150}>
            <option value="">Any status</option>
            {Object.keys(ERS_STATUS).map((s) => <option key={s} value={s}>{s}</option>)}
          </FilterSelect>

          <FilterSelect label="Outlet" value={outletId} onChange={setOutletId} width={150}>
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </FilterSelect>

          <FilterSelect label="City" value={cityId} onChange={setCityId} width={130}>
            <option value="">All cities</option>
            {cities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </FilterSelect>

          {brands.length > 0 && (
            <FilterSelect label="Brand" value={brandId} onChange={setBrandId} width={140}>
              <option value="">All brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FilterSelect>
          )}

          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={!activeFilters}>
            <RefreshCw size={14} /> Reset
          </button>
        </div>
      </div>

      {(outletName || status) && (
        <div className="inv-selbar">
          Showing <b>{status || 'everyone'}</b>{outletName ? <> at <b>{outletName}</b></> : null}
          <span className="inv-filter-spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            <XIcon size={13} /> Clear
          </button>
        </div>
      )}

      <div className="inv-toolbar">
        <span className="tiny muted">
          {isFetching ? 'Loading…' : 'Click a row to see how that score was reached.'}
        </span>
        <div className="inv-range">
          <select className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} per page</option>)}
          </select>
        </div>
      </div>

      <section className="inv-card">
        {isLoading ? <div style={{ padding: 14 }}><SkTable rows={10} /></div> : isError ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={TriangleAlert}
              title="Could not reach the review service"
              hint="The employee review service did not respond. Try Refresh in a moment."
            />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={Trophy}
              title={activeFilters ? 'Nobody matches those filters' : 'No ranked employees'}
              hint={activeFilters ? 'Widen the search, or hit Reset above.' : 'The review service returned an empty ranking.'}
            />
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table ers-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  {COLUMNS.map((col, i) => (
                    <th key={col.key} style={{ minWidth: col.width, width: col.grow, textAlign: col.align || 'left' }}>
                      <span className="ers-th" style={col.align === 'right' ? { justifyContent: 'flex-end' } : undefined}>
                        <SortHead label={col.label} sortKey={col.sort} sort={sort} onSort={toggleSort} />
                        {col.tip && (
                          /* The last two columns open their panel to the LEFT,
                             or it would run off the edge of the table. */
                          <InfoTip align={i >= COLUMNS.length - 3 ? 'right' : 'left'}>
                            {col.tip === 'CPS' ? <CpsExplainer formula={d.formula} /> : col.tip}
                          </InfoTip>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    className={`${e.rank && e.rank <= 3 ? 'is-podium' : ''}${!e.totalReviews ? ' is-unranked' : ''}`}
                    onClick={() => setViewing(e.id)}
                    style={{ cursor: 'pointer' }}
                    title={`Open ${e.name}`}
                  >
                    <td><RankCell rank={e.rank} /></td>
                    <td style={{ maxWidth: 0 }}>
                      <span className="ers-emp">
                        <Avatar name={e.name} photo={e.photo} size={32} rank={e.rank} />
                        <span style={{ minWidth: 0 }}>
                          <span className="ers-emp-name">{e.name}</span>
                          <span className="ers-emp-code">{e.code || '—'}</span>
                        </span>
                      </span>
                    </td>
                    <td style={{ maxWidth: 170 }}>
                      <span className="inv-ellipsis" title={e.position}>{e.position || '—'}</span>
                    </td>
                    <td style={{ maxWidth: 150 }}>
                      <span className="inv-ellipsis" title={`${e.outlet} · ${e.city}`}>{e.outlet || '—'}</span>
                      <span className="tiny muted">{e.city}</span>
                    </td>
                    <td><Stars value={e.avgRating} reviews={e.totalReviews} tone={ratingTone(e.avgRating, e.totalReviews)} /></td>
                    <td style={{ textAlign: 'right' }}>{n(e.totalReviews)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {e.totalReviews
                        ? <b className={`ers-num--${positiveTone(e.positivePct, e.totalReviews)}`}>{Math.round(e.positivePct)}%</b>
                        : <span className="inv-muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={`ers-cps-chip ers-num--${cpsTone(e.cps, bestCps)}`}>{score(e.cps)}</span>
                    </td>
                    <td><StatusPill status={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <Pager
            page={d.page || 1}
            totalPages={d.totalPages || 1}
            total={d.total || 0}
            limit={limit}
            onPage={setPage}
            noun="employees"
          />
        )}
      </section>

      <EmployeeDrawer employeeId={viewing} period={period} onClose={() => setViewing(null)} />
    </div>
  );
}
