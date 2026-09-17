import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  History, Search, X as XIcon, AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardCheck,
  RefreshCw, TrendingUp, TrendingDown, ListOrdered,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useMovements, useImsLocations } from './imsHooks.js';
import { n, Pager, FilterSelect } from '../master/inventoryUi.jsx';

/**
 * Inventory → Movements — every change to every count, newest first.
 *
 * Route: /ims/movements
 *
 * THE LEDGER IS THE SOURCE OF TRUTH; the on-hand numbers everywhere else in
 * the module are a running total of this. It is append-only: a mistaken entry
 * is corrected by posting its opposite, exactly as a ledger is corrected, so
 * this page shows both the error and the fix. Nothing here can be edited or
 * deleted, and there is deliberately no control that offers to.
 *
 * WHY `balanceBefore → balanceAfter` IS ON EVERY ROW. They were frozen when
 * the movement was written, so if a cached balance ever drifts these say
 * exactly which row it drifted at. That is the difference between an audit
 * trail and a list of events.
 */

const ICON = {
  in: ArrowDownLeft, transfer_in: ArrowDownLeft, out: ArrowUpRight, transfer_out: ArrowUpRight, adjust: ClipboardCheck,
};

const TYPE_LABEL = {
  in: 'Received', out: 'Issued', adjust: 'Counted', transfer_in: 'Transfer in', transfer_out: 'Transfer out',
};

const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

export default function MovementsPage() {
  const [params, setParams] = useSearchParams();

  const [location, setLocation] = useState(params.get('location') || '');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const item = params.get('item') || '';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [debounced, location, type, from, to, limit, item]);

  const query = useMemo(() => ({
    ...(location ? { location } : {}),
    ...(item ? { item } : {}),
    ...(type ? { type } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    page,
    limit,
  }), [location, item, type, debounced, from, to, page, limit]);

  const movesQ = useMovements(query);
  const { data: locationsRaw } = useImsLocations();

  const payload = movesQ.data?.rows ? movesQ.data : (movesQ.data?.data ?? {});
  const rows = payload.rows || [];
  const counts = payload.counts || {};
  const locations = locationsRaw?.data ?? locationsRaw ?? [];

  const activeFilters = [debounced, location, type, from, to].filter(Boolean).length + (item ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch(''); setLocation(''); setType(''); setFrom(''); setTo('');
    setParams({}, { replace: true });
  }, [setParams]);

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon"><History size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Movements</h1>
            <p className="inv-head-sub">
              Every receipt, issue, count and transfer, newest first — with who did it, why, and the
              balance it left behind. This ledger is append-only: a mistake is corrected by posting
              its opposite, so the history shows both.
            </p>
          </div>
        </div>
      </div>

      <div className="inv-kpis">
        <div className="inv-kpi" style={{ '--k': '#3b82f6' }}>
          <span className="inv-kpi-icon"><ListOrdered size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Movements</span>
            <span className="inv-kpi-value">{n(counts.total)}</span>
            <span className="inv-kpi-sub">{activeFilters ? 'matching your filters' : 'ever recorded'}</span>
          </span>
        </div>
        <div className="inv-kpi" style={{ '--k': '#10b981' }}>
          <span className="inv-kpi-icon"><TrendingUp size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Units in</span>
            <span className="inv-kpi-value">+{n(counts.inUnits)}</span>
            <span className="inv-kpi-sub">received, returned or counted up</span>
          </span>
        </div>
        <div className="inv-kpi" style={{ '--k': '#ef4444' }}>
          <span className="inv-kpi-icon"><TrendingDown size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Units out</span>
            <span className="inv-kpi-value">−{n(counts.outUnits)}</span>
            <span className="inv-kpi-sub">issued, consumed or counted down</span>
          </span>
        </div>
        <div className="inv-kpi" style={{ '--k': '#8b5cf6' }}>
          <span className="inv-kpi-icon"><ClipboardCheck size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Net change</span>
            <span className="inv-kpi-value">
              {(counts.inUnits || 0) - (counts.outUnits || 0) >= 0 ? '+' : ''}
              {n((counts.inUnits || 0) - (counts.outUnits || 0))}
            </span>
            <span className="inv-kpi-sub">over the filtered period</span>
          </span>
        </div>
      </div>

      <div className="inv-filters">
        <div className="inv-filters-row">
        <label className="inv-search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an item, SKU, reference or note…" />
          {search && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => setSearch('')} aria-label="Clear search">
              <XIcon size={13} />
            </button>
          )}
        </label>

        <FilterSelect label="Location" value={location} onChange={setLocation} width={150}>
          <option value="">Every location</option>
          {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
        </FilterSelect>

        <FilterSelect label="Type" value={type} onChange={setType} width={126}>
          <option value="">Any movement</option>
          <option value="in">Received</option>
          <option value="out">Issued</option>
          <option value="adjust">Counted</option>
          <option value="transfer_in">Transfer in</option>
          <option value="transfer_out">Transfer out</option>
        </FilterSelect>

        <label className="inv-select" style={{ width: 124 }}>
          <span>From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="inv-select" style={{ width: 124 }}>
          <span>To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={!activeFilters}>
          <RefreshCw size={14} /> Reset
        </button>
        </div>

        {item && (
          <span className="tiny muted" style={{ marginLeft: 'auto' }}>Filtered to one item.</span>
        )}
      </div>

      <section className="inv-card">
        {movesQ.isLoading ? <div style={{ padding: 14 }}><SkTable rows={8} /></div> : movesQ.isError ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={AlertTriangle} title="Could not load the ledger" hint="The inventory service didn’t respond." />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={History}
              title={activeFilters ? 'No movement matches those filters' : 'Nothing has moved yet'}
              hint={activeFilters
                ? 'Widen the dates or hit Reset above.'
                : 'Use Stock in on the Stock page to record the opening quantities — every one of them lands here.'}
            />
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>When</th>
                  <th style={{ minWidth: 130 }}>Type</th>
                  <th style={{ minWidth: 240 }}>Item</th>
                  <th style={{ minWidth: 150 }}>Location</th>
                  <th style={{ minWidth: 120 }}>Reason</th>
                  <th style={{ minWidth: 96, textAlign: 'right' }}>Change</th>
                  <th style={{ minWidth: 130, textAlign: 'right' }}>Balance</th>
                  <th style={{ minWidth: 140 }}>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const Icon = ICON[m.type] || ClipboardCheck;
                  const dir = m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : 'flat';
                  return (
                    <tr key={m._id}>
                      <td>
                        <span className="tiny" style={{ color: 'var(--text)' }}>{when(m.at)}</span>
                      </td>
                      <td>
                        <span className={`ims-move ims-move--${dir}`}>
                          <Icon size={14} /> {TYPE_LABEL[m.type] || m.type}
                        </span>
                      </td>
                      <td style={{ maxWidth: 240 }}>
                        <span className="inv-name inv-ellipsis" title={m.name}>{m.name}</span>
                        <span className="inv-sku">{m.sku}</span>
                      </td>
                      <td style={{ maxWidth: 150 }}>
                        <span className="inv-ellipsis" title={m.locationName}>{m.locationName}</span>
                      </td>
                      <td>
                        {m.reason ? <span className="ims-reason">{m.reason.replace(/_/g, ' ')}</span> : <span className="inv-muted">—</span>}
                        {m.reference && <div className="tiny muted">ref {m.reference}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`ims-move ims-move--${dir}`}>{m.delta > 0 ? '+' : ''}{n(m.delta)}</span>
                      </td>
                      {/* Frozen at the moment of the movement — see the note at
                          the top of this file. */}
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <span className="tiny muted">{n(m.balanceBefore)} → </span>
                        <b>{n(m.balanceAfter)}</b>
                      </td>
                      <td>
                        <span className="inv-ellipsis" title={m.byName}>{m.byName}</span>
                        {m.note && <div className="tiny muted inv-ellipsis" title={m.note} style={{ maxWidth: 140 }}>{m.note}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <Pager
            page={payload.page || 1}
            totalPages={payload.totalPages || 1}
            total={payload.total || 0}
            limit={limit}
            onPage={setPage}
            noun="movements"
          />
        )}
      </section>
    </div>
  );
}
