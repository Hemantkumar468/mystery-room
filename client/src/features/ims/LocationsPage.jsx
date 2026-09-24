import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Warehouse, Plus, Pencil, Archive, RotateCcw, AlertTriangle, X as XIcon, MapPin, Phone,
  ArrowRight, ShieldCheck, RefreshCw,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useImsLocations, useCreateImsLocation, useUpdateImsLocation, useCloseImsLocation, useRecountStock,
} from './imsHooks.js';
import { LOCATION_TYPES } from '../../app/api/imsApi.js';
import { n } from '../master/inventoryUi.jsx';
import { LocationIcon } from './imsUi.jsx';

/**
 * Inventory → Locations — the places stock sits.
 *
 * Route: /ims/locations
 *
 * The central store, and one row per centre after that. Mystery Rooms runs
 * outlets in a dozen cities, several of them franchise-owned, and "how many
 * fog machines have we got" has a different answer in each — which is the
 * whole reason stock is counted per location rather than as one number.
 *
 * A LOCATION IS NOT A PROJECT. A project is the BUILD of a centre and finishes
 * at launch; a location is the centre once it is running, and it outlives its
 * project by years. The central warehouse was never a project at all. See the
 * note on inventoryLocation.model.js.
 *
 * CLOSING NEVER DELETES. A centre that shut last year still has to answer
 * "what did we send it, and what came back" — its stock rows and its ledger
 * are that answer, so closing only stops it being offered for new movements.
 */

const blank = {
  name: '', code: '', type: 'outlet', city: '', address: '',
  contactName: '', contactPhone: '', notes: '',
};

export default function LocationsPage() {
  const user = useAppSelector(selectCurrentUser);
  const canManage = can.manage(user?.role);

  const [showClosed, setShowClosed] = useState(false);
  const { data: raw, isLoading, isError } = useImsLocations(showClosed ? { includeInactive: true } : {});
  const create = useCreateImsLocation();
  const update = useUpdateImsLocation();
  const close = useCloseImsLocation();
  const recount = useRecountStock();

  const [editing, setEditing] = useState(null);   // location | 'new'
  const [form, setForm] = useState(blank);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const locations = raw?.data ?? raw ?? [];

  const openNew = () => { setForm(blank); setEditing('new'); setError(null); };
  const openEdit = (l) => {
    setForm(Object.fromEntries(Object.keys(blank).map((k) => [k, l[k] ?? ''])));
    setEditing(l);
    setError(null);
  };

  /** "Mystery Rooms Gurgaon" → "MYSTERYROOMSG" is useless; the initials are not.
      Suggested only, and only while the field is untouched — a code somebody
      typed is never overwritten by one we guessed. */
  const suggestCode = (name) => String(name)
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(mystery|rooms|the|of)$/i.test(w))
    .map((w) => w.slice(0, 3))
    .join('')
    .toUpperCase()
    .slice(0, 8);

  const save = async () => {
    setError(null);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v ?? '').trim()]));
    if (!body.name) { setError('The location needs a name.'); return; }
    if (!body.code) body.code = suggestCode(body.name);
    if (!body.code) { setError('The location needs a short code — it goes on every movement line.'); return; }

    try {
      if (editing === 'new') await create.mutateAsync(body);
      else await update.mutateAsync({ id: editing._id, ...body });
      setEditing(null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not save that.');
    }
  };

  const toggleActive = async (l) => {
    setError(null);
    try {
      if (l.active === false) {
        await update.mutateAsync({ id: l._id, active: true });
        setFlash(`${l.name} reopened.`);
      } else {
        const res = await close.mutateAsync(l._id);
        setFlash(res?.message || `${l.name} closed.`);
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change that.');
    }
  };

  const doRecount = async () => {
    setError(null);
    try {
      const res = await recount.mutateAsync({});
      const payload = res?.data ?? res;
      setFlash(payload.fixed
        ? `${payload.fixed} of ${payload.checked} balances were out of step with the ledger and have been corrected.`
        : `All ${payload.checked} balances agree with the ledger.`);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not run the check.');
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <div className="content inv-page">
      <div className="inv-head">
        <div className="inv-head-left">
          <span className="inv-head-icon"><Warehouse size={22} /></span>
          <div style={{ minWidth: 0 }}>
            <h1 className="inv-head-title">Locations</h1>
            <p className="inv-head-sub">
              Every place stock sits — the central store, the company-run outlets and the
              franchise-run centres. Each holds its own count of each item and its own safety
              level, because six spares in a warehouse is prudent and six in one outlet is money
              in a cupboard.
            </p>
          </div>
        </div>

        <div className="inv-head-actions">
          <label className="row gap-1 tiny" style={{ alignItems: 'center', cursor: 'pointer', color: 'var(--text-subtle)' }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed
          </label>
          {canManage && (
            <>
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={recount.isPending} onClick={doRecount}
                title="Re-derive every cached balance from the movement ledger — the answer to “this count looks wrong”"
              >
                <RefreshCw size={15} /> {recount.isPending ? 'Checking…' : 'Verify balances'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNew}>
                <Plus size={15} /> Add location
              </button>
            </>
          )}
        </div>
      </div>

      {flash && (
        <div className="pt-alert inv-alert--ok">
          <ShieldCheck size={14} /> {flash}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setFlash(null)}><XIcon size={13} /></button>
        </div>
      )}
      {error && (
        <div className="pt-alert pt-alert--bad">
          <AlertTriangle size={14} /> {error}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setError(null)}><XIcon size={13} /></button>
        </div>
      )}

      {isLoading ? (
        <span className="tiny muted">Loading…</span>
      ) : isError ? (
        <EmptyState icon={AlertTriangle} title="Could not load the locations" hint="The inventory service didn’t respond." />
      ) : locations.length === 0 ? (
        <EmptyState
          icon={Warehouse}
          title="No locations yet"
          hint="Run `npm run seed:ims -w server -- --apply` to create the main warehouse and the city outlets, or add the first one here."
        />
      ) : (
        <div className="ims-locations">
          {locations.map((l) => (
            <div key={l._id} className={`ims-loc${l.active === false ? ' is-off' : ''}`}>
              <div className="ims-loc-top">
                <LocationIcon type={l.type} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="ims-loc-name">
                    {l.name}
                    {l.active === false && <span className="inv-tag inv-tag--archived" style={{ marginLeft: 6 }}>Closed</span>}
                  </div>
                  <div className="ims-loc-sub">
                    {l.code} · {LOCATION_TYPES.find((t) => t.value === l.type)?.label || l.type}
                    {l.city && <> · <MapPin size={10} style={{ verticalAlign: -1 }} /> {l.city}</>}
                  </div>
                  {l.contactName && (
                    <div className="ims-loc-sub">
                      <Phone size={10} style={{ verticalAlign: -1 }} /> {l.contactName}
                      {l.contactPhone && ` · ${l.contactPhone}`}
                    </div>
                  )}
                </div>
                {canManage && (
                  <span className="inv-actions" style={{ flex: 'none' }}>
                    <button type="button" className="btn btn-ghost btn-sm" title="Edit" onClick={() => openEdit(l)}>
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button" className="btn btn-ghost btn-sm"
                      style={l.active === false ? undefined : { color: 'var(--danger)' }}
                      title={l.active === false ? 'Reopen it' : 'Close — its stock and history stay readable'}
                      onClick={() => toggleActive(l)}
                    >
                      {l.active === false ? <RotateCcw size={13} /> : <Archive size={13} />}
                    </button>
                  </span>
                )}
              </div>

              <div className="ims-loc-stats">
                <span className="ims-loc-stat"><b>{n(l.skus)}</b><span>SKUs</span></span>
                <span className="ims-loc-stat"><b>{n(l.units)}</b><span>Units</span></span>
                <span className={`ims-loc-stat${l.lowCount ? ' is-warn' : ''}`}><b>{n(l.lowCount)}</b><span>Low</span></span>
                <span className={`ims-loc-stat${l.outCount ? ' is-bad' : ''}`}><b>{n(l.outCount)}</b><span>Out</span></span>
              </div>

              <Link to={`/ims/stock?location=${l._id}`} className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>
                Open its stock <ArrowRight size={11} style={{ verticalAlign: -1 }} />
              </Link>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'Add a location' : `Edit ${editing.name}`}
          subtitle="A place stock sits — each keeps its own count and its own safety levels."
          width={580}
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
            {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
            <div className="po-ccbcc">
              <label className="pt-field"><span>Name *</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    /* Only while the code is untouched — a code somebody typed
                       is never overwritten by one we guessed. */
                    setForm((f) => ({ ...f, name, code: f.code || '' }));
                  }}
                  onBlur={() => setForm((f) => ({ ...f, code: f.code || suggestCode(f.name) }))}
                  placeholder="e.g. Mystery Rooms Pune"
                />
              </label>
              <label className="pt-field"><span>Code *</span>
                <input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="PUN"
                  maxLength={20}
                />
              </label>
              <label className="pt-field"><span>Kind</span>
                <select className="select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  {LOCATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="pt-field"><span>City</span>
                <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Contact name</span>
                <input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
              </label>
              <label className="pt-field"><span>Contact phone</span>
                <input value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
              </label>
            </div>
            <label className="pt-field"><span>Address</span>
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </label>
            <label className="pt-field"><span>Notes</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <span className="tiny muted">
              {LOCATION_TYPES.find((t) => t.value === form.type)?.hint} The code appears on every
              movement line, so keep it short and recognisable.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
