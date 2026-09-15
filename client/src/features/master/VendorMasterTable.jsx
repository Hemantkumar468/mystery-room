import { useMemo, useState } from 'react';
import {
  Search, Plus, Pencil, Trash2, AlertTriangle, Handshake, Check, X as XIcon,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useVendorMaster, useCreateMasterVendor, useUpdateMasterVendor, useDeleteMasterVendor,
} from '../../app/api/vendorMasterApi.js';

/**
 * The supply vendor master, as a spreadsheet.
 *
 * This list came off SHEET/F Vendor.xlsx and the people who maintain it have
 * been maintaining it in Excel, so it is laid out the way they already read it:
 * one row per supplier, columns left to right in the sheet's own order, the
 * header and the row number pinned while the rest scrolls sideways. The two
 * habits that carry over from the spreadsheet are the ones worth keeping —
 * click a cell and type into it, and tab along the row — so both work here.
 *
 * WHY BOTH INLINE EDITING AND A FORM. They answer different questions. Fixing
 * one wrong digit in a phone number should not be a dialog; adding a supplier
 * means filling in eight fields at once and wants a form with labels. The grid
 * does the first, the row's Edit button opens the second, and both write
 * through the same PATCH.
 *
 * DELETE REALLY DELETES. See the note on the DELETE route — nothing references
 * a row here by id, orders store the vendor's name as text, and a phone list
 * you cannot take a dead number out of stops being trusted.
 */

/** Columns, left to right, in the sheet's own order. */
const COLUMNS = [
  { key: 'item', label: 'Item', width: 190, hint: 'What we buy' },
  { key: 'vendorName', label: 'Vendor', width: 210, hint: 'The firm, as it should read on a PO' },
  { key: 'contactNumber', label: 'Contact', width: 125 },
  { key: 'contactPerson', label: 'Person', width: 140 },
  { key: 'email', label: 'Email', width: 175 },
  { key: 'city', label: 'City', width: 105 },
  { key: 'gst', label: 'GST', width: 135 },
  { key: 'notes', label: 'Notes', width: 190 },
];

/** The two the sheet insists on — a row without them is not a vendor. */
const REQUIRED = ['item', 'vendorName'];

const blank = {
  item: '', vendorName: '', contactNumber: '', contactPerson: '',
  email: '', city: '', gst: '', notes: '',
};

export default function VendorMasterTable() {
  const user = useAppSelector(selectCurrentUser);
  const canManage = can.manage(user?.role);

  const { data, isLoading, isError } = useVendorMaster();
  const create = useCreateMasterVendor();
  const update = useUpdateMasterVendor();
  const remove = useDeleteMasterVendor();

  const [search, setSearch] = useState('');
  /* Three filters beside the search box, because "find it" and "narrow it
     down" are different jobs. Search answers "where is Utsav Trading?"; these
     answer "show me everything under Balloon", "everyone in Delhi", and the
     one nobody can ask a spreadsheet — "which rows are still missing a phone
     number?", which is the question that keeps a master trustworthy. */
  const [itemFilter, setItemFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [completeness, setCompleteness] = useState(''); // '' | 'missing' | 'complete'
  const [editing, setEditing] = useState(null);   // vendor | 'new'
  const [form, setForm] = useState(blank);
  const [formError, setFormError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  // The one cell currently being typed into: { id, key }. Null the rest of the time.
  const [cell, setCell] = useState(null);
  const [draft, setDraft] = useState('');
  // A failed inline save has nowhere to put its message — the dialog it would
  // have gone in is the thing we skipped — so it sits above the grid instead.
  const [gridError, setGridError] = useState(null);

  const vendors = data?.data || data || [];

  /** The distinct values each dropdown offers, taken from the data itself. */
  const options = useMemo(() => {
    const uniq = (key) => [...new Set(vendors.map((v) => (v[key] || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    return { items: uniq('item'), cities: uniq('city') };
  }, [vendors]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (q && ![v.item, v.vendorName, v.contactNumber, v.contactPerson, v.email, v.city, v.gst, v.notes]
        .filter(Boolean).join(' ').toLowerCase().includes(q)) return false;
      if (itemFilter && (v.item || '').trim() !== itemFilter) return false;
      if (cityFilter && (v.city || '').trim() !== cityFilter) return false;
      // "Reachable" is the only completeness that matters on a supply list:
      // a row you cannot ring is a row you cannot order from.
      const reachable = Boolean((v.contactNumber || '').trim() || (v.email || '').trim());
      if (completeness === 'missing' && reachable) return false;
      if (completeness === 'complete' && !reachable) return false;
      return true;
    });
  }, [vendors, search, itemFilter, cityFilter, completeness]);

  const activeFilters = [search.trim(), itemFilter, cityFilter, completeness].filter(Boolean).length;
  const clearFilters = () => { setSearch(''); setItemFilter(''); setCityFilter(''); setCompleteness(''); };

  const totals = useMemo(() => ({
    vendors: vendors.length,
    items: new Set(vendors.map((v) => (v.item || '').trim().toLowerCase()).filter(Boolean)).size,
    firms: new Set(vendors.map((v) => (v.vendorName || '').trim().toLowerCase()).filter(Boolean)).size,
    unreachable: vendors.filter((v) => !(v.contactNumber || '').trim() && !(v.email || '').trim()).length,
  }), [vendors]);

  /* ── the form ──────────────────────────────────────────────────────── */

  const openNew = () => { setForm(blank); setEditing('new'); setFormError(null); };
  const openEdit = (v) => {
    setForm(Object.fromEntries(Object.keys(blank).map((k) => [k, v[k] ?? ''])));
    setEditing(v);
    setFormError(null);
  };

  const save = async () => {
    setFormError(null);
    const body = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]),
    );
    const missing = REQUIRED.filter((k) => !body[k]);
    if (missing.length) {
      setFormError(missing.length === 2
        ? 'A row needs both the item and the vendor.'
        : `${missing[0] === 'item' ? 'The item' : 'The vendor name'} is missing.`);
      return;
    }
    try {
      if (editing === 'new') await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing._id, ...body });
      setEditing(null);
    } catch (err) {
      setFormError(err?.response?.data?.message || 'Could not save that.');
    }
  };

  const doDelete = async () => {
    try {
      await remove.mutateAsync(confirmDelete._id);
      setConfirmDelete(null);
    } catch (err) {
      setGridError(err?.response?.data?.message || 'Could not remove that row.');
      setConfirmDelete(null);
    }
  };

  /* ── inline editing ────────────────────────────────────────────────── */

  const startCell = (v, key) => {
    if (!canManage) return;
    setGridError(null);
    setCell({ id: v._id, key });
    setDraft(v[key] ?? '');
  };

  const cancelCell = () => { setCell(null); setDraft(''); };

  /**
   * Commit the cell being edited.
   *
   * Returns false when the value was refused, so Tab can keep the caret where
   * it is rather than walking on and leaving a rejected edit behind.
   */
  const commitCell = async () => {
    if (!cell) return true;
    const row = vendors.find((v) => v._id === cell.id);
    const next = draft.trim();
    const prev = (row?.[cell.key] ?? '').toString();
    if (!row || next === prev.trim()) { cancelCell(); return true; }
    if (REQUIRED.includes(cell.key) && !next) {
      setGridError(`${cell.key === 'item' ? 'The item' : 'The vendor name'} cannot be emptied — delete the row instead.`);
      return false;
    }
    // Cleared first so the grid never shows a stale input over fresh data if
    // the request is slow; a refusal puts the message above the grid.
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
  const onCellKeyDown = async (e, v) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelCell(); return; }
    if (e.key === 'Enter') { e.preventDefault(); await commitCell(); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = COLUMNS.findIndex((c) => c.key === cell?.key);
      const nextCol = COLUMNS[i + (e.shiftKey ? -1 : 1)];
      const ok = await commitCell();
      if (ok && nextCol) startCell(v, nextCol.key);
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <>
      <section className="card vm-card">
        <div className="vm-head">
          <div className="vm-head-title">
            <h2 className="card-title">Vendor master</h2>
            {/* The counts, inline. They were three dashboard cards the height of
                the toolbar — a supply list of two dozen rows does not have a
                headline figure worth that much of the screen, and they pushed
                the grid itself below the fold. */}
            <div className="vm-stats">
              <span className="vm-stat"><b>{totals.vendors}</b> rows</span>
              <span className="vm-stat"><b>{totals.items}</b> items</span>
              <span className="vm-stat"><b>{totals.firms}</b> firms</span>
              {totals.unreachable > 0 && (
                <button
                  type="button"
                  className="vm-stat is-warn"
                  title="Show the rows with neither a phone number nor an email"
                  onClick={() => setCompleteness(completeness === 'missing' ? '' : 'missing')}
                >
                  <b>{totals.unreachable}</b> with no contact
                </button>
              )}
            </div>
          </div>
          {canManage && (
            <button type="button" className="btn btn-primary btn-sm" onClick={openNew} data-guide="vendor-master-add">
              <Plus size={14} /> Add a vendor
            </button>
          )}
        </div>

        <div className="vm-filters">
          <label className="vm-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search any column…"
            />
          </label>

          <label className="vm-filter">
            <span>Item</span>
            <select className="select" value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}>
              <option value="">All items</option>
              {options.items.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>

          {/* Offered only once a city has actually been filled in — an empty
              dropdown is a promise the data cannot keep. */}
          {options.cities.length > 0 && (
            <label className="vm-filter">
              <span>City</span>
              <select className="select" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
                <option value="">All cities</option>
                {options.cities.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          )}

          <label className="vm-filter">
            <span>Contact</span>
            <select className="select" value={completeness} onChange={(e) => setCompleteness(e.target.value)}>
              <option value="">Any</option>
              <option value="complete">Reachable</option>
              <option value="missing">No contact</option>
            </select>
          </label>

          {activeFilters > 0 && (
            <button type="button" className="vm-clear" onClick={clearFilters}>
              <XIcon size={12} /> Clear {activeFilters} filter{activeFilters === 1 ? '' : 's'}
              <span className="vm-clear-count">{visible.length} of {vendors.length}</span>
            </button>
          )}
        </div>

        <p className="vm-hint">
          {canManage
            ? 'Click a cell to edit it in place — Enter saves, Escape reverts, Tab moves along the row. The Vendor column feeds every BOQ and work-order vendor dropdown.'
            : 'The company supply list. The Vendor column feeds every BOQ and work-order vendor dropdown.'}
        </p>

        {gridError && (
          <div className="pt-alert pt-alert--bad" style={{ marginBottom: 8 }}>
            <AlertTriangle size={14} /> {gridError}
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setGridError(null)}>
              <XIcon size={13} />
            </button>
          </div>
        )}

        {isLoading ? <SkTable rows={8} /> : isError ? (
          <EmptyState icon={AlertTriangle} title="Could not load the vendor master" hint="The vendor service didn’t respond." />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Handshake}
            title={vendors.length ? 'No vendor matches those filters' : 'No vendors yet'}
            hint={vendors.length
              ? 'Widen the search, or clear the filters above.'
              : 'Run `node src/seed/seedVendorMaster.js --apply` to load F Vendor.xlsx, or add the first vendor here.'}
          />
        ) : (
          <div className="vm-grid-wrap">
            <table className="vm-grid">
              <thead>
                <tr>
                  <th className="vm-col-sno" title="The sheet’s own S.no">S.no</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} style={{ minWidth: c.width }} title={c.hint}>{c.label}</th>
                  ))}
                  <th className="vm-col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((v, i) => (
                  <tr key={v._id}>
                    {/* The sheet's number where it had one, the row's own
                        position where it did not — never blank, because a
                        spreadsheet with a hole in column A reads as an error. */}
                    <td className="vm-col-sno">{v.serial ?? i + 1}</td>
                    {COLUMNS.map((c) => {
                      const active = cell?.id === v._id && cell?.key === c.key;
                      return (
                        <td
                          key={c.key}
                          className={`vm-cell${canManage ? ' is-editable' : ''}${active ? ' is-editing' : ''}`}
                          style={{ width: c.width }}
                          // Truncated in the cell, whole in the tooltip.
                          title={active ? undefined : (v[c.key] || '')}
                          onClick={() => !active && startCell(v, c.key)}
                        >
                          {active ? (
                            <input
                              className="vm-cell-input"
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => onCellKeyDown(e, v)}
                              onBlur={commitCell}
                            />
                          ) : (
                            /* The width is bounded HERE rather than on the cell:
                               the table sizes itself to its content (`width:
                               max-content`), so a `td` has no definite width for
                               `text-overflow` to ellipsise against. */
                            <span
                              className={v[c.key] ? '' : 'vm-cell-empty'}
                              style={{ maxWidth: c.width - 20 }}
                            >
                              {v[c.key] || '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="vm-col-actions">
                      {canManage ? (
                        <span className="pt-actions">
                          <button type="button" className="btn btn-ghost btn-sm" title="Edit the whole row" onClick={() => openEdit(v)}>
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ color: 'var(--danger)' }}
                            title="Remove from the master"
                            onClick={() => setConfirmDelete(v)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      ) : <span className="tiny muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'Add a vendor' : `Edit ${editing.vendorName}`}
          subtitle="Master data — every project picks from this list."
          width={560}
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
              <label className="pt-field"><span>Item *</span>
                <input
                  value={form.item}
                  onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))}
                  placeholder="e.g. Push Buttons"
                />
              </label>
              <label className="pt-field"><span>Vendor *</span>
                <input
                  value={form.vendorName}
                  onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))}
                  placeholder="e.g. Bobby Video Game"
                />
              </label>
              <label className="pt-field"><span>Contact number</span>
                <input value={form.contactNumber} onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Contact person</span>
                <input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Email</span>
                <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </label>
              <label className="pt-field"><span>City</span>
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </label>
              <label className="pt-field"><span>GST</span>
                <input value={form.gst} onChange={(e) => setForm((f) => ({ ...f, gst: e.target.value }))} />
              </label>
            </div>
            <label className="pt-field"><span>Notes</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <span className="tiny muted">
              The same firm can appear under more than one item — that is how the sheet lists Engenius Lab.
            </span>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Remove this vendor?"
          width={440}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={doDelete}>
                {remove.isPending ? 'Removing…' : 'Remove'}
              </button>
            </div>
          )}
        >
          <div className="col gap-2">
            <p className="sm">
              <b>{confirmDelete.vendorName}</b> will stop being offered for <b>{confirmDelete.item}</b>.
            </p>
            <p className="tiny muted">
              <Check size={11} /> Orders already placed with them keep reading exactly as they do now —
              a purchase order stores the vendor’s name, not a link to this row.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
