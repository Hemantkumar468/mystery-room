import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Warehouse, Search, X as XIcon, AlertTriangle, ArrowDownLeft, ArrowUpRight, ClipboardCheck,
  Boxes, TriangleAlert, PackageX, IndianRupee, ShieldCheck, RefreshCw, SlidersHorizontal, History,
} from 'lucide-react';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useStock, useImsLocations, useInventoryMetaForIms, useSetSafetyStock, useSetSafetyStockBulk,
} from './imsHooks.js';
import { n, money, CategoryPill, Thumb, Pager, SortHead, FilterSelect } from '../master/inventoryUi.jsx';
import { StockBar, StatusPill } from './imsUi.jsx';
import StockMoveDrawer from './StockMoveDrawer.jsx';
import ItemHistoryDrawer from './ItemHistoryDrawer.jsx';

/**
 * Inventory → Stock — how much of each item is at each location.
 *
 * Route: /ims/stock
 *
 * The working screen of the module. One row per item × location: what is on
 * the shelf, what the floor is, whether that is a problem, and what it is
 * worth. Everything — search, five filters, the sort, the paging and the six
 * counts above the table — is answered by the server in one aggregation; see
 * ims.service.js#stock for why none of it happens in the browser.
 *
 * ADDING AND REMOVING ARE SEPARATE DRAWERS, deliberately. They are the same
 * form with the sign flipped, so a single screen with a direction toggle is an
 * invitation to fill in the wrong one — and the cost of that mistake is a
 * count nobody can reconcile. Two buttons, two colours, two verbs. See
 * StockMoveDrawer.
 *
 * THE SAFETY LEVEL IS EDITED IN PLACE, in its own column. It is the number
 * this module is really about: it decides what "low" means, what the dashboard
 * counts, and what the reorder list holds. Burying it behind a dialog would
 * mean it never gets set, and an unset floor is the one state that can never
 * raise an alarm.
 */

/**
 * The item name and the SKU code get a column each.
 *
 * They were briefly stacked in one cell to buy back width, and that was the
 * wrong trade: the code is not a subtitle of the name, it is the other thing
 * people look a row up BY — somebody reading a label off a bin scans the code
 * column, somebody who knows what they want scans the names. Stacked, neither
 * scan works, because the eye has to read two lines per row to do either.
 * Separate columns also make the SKU sortable on its own, which is how a
 * stores team walks a shelf in code order.
 *
 * `width` is a MINIMUM, not a size — the table is `width: 100%`, so on a wide
 * screen every column grows past these. They only bite when space is short, so
 * they are tuned to the tightest real case: ten columns inside the ~1,068px a
 * 14" laptop has with the sidebar open.
 */
const COLUMNS = [
  /* `grow` takes the spare width on a wide screen. Without it every column
     shared the surplus equally and the Value column ended up wider than the
     item name — which is the one thing on the row people actually read. */
  { key: 'name', label: 'Item name', sort: 'name', width: 180, grow: '26%' },
  { key: 'sku', label: 'SKU code', sort: 'sku', width: 112 },
  { key: 'category', label: 'Category', sort: 'category', width: 104 },
  { key: 'location', label: 'Location', width: 110 },
  /* "On hand", not "On hand / floor": the header text was itself setting this
     column's width, and the cell already renders "25 / 60 min", so the floor
     is on screen either way. */
  { key: 'onHand', label: 'On hand', sort: 'onHand', width: 104 },
  { key: 'status', label: 'Status', sort: 'status', width: 96 },
  { key: 'safetyStock', label: 'Safety level', sort: 'safetyStock', width: 96, align: 'right' },
  { key: 'value', label: 'Value', sort: 'value', width: 84, align: 'right' },
];

/** A column's declared width, by key — so a body cell and its heading can never
    drift apart, which is exactly how this table ended up 36px too wide, with
    the name cell asking for 196 and its heading for 180. */
const colWidth = (key) => COLUMNS.find((c) => c.key === key)?.width;

export default function StockPage() {
  const user = useAppSelector(selectCurrentUser);
  const canManage = can.manage(user?.role);

  const [params, setParams] = useSearchParams();

  const [location, setLocation] = useState(params.get('location') || '');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [sort, setSort] = useState({ key: 'name', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [showMore, setShowMore] = useState(false);

  const [drawer, setDrawer] = useState(null);       // { kind, seedItem } | null
  const [historyFor, setHistoryFor] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [safetyCell, setSafetyCell] = useState(null);  // row id being typed into
  const [safetyDraft, setSafetyDraft] = useState('');
  const [bulkSafety, setBulkSafety] = useState('');
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  /* An item id in the URL is how the master page hands off — "manage the stock
     of THIS item" arrives as a link, not as a search somebody retypes. */
  const item = params.get('item') || '';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /* Any change to WHAT is being asked for returns to page 1 — a page number is
     a position in a result set, and kept across a filter change it points into
     a different one. */
  useEffect(() => { setPage(1); }, [debounced, location, category, vendor, status, limit, sort, item]);

  const query = useMemo(() => ({
    ...(location ? { location } : {}),
    ...(item ? { item } : {}),
    ...(debounced ? { search: debounced } : {}),
    ...(category ? { category } : {}),
    ...(vendor ? { vendor } : {}),
    ...(status ? { status } : {}),
    sort: sort.key,
    dir: sort.dir,
    page,
    limit,
  }), [location, item, debounced, category, vendor, status, sort, page, limit]);

  const stockQ = useStock(query);
  const { data: locationsRaw } = useImsLocations();
  const meta = useInventoryMetaForIms();
  const setSafety = useSetSafetyStock();
  const setSafetyBulk = useSetSafetyStockBulk();

  const payload = stockQ.data?.rows ? stockQ.data : (stockQ.data?.data ?? {});
  const rows = payload.rows || [];
  const counts = payload.counts || {};
  const total = payload.total || 0;
  const totalPages = payload.totalPages || 1;
  const locations = locationsRaw?.data ?? locationsRaw ?? [];

  const activeFilters = [debounced, location, category, vendor, status].filter(Boolean).length + (item ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch(''); setLocation(''); setCategory(''); setVendor(''); setStatus('');
    setParams({}, { replace: true });
  }, [setParams]);

  const toggleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: key === 'onHand' || key === 'value' ? 'desc' : 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return { key: 'name', dir: 'asc' };
    });
  }, []);

  /* ── the safety level ──────────────────────────────────────────────── */

  const startSafety = (row) => {
    if (!canManage) return;
    setError(null);
    setSafetyCell(row._id);
    setSafetyDraft(String(row.safetyStock ?? 0));
  };

  const commitSafety = async (row) => {
    const next = Number(safetyDraft);
    setSafetyCell(null);
    if (!Number.isFinite(next) || next < 0 || next === row.safetyStock) return;
    try {
      await setSafety.mutateAsync({ item: row.item, location: row.location, safetyStock: next });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not set that level.');
    }
  };

  const applyBulkSafety = async () => {
    const value = Number(bulkSafety);
    if (!Number.isFinite(value) || value < 0) { setError('Type a safety level first.'); return; }
    const picked = rows.filter((r) => selected.has(r._id));
    try {
      /* Grouped by location, because the floor is per location by design — the
         same item warrants a different floor in a warehouse and an outlet. */
      const byLocation = new Map();
      for (const r of picked) {
        if (!byLocation.has(r.location)) byLocation.set(r.location, []);
        byLocation.get(r.location).push(r.item);
      }
      for (const [loc, items] of byLocation) {
        // eslint-disable-next-line no-await-in-loop
        await setSafetyBulk.mutateAsync({ location: loc, items, safetyStock: value });
      }
      setFlash(`Safety level set to ${n(value)} on ${picked.length} row${picked.length === 1 ? '' : 's'}.`);
      setSelected(new Set());
      setBulkSafety('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not set those levels.');
    }
  };

  /* ── selection ─────────────────────────────────────────────────────── */

  const pageIds = rows.map((r) => r._id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const togglePage = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOnPage) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    return next;
  });

  const onMoved = (res, kind, lineCount) => {
    const verb = kind === 'in' ? 'received' : kind === 'out' ? 'issued' : 'counted';
    setFlash(`${lineCount} line${lineCount === 1 ? '' : 's'} ${verb}. The ledger has it.`);
  };

  const currentLocationName = locations.find((l) => String(l._id) === String(location))?.name;

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon"><Warehouse size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Stock</h1>
            <p className="inv-head-sub">
              How many of each item are at each location, against the safety level set for that
              place. Receiving, issuing and counting all write to the ledger — nothing changes a
              count without a record of who changed it and why.
            </p>
          </div>
        </div>

        <div className="inv-head-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDrawer({ kind: 'adjust' })}>
            <ClipboardCheck size={15} /> Count
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' }}
            onClick={() => setDrawer({ kind: 'out' })}
            data-guide="ims-stock-out"
          >
            <ArrowUpRight size={15} /> Stock out
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'var(--success)', color: '#fff', borderColor: 'var(--success)' }}
            onClick={() => setDrawer({ kind: 'in' })}
            data-guide="ims-stock-in"
          >
            <ArrowDownLeft size={15} /> Stock in
          </button>
        </div>
      </div>

      {/* Six figures, all over whatever is currently filtered. "Needs action"
          leads because it is the only one somebody can DO something about. */}
      <div className="inv-kpis">
        <div className="inv-kpi" style={{ '--k': '#3b82f6' }}>
          <span className="inv-kpi-icon"><Boxes size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Stock rows</span>
            <span className="inv-kpi-value">{n(counts.skus)}</span>
            <span className="inv-kpi-sub">{currentLocationName || 'across every location'}</span>
          </span>
        </div>
        <div className="inv-kpi" style={{ '--k': '#10b981' }}>
          <span className="inv-kpi-icon"><Warehouse size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Units on hand</span>
            <span className="inv-kpi-value">{n(counts.units)}</span>
            <span className="inv-kpi-sub"><b>{n(counts.ok)}</b> rows healthy</span>
          </span>
        </div>
        <button
          type="button"
          className={`inv-kpi${status === 'low' || status === 'critical' ? ' is-on' : ''}`}
          style={{ '--k': '#f59e0b' }}
          onClick={() => setStatus(status === 'low' ? '' : 'low')}
          title="Show only the rows at or under their safety level"
        >
          <span className="inv-kpi-icon"><TriangleAlert size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Needs ordering</span>
            <span className="inv-kpi-value">{n(counts.needsAction)}</span>
            <span className="inv-kpi-sub">{n(counts.critical)} critical · {n(counts.low)} low</span>
          </span>
        </button>
        <button
          type="button"
          className={`inv-kpi${status === 'out' ? ' is-on' : ''}`}
          style={{ '--k': '#ef4444' }}
          onClick={() => setStatus(status === 'out' ? '' : 'out')}
          title="Show only the rows that have run out"
        >
          <span className="inv-kpi-icon"><PackageX size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Out of stock</span>
            <span className="inv-kpi-value">{n(counts.out)}</span>
            <span className="inv-kpi-sub">nothing on the shelf</span>
          </span>
        </button>
        <button
          type="button"
          className={`inv-kpi${status === 'unset' ? ' is-on' : ''}`}
          style={{ '--k': '#8b5cf6' }}
          onClick={() => setStatus(status === 'unset' ? '' : 'unset')}
          title="Stock is held but nobody has set a safety level, so it can never be reported as low"
        >
          <span className="inv-kpi-icon"><ShieldCheck size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">No safety level</span>
            <span className="inv-kpi-value">{n(counts.unset)}</span>
            <span className="inv-kpi-sub">never raises an alarm</span>
          </span>
        </button>
        <div className="inv-kpi" style={{ '--k': '#0ea5e9' }}>
          <span className="inv-kpi-icon"><IndianRupee size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Stock value</span>
            <span className="inv-kpi-value">{money(counts.value, { blank: '₹0' })}</span>
            <span className="inv-kpi-sub">priced items only</span>
          </span>
        </div>
      </div>

      {/* ── filters ────────────────────────────────────────────────── */}
      <div className="inv-filters">
        <div className="inv-filters-row">
        <label className="inv-search">
          <Search size={15} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search an item, SKU, vendor or bin…" />
          {search && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => setSearch('')} aria-label="Clear search">
              <XIcon size={13} />
            </button>
          )}
        </label>

        <FilterSelect label="Location" value={location} onChange={setLocation} width={156}>
          <option value="">Every location</option>
          {locations.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}
        </FilterSelect>

        <FilterSelect label="Status" value={status} onChange={setStatus} width={122}>
          <option value="">Any status</option>
          <option value="out">Out of stock</option>
          <option value="critical">Critical</option>
          <option value="low">Low</option>
          <option value="ok">In stock</option>
          <option value="unset">No floor set</option>
          <option value="empty">Not stocked</option>
        </FilterSelect>

        <FilterSelect label="Category" value={category} onChange={setCategory} width={132}>
          <option value="">All categories</option>
          {(meta.categories || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </FilterSelect>

        <button type="button" className={`btn btn-sm ${showMore ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowMore((s) => !s)}>
          <SlidersHorizontal size={14} /> More Filters
        </button>

        <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={!activeFilters}>
          <RefreshCw size={14} /> Reset
        </button>
        </div>

        {showMore && (
          <div className="inv-more">
            <FilterSelect label="Vendor" value={vendor} onChange={setVendor} width={156}>
              <option value="">Any vendor</option>
              {(meta.vendors || []).map((v) => <option key={v} value={v}>{v}</option>)}
            </FilterSelect>
            {item && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>
                <XIcon size={13} /> Showing one item — clear
              </button>
            )}
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {activeFilters ? `${activeFilters} filter${activeFilters === 1 ? '' : 's'} on` : 'No filters — every stock row.'}
            </span>
          </div>
        )}
      </div>

      {flash && (
        <div className="pt-alert inv-alert--ok">
          <ClipboardCheck size={14} /> {flash}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFlash(null)}><XIcon size={13} /></button>
        </div>
      )}
      {error && (
        <div className="pt-alert pt-alert--bad">
          <AlertTriangle size={14} /> {error}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}><XIcon size={13} /></button>
        </div>
      )}

      {/* The bulk action that matters here: set one floor across everything
          ticked. Somebody opening a location sets a sensible level on forty
          consumables in one go, and doing that row by row is why it never
          gets done at all. */}
      {selected.size > 0 && canManage && (
        <div className="inv-selbar">
          <b>{n(selected.size)}</b> selected
          <span style={{ color: 'var(--text-subtle)' }}>· set safety level to</span>
          <input
            type="number"
            min={0}
            value={bulkSafety}
            onChange={(e) => setBulkSafety(e.target.value)}
            style={{ width: 92, height: 30 }}
            placeholder="e.g. 10"
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={setSafetyBulk.isPending || bulkSafety === ''} onClick={applyBulkSafety}>
            <ShieldCheck size={13} /> Apply
          </button>
          <span className="inv-filter-spacer" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            <XIcon size={13} /> Clear
          </button>
        </div>
      )}

      <div className="inv-toolbar">
        <span className="tiny muted">
          {canManage
            ? 'Click a safety level to change it — Enter saves. Tick rows to set the same level on all of them.'
            : 'Read-only: your role can record movements but not change safety levels.'}
        </span>
        <div className="inv-range">
          <select className="select" value={limit} onChange={(e) => setLimit(Number(e.target.value))} aria-label="Rows per page">
            {[25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} per page</option>)}
          </select>
        </div>
      </div>

      <section className="inv-card">
        {stockQ.isLoading ? <div style={{ padding: 14 }}><SkTable rows={8} /></div> : stockQ.isError ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={AlertTriangle} title="Could not load the stock" hint="The inventory service didn’t respond." />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={Warehouse}
              title={activeFilters ? 'No stock row matches those filters' : 'No stock rows yet'}
              hint={activeFilters
                ? 'Widen the search, or hit Reset above.'
                : 'Run `npm run seed:ims -w server -- --apply` to create the locations, then use Stock in to record what is on the shelves.'}
            />
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table" style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  {canManage && (
                    <th className="inv-col-check">
                      <input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label="Select every row on this page" />
                    </th>
                  )}
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.width, width: c.grow, textAlign: c.align || 'left' }}>
                      <SortHead label={c.label} sortKey={c.sort} sort={sort} onSort={toggleSort} />
                    </th>
                  ))}
                  <th className="inv-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className={selected.has(r._id) ? 'is-selected' : ''}>
                    {canManage && (
                      <td className="inv-col-check">
                        <input type="checkbox" checked={selected.has(r._id)} onChange={() => toggleOne(r._id)} aria-label={`Select ${r.name}`} />
                      </td>
                    )}
                    <td style={{ maxWidth: 0 }}>
                      <span className="row gap-2" style={{ alignItems: 'center' }}>
                        <Thumb src={r.imageUrl} alt={r.name} />
                        <span style={{ minWidth: 0 }}>
                          {/* Wrapped to two lines rather than ellipsised on one.
                              At 1366 the columns exactly fill the width, so there
                              is no spare to widen this with — but the row is
                              already two lines tall for the bin and the location
                              beside it, and a second line of NAME costs nothing
                              and shows the whole thing. */}
                          <span className="inv-name ims-name" title={r.name}>{r.name}</span>
                          {/* The bin stays under the name — it answers "where on
                              the floor", which is a property of this item HERE,
                              not an identifier worth its own column. */}
                          {r.bin && <span className="tiny muted inv-ellipsis">{r.bin}</span>}
                        </span>
                      </span>
                    </td>
                    <td style={{ maxWidth: colWidth('sku') }}><span className="inv-sku">{r.sku}</span></td>
                    <td style={{ maxWidth: colWidth('category') }}><CategoryPill value={r.category} /></td>
                    {/* The CODE leads, not the name. Every location is called
                        "Mystery Rooms <something>", so at any column width the
                        name truncates to "Mystery Roo…" and tells you nothing —
                        whereas MAIN / GGN / JAI never truncate, are unique, and
                        are what the module prints on every movement line. The
                        full name is on the second line and in the tooltip. */}
                    <td style={{ maxWidth: colWidth('location') }}>
                      <span className="row gap-1" style={{ alignItems: 'baseline' }}>
                        <b>{r.locationCode}</b>
                        <span className="tiny muted inv-ellipsis">{r.city || r.locationType}</span>
                      </span>
                      <span className="tiny muted inv-ellipsis" title={r.locationName}>{r.locationName}</span>
                    </td>
                    <td><StockBar onHand={r.onHand} safetyStock={r.safetyStock} status={r.status} /></td>
                    <td><StatusPill status={r.status} /></td>

                    {/* The number the module is really about, edited where it
                        is read. See the note at the top of this file. */}
                    <td
                      style={{ textAlign: 'right' }}
                      className={`${canManage ? 'inv-cell' : ''}${safetyCell === r._id ? ' is-editing' : ''}`}
                      onClick={() => safetyCell !== r._id && startSafety(r)}
                      title={canManage ? 'Click to set the level at or below which this location should reorder' : undefined}
                    >
                      {safetyCell === r._id ? (
                        <input
                          className="inv-cell-input"
                          style={{ textAlign: 'right' }}
                          type="number"
                          min={0}
                          autoFocus
                          value={safetyDraft}
                          onChange={(e) => setSafetyDraft(e.target.value)}
                          onBlur={() => commitSafety(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); commitSafety(r); }
                            if (e.key === 'Escape') { e.preventDefault(); setSafetyCell(null); }
                          }}
                        />
                      ) : r.safetyStock > 0 ? (
                        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{n(r.safetyStock)}</b>
                      ) : (
                        <span className="inv-muted">Set…</span>
                      )}
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      {r.price == null
                        ? <span className="inv-price inv-price--none" title="The item has no price in the master">—</span>
                        : <span className="inv-price">{money(r.value)}</span>}
                    </td>

                    <td className="inv-col-actions">
                      <span className="inv-actions">
                        <button
                          type="button" className="btn btn-ghost btn-sm" title={`Stock in — ${r.name} at ${r.locationName}`}
                          style={{ color: 'var(--success)' }}
                          onClick={() => setDrawer({ kind: 'in', seedItem: asItem(r), location: r.location })}
                        >
                          <ArrowDownLeft size={14} />
                        </button>
                        <button
                          type="button" className="btn btn-ghost btn-sm" title={`Stock out — ${r.name} at ${r.locationName}`}
                          style={{ color: 'var(--danger)' }}
                          disabled={r.onHand <= 0}
                          onClick={() => setDrawer({ kind: 'out', seedItem: asItem(r), location: r.location })}
                        >
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          type="button" className="btn btn-ghost btn-sm" title="Its movement history"
                          onClick={() => setHistoryFor(r)}
                        >
                          <History size={14} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <Pager page={page} totalPages={totalPages} total={total} limit={limit} onPage={setPage} noun="stock rows" />
        )}
      </section>

      <StockMoveDrawer
        open={!!drawer}
        kind={drawer?.kind || 'in'}
        location={drawer?.location || location}
        locations={locations}
        seedItem={drawer?.seedItem || null}
        onClose={() => setDrawer(null)}
        onDone={onMoved}
      />

      <ItemHistoryDrawer row={historyFor} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

/** A stock row carries the item's fields flattened; the drawer wants the item. */
const asItem = (r) => ({ _id: r.item, sku: r.sku, name: r.name, unit: r.unit, imageUrl: r.imageUrl });
