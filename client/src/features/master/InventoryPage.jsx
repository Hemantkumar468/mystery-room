import { useState } from 'react';
import {
  Boxes, Search, Plus, Pencil, Archive, RotateCcw, AlertTriangle, X as XIcon, Eye,
  Tag, Upload, Download, SlidersHorizontal, RefreshCw, Table2, LayoutGrid, Image as ImageIcon,
  Package, FolderTree, Users, Ruler, MoreHorizontal, Warehouse,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  VISIBILITIES,
  useInventoryMeta,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useArchiveInventoryItem,
  useRestoreInventoryItem,
  downloadInventoryCsv,
} from '../../app/api/inventoryApi.js';
import { useInventoryQuery } from './useInventoryQuery.js';
import {
  n, money, CategoryPill, VisibilityTag, Thumb, Pager, SortHead, FilterSelect,
} from './inventoryUi.jsx';
import InventoryBulkAddModal from './InventoryBulkAddModal.jsx';
import InventoryCategoriesModal from './InventoryCategoriesModal.jsx';
import InventoryItemDrawer from './InventoryItemDrawer.jsx';

/**
 * Master Data → Item Master — the company's stock catalogue.
 *
 * Route: /inventory
 *
 * Every SKU Mystery Rooms stocks: the code, the picture, what it is filed
 * under, the unit it is counted in, who it comes from and what it costs.
 * Migrated from the BoxHero export in SHEET/ (1,322 rows) and maintained here.
 *
 * IT IS A CATALOGUE, NOT A COUNT — there is no quantity column and that is
 * deliberate. How many of a thing are in Gurgaon today is a different question
 * with a different answer at every location, and it lives in the IMS
 * (/ims/stock). The two meet at the SKU: this page owns what a thing IS, the
 * IMS owns how many there are. The drawer behind the eye icon shows a row's
 * stock at every location without either page having to own the other's data.
 *
 * EVERYTHING IS SERVER-SIDE — the search, the filters, the sort, the paging and
 * the four counts above the table. The master is over 1,300 rows and growing;
 * the alternative is shipping all of it to show ten. See useInventoryQuery.js.
 *
 * THREE VIEWS, one dataset. Table is the working view. Cards suit a category
 * somebody is reviewing rather than scanning. Gallery is for the day the
 * pictures are filled in and "which one is the blue one" becomes the question.
 * All three read the same page of the same query — switching view is not a
 * refetch.
 */

/** Columns, left to right, as the reference draws them. */
/**
 * `width` is a MINIMUM, not a size — the table is `width: 100%`, so on a wide
 * screen every column grows past these. They only bite when space is short,
 * which is why they are tuned to the tightest real case rather than to what
 * looks balanced on a large monitor: eleven columns at their old minimums came
 * to 1,138px against the 1,068px a 14" laptop has with the sidebar open, and
 * the 70px difference pushed the price under the pinned Actions column.
 */
const COLUMNS = [
  { key: 'sku', label: 'SKU', sort: 'sku', width: 118 },
  { key: 'name', label: 'Item name', sort: 'name', width: 180 },
  { key: 'category', label: 'Category', sort: 'category', width: 120 },
  { key: 'unit', label: 'Unit', sort: 'unit', width: 80 },
  { key: 'vendorName', label: 'Vendor', sort: 'vendorName', width: 128 },
  { key: 'visibility', label: 'Visibility', sort: 'visibility', width: 112 },
  { key: 'price', label: 'Price (₹)', sort: 'price', width: 100, align: 'right' },
];

/** Cells the grid lets you type straight into. Not the picture or the price —
    those have a proper control on the form and a text box is the wrong one. */
const EDITABLE = ['sku', 'name', 'category', 'unit', 'vendorName'];

/** Emptying one of these is a delete, not an edit — refused inline. */
const REQUIRED = ['sku', 'name'];

const blank = {
  sku: '', name: '', category: '', unit: '', visibility: 'Unlisted',
  vendorName: '', vendorDetails: '', price: '', imageUrl: '', notes: '',
};

export default function InventoryPage() {
  const user = useAppSelector(selectCurrentUser);
  const canManage = can.manage(user?.role);

  const q = useInventoryQuery();
  const { data: metaRaw } = useInventoryMeta();
  const meta = metaRaw?.data ?? metaRaw ?? {};

  const create = useCreateInventoryItem();
  const update = useUpdateInventoryItem();
  const archive = useArchiveInventoryItem();
  const restore = useRestoreInventoryItem();

  const [view, setView] = useState('table');        // table | cards | gallery
  const [showMore, setShowMore] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);     // item | 'new'
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState(null);
  const [gridError, setGridError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [viewing, setViewing] = useState(null);     // the item in the drawer
  const [busyExport, setBusyExport] = useState(false);
  const [cell, setCell] = useState(null);           // { id, key } being typed into
  const [draft, setDraft] = useState('');

  const counts = q.counts;
  const categories = meta.categories || [];
  const units = meta.units || [];
  const vendors = meta.vendors || [];
  const rows = q.rows;

  /* ── selection ─────────────────────────────────────────────────────── */

  /* Scoped to the page on screen. "Select all" across 1,322 rows the person
     has never seen, followed by "Archive", is a mistake the UI should not make
     easy to make — the header box ticks THIS page, and the count says so. */
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

  const clearSelection = () => setSelected(new Set());

  const archiveSelected = async () => {
    const ids = [...selected];
    setGridError(null);
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await archive.mutateAsync(id);
      }
      setFlash(`${ids.length} item${ids.length === 1 ? '' : 's'} archived — their SKUs stay reserved.`);
      clearSelection();
    } catch (err) {
      setGridError(err?.response?.data?.message || 'Could not archive those.');
    }
  };

  /* ── export ────────────────────────────────────────────────────────── */

  const doExport = async () => {
    setBusyExport(true);
    setGridError(null);
    try {
      const filename = await downloadInventoryCsv(q.exportParams);
      setFlash(`Exported ${n(q.total)} row${q.total === 1 ? '' : 's'} to ${filename || 'a CSV'}.`);
    } catch (err) {
      setGridError(err?.response?.data?.message || 'Could not build that export.');
    } finally {
      setBusyExport(false);
    }
  };

  /* ── the form ──────────────────────────────────────────────────────── */

  const openNew = () => { setForm(blank); setEditing('new'); setFormError(null); };
  const openEdit = (item) => {
    setForm(Object.fromEntries(Object.keys(blank).map((k) => [k, item[k] ?? ''])));
    setEditing(item);
    setFormError(null);
  };

  const save = async () => {
    setFormError(null);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v ?? '').trim()]));
    if (!body.name) { setFormError('The item needs a name.'); return; }
    /* Blank stays null rather than 0 — "unpriced" and "free" are different
       answers, and the model keeps them apart. */
    body.price = body.price === '' ? null : Number(body.price);
    if (body.price != null && !Number.isFinite(body.price)) { setFormError('That price is not a number.'); return; }

    try {
      if (editing === 'new') {
        const res = await create.mutateAsync(body);
        const made = res?.data ?? res;
        setFlash(`${made.name} added as ${made.sku}.`);
      } else {
        await update.mutateAsync({ id: editing._id, ...body });
      }
      setEditing(null);
    } catch (err) {
      setFormError(err?.response?.data?.message || 'Could not save that.');
    }
  };

  /* ── inline editing ────────────────────────────────────────────────── */

  const startCell = (item, key) => {
    if (!canManage || item.active === false || !EDITABLE.includes(key)) return;
    setGridError(null);
    setCell({ id: item._id, key });
    setDraft(item[key] ?? '');
  };

  const cancelCell = () => { setCell(null); setDraft(''); };

  /**
   * Commit the cell being edited. Returns false when the value was refused, so
   * Tab keeps the caret where it is rather than walking on and leaving a
   * rejected edit behind.
   */
  const commitCell = async () => {
    if (!cell) return true;
    const row = rows.find((r) => r._id === cell.id);
    const next = draft.trim();
    if (!row || next === String(row[cell.key] ?? '').trim()) { cancelCell(); return true; }
    if (REQUIRED.includes(cell.key) && !next) {
      setGridError(cell.key === 'sku'
        ? 'A SKU cannot be emptied — it is what every bin label, every stock row and every past indent matches on.'
        : 'An item cannot be left without a name — archive the row instead.');
      return false;
    }
    /* Cleared first so the grid never shows a stale input over fresh data if
       the request is slow; a refusal puts the message above the table. */
    const { id, key } = cell;
    cancelCell();
    try {
      await update.mutateAsync({ id, [key]: next });
      return true;
    } catch (err) {
      setGridError(err?.response?.data?.message || 'Could not save that cell.');
      return false;
    }
  };

  /** Enter commits, Escape reverts, Tab commits and steps to the next column. */
  const onCellKeyDown = async (e, item) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelCell(); return; }
    if (e.key === 'Enter') { e.preventDefault(); await commitCell(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = EDITABLE.indexOf(cell?.key);
      const nextKey = EDITABLE[i + (e.shiftKey ? -1 : 1)];
      if (await commitCell() && nextKey) startCell(item, nextKey);
    }
  };

  const toggleArchive = async (item) => {
    setGridError(null);
    try {
      if (item.active === false) await restore.mutateAsync(item._id);
      else await archive.mutateAsync(item._id);
    } catch (err) {
      setGridError(err?.response?.data?.message || 'Could not change that.');
    }
  };

  const busy = create.isPending || update.isPending;

  /** The cell's contents, shared by the table's read and edit states. */
  const renderValue = (item, col) => {
    const value = item[col.key];
    if (col.key === 'category') return <CategoryPill value={value} />;
    if (col.key === 'visibility') return <VisibilityTag value={value} archived={item.active === false} />;
    if (col.key === 'price') {
      return value == null || value === ''
        ? <span className="inv-price inv-price--none" title="Nobody has priced this yet">Not priced</span>
        : <span className="inv-price">{money(value)}</span>;
    }
    if (col.key === 'sku') return <span className="inv-sku">{value}</span>;
    if (col.key === 'name') return <span className="inv-name inv-ellipsis" title={value}>{value}</span>;
    return value
      ? <span className="inv-ellipsis" title={value}>{value}</span>
      : <span className="inv-muted">—</span>;
  };

  return (
    <div className="content inv-page">
      {/* ── header ─────────────────────────────────────────────────── */}
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon"><Boxes size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Master Data</h1>
            <p className="inv-head-sub">
              Manage the product catalogue — every item, its details, categories, units, vendors and
              price. This is the source of truth for <b>what</b> we stock and how it is organised;{' '}
              <Link to="/ims/stock" style={{ color: 'var(--primary)', fontWeight: 600 }}>Inventory → Stock</Link>{' '}
              holds <b>how many</b> there are, at each location.
            </p>
          </div>
        </div>

        {canManage && (
          <div className="inv-head-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCatsOpen(true)}>
              <Tag size={15} /> Categories
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBulkOpen(true)} data-guide="inventory-import">
              <Upload size={15} /> Import
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busyExport} onClick={doExport}>
              <Download size={15} /> {busyExport ? 'Building…' : 'Export'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={openNew} data-guide="inventory-add">
              <Plus size={15} /> Add Item
            </button>
          </div>
        )}
      </div>

      {/* ── stat cards ─────────────────────────────────────────────── */}
      {/* Each describes WHAT IS FILTERED, not the whole master — the only
          reading that makes sense once a filter is on, and the reason they
          are computed server-side beside the rows. */}
      <div className="inv-kpis">
        <div className="inv-kpi" style={{ '--k': '#3b82f6' }}>
          <span className="inv-kpi-icon"><Package size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Total Items</span>
            <span className="inv-kpi-value">{n(counts.items)}</span>
            <span className="inv-kpi-sub">{q.activeFilters ? 'matching your filters' : 'in the master'}</span>
          </span>
        </div>

        <div className="inv-kpi" style={{ '--k': '#10b981' }}>
          <span className="inv-kpi-icon"><FolderTree size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Categories</span>
            <span className="inv-kpi-value">{n(counts.categories)}</span>
            <span className="inv-kpi-sub"><b>{n(counts.listed)}</b> listed items</span>
          </span>
        </div>

        <div className="inv-kpi" style={{ '--k': '#8b5cf6' }}>
          <span className="inv-kpi-icon"><Users size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Vendors</span>
            <span className="inv-kpi-value">{n(counts.vendors)}</span>
            <span className="inv-kpi-sub">supplying these items</span>
          </span>
        </div>

        {/* The one card that is also an action — the question a spreadsheet
            cannot answer about itself, and the one that keeps a master
            trustworthy. 51 rows arrived from the export unfiled. */}
        <button
          type="button"
          className={`inv-kpi${q.uncategorised ? ' is-on' : ''}`}
          style={{ '--k': '#f59e0b' }}
          onClick={q.toggleUncategorised}
          title="Show only the items nobody has filed under a category yet"
        >
          <span className="inv-kpi-icon"><Ruler size={20} /></span>
          <span className="inv-kpi-body">
            <span className="inv-kpi-label">Unfiled</span>
            <span className="inv-kpi-value">{n(counts.uncategorised)}</span>
            <span className="inv-kpi-sub">{q.uncategorised ? 'showing these — click to clear' : 'no category yet'}</span>
          </span>
        </button>
      </div>

      {/* ── filters ────────────────────────────────────────────────── */}
      <div className="inv-filters">
        <div className="inv-filters-row">
        <label className="inv-search">
          <Search size={15} />
          <input
            value={q.search}
            onChange={(e) => q.setSearch(e.target.value)}
            placeholder="Search by name, SKU, category, vendor…"
          />
          {q.search && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 2 }} onClick={() => q.setSearch('')} aria-label="Clear search">
              <XIcon size={13} />
            </button>
          )}
        </label>

        <FilterSelect label="Category" value={q.category} onChange={q.setCategory} width={148}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>{c.name}{c.count ? ` (${c.count})` : ''}</option>
          ))}
        </FilterSelect>

        <FilterSelect label="Unit" value={q.unit} onChange={q.setUnit} width={116}>
          <option value="">Any Unit</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </FilterSelect>

        <FilterSelect label="Vendor" value={q.vendor} onChange={q.setVendor} width={140}>
          <option value="">Any Vendor</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </FilterSelect>

        <FilterSelect label="Visibility" value={q.visibility} onChange={q.setVisibility} width={104}>
          <option value="">Any</option>
          {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
        </FilterSelect>

        <button
          type="button"
          className={`btn btn-sm ${showMore ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowMore((s) => !s)}
        >
          <SlidersHorizontal size={14} /> More Filters
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => { q.clearFilters(); setShowMore(false); }}
          disabled={!q.activeFilters}
          title={q.activeFilters ? `Clear ${q.activeFilters} filter(s)` : 'Nothing to reset'}
        >
          <RefreshCw size={14} /> Reset
        </button>
        </div>

        {showMore && (
          <div className="inv-more">
            <label className="row gap-1 tiny" style={{ alignItems: 'center', cursor: 'pointer', color: 'var(--text-subtle)' }}>
              <input type="checkbox" checked={q.includeArchived} onChange={(e) => q.setIncludeArchived(e.target.checked)} />
              Show archived items
            </label>
            <label className="row gap-1 tiny" style={{ alignItems: 'center', cursor: 'pointer', color: 'var(--text-subtle)' }}>
              <input type="checkbox" checked={q.uncategorised} onChange={q.toggleUncategorised} />
              Only items with no category
            </label>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>
              {q.activeFilters
                ? `${q.activeFilters} filter${q.activeFilters === 1 ? '' : 's'} on · ${n(q.total)} of ${n(counts.items)} shown`
                : 'No filters — the whole master.'}
            </span>
          </div>
        )}
      </div>

      {flash && (
        <div className="pt-alert inv-alert--ok">
          <Eye size={14} /> {flash}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFlash(null)}>
            <XIcon size={13} />
          </button>
        </div>
      )}

      {gridError && (
        <div className="pt-alert pt-alert--bad">
          <AlertTriangle size={14} /> {gridError}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setGridError(null)}>
            <XIcon size={13} />
          </button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="inv-selbar">
          <b>{n(selected.size)}</b> selected
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
            <XIcon size={13} /> Clear
          </button>
          <span className="inv-filter-spacer" />
          {canManage && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={archiveSelected}>
              <Archive size={13} /> Archive selected
            </button>
          )}
        </div>
      )}

      {/* ── toolbar ────────────────────────────────────────────────── */}
      <div className="inv-toolbar">
        <div className="inv-views">
          {[
            { key: 'table', label: 'Table', icon: Table2 },
            { key: 'cards', label: 'Cards', icon: LayoutGrid },
            { key: 'gallery', label: 'Gallery', icon: ImageIcon },
          ].map((v) => (
            <button
              key={v.key}
              type="button"
              className={`inv-view${view === v.key ? ' is-on' : ''}`}
              onClick={() => setView(v.key)}
            >
              <v.icon size={14} /> {v.label}
            </button>
          ))}
        </div>

        <div className="inv-range">
          <span>
            {q.isFetching ? 'Loading…' : <>Showing <b>{n(q.total === 0 ? 0 : (q.page - 1) * q.limit + 1)}–{n(Math.min(q.page * q.limit, q.total))}</b> of <b>{n(q.total)}</b> items</>}
          </span>
          <select className="select" value={q.limit} onChange={(e) => q.setLimit(Number(e.target.value))} aria-label="Rows per page">
            {[10, 25, 50, 100, 200].map((x) => <option key={x} value={x}>{x} per page</option>)}
          </select>
        </div>
      </div>

      {/* ── the data ───────────────────────────────────────────────── */}
      <section className="inv-card">
        {q.isLoading ? <div style={{ padding: 14 }}><SkTable rows={8} /></div> : q.isError ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon={AlertTriangle} title="Could not load the catalogue" hint="The inventory service didn’t respond." />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon={Boxes}
              title={q.activeFilters ? 'No item matches those filters' : 'No items yet'}
              hint={q.activeFilters
                ? 'Widen the search, or hit Reset above.'
                : 'Run `npm run migrate:inventory -w server -- --apply` to load the BoxHero export, or add the first item here.'}
            />
          </div>
        ) : view === 'table' ? (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="inv-col-check">
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      onChange={togglePage}
                      aria-label="Select every row on this page"
                      title="Select every row on this page"
                    />
                  </th>
                  <th className="inv-col-num">#</th>
                  <th className="inv-col-img">Image</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.width, textAlign: c.align || 'left' }}>
                      <SortHead label={c.label} sortKey={c.sort} sort={q.sort} onSort={q.toggleSort} />
                    </th>
                  ))}
                  <th className="inv-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item, i) => {
                  const archived = item.active === false;
                  const isSelected = selected.has(item._id);
                  return (
                    <tr key={item._id} className={`${archived ? 'inv-row-archived' : ''}${isSelected ? ' is-selected' : ''}`}>
                      <td className="inv-col-check">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleOne(item._id)} aria-label={`Select ${item.name}`} />
                      </td>
                      {/* The row's position in the WHOLE result, not in this
                          page — "row 312 of 1,322" is what somebody reading a
                          long list wants, and restarting at 1 each page makes
                          the number meaningless. */}
                      <td className="inv-col-num">{(q.page - 1) * q.limit + i + 1}</td>
                      <td className="inv-col-img"><Thumb src={item.imageUrl} alt={item.name} /></td>

                      {COLUMNS.map((c) => {
                        const active = cell?.id === item._id && cell?.key === c.key;
                        const editable = canManage && !archived && EDITABLE.includes(c.key);
                        return (
                          <td
                            key={c.key}
                            className={`${editable ? 'inv-cell' : ''}${active ? ' is-editing' : ''}`}
                            style={{ maxWidth: c.width, textAlign: c.align || 'left' }}
                            onClick={() => editable && !active && startCell(item, c.key)}
                          >
                            {active ? (
                              <input
                                className="inv-cell-input"
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onKeyDown={(e) => onCellKeyDown(e, item)}
                                onBlur={commitCell}
                                list={
                                  c.key === 'category' ? 'inv-dl-categories'
                                    : c.key === 'unit' ? 'inv-dl-units'
                                      : c.key === 'vendorName' ? 'inv-dl-vendors' : undefined
                                }
                              />
                            ) : renderValue(item, c)}
                          </td>
                        );
                      })}

                      <td className="inv-col-actions">
                        <span className="inv-actions">
                          <button type="button" className="btn btn-ghost btn-sm" title="Open the item — details and its stock at every location" onClick={() => setViewing(item)}>
                            <Eye size={14} />
                          </button>
                          {canManage && !archived && (
                            <button type="button" className="btn btn-ghost btn-sm" title="Edit the whole row" onClick={() => openEdit(item)}>
                              <Pencil size={14} />
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={archived ? undefined : { color: 'var(--danger)' }}
                              title={archived ? 'Put it back in the master' : 'Archive — the SKU stays reserved and past paperwork still reads'}
                              onClick={() => toggleArchive(item)}
                            >
                              {archived ? <RotateCcw size={14} /> : <Archive size={14} />}
                            </button>
                          )}
                          {!canManage && <span className="tiny muted">—</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : view === 'cards' ? (
          <div className="inv-cards">
            {rows.map((item) => (
              <div key={item._id} className={`inv-cardx${selected.has(item._id) ? ' is-selected' : ''}`}>
                <div className="inv-cardx-top">
                  <Thumb src={item.imageUrl} alt={item.name} size={46} radius={10} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="inv-cardx-name">{item.name}</div>
                    <div className="inv-sku">{item.sku}</div>
                  </div>
                  <input type="checkbox" checked={selected.has(item._id)} onChange={() => toggleOne(item._id)} aria-label={`Select ${item.name}`} />
                </div>
                <div className="inv-cardx-meta">
                  <CategoryPill value={item.category} />
                  <VisibilityTag value={item.visibility} archived={item.active === false} />
                </div>
                <div className="tiny muted inv-ellipsis" title={item.vendorName}>
                  {item.vendorName || 'No vendor recorded'} · {item.unit || 'no unit'}
                </div>
                <div className="inv-cardx-foot">
                  <span className={item.price == null ? 'inv-price inv-price--none' : 'inv-price'}>
                    {item.price == null ? 'Not priced' : money(item.price)}
                  </span>
                  <span className="inv-actions">
                    <button type="button" className="btn btn-ghost btn-sm" title="Open" onClick={() => setViewing(item)}><Eye size={14} /></button>
                    {canManage && <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={() => openEdit(item)}><Pencil size={14} /></button>}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="inv-gallery">
            {rows.map((item) => (
              <button key={item._id} type="button" className="inv-tile" onClick={() => setViewing(item)} title={item.name}>
                {item.imageUrl
                  ? <Thumb src={item.imageUrl} alt={item.name} size="100%" radius={0} className="inv-tile-img" />
                  : <div className="inv-tile-img inv-tile-img--empty" title="No picture yet"><Package size={34} /></div>}
                <span className="inv-tile-body">
                  <span className="inv-tile-name">{item.name}</span>
                  <span className="inv-sku">{item.sku}</span>
                  <span className="row gap-1" style={{ alignItems: 'center' }}>
                    <CategoryPill value={item.category} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <Pager page={q.page} totalPages={q.totalPages} total={q.total} limit={q.limit} onPage={q.setPage} />
        )}
      </section>

      {/* One set of suggestion lists for every inline cell and the form — a
          datalist per cell would put the same hundred-odd vendor names into the DOM
          fifty times over. */}
      <datalist id="inv-dl-categories">{categories.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <datalist id="inv-dl-units">{units.map((u) => <option key={u} value={u} />)}</datalist>
      <datalist id="inv-dl-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'Add an item' : `Edit ${editing.name}`}
          subtitle="Master data — what the thing IS. Quantities live in Inventory → Stock."
          width={640}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        >
          <div className="col gap-3">
            {formError && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {formError}</div>}
            <div className="po-ccbcc">
              <label className="pt-field"><span>Item name *</span>
                <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Masking Tape 2 inch" />
              </label>
              <label className="pt-field"><span>SKU</span>
                <input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} placeholder={editing === 'new' ? 'Leave blank and we mint one' : ''} />
              </label>
              <label className="pt-field"><span>Category</span>
                <input list="inv-dl-categories" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Pick one, or type a new one" />
              </label>
              <label className="pt-field"><span>Unit</span>
                <input list="inv-dl-units" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="Piece, Set, Meter…" />
              </label>
              <label className="pt-field"><span>Visibility</span>
                <select className="select" value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}>
                  {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="pt-field"><span>Price (₹)</span>
                <input
                  type="number" min={0} step="0.01" value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="Leave blank if unpriced"
                />
              </label>
              <label className="pt-field"><span>Vendor</span>
                <input list="inv-dl-vendors" value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Vendor contact</span>
                <input value={form.vendorDetails} onChange={(e) => setForm((f) => ({ ...f, vendorDetails: e.target.value }))} />
              </label>
            </div>
            <label className="pt-field"><span>Image URL</span>
              <input value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
            </label>
            {form.imageUrl && (
              <div className="row gap-2" style={{ alignItems: 'center' }}>
                <Thumb src={form.imageUrl} alt={form.name} size={54} radius={10} />
                <span className="tiny muted">Preview — if this stays a letter, the URL did not load.</span>
              </div>
            )}
            <label className="pt-field"><span>Notes</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <span className="tiny muted">
              <MoreHorizontal size={11} /> A category typed here joins the list, so the next person picks it
              rather than retyping it slightly differently. A blank price means <b>unpriced</b>, not free.
            </span>
          </div>
        </Modal>
      )}

      <InventoryBulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} meta={meta} onDone={(r) => setFlash(`${r.created} item${r.created === 1 ? '' : 's'} imported.`)} />
      <InventoryCategoriesModal open={catsOpen} onClose={() => setCatsOpen(false)} meta={meta} />
      <InventoryItemDrawer item={viewing} onClose={() => setViewing(null)} onEdit={canManage ? openEdit : null} />

      {/* A quiet pointer across to the other half of the system. The people who
          maintain this catalogue are the people who ask "so how many have we
          got", and the answer is one click away rather than in another menu. */}
      <p className="inv-hint" style={{ textAlign: 'center' }}>
        <Warehouse size={12} style={{ verticalAlign: -2 }} />{' '}
        Counting stock, receiving deliveries and setting safety levels happen in{' '}
        <Link to="/ims/overview" style={{ color: 'var(--primary)', fontWeight: 600 }}>Inventory Management</Link>.
      </p>
    </div>
  );
}
