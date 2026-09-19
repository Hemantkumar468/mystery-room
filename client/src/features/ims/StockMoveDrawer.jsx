import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, ClipboardCheck, Trash2, AlertTriangle, Check, Info,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { MOVEMENT_KINDS, usePostMovement } from '../../app/api/imsApi.js';
import { n } from '../master/inventoryUi.jsx';
import { ItemPicker } from './imsUi.jsx';

/**
 * Put stock in, take stock out, or record a count — one drawer, three modes.
 *
 * ONE COMPONENT, THREE APPEARANCES, and the distinction matters. Receiving and
 * issuing are the same form with the sign flipped, which is precisely why they
 * must not LOOK the same: the entire cost of a mistake here is somebody
 * filling in the wrong one, and a shared screen with a direction toggle is an
 * invitation to do exactly that. So each mode is opened by its own button,
 * carries its own colour, its own verb and its own set of reasons, and the
 * mode cannot be switched from inside. The code is shared; the experience is
 * not.
 *
 * A DRAWER, not a dialog: it docks to the right and the stock table stays
 * visible beside it, so somebody can read the row they are acting on while
 * they type. That is the whole reason the increase and decrease actions were
 * asked for as a sidebar rather than a pop-up.
 *
 * A COUNT IS STATED, NOT CALCULATED. In `adjust` mode the field is "what is
 * actually on the shelf", and the drawer shows the difference it will make.
 * Asking somebody holding a clipboard to work out the delta themselves is
 * asking them to make the arithmetic mistake the count exists to catch.
 */

const ICON = { in: ArrowDownLeft, out: ArrowUpRight, adjust: ClipboardCheck };

const BLURB = {
  in: 'Adds to the count at this location. Every line is written to the ledger with your name against it.',
  out: 'Takes off the count at this location. An issue larger than what is there is refused, and says what is actually on the shelf.',
  adjust: 'Enter what the shelf ACTUALLY holds. The difference is written to the ledger as a correction, so the history shows both the old number and the new.',
};

export default function StockMoveDrawer({
  open, kind = 'in', onClose, location, locations = [], seedItem = null, onDone,
}) {
  const post = usePostMovement();

  const [locationId, setLocationId] = useState(location || '');
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const meta = MOVEMENT_KINDS[kind] || MOVEMENT_KINDS.in;
  const Icon = ICON[kind] || ArrowDownLeft;

  /* Re-seeded each time it opens rather than on mount: the drawer instance is
     kept alive between openings, and a form that remembers the last delivery
     is a form that quietly posts it twice. */
  useEffect(() => {
    if (!open) return;
    setLocationId(location || locations[0]?._id || '');
    setLines(seedItem ? [{ ...blankLine(), item: seedItem }] : []);
    setReason(meta.reasons[0]?.value || '');
    setReference('');
    setNote('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, location, seedItem]);

  const chosen = useMemo(() => lines.map((l) => l.item?._id).filter(Boolean), [lines]);

  const addItem = (item) => setLines((prev) => [...prev, { ...blankLine(), item }]);
  const setQty = (i, v) => setLines((prev) => prev.map((l, k) => (k === i ? { ...l, qty: v } : l)));
  const dropLine = (i) => setLines((prev) => prev.filter((_, k) => k !== i));

  /** The lines that will actually be sent. A blank quantity is an unfinished
      line, not a zero — sending it would write a no-op row to the ledger. */
  const ready = lines.filter((l) => l.item && l.qty !== '' && Number.isFinite(Number(l.qty)) && Number(l.qty) >= 0
    && (kind === 'adjust' || Number(l.qty) > 0));

  const totalUnits = ready.reduce((sum, l) => sum + Number(l.qty), 0);

  const submit = async () => {
    setError(null);
    if (!locationId) { setError('Pick the location this is happening at.'); return; }
    if (!ready.length) { setError(`Add at least one item and a ${kind === 'adjust' ? 'counted quantity' : 'quantity'}.`); return; }

    try {
      const res = await post.mutateAsync({
        location: locationId,
        type: kind,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        lines: ready.map((l) => (kind === 'adjust'
          ? { item: l.item._id, countedQty: Number(l.qty), reason }
          : { item: l.item._id, qty: Number(l.qty), reason })),
      });
      onDone?.(res?.data ?? res, kind, ready.length);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not record that.');
    }
  };

  if (!open) return null;

  const locationName = locations.find((l) => String(l._id) === String(locationId))?.name;

  return (
    <Modal
      open
      onClose={onClose}
      /* Centred, not docked to the right edge. Recording a movement is a task
         you finish and close, not a reference panel you keep open beside the
         table — and as a drawer it sat against one edge with the rows it was
         about hidden behind it. */
      width={760}
      title={meta.label}
      subtitle={locationName || 'Pick a location'}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={post.isPending || !ready.length}
            onClick={submit}
          >
            {post.isPending ? 'Saving…' : `${meta.verb} ${ready.length || ''} item${ready.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}
    >
      <div className="ims-drawer">
        <div className={`ims-drawer-kind ims-drawer-kind--${kind}`}>
          <Icon size={22} style={{ flex: 'none' }} />
          <span>
            <b>{meta.label}</b>
            <span>{BLURB[kind]}</span>
          </span>
        </div>

        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        <div className="po-ccbcc">
          <label className="pt-field"><span>Location *</span>
            <select className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Pick one…</option>
              {locations.map((l) => (
                <option key={l._id} value={l._id}>{l.name} ({l.code})</option>
              ))}
            </select>
          </label>
          <label className="pt-field"><span>Reason</span>
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              {meta.reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="pt-field"><span>Reference</span>
            <input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="PO number, challan, project…"
            />
          </label>
        </div>

        <div className="col gap-2">
          <h3 className="inv-section-title">Items</h3>
          <ItemPicker
            onPick={addItem}
            exclude={chosen}
            autoFocus={!seedItem}
            placeholder="Search an item by name or SKU to add a line…"
          />

          {lines.length === 0 ? (
            <p className="inv-hint">
              <Info size={12} style={{ verticalAlign: -2 }} /> Nothing on this {kind === 'adjust' ? 'count' : 'note'} yet —
              search above to add the first line. An item that has never been at this location is
              fine; receiving it creates its stock row.
            </p>
          ) : (
            <div className="ims-lines">
              {lines.map((l, i) => (
                <div key={l.item._id} className="ims-line">
                  <span className="ims-line-item">
                    <span className="ims-line-name" title={l.item.name}>{l.item.name}</span>
                    <span className="ims-line-meta">{l.item.sku}{l.item.unit ? ` · ${l.item.unit}` : ''}</span>
                  </span>
                  <input
                    type="number"
                    min={kind === 'adjust' ? 0 : 1}
                    step="1"
                    value={l.qty}
                    onChange={(e) => setQty(i, e.target.value)}
                    placeholder={kind === 'adjust' ? 'counted' : 'qty'}
                    aria-label={`Quantity for ${l.item.name}`}
                  />
                  <button type="button" className="ims-line-drop" onClick={() => dropLine(i)} title="Remove this line">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="pt-field"><span>Note</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the ledger should carry with this" />
        </label>

        {/* What is about to be committed, stated BEFORE the button rather than
            discovered after it. */}
        <div className="ims-drawer-total">
          <span>
            {ready.length
              ? <>{ready.length} line{ready.length === 1 ? '' : 's'} · {meta.gerund}</>
              : 'Nothing to record yet'}
          </span>
          <b>{kind === 'adjust' ? `${n(totalUnits)} counted` : `${kind === 'out' ? '−' : '+'}${n(totalUnits)}`}</b>
        </div>

        {kind === 'adjust' && ready.length > 0 && (
          <p className="inv-hint">
            <Check size={12} style={{ verticalAlign: -2 }} /> Each line is stored as the difference between
            what the system held and what you counted, so the ledger shows both.
          </p>
        )}
      </div>
    </Modal>
  );
}

const blankLine = () => ({ item: null, qty: '' });
