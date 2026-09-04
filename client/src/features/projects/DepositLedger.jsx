import { useMemo, useState } from 'react';
import {
  Wallet, Plus, Paperclip, Trash2, AlertTriangle, CheckCircle2, ArrowDownToLine, X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { useAddPayment, useRemovePayment, useUploadMedia, useStageRecords } from '../../app/api/recordsApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

/**
 * The deposit, as money actually received rather than a single number.
 *
 * A franchise security deposit is agreed once in the LOI and paid in parts —
 * a token now, the balance on signing, sometimes a third instalment weeks
 * later. The form had one Security Deposit box and one payment proof, so the
 * second instalment had nowhere to live and "how much have we actually
 * received?" was answerable only from somebody's inbox.
 *
 * This is the ledger: what was agreed, what has come in, what is still owed,
 * and every payment with its own reference and receipt.
 *
 * Deliberately simple. Three numbers at the top, one button, one table. The
 * arithmetic is done by the server from the entries themselves, so the running
 * total can never disagree with the list under it.
 */

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const MODES = ['NEFT/RTGS', 'Cheque', 'UPI', 'Cash', 'Bank Transfer', 'Other'];
const today = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export default function DepositLedger({ record, projectId }) {
  const user = useAppSelector(selectCurrentUser);
  const canEdit = can.capture(user?.role);
  const addPayment = useAddPayment(projectId, record?.stageKey);
  const removePayment = useRemovePayment(projectId, record?.stageKey);
  const upload = useUploadMedia();

  /* What the LOI agreed. Shown when this record has no agreed figure of its
     own, or disagrees with it — the two documents describing the same deposit
     should not quietly differ. */
  const { data: p3 } = useStageRecords(projectId, 'p3');
  const loiDeposit = useMemo(() => {
    const rows = p3?.data || p3 || [];
    const loi = rows.find((r) => r.assessmentType === 'loi' && r.values?.deposit_amount);
    return loi ? Number(loi.values.deposit_amount) : null;
  }, [p3]);

  const v = record?.values || {};
  const payments = useMemo(
    () => [...(v.deposit_payments || [])].sort((a, b) => new Date(a.paidOn || a.at) - new Date(b.paidOn || b.at)),
    [v.deposit_payments],
  );
  const agreed = Number(v.security_deposit) || 0;
  const received = payments.reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const balance = agreed ? Math.max(agreed - received, 0) : null;
  const over = agreed > 0 && received > agreed;
  const pct = agreed > 0 ? Math.min(100, Math.round((received / agreed) * 100)) : 0;

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const openForm = () => {
    setError(null);
    setForm({
      // The balance is what is usually being paid — offered, never forced.
      amount: balance ? String(balance) : '',
      paidOn: today(),
      mode: 'NEFT/RTGS',
      reference: '',
      note: '',
      proof: [],
    });
    setOpen(true);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const attach = async (files) => {
    setError(null);
    setBusy(true);
    try {
      const added = [];
      for (const file of [...files].slice(0, 5)) {
        const ref = await upload.mutateAsync({ file });
        added.push({ url: ref.url, publicId: ref.publicId, name: file.name, mimetype: file.type });
      }
      setForm((f) => ({ ...f, proof: [...f.proof, ...added] }));
    } catch (err) {
      setError(err?.response?.data?.message || 'That file could not be uploaded.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError(null);
    const amount = Number(String(form.amount).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter the amount received.'); return; }
    setBusy(true);
    try {
      await addPayment.mutateAsync({
        id: record._id,
        amount,
        paidOn: form.paidOn || undefined,
        mode: form.mode || undefined,
        reference: form.reference.trim() || undefined,
        note: form.note.trim() || undefined,
        proof: form.proof,
      });
      setOpen(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not record that payment.');
    } finally {
      setBusy(false);
    }
  };

  if (!record) return null;

  return (
    <section className="card dl-card">
      <div className="card-head">
        <h2 className="card-title"><Wallet size={16} /> Deposit received</h2>
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={openForm} data-guide="add-payment">
            <Plus size={14} /> Record a payment
          </button>
        )}
      </div>

      {/* The three numbers, and nothing else competing with them. */}
      <div className="dl-totals">
        <div className="dl-total">
          <span className="dl-total-label">Agreed</span>
          <span className="dl-total-value">{agreed ? inr(agreed) : '—'}</span>
          {!agreed && loiDeposit
            ? <span className="tiny muted">LOI says {inr(loiDeposit)} — set it in this form</span>
            : null}
          {agreed > 0 && loiDeposit && loiDeposit !== agreed && (
            <span className="tiny" style={{ color: 'var(--warning)' }}>
              LOI says {inr(loiDeposit)} — they disagree
            </span>
          )}
        </div>
        <div className="dl-total">
          <span className="dl-total-label">Received</span>
          <span className="dl-total-value is-ok">{inr(received)}</span>
          <span className="tiny muted">{payments.length} payment{payments.length === 1 ? '' : 's'}</span>
        </div>
        <div className="dl-total">
          <span className="dl-total-label">{over ? 'Received over' : 'Still to come'}</span>
          <span className={`dl-total-value ${over ? 'is-warn' : balance === 0 && agreed ? 'is-ok' : 'is-due'}`}>
            {agreed ? inr(over ? received - agreed : balance) : '—'}
          </span>
          {agreed > 0 && balance === 0 && !over && <span className="tiny" style={{ color: 'var(--success)' }}><CheckCircle2 size={11} /> Fully received</span>}
        </div>
      </div>

      {agreed > 0 && (
        <div className="dl-bar" title={`${pct}% received`}>
          <span style={{ width: `${pct}%`, background: over ? 'var(--warning)' : 'var(--success)' }} />
        </div>
      )}
      {over && (
        <div className="pt-alert">
          <AlertTriangle size={14} /> More has been received than the agreed deposit. Check the entries, or update the agreed figure.
        </div>
      )}

      {payments.length === 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          Nothing received yet. Use <b>Record a payment</b> as each instalment arrives — the balance keeps itself up to date.
        </p>
      ) : (
        <div className="pt-table-wrap">
          <table className="table dl-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Received on</th>
                <th>Amount</th>
                <th>How</th>
                <th>Reference</th>
                <th>Receipt</th>
                <th>Recorded by</th>
                {canEdit && <th style={{ width: 44 }} />}
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={p.id || i}>
                  <td className="muted">{i + 1}</td>
                  <td className="pt-nowrap">{fmtDate(p.paidOn)}</td>
                  <td className="pt-nowrap"><b>{inr(p.amount)}</b></td>
                  <td className="pt-nowrap">{p.mode || '—'}</td>
                  <td className="pt-nowrap">{p.reference || '—'}</td>
                  <td className="pt-nowrap">
                    {(p.proof || []).length === 0 ? <span className="muted">—</span> : (p.proof || []).map((f, k) => (
                      <a key={k} className="tiny" href={f.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', marginRight: 8 }}>
                        <Paperclip size={11} /> {f.name || `file ${k + 1}`}
                      </a>
                    ))}
                  </td>
                  <td className="pt-nowrap tiny muted">{p.byName || '—'}<br />{p.at ? fmtDateTime(p.at) : ''}</td>
                  {canEdit && (
                    <td>
                      <button
                        type="button" className="btn btn-ghost btn-sm" title="Remove this entry"
                        onClick={() => setConfirmDelete(p)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {payments.length > 1 && (
                <tr className="dl-sum">
                  <td />
                  <td><b>Total</b></td>
                  <td><b>{inr(received)}</b></td>
                  <td colSpan={canEdit ? 5 : 4} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal
          open onClose={() => setOpen(false)} title="Record a payment" width={520}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Record it'}
              </button>
            </div>
          )}
        >
          <div className="col gap-3">
            {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
            {agreed > 0 && (
              <p className="tiny muted" style={{ margin: 0 }}>
                Agreed {inr(agreed)} · received so far {inr(received)} ·{' '}
                <b>{balance ? `${inr(balance)} still to come` : 'fully received'}</b>
              </p>
            )}
            <div className="po-ccbcc">
              <label className="pt-field"><span>Amount received</span>
                <input inputMode="numeric" value={form.amount} onChange={set('amount')} placeholder="e.g. 250000" />
              </label>
              <label className="pt-field"><span>Received on</span>
                <input type="date" value={form.paidOn} onChange={set('paidOn')} />
              </label>
              <label className="pt-field"><span>How it came</span>
                <select className="pt-select" value={form.mode} onChange={set('mode')}>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="pt-field"><span>Reference / UTR / cheque no.</span>
                <input value={form.reference} onChange={set('reference')} placeholder="e.g. HDFCN5202603…" />
              </label>
            </div>
            <label className="pt-field"><span>Note (optional)</span>
              <textarea rows={2} value={form.note} onChange={set('note')} placeholder="e.g. first instalment against the LOI" />
            </label>
            <div className="col gap-1">
              <span className="label"><ArrowDownToLine size={13} /> Receipt / bank advice</span>
              <input type="file" multiple accept="image/*,.pdf" onChange={(e) => { attach(e.target.files); e.target.value = ''; }} />
              {form.proof.length > 0 && (
                <div className="row gap-2 wrap">
                  {form.proof.map((f, i) => (
                    <span key={i} className="grn-photo-chip">
                      <Paperclip size={11} /> {f.name}
                      <button type="button" onClick={() => setForm((x) => ({ ...x, proof: x.proof.filter((_, k) => k !== i) }))} aria-label="Remove">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          open onClose={() => setConfirmDelete(null)} title="Remove this payment?" width={420}
          footer={(
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Keep it</button>
              <button
                type="button" className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
                onClick={async () => {
                  await removePayment.mutateAsync({ id: record._id, paymentId: confirmDelete.id });
                  setConfirmDelete(null);
                }}
              >
                Remove it
              </button>
            </div>
          )}
        >
          <p className="sm" style={{ margin: 0 }}>
            {inr(confirmDelete.amount)} received on {fmtDate(confirmDelete.paidOn)}
            {confirmDelete.reference ? ` (${confirmDelete.reference})` : ''} will be taken off the total.
            The removal is recorded in this record’s history.
          </p>
        </Modal>
      )}
    </section>
  );
}
