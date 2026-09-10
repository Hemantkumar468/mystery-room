import { useMemo, useState } from 'react';
import { AlertTriangle, PackageCheck, RotateCcw, X } from 'lucide-react';
import { has, num, inr } from '../projects/orderTracking.jsx';

/**
 * Move one order along, and decide what happens when less arrives than was
 * ordered — without leaving the sheet.
 *
 * WHAT THIS WRITES ARE TRACKER FIELDS, all of them already on the Phase 5 BOQ
 * form: order_status, received_date, received_quantity, pending_quantity,
 * grn_number, shortage_note, received_by. Nothing here is a new field and
 * nothing here is a new endpoint — an approved BOQ line stays frozen, and its
 * receipt story is written around it, which is the rule the order page has
 * always followed.
 *
 * THE SHORTFALL IS THE POINT. 200 ordered, 190 arrived: the ten that did not
 * come are not an error to be tidied away, they are a decision somebody has to
 * make. Two answers are offered, and the panel refuses to guess between them:
 *
 *   Reorder the balance — a NEW BOQ line for the ten, same item, same vendor,
 *     carrying a note saying which PO it is short against. It enters the flow
 *     at step one and gets its own PO, its own tracking and its own GRN, so
 *     "how many times did we chase this" stays answerable.
 *   Close it short — the ten are written off. The line closes at 190 with the
 *     reason recorded, because a shortfall accepted silently is one nobody can
 *     explain a month later.
 */

/** The statuses somebody sets by hand, in the order things happen. */
const STATUSES = ['Ordered', 'Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged', 'Cancelled'];

/** A GRN number that reads as one, from the PO it belongs to. */
function suggestGrn(po, existing) {
  const base = `GRN-${(po || 'PO').replace(/^GRN-/, '')}`;
  const d = new Date();
  const stamp = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let n = `${base}-${stamp}`;
  let i = 2;
  while (existing.has(n)) { n = `${base}-${stamp}-${i}`; i += 1; }
  return n;
}

export function ReceivePanel({ row, existingGrns, busy, error, onClose, onSave, onReorder }) {
  const { r, f, project } = row;
  const v = r.values || {};

  const [status, setStatus] = useState(f.status === 'Not sent yet' ? 'Ordered' : f.status);
  const [received, setReceived] = useState(has(v.received_quantity) ? String(num(v.received_quantity)) : '');
  const [when, setWhen] = useState(v.received_date ? String(v.received_date).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [grn, setGrn] = useState(v.grn_number || '');
  const [note, setNote] = useState(v.shortage_note || '');
  const [by, setBy] = useState(v.received_by || '');
  /* Only asked once there IS a shortfall, and never pre-answered. */
  const [shortPlan, setShortPlan] = useState('');

  const qty = f.qty;
  const got = received === '' ? null : num(received);
  const short = got == null ? 0 : Math.max(qty - got, 0);
  const over = got == null ? 0 : Math.max(got - qty, 0);
  const rate = num(v.rate);

  /* The number is what decides the status, not the other way round: somebody
     who types 190 of 200 has told you it is short whatever the box says. */
  const suggested = useMemo(() => {
    if (got == null) return null;
    if (short > 0) return 'Short / Damaged';
    return 'Received (GRN)';
  }, [got, short]);

  const grnClash = grn.trim() && grn.trim() !== (v.grn_number || '') && existingGrns.has(grn.trim());
  const needsPlan = short > 0 && !shortPlan;
  const canSave = !busy && !grnClash && !needsPlan
    && (got == null || (Number.isFinite(got) && got >= 0));

  const save = () => {
    const values = { order_status: status };
    if (got != null) {
      values.received_quantity = got;
      values.pending_quantity = short;
      values.received_date = when;
    }
    if (grn.trim()) values.grn_number = grn.trim();
    if (note.trim()) values.shortage_note = note.trim();
    if (by.trim()) values.received_by = by.trim();
    onSave({ values, shortPlan: short > 0 ? shortPlan : null, short });
  };

  return (
    <>
      <button type="button" className="pu-scrim" aria-label="Close" onClick={onClose} />
      <aside className="pu-recv" role="dialog" aria-modal="true" aria-label="Receive this order">
        <button type="button" className="pu-recv-x" onClick={onClose} aria-label="Close"><X size={16} /></button>

        <p className="pu-recv-id">{project.name}{project.city ? ` · ${project.city}` : ''} · {f.po}</p>
        <h2 className="pu-recv-title">{r.title || v.item || 'Untitled line'}</h2>

        {/* Ordered against received, said plainly and in one place. */}
        <div className="pu-recv-sums">
          <span><b>{qty || '—'}</b> ordered{v.unit ? ` ${v.unit}` : ''}</span>
          <span><b>{got == null ? '—' : got}</b> received</span>
          {short > 0 && <span className="is-short"><b>{short}</b> short</span>}
          {over > 0 && <span className="is-over"><b>{over}</b> more than ordered</span>}
        </div>

        <label className="pt-field">
          <span>Order status</span>
          <select className="pt-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {suggested && suggested !== status && (
            <button type="button" className="pu-recv-hint" onClick={() => setStatus(suggested)}>
              {short > 0
                ? `${got} of ${qty} arrived — set “${suggested}”?`
                : `The full ${qty} arrived — set “${suggested}”?`}
            </button>
          )}
        </label>

        <div className="pu-recv-grid">
          <label className="pt-field">
            <span>Quantity received</span>
            <input
              className="pt-input"
              type="number"
              min="0"
              value={received}
              placeholder={qty ? String(qty) : ''}
              onChange={(e) => setReceived(e.target.value)}
            />
          </label>
          <label className="pt-field">
            <span>Received on</span>
            <input className="pt-input" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label className="pt-field">
            <span>GRN number</span>
            <input
              className="pt-input"
              value={grn}
              placeholder="not booked"
              onChange={(e) => setGrn(e.target.value)}
            />
            {!grn && (
              <button type="button" className="pu-recv-hint" onClick={() => setGrn(suggestGrn(f.po, existingGrns))}>
                Use {suggestGrn(f.po, existingGrns)}
              </button>
            )}
            {grnClash && <span className="pu-recv-bad"><AlertTriangle size={12} /> That GRN number is already used.</span>}
          </label>
          <label className="pt-field">
            <span>Received by</span>
            <input className="pt-input" value={by} placeholder="who signed for it" onChange={(e) => setBy(e.target.value)} />
          </label>
        </div>

        {/* THE DECISION. Only when there is a shortfall, and it has no default:
            reordering ten units and writing ten units off are different
            answers, and neither is the safe one to assume. */}
        {short > 0 && (
          <div className="pu-recv-short">
            <p className="pu-recv-short-t">
              <AlertTriangle size={13} /> {short} short of {qty}
              {rate > 0 && <span className="tiny muted"> · {inr(short * rate)} not delivered</span>}
            </p>
            <p className="tiny muted">What happens to the {short} that did not arrive?</p>
            <div className="pu-recv-choices">
              <button
                type="button"
                className={`pu-recv-choice${shortPlan === 'reorder' ? ' is-on' : ''}`}
                onClick={() => setShortPlan('reorder')}
              >
                <RotateCcw size={14} />
                <span>
                  <b>Reorder the balance</b>
                  <em>A new BOQ line for {short}, same item and vendor — it gets its own PO and GRN.</em>
                </span>
              </button>
              <button
                type="button"
                className={`pu-recv-choice${shortPlan === 'close' ? ' is-on' : ''}`}
                onClick={() => setShortPlan('close')}
              >
                <PackageCheck size={14} />
                <span>
                  <b>Close it short</b>
                  <em>The {short} are written off. The line closes at {got} with your reason below.</em>
                </span>
              </button>
            </div>
          </div>
        )}

        <label className="pt-field">
          <span>
            {short > 0 ? 'Why it was short' : 'Note'} <span className="tiny muted">{short > 0 ? 'goes on the line' : 'optional'}</span>
          </span>
          <textarea
            className="pt-input"
            rows={2}
            value={note}
            placeholder={short > 0 ? 'damaged in transit, vendor short-supplied…' : ''}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <p className="pu-recv-bad"><AlertTriangle size={13} /> {error}</p>}

        <div className="pu-recv-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : shortPlan === 'reorder' ? `Save and reorder ${short}` : 'Save'}
          </button>
        </div>
        {needsPlan && (
          <p className="tiny muted" style={{ textAlign: 'right' }}>
            Choose what happens to the {short} short before saving.
          </p>
        )}
      </aside>
    </>
  );
}

export default ReceivePanel;
