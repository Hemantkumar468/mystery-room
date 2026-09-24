import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Trophy, Users, MessageSquare, Star, CircleCheck, ThumbsUp, TriangleAlert,
  RefreshCw, ArrowRight, Clock, Store, Info,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { FilterSelect } from '../master/inventoryUi.jsx';
import {
  useErsOverview, useRefreshErs, ERS_PERIODS,
} from '../../app/api/ersApi.js';
import { Avatar, StatusPill, Stars, RankCell, n, score } from './ersUi.jsx';
import EmployeeDrawer from './EmployeeDrawer.jsx';

/**
 * ERS → Performance overview.
 *
 * Route: /ers/overview
 *
 * Customer ratings from the review service, rolled into scores and ranks. The
 * whole page is ONE upstream call — the counts, the podium, the top ten and
 * the outlet roll-up are all views of the same response, which is why nothing
 * here can show two figures that disagree.
 *
 * READ-ONLY. There is no control on this page that changes anything anywhere:
 * the ratings belong to the review service and this is a window onto them. The
 * only button that writes is Refresh, and all it does is drop our own 60-second
 * cache of their response.
 *
 * WHY THE KPI TILES CARRY A SHARE AND NOT A TREND. The obvious chip top-right
 * is "+12% vs last month", and we cannot honestly draw it: the API returns a
 * snapshot with no history to compare against. So each chip states what its
 * number is a share OF, which is true and is actually the more useful reading.
 */

const PODIUM_TONE = ['#c88a3d', '#8b94a3', '#b4763f'];

export default function ErsOverviewPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState('month');
  const [brandId, setBrandId] = useState('');
  const [cityId, setCityId] = useState('');
  const [viewing, setViewing] = useState(null);

  const params = {
    period,
    ...(brandId ? { brandId } : {}),
    ...(cityId ? { cityId } : {}),
  };
  const { data: raw, isLoading, isError, isFetching } = useErsOverview(params);
  const refresh = useRefreshErs();

  const d = raw?.counts ? raw : (raw?.data ?? {});
  const c = d.counts || {};
  const podium = d.podium || [];
  const top = d.top || [];
  const outlets = d.outlets || [];
  const opts = d.filterOptions || {};

  const pct = (part) => (c.employees ? Math.round((part / c.employees) * 100) : 0);
  const updated = d.lastUpdated
    ? new Date(d.lastUpdated).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  /* The location filters come from upstream as either ids or bare names
     depending on the list; only the id-bearing ones can be sent back. */
  const brands = (opts.brands || []).filter((b) => typeof b === 'object' && b.id);
  const cities = (opts.cities || []).filter((x) => typeof x === 'object' && x.id);

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon ers-head-icon"><Trophy size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Employee Performance</h1>
            <p className="inv-head-sub">
              Customer ratings from the review service, rolled into scores and ranks.
              {' '}<b>{n(c.employees)}</b> employees ranked across <b>{n(c.outlets)}</b> outlets
              {' '}on <b>{n(c.reviews)}</b> reviews. This is a read-only view — ratings are
              recorded in the review service, never here.
            </p>
          </div>
        </div>

        <div className="inv-head-actions">
          {updated && (
            <span className="ers-asof" title="When the review service last recalculated these figures">
              <Clock size={12} /> {updated}
            </span>
          )}
          <button
            type="button" className="btn btn-ghost btn-sm"
            disabled={refresh.isPending || isFetching}
            onClick={() => refresh.mutate({})}
            title="Fetch fresh figures from the review service"
          >
            <RefreshCw size={15} /> {refresh.isPending || isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/ers/leaderboard" className="btn btn-primary btn-sm">
            <Trophy size={15} /> Full leaderboard
          </Link>
        </div>
      </div>

      {/* ── the six counts ─────────────────────────────────────────── */}
      <div className="ers-kpis">
        <div className="ers-kpi" style={{ '--k': '#3b5bdb' }}>
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><Users size={16} /></span>
          </span>
          <span className="ers-kpi-label">Employees ranked</span>
          <span className="ers-kpi-value">{n(c.employees)}</span>
          <span className="ers-kpi-sub">across {n(c.outlets)} outlets</span>
        </div>

        <div className="ers-kpi" style={{ '--k': '#6741d9' }}>
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><MessageSquare size={16} /></span>
          </span>
          <span className="ers-kpi-label">Total reviews</span>
          <span className="ers-kpi-value">{n(c.reviews)}</span>
          <span className="ers-kpi-sub">{ERS_PERIODS.find((p) => p.value === period)?.label.toLowerCase()}</span>
        </div>

        <div className="ers-kpi" style={{ '--k': '#b7791f' }}>
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><Star size={16} /></span>
            <span className="ers-kpi-chip">{c.avgRating >= c.globalAvg ? '↑' : '↓'} {Math.abs(c.avgRating - c.globalAvg).toFixed(2)}</span>
          </span>
          <span className="ers-kpi-label">Average rating</span>
          <span className="ers-kpi-value">{Number(c.avgRating || 0).toFixed(2)}</span>
          <span className="ers-kpi-sub">global avg {Number(c.globalAvg || 0).toFixed(2)}</span>
        </div>

        {/* The three bands are filters, not just figures — clicking one opens
            the full leaderboard already narrowed to those people. */}
        <button
          type="button" className="ers-kpi" style={{ '--k': '#1f7a4d' }}
          onClick={() => navigate('/ers/leaderboard?status=Perfect')}
          title="See these employees on the leaderboard"
        >
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><CircleCheck size={16} /></span>
            <span className="ers-kpi-chip">{pct(c.perfect)}%</span>
          </span>
          <span className="ers-kpi-label">Perfect</span>
          <span className="ers-kpi-value">{n(c.perfect)}</span>
          <span className="ers-kpi-sub">4.8★ and above</span>
        </button>

        <button
          type="button" className="ers-kpi" style={{ '--k': '#0b7285' }}
          onClick={() => navigate('/ers/leaderboard?status=Good')}
          title="See these employees on the leaderboard"
        >
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><ThumbsUp size={16} /></span>
            <span className="ers-kpi-chip">{pct(c.good)}%</span>
          </span>
          <span className="ers-kpi-label">Good</span>
          <span className="ers-kpi-value">{n(c.good)}</span>
          <span className="ers-kpi-sub">4.0 – 4.79★</span>
        </button>

        <button
          type="button" className="ers-kpi" style={{ '--k': '#c0392b' }}
          onClick={() => navigate('/ers/leaderboard?status=Needs Improvement')}
          title="See these employees on the leaderboard"
        >
          <span className="ers-kpi-top">
            <span className="ers-kpi-icon"><TriangleAlert size={16} /></span>
            <span className="ers-kpi-chip">{pct(c.needsImprovement)}%</span>
          </span>
          <span className="ers-kpi-label">Needs improvement</span>
          <span className="ers-kpi-value">{n(c.needsImprovement)}</span>
          <span className="ers-kpi-sub">below 4.0★</span>
        </button>
      </div>

      {/* Said out loud: a board of 148 in a company of 157 otherwise reads as
          missing data rather than as people with nothing to rank yet. */}
      {c.noReviews > 0 && (
        <div className="ers-note">
          <Info size={14} style={{ flex: 'none', color: 'var(--warning)' }} />
          <span>
            <b>{n(c.noReviews)} employees</b> have no reviews in this period, so they sit outside the ranking.
          </span>
          <Link
            to="/ers/leaderboard?status=No reviews"
            className="tiny"
            style={{ marginLeft: 'auto', color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            See who <ArrowRight size={11} style={{ verticalAlign: -1 }} />
          </Link>
        </div>
      )}

      {/* ── scope ──────────────────────────────────────────────────── */}
      <div className="inv-filters">
        <div className="inv-filters-row">
          <div className="ers-tabs" role="group" aria-label="Period">
            {ERS_PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`ers-tab${period === p.value ? ' is-on' : ''}`}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <span className="inv-filter-spacer" />

          {brands.length > 0 && (
            <FilterSelect label="Brand" value={brandId} onChange={setBrandId} width={160}>
              <option value="">All brands</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </FilterSelect>
          )}
          {cities.length > 0 && (
            <FilterSelect label="City" value={cityId} onChange={setCityId} width={150}>
              <option value="">All cities</option>
              {cities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </FilterSelect>
          )}
        </div>
      </div>

      {isLoading ? (
        <SkTable rows={6} />
      ) : isError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Could not reach the review service"
          hint="The employee review service did not respond. The figures below are unavailable until it does."
        />
      ) : (
        <>
          {/* ── the top three ──────────────────────────────────────── */}
          {podium.length > 0 && (
            <div className="ers-podium">
              {podium.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  className={`ers-pod${i === 0 ? ' ers-pod--1' : ''}`}
                  onClick={() => setViewing(e.id)}
                  style={{ '--k': PODIUM_TONE[i] }}
                >
                  <Avatar name={e.name} photo={e.photo} size={46} rank={e.rank} />
                  <span className="ers-pod-body">
                    <span className="ers-pod-name">{e.name}</span>
                    <span className="ers-pod-meta">{[e.position, e.outlet].filter(Boolean).join(' · ')}</span>
                    <span className="ers-pod-figs">
                      <span className="ers-pod-cps">
                        {score(e.cps)}
                        <small>CPS</small>
                      </span>
                      <Stars value={e.avgRating} reviews={e.totalReviews} />
                      <span className="tiny muted">{n(e.totalReviews)} reviews</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── top ten ────────────────────────────────────────────── */}
          <section className="inv-card">
            <div className="ims-panel-head">
              <h2 className="ims-panel-title"><Trophy size={16} style={{ color: 'var(--primary)' }} /> Top performers</h2>
              <Link to="/ers/leaderboard" className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                All {n(c.employees)} <ArrowRight size={11} style={{ verticalAlign: -1 }} />
              </Link>
            </div>

            <div className="inv-table-wrap">
              <table className="inv-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 54 }}>#</th>
                    <th style={{ minWidth: 220 }}>Employee</th>
                    <th style={{ minWidth: 150 }}>Outlet</th>
                    <th style={{ minWidth: 110 }}>Rating</th>
                    <th style={{ minWidth: 96, textAlign: 'right' }}>Reviews</th>
                    <th style={{ minWidth: 90, textAlign: 'right' }}>CPS</th>
                    <th style={{ minWidth: 130 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((e) => (
                    <tr key={e.id} onClick={() => setViewing(e.id)} style={{ cursor: 'pointer' }} title={`Open ${e.name}`}>
                      <td><RankCell rank={e.rank} /></td>
                      <td style={{ maxWidth: 220 }}>
                        <span className="ers-emp">
                          <Avatar name={e.name} photo={e.photo} size={32} rank={e.rank} />
                          <span style={{ minWidth: 0 }}>
                            <span className="ers-emp-name">{e.name}</span>
                            <span className="ers-emp-code">{e.code || e.position}</span>
                          </span>
                        </span>
                      </td>
                      <td style={{ maxWidth: 150 }}>
                        <span className="inv-ellipsis" title={e.outlet}>{e.outlet || '—'}</span>
                        <span className="tiny muted">{e.city}</span>
                      </td>
                      <td><Stars value={e.avgRating} reviews={e.totalReviews} /></td>
                      <td style={{ textAlign: 'right' }}>{n(e.totalReviews)}</td>
                      <td style={{ textAlign: 'right' }}><span className="ers-cps">{score(e.cps)}</span></td>
                      <td><StatusPill status={e.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── outlets ────────────────────────────────────────────── */}
          {outlets.length > 0 && (
            <section className="col gap-2">
              <h2 className="ims-panel-title"><Store size={16} /> Outlets by average rating</h2>
              <div className="ers-outlets">
                {outlets.slice(0, 12).map((o) => (
                  <button
                    key={o.outlet}
                    type="button"
                    className="ers-outlet"
                    onClick={() => navigate(`/ers/leaderboard?outletId=${o.outletId ?? ''}&outlet=${encodeURIComponent(o.outlet)}`)}
                    title={`See everyone at ${o.outlet}`}
                  >
                    <span>
                      <span className="ers-outlet-name">{o.outlet}</span>
                      <span className="ers-outlet-city">{[o.city, o.state].filter(Boolean).join(' · ')}</span>
                    </span>

                    <span className="ers-outlet-stats">
                      <span className="ers-outlet-stat"><b>{Number(o.avgRating).toFixed(2)}</b><span>Rating</span></span>
                      <span className="ers-outlet-stat"><b>{n(o.employees)}</b><span>Staff</span></span>
                      <span className="ers-outlet-stat"><b>{n(o.reviews)}</b><span>Reviews</span></span>
                    </span>

                    {o.best && (
                      <span className="ers-outlet-best">
                        <Avatar name={o.best.name} photo={o.best.photo} size={26} />
                        <span style={{ minWidth: 0 }}>
                          <span className="ers-outlet-best-label">Best here</span>
                          <span className="ers-outlet-best-name">{o.best.name}</span>
                        </span>
                        <span className="ers-cps" style={{ marginLeft: 'auto' }}>{score(o.best.cps)}</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <EmployeeDrawer employeeId={viewing} period={period} onClose={() => setViewing(null)} />
    </div>
  );
}
