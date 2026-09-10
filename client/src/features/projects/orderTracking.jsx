import { useState } from 'react';
import { History, Send } from 'lucide-react';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { ClampText } from '../../components/ui/ClampText.jsx';

/**
 * Everything the Phase 6 order tracker and the single-order page share: the
 * status vocabulary, the row facts (status, due, late, received/pending), the
 * in-place editor and the who-changed-what history. One source, so the sheet
 * and the order's own page can never disagree about what "late" or "partly
 * received" means. Mirrors the server's orderFacts (procurementBrief.service).
 */

export const STAGE_KEY = 'p15';
export const BOQ_STAGE = 'p13';
export const STATUSES = ['Ordered', 'Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged', 'Cancelled'];
export const CLOSED = new Set(['Received (GRN)', 'Cancelled']);
export const MOVED = new Set(['Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged']);
export const NOT_SENT = 'Not sent yet';

export const TONE = {
  [NOT_SENT]: { color: 'var(--text-subtle)', soft: 'var(--surface-2)' },
  Ordered: { color: 'var(--primary)', soft: 'color-mix(in srgb, var(--primary) 12%, transparent)' },
  Dispatched: { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  Delivered: { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  'Partly Received': { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  'Received (GRN)': { color: 'var(--success)', soft: 'var(--success-soft)' },
  'Short / Damaged': { color: 'var(--danger)', soft: 'var(--danger-soft, #FEE2E2)' },
  Cancelled: { color: 'var(--text-subtle)', soft: 'var(--surface-2)' },
};

export const FILTERS = [
  { key: 'all', label: 'All' },
  { key: NOT_SENT, label: 'Not sent' },
  { key: 'Ordered', label: 'Ordered' },
  { key: 'Dispatched', label: 'Dispatched' },
  { key: 'Delivered', label: 'Delivered' },
  { key: 'Partly Received', label: 'Partly received' },
  { key: 'Received (GRN)', label: 'Received' },
  { key: 'late', label: 'Late' },
];

/** The fields the Update panel edits, in the order a person fills them. */
export const EDIT_FIELDS = [
  { group: 'Paperwork', fields: [
    { key: 'po_number', label: 'PO number', type: 'text' },
    { key: 'indent_number', label: 'Indent number', type: 'text' },
    { key: 'promised_delivery', label: 'Vendor promised delivery', type: 'date' },
  ] },
  { group: 'Dispatch (from the vendor)', fields: [
    { key: 'dispatch_date', label: 'Dispatched on', type: 'date' },
    { key: 'transporter', label: 'Transporter', type: 'text' },
    { key: 'lr_docket', label: 'LR / docket no.', type: 'text' },
    { key: 'delivery_challan_no', label: 'Delivery challan no.', type: 'text' },
  ] },
  { group: 'Receipt (at site)', fields: [
    { key: 'received_date', label: 'Received on', type: 'date' },
    { key: 'received_quantity', label: 'Quantity received', type: 'number' },
    { key: 'grn_number', label: 'GRN number', type: 'text' },
    { key: 'shortage_note', label: 'Short / damaged — details', type: 'textarea' },
  ] },
  { group: 'Notes', fields: [
    { key: 'tracking_remarks', label: 'Remarks', type: 'textarea' },
  ] },
];

export const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const has = (v) => v !== undefined && v !== null && v !== '';
export const inr = (v) => `₹${num(v).toLocaleString('en-IN')}`;
export const dayDiff = (a, b) => Math.round((new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / 86400000);
/** Today's date as the user sees it (local), not UTC — after 18:30 IST the ISO date is already "yesterday". */
export const todayLocal = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const poNumberOf = (r) => r.values?.po_number || `PO-${String(r.seq ?? 0).padStart(3, '0')}`;

/** Everything the row shows, derived once from the record. Mirrors the server's orderFacts. */
export function factsOf(r, today = new Date()) {
  const v = r.values || {};
  /* GUARDED. `sent_whatsapp_at` is also a plain text box on the Phase 5 BOQ
     form, and four rows in this database hold the literal string "+91 " in
     it. Read raw, that is truthy: the order reported itself as SENT, took
     the status "Ordered", and the company pipeline counted it under "PO
     raised" for a message nobody had sent. sentAtOf is defined below for
     exactly this and was simply never wired in here. */
  const sentAt = sentAtOf(v.sent_whatsapp_at) || sentAtOf(v.sent_email_at);
  const status = v.order_status || (sentAt ? 'Ordered' : NOT_SENT);
  const due = v.promised_delivery || v.planned_end || null;
  const qty = num(v.quantity);
  const received = has(v.received_quantity) ? num(v.received_quantity) : null;
  const pending = received == null ? null : Math.max(qty - received, 0);
  /* The other half of the same question. `pending` clamps at zero because
     "still to come" cannot be negative — which is correct, and is exactly why
     an over-delivery vanished: it had nowhere to be counted. */
  const excess = received == null ? null : Math.max(received - qty, 0);
  const closed = CLOSED.has(status);
  const daysLate = due && !closed && dayDiff(today, due) > 0 ? dayDiff(today, due) : 0;
  const receivedLate = v.received_date && due && dayDiff(v.received_date, due) > 0 ? dayDiff(v.received_date, due) : 0;
  const lastChange = (r.changeLog || []).at(-1);
  return {
    po: poNumberOf(r), status, due, qty, received, pending, excess, closed, daysLate, receivedLate,
    moved: MOVED.has(status), sent: Boolean(sentAt),
    amount: has(v.amount) ? num(v.amount) : qty * num(v.rate),
    lastBy: lastChange?.by?.name || r.updatedBy?.name || null,
    lastAt: lastChange?.at || r.updatedAt,
  };
}

/** Who stamped a given tracking field — the most recent changeLog entry for it. */
/**
 * A send timestamp, but only if it really is one.
 *
 * `sent_whatsapp_at` / `sent_email_at` are written by the order page when a PO
 * is actually sent — but they are ALSO plain text fields on the Phase 5 BOQ
 * form, so anybody filling the BOQ can type into them. Somebody put a phone
 * number ("+91 ") in "WhatsApp sent at", and the tracker duly reported the
 * order as sent, dated 01 Jan 00:00, for an order nobody had sent.
 *
 * Anything that is not a real, parseable date is treated as not sent. The
 * fields should not be on that form at all — this is the guard that holds
 * regardless, for the rows already carrying junk.
 */
export const sentAtOf = (value) => {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  // A bare number like "2024" parses; a send stamp is written as a full ISO
  // string, so anything without a date separator is not one of ours.
  if (!/[-/T:]/.test(String(value))) return null;
  return value;
};

/**
 * The vendor master row behind a name typed on a BOQ line.
 *
 * Exact match first, then a contained match — the vendor box is free text and
 * real entries carry stray spaces and suffixes ("santosh " for "santosh").
 * Anything looser would start matching the wrong supplier, which on a purchase
 * order means sending somebody else's money to them.
 */
export function matchVendor(vendors, name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  return vendors.find((r) => String(r.values?.vendor_name || '').trim().toLowerCase() === target)
    || vendors.find((r) => String(r.values?.vendor_name || '').toLowerCase().includes(target))
    || null;
}

export const stampedBy = (r, field) => [...(r.changeLog || [])].reverse().find((c) => c.field === field)?.by?.name || null;

export function OrderEditor({ record, facts, vendor, statusOptions, saving, onCancel, onSave, compact = false }) {
  const v = record.values || {};
  const initial = Object.fromEntries(EDIT_FIELDS.flatMap((g) => g.fields).map((f) => [f.key, has(v[f.key]) ? String(v[f.key]).slice(0, f.type === 'date' ? 10 : undefined) : '']));
  initial.order_status = ''; // '' = untouched: the status shown in the sheet stays unless the user picks one or the receipt works one out
  const [form, setForm] = useState(initial);
  const set = (k, val) => setForm((s) => ({ ...s, [k]: val }));

  const qty = facts.qty;
  const received = has(form.received_quantity) ? num(form.received_quantity) : null;
  const pending = received == null ? null : Math.max(qty - received, 0);
  const excess = received == null ? null : Math.max(received - qty, 0);
  const suggested = received == null ? null : received >= qty && qty > 0 ? 'Received (GRN)' : received > 0 ? 'Partly Received' : null;

  const submit = (e) => {
    e.preventDefault();
    const values = {};
    for (const [k, val] of Object.entries(form)) {
      if (k === 'order_status') continue;
      if (String(initial[k] ?? '') !== String(val ?? '')) values[k] = val === '' ? null : val;
    }
    // An untouched dropdown never writes a status back (it could be stale if
    // the status was changed elsewhere meanwhile); a worked-out status from the
    // received quantity applies unless the user chose one explicitly.
    const status = form.order_status || suggested || '';
    if (status && status !== (v.order_status || '')) values.order_status = status;
    if (pending != null && String(pending) !== String(v.pending_quantity ?? '')) values.pending_quantity = pending;
    if (values.received_quantity != null && !has(form.received_date)) values.received_date = todayLocal();
    if (!Object.keys(values).length) { onCancel(); return; }
    onSave(values);
  };

  return (
    <form className="pt-editor" onSubmit={submit}>
      {/* The order page shows these same facts and its own status control in
          the summary card directly above — repeating them here made the page
          read twice. The tracker keeps the head: there the editor opens inside
          a long sheet, away from any summary. */}
      {!compact && <div className="pt-editor-head">
        <div>
          <b>{facts.po}</b> · {record.title || v.item} · {v.quantity} {v.unit || ''} from <b>{v.vendor || '—'}</b>
          {vendor && (
            <span className="tiny muted"> · {[vendor.contact_person, vendor.contact_phone, vendor.email].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        <label className="pt-field" style={{ minWidth: 200 }}>
          <span>Status</span>
          <select className="pt-select" value={form.order_status} onChange={(e) => set('order_status', e.target.value)}>
            <option value="">{suggested ? `Worked out: ${suggested}` : facts.status}</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>}
      <div className="pt-editor-grid">
        {EDIT_FIELDS.map((g) => (
          <fieldset key={g.group} className="pt-group">
            <legend>{g.group}</legend>
            <div className="pt-group-fields">
              {g.fields.map((f) => (
                <label key={f.key} className={`pt-field${f.type === 'textarea' ? ' pt-field--wide' : ''}`}>
                  <span>{f.label}</span>
                  {f.type === 'textarea'
                    ? <textarea rows={2} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                    : <input type={f.type} value={form[f.key]} onChange={(e) => set(f.key, e.target.value)} min={f.type === 'number' ? 0 : undefined} step={f.type === 'number' ? 'any' : undefined} />}
                </label>
              ))}
            </div>
            {g.group.startsWith('Receipt') && (
              <div className="pt-pending">
                Ordered <b>{qty || '?'}</b>
                {received != null && <> · received <b>{received}</b> · pending <b>{pending}</b></>}
                {excess > 0 && (
                  <> · <span className="pt-over-note"><b>{excess} more than ordered</b> — say why below</span></>
                )}
                {suggested && <> → status <b>{suggested}</b></>}
              </div>
            )}
          </fieldset>
        ))}
      </div>
      <div className="pt-editor-foot">
        <span className="tiny muted">Only what you change is saved, with your name and the time.</span>
        <div className="row gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </form>
  );
}
export function OrderHistory({ record }) {
  const log = [...(record.changeLog || [])].reverse();
  const fmt = (x) => (x == null ? '—' : /^\d{4}-\d{2}-\d{2}T/.test(String(x)) ? fmtDateTime(x) : /^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? fmtDate(x) : String(x));
  return (
    <div className="pt-history">
      <div className="pt-history-head"><History size={14} /> Who changed what</div>
      {log.length === 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>Nothing tracked on this order yet.</p>
      ) : (
        <ul>
          {log.map((c, i) => (
            <li key={i}>
              <span className="pt-history-when">{fmtDateTime(c.at)}</span>
              <span className="pt-history-who">{c.by?.name || 'Someone'}</span>
              <span className="pt-history-what">
                {c.label}: <s className="muted">{fmt(c.from)}</s> → <b>{fmt(c.to)}</b>
                {c.note && <span className="tiny muted"> · {c.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(record.comments || []).length > 0 && (
        <>
          <div className="pt-history-head" style={{ marginTop: 10 }}><Send size={14} /> Send log</div>
          <ul>
            {[...record.comments].reverse().map((c) => (
              <li key={c._id || c.createdAt}>
                <span className="pt-history-when">{fmtDateTime(c.createdAt)}</span>
                <span className="pt-history-who">{c.author?.name || ''}</span>
                {/* A send-log entry can be the whole message that went out, so
                    it is clamped to three lines with a "View more" that opens
                    the rest in place — this is a panel, not a table row, so
                    nothing below it loses its position when it grows. */}
                <ClampText as="span" lines={3} className="pt-history-what">
                  {c.body}
                </ClampText>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * "What should I chase today?" — a saved brief shows instantly; Refresh pays
 * for a new one. Advice over the rows above; it changes nothing.
 */