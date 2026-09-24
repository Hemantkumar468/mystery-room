import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard, TriangleAlert, PackageX, Boxes, IndianRupee, ShieldCheck, Warehouse,
  ArrowDownLeft, ArrowUpRight, ClipboardCheck, ArrowRight, MapPin,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useImsOverview, useImsLocations } from './imsHooks.js';
import { n, money, Thumb, FilterSelect } from '../master/inventoryUi.jsx';
import { StatusPill, LocationIcon } from './imsUi.jsx';
import StockMoveDrawer from './StockMoveDrawer.jsx';

/**
 * Inventory → Overview — what needs doing, and where.
 *
 * Route: /ims/overview
 *
 * DELIBERATELY NOT A VALUE DASHBOARD. The obvious front page for a stock
 * system is a big total-stock-value figure, and it is the wrong one: it
 * barely moves, nobody can act on it, and a number at the top that never
 * changes teaches people to stop looking at the top. What somebody opens this
 * module for is what is about to run out — so that leads, by name, with the
 * shortfall and a way to act on it in the same row.
 *
 * The value is still here, fourth, because it is the figure finance asks for
 * once a quarter.
 */

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
}) : '—');

const MOVE_ICON = {
  in: ArrowDownLeft, transfer_in: ArrowDownLeft, out: ArrowUpRight, transfer_out: ArrowUpRight, adjust: ClipboardCheck,
};

export default function ImsOverviewPage() {
  const [location, setLocation] = useState('');
  const [drawer, setDrawer] = useState(null);

  const { data: raw, isLoading } = useImsOverview(location ? { location } : {});
  const { data: locationsRaw } = useImsLocations();

  const data = raw?.counts ? raw : (raw?.data ?? {});
  const counts = data.counts || {};
  const lowStock = data.lowStock || [];
  const recent = data.recent || [];
  const locations = locationsRaw?.data ?? locationsRaw ?? [];

  const scope = locations.find((l) => String(l._id) === String(location))?.name;

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon"><LayoutDashboard size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Inventory Management</h1>
            <p className="inv-head-sub">
              Stock across every location — what is running out, what moved today, and where it all
              sits. The catalogue of <b>what</b> we stock is{' '}
              <Link to="/inventory" style={{ color: 'var(--primary)', fontWeight: 600 }}>Master Data → Item Master</Link>;
              this is <b>how many</b>.
            </p>
          </div>
        </div>

        <div className="inv-head-actions">
          <FilterSelect label="Location" value={location} onChange={setLocation} width={200}>
            <option value="">Every location</option>
            {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
          </FilterSelect>
          <button
            type="button" className="btn btn-sm"
            style={{ background: 'var(--success)', color: '#fff', borderColor: 'var(--success)' }}
            onClick={() => setDrawer({ kind: 'in' })}
          >
            <ArrowDownLeft size={15} /> Stock in
          </button>
          <button
            type="button" className="btn btn-sm"
            style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
            onClick={() => setDrawer({ kind: 'out' })}
          >
            <ArrowUpRight size={15} /> Stock out
          </button>
        </div>
      </div>

      <div className="inv-kpis">
        <Link to={`/ims/stock?status=low${location ? `&location=${location}` : ''}`} className="inv-kpi" style={{ '--k': '#f59e0b', textDecoration: 'none' }}>
          <span className="inv-kpi-icon"><TriangleAlert size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Needs ordering</span>
            <span className="inv-kpi-value">{n(counts.needsAction)}</span>
            <span className="inv-kpi-sub">{n(counts.critical)} critical · {n(counts.low)} low</span>
          </span>
        </Link>

        <Link to={`/ims/stock?status=out${location ? `&location=${location}` : ''}`} className="inv-kpi" style={{ '--k': '#ef4444', textDecoration: 'none' }}>
          <span className="inv-kpi-icon"><PackageX size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Out of stock</span>
            <span className="inv-kpi-value">{n(counts.out)}</span>
            <span className="inv-kpi-sub">nothing on the shelf</span>
          </span>
        </Link>

        <div className="inv-kpi" style={{ '--k': '#10b981' }}>
          <span className="inv-kpi-icon"><Boxes size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Units on hand</span>
            <span className="inv-kpi-value">{n(counts.units)}</span>
            <span className="inv-kpi-sub">over <b>{n(counts.skus)}</b> stock rows</span>
          </span>
        </div>

        <div className="inv-kpi" style={{ '--k': '#0ea5e9' }}>
          <span className="inv-kpi-icon"><IndianRupee size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Stock value</span>
            <span className="inv-kpi-value">{money(counts.value, { blank: '₹0' })}</span>
            <span className="inv-kpi-sub"><b>{n(counts.priced)}</b> of {n(counts.skus)} priced</span>
          </span>
        </div>

        <Link to={`/ims/stock?status=unset${location ? `&location=${location}` : ''}`} className="inv-kpi" style={{ '--k': '#8b5cf6', textDecoration: 'none' }}>
          <span className="inv-kpi-icon"><ShieldCheck size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">No safety level</span>
            <span className="inv-kpi-value">{n(counts.unset)}</span>
            <span className="inv-kpi-sub">can never raise an alarm</span>
          </span>
        </Link>

        <Link to="/ims/locations" className="inv-kpi" style={{ '--k': '#3b82f6', textDecoration: 'none' }}>
          <span className="inv-kpi-icon"><Warehouse size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Locations</span>
            <span className="inv-kpi-value">{n(counts.locations)}</span>
            <span className="inv-kpi-sub">{scope || 'warehouse, outlets, franchises'}</span>
          </span>
        </Link>
      </div>

      <div className="ims-grid2">
        {/* ── what to order ──────────────────────────────────────────── */}
        <section className="ims-panel">
          <div className="ims-panel-head">
            <h2 className="ims-panel-title"><TriangleAlert size={16} style={{ color: 'var(--warning)' }} /> Running out</h2>
            <Link to={`/ims/stock?status=low${location ? `&location=${location}` : ''}`} className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              See all <ArrowRight size={11} style={{ verticalAlign: -1 }} />
            </Link>
          </div>
          <div className="ims-panel-body">
            {isLoading ? (
              <span className="tiny muted" style={{ padding: 12 }}>Loading…</span>
            ) : lowStock.length === 0 ? (
              <div style={{ padding: 16 }}>
                <EmptyState
                  icon={ShieldCheck}
                  title="Nothing is under its safety level"
                  hint={counts.unset
                    ? `${n(counts.unset)} row${counts.unset === 1 ? '' : 's'} have no safety level set, so they can never appear here. Setting one is what opts an item into this list.`
                    : 'Every stocked item is above the floor set for it.'}
                />
              </div>
            ) : lowStock.map((r) => (
              <div key={r._id} className="ims-row">
                <Thumb src={r.imageUrl} alt={r.name} size={34} radius={8} />
                <span className="ims-row-main">
                  <span className="ims-row-name" title={r.name}>{r.name}</span>
                  <span className="ims-row-sub">
                    <MapPin size={10} style={{ verticalAlign: -1 }} /> {r.locationName} · {r.sku}
                  </span>
                </span>
                <span className="col" style={{ alignItems: 'flex-end', gap: 3, flex: 'none' }}>
                  <StatusPill status={r.status} />
                  {/* The actionable number: not "you have 3", but "you are 7
                      short of where you said you wanted to be". */}
                  <span className="ims-short">
                    {n(r.onHand)} of {n(r.safetyStock)}
                    {r.shortBy > 0 && <> · short {n(r.shortBy)}</>}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--success)', flex: 'none' }}
                  title={`Stock in — ${r.name} at ${r.locationName}`}
                  onClick={() => setDrawer({
                    kind: 'in',
                    location: r.location,
                    seedItem: { _id: r.item, sku: r.sku, name: r.name, unit: r.unit, imageUrl: r.imageUrl },
                  })}
                >
                  <ArrowDownLeft size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* ── what just happened ─────────────────────────────────────── */}
        <section className="ims-panel">
          <div className="ims-panel-head">
            <h2 className="ims-panel-title"><ClipboardCheck size={16} /> Latest movements</h2>
            <Link to={`/ims/movements${location ? `?location=${location}` : ''}`} className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>
              Full ledger <ArrowRight size={11} style={{ verticalAlign: -1 }} />
            </Link>
          </div>
          <div className="ims-panel-body">
            {recent.length === 0 ? (
              <div style={{ padding: 16 }}>
                <EmptyState
                  icon={ClipboardCheck}
                  title="Nothing has moved yet"
                  hint="Every receipt, issue and count lands here with the name of whoever recorded it."
                />
              </div>
            ) : recent.map((m) => {
              const Icon = MOVE_ICON[m.type] || ClipboardCheck;
              const dir = m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : 'flat';
              return (
                <div key={m._id} className="ims-row">
                  <Icon size={16} style={{ flex: 'none', color: dir === 'up' ? 'var(--success)' : dir === 'down' ? 'var(--danger)' : 'var(--text-subtle)' }} />
                  <span className="ims-row-main">
                    <span className="ims-row-name" title={m.name}>{m.name}</span>
                    <span className="ims-row-sub">{m.locationName} · {m.byName} · {when(m.at)}</span>
                  </span>
                  <span className="col" style={{ alignItems: 'flex-end', gap: 2, flex: 'none' }}>
                    <span className={`ims-move ims-move--${dir}`}>{m.delta > 0 ? '+' : ''}{n(m.delta)}</span>
                    <span className="tiny muted">→ {n(m.balanceAfter)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ── the locations, at a glance ─────────────────────────────── */}
      <section className="col gap-2">
        <h2 className="ims-panel-title"><Warehouse size={16} /> Locations</h2>
        <div className="ims-locations">
          {locations.map((l) => (
            <Link key={l._id} to={`/ims/stock?location=${l._id}`} className="ims-loc" style={{ textDecoration: 'none' }}>
              <div className="ims-loc-top">
                <LocationIcon type={l.type} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ims-loc-name">{l.name}</div>
                  <div className="ims-loc-sub">{l.code} · {l.city || l.type}</div>
                </div>
              </div>
              <div className="ims-loc-stats">
                <span className="ims-loc-stat"><b>{n(l.skus)}</b><span>SKUs</span></span>
                <span className="ims-loc-stat"><b>{n(l.units)}</b><span>Units</span></span>
                <span className={`ims-loc-stat${l.lowCount ? ' is-warn' : ''}`}><b>{n(l.lowCount)}</b><span>Low</span></span>
                <span className={`ims-loc-stat${l.outCount ? ' is-bad' : ''}`}><b>{n(l.outCount)}</b><span>Out</span></span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <StockMoveDrawer
        open={!!drawer}
        kind={drawer?.kind || 'in'}
        location={drawer?.location || location}
        locations={locations}
        seedItem={drawer?.seedItem || null}
        onClose={() => setDrawer(null)}
      />
    </div>
  );
}
