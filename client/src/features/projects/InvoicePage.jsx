import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrderRoutes } from './orderRoutes.js';
import {
  ArrowLeft, Printer, Send, Mail, MessageCircle, Receipt, PackageCheck, Pencil,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import {
  useRecord, useGlobalStageRecords, useAddRecordComment, useUpdateRecordTracking,
} from '../../app/api/recordsApi.js';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { EmailComposerPanel, AiMessageButtons } from './PurchaseOrderPage.jsx';

/**
 * The invoice — raised from what was ACTUALLY received, never from what was
 * merely ordered.
 *
 * Route: /projects/:id/invoice/:recordId — reachable from the order page the
 * moment a GRN exists. Same document-first layout as the PO page: the branded
 * printable invoice on the left (billing the RECEIVED quantity at the
 * approved rate, with the GRN as its evidence), the paperwork and the split
 * Email | WhatsApp composer to send it — both drafted by AI from the
 * invoice's real facts, verified by a human, every send logged.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const inr = (v) => `₹${num(v).toLocaleString('en-IN')}`;

export default function InvoicePage() {
  const { id, recordId } = useParams();
  const links = useOrderRoutes(id, recordId);
  const navigate = useNavigate();
  const { data: project } = useProject(id);
  const { data: record, isLoading } = useRecord(recordId);
  const { data: vendorsResp } = useGlobalStageRecords('p12');
  const track = useUpdateRecordTracking(id, record?.stageKey || 'p13');
  const addComment = useAddRecordComment(id, record?.stageKey || 'p13');

  const v = record?.values || {};
  const vendors = vendorsResp?.data || vendorsResp || [];
  const vv = useMemo(() => {
    const target = String(v.vendor || '').trim().toLowerCase();
    return vendors.find((x) => String(x.values?.vendor_name || '').trim().toLowerCase() === target)?.values || {};
  }, [vendors, v.vendor]);

  const receivedQty = v.received_quantity ?? v.quantity;
  const amount = num(receivedQty) * num(v.rate);
  const poNumber = String(v.po_number || '').trim() || `PO-${record?.seq != null ? String(record.seq).padStart(3, '0') : ''}`;
  const invNumber = String(v.invoice_number || '').trim()
    || `INV-${record?.seq != null ? String(record.seq).padStart(3, '0') : String(recordId || '').slice(-6).toUpperCase()}`;
  const invDate = v.invoice_date || v.received_date || new Date();
  const photos = v.receipt_photos || [];

  /* Editable invoice paperwork — number and date, tracker fields like the PO's. */
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const openEdit = () => {
    setDraft({
      invoice_number: v.invoice_number || invNumber,
      invoice_date: v.invoice_date ? String(v.invoice_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    await track.mutateAsync({ id: recordId, values: draft, note: 'Invoice details edited' });
    flashSuccess('Invoice details updated');
    setEditOpen(false);
  };

  /* The default message, from the invoice's real facts. */
  const defaultMessage = useMemo(() => [
    'Dear Sir/Madam,',
    '',
    `Greetings from Mystery Rooms. Please find invoice ${invNumber} against purchase order ${poNumber} (${project?.name || ''}):`,
    '',
    `• Item: ${record?.title || v.item || '—'}`,
    `• Quantity received: ${receivedQty ?? '—'} ${v.unit || ''}`.trim(),
    `• Rate: ${inr(v.rate)}  |  Invoice amount: ${inr(amount)}`,
    v.grn_number ? `• GRN: ${v.grn_number} (received ${v.received_date ? fmtDate(v.received_date) : '—'})` : null,
    '',
    'The invoice document is attached. Kindly acknowledge receipt.',
    '',
    'Regards,',
    'Mystery Rooms — Projects Team',
  ].filter((l) => l !== null).join('\n'), [invNumber, poNumber, project, record, v, receivedQty, amount]);

  const invoiceContext = {
    invoice_number: invNumber,
    po_number: poNumber,
    project: project?.name,
    city: project?.city,
    vendor_name: vv.vendor_name || v.vendor,
    item: record?.title || v.item,
    quantity_received_display: [receivedQty, v.unit].filter(Boolean).join(' ') || undefined,
    rate_display: v.rate ? inr(v.rate) : undefined,
    amount_display: inr(amount),
    grn_display: v.grn_number ? `${v.grn_number} on ${v.received_date ? fmtDate(v.received_date) : '—'}` : undefined,
    received_by: v.received_by || undefined,
  };

  const [message, setMessage] = useState(null);
  const text = message ?? defaultMessage;
  const [waPhone, setWaPhone] = useState(null);
  const phoneTo = (waPhone ?? vv.contact_phone) || '';
  const emailSendRef = useRef(null);
  const [channels, setChannels] = useState({ whatsapp: true, email: true });
  const toggle = (k) => setChannels((c) => ({ ...c, [k]: !c[k] }));
  const chosen = [channels.whatsapp && 'WhatsApp', channels.email && 'Email'].filter(Boolean);

  const logSend = (channel, to) => {
    addComment.mutate({ id: recordId, body: `🧾 Invoice ${invNumber} sent via ${channel}${to ? ` to ${to}` : ''}.` });
    track.mutate({
      id: recordId,
      values: {
        sent_invoice_at: new Date().toISOString(),
        sent_invoice_to: to || '',
        ...(v.invoice_number ? {} : { invoice_number: invNumber }),
      },
      note: `Invoice sent via ${channel}`,
    });
  };
  const sendWhatsApp = () => {
    const phone = String(phoneTo).replace(/[^\d]/g, '');
    const url = phone
      ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
    logSend('WhatsApp', phoneTo || null);
  };
  const sendChosen = () => {
    if (channels.whatsapp) sendWhatsApp();
    if (channels.email) emailSendRef.current?.();
  };

  if (isLoading) return (<><Topbar title="Invoice" /><div className="content"><SkDetail /></div></>);
  if (!record) return (<><Topbar title="Invoice" /><div className="content"><p className="muted">Order not found.</p></div></>);

  return (
    <>
      <div className="po-topbar">
        <Topbar
          title={(
            <span className="row gap-3" style={{ alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
                <ArrowLeft size={16} />
              </button>
              {invNumber}
              <Badge soft="var(--surface-2)">against {poNumber}</Badge>
            </span>
          )}
        />
      </div>

      <div className="content po-layout">
        {/* ── The document. This block IS the PDF: Download prints only it. ── */}
        <article className="po-doc" id="po-print-area">
          <header className="po-doc-head">
            <div>
              <h1 className="po-brand">Mystery Rooms</h1>
              <p className="po-brand-sub">A Real Life Escape Experience</p>
            </div>
            <div className="po-doc-meta">
              <h2>Invoice</h2>
              <table>
                <tbody>
                  <tr><td>Invoice No.</td><td>{invNumber}</td></tr>
                  <tr><td>Date</td><td>{fmtDate(invDate)}</td></tr>
                  <tr><td>Against PO</td><td>{poNumber}</td></tr>
                  <tr><td>Project</td><td>{project?.name} ({project?.code})</td></tr>
                </tbody>
              </table>
            </div>
          </header>

          <section className="po-parties">
            <div>
              <h3>Vendor</h3>
              <p className="po-party-name">{vv.vendor_name || v.vendor || '—'}</p>
              {vv.contact_person && <p>{vv.contact_person}</p>}
              {vv.contact_phone && <p>{vv.contact_phone}</p>}
              {vv.email && <p>{vv.email}</p>}
              {vv.gst_number && <p>GST: {vv.gst_number}</p>}
            </div>
            <div>
              <h3>Delivered to</h3>
              <p className="po-party-name">{project?.name}</p>
              <p>{project?.city}</p>
              {v.received_by && <p>Received by {v.received_by}</p>}
            </div>
          </section>

          <table className="po-items">
            <thead>
              <tr><th>#</th><th>Item</th><th>Qty received</th>{v.unit ? <th>Unit</th> : null}<th>Rate</th><th>Amount</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>
                  {record.title || v.item || '—'}
                  {v.description && <div className="po-item-desc">{v.description}</div>}
                </td>
                <td>{receivedQty ?? '—'}</td>
                {v.unit ? <td>{v.unit}</td> : null}
                <td>{inr(v.rate)}</td>
                <td>{inr(amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr><td colSpan={v.unit ? 5 : 4}>Total</td><td>{inr(amount)}</td></tr>
            </tfoot>
          </table>

          <section className="po-terms">
            <p>
              <strong>Goods receipt:</strong> GRN {v.grn_number || '—'}
              {v.received_date ? ` · received ${fmtDate(v.received_date)}` : ''}
              {v.received_by ? ` · by ${v.received_by}` : ''}
              {photos.length ? ` · ${photos.length} receipt document${photos.length === 1 ? '' : 's'} on file` : ''}
            </p>
            {num(v.quantity) > num(receivedQty) && (
              <p><strong>Note:</strong> {num(v.quantity) - num(receivedQty)} of {v.quantity} {v.unit || ''} pending — this invoice covers the received quantity only.</p>
            )}
            <p className="po-fineprint">
              This invoice is raised against goods received and verified under the GRN quoted above.
              Please quote the invoice number in all correspondence.
            </p>
          </section>

          <footer className="po-doc-foot">
            <span>Mystery Rooms — Projects</span>
            <span>Generated {fmtDateTime(new Date())}</span>
          </footer>
        </article>

        {/* ── Actions — never printed. ── */}
        <aside className="po-side no-print">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">Invoice details</h2>
              {!editOpen && <button type="button" className="btn btn-subtle btn-sm" onClick={openEdit}><Pencil size={12} /> Edit</button>}
            </div>
            <div className="po-actions">
              {editOpen && draft ? (
                <>
                  <label className="pt-field"><span>Invoice number</span>
                    <input value={draft.invoice_number} onChange={(e) => setDraft((d) => ({ ...d, invoice_number: e.target.value }))} />
                  </label>
                  <label className="pt-field"><span>Invoice date</span>
                    <input type="date" value={draft.invoice_date} onChange={(e) => setDraft((d) => ({ ...d, invoice_date: e.target.value }))} />
                  </label>
                  <div className="row gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={track.isLoading || track.isPending} onClick={saveEdit}>Save</button>
                  </div>
                </>
              ) : (
                <dl className="od-kv">
                  <dt>Invoice no.</dt><dd>{invNumber}</dd>
                  <dt>Date</dt><dd>{fmtDate(invDate)}</dd>
                  <dt>Received</dt><dd>{receivedQty ?? '—'} of {v.quantity ?? '—'} {v.unit || ''}</dd>
                  <dt>GRN</dt><dd>{v.grn_number || '—'}</dd>
                  {v.sent_invoice_at && <><dt>Last sent</dt><dd>{fmtDateTime(v.sent_invoice_at)}{v.sent_invoice_to ? ` → ${v.sent_invoice_to}` : ''}</dd></>}
                </dl>
              )}
              <p className="tiny muted" style={{ margin: 0 }}>The quantity and rate come from the GRN and the approved order — the invoice bills what actually arrived.</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2 className="card-title">Document</h2></div>
            <div className="po-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => document.getElementById('inv-send')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <Send size={14} /> Send the invoice — WhatsApp & Email ↓
              </button>
              <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
                <Printer size={14} /> Preview / Download PDF
              </button>
              <Link className="btn btn-ghost btn-sm" to={links.order}>
                <PackageCheck size={13} /> Back to the order
              </Link>
            </div>
          </section>
        </aside>

        {/* ── Send the invoice: same split composer as the PO page. ── */}
        <section className="card no-print po-sendbar" id="inv-send">
          <div className="card-head">
            <h2 className="card-title"><Receipt size={15} /> Send the invoice</h2>
            <span className="tiny muted">Every send is logged on this order&rsquo;s history</span>
          </div>
          <div className="card-body">
            <div className="po-split">
              <div className={`po-chan${channels.email ? '' : ' is-off'}`}>
                <label className="po-chan-head">
                  <input type="checkbox" checked={channels.email} onChange={() => toggle('email')} />
                  <Mail size={15} /> <b>Email</b>
                  <span className="tiny muted">the formal record</span>
                </label>
                <EmailComposerPanel
                  orderContext={invoiceContext}
                  defaultTo={vv.email || ''}
                  defaultSubject={`Invoice ${invNumber} — Mystery Rooms`}
                  defaultBody={text}
                  registerSend={(fn) => { emailSendRef.current = fn; }}
                  onSent={(to) => logSend('email', to)}
                  disabled={!channels.email}
                />
              </div>
              <div className={`po-chan${channels.whatsapp ? '' : ' is-off'}`}>
                <label className="po-chan-head">
                  <input type="checkbox" checked={channels.whatsapp} onChange={() => toggle('whatsapp')} />
                  <MessageCircle size={15} /> <b>WhatsApp</b>
                  <span className="tiny muted">the quick confirmation</span>
                </label>
                <div className="col gap-2">
                  <div className="col gap-1">
                    <label className="label" htmlFor="inv-wa-to">To (phone)</label>
                    <input id="inv-wa-to" className="input" value={phoneTo} onChange={(e) => setWaPhone(e.target.value)} placeholder="+91…" />
                  </div>
                  <div className="col gap-1">
                    <label className="label" htmlFor="inv-msg">Message</label>
                    <textarea id="inv-msg" className="textarea" rows={9} value={text} onChange={(e) => setMessage(e.target.value)} />
                    <AiMessageButtons channel="WhatsApp" context={invoiceContext} value={text} onText={(t) => setMessage(t)} />
                    {message !== null && (
                      <button type="button" className="tbrief-link" onClick={() => setMessage(null)}>Reset to the standard template</button>
                    )}
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    Opens WhatsApp in a new tab with this message ready — you press send there.
                  </p>
                </div>
              </div>
            </div>
            <div className="po-send-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={sendChosen}
                disabled={chosen.length === 0}
              >
                <Send size={14} /> {chosen.length === 0 ? 'Tick a channel above' : `Send by ${chosen.join(' + ')}`}
              </button>
              <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
                <Printer size={14} /> Download the PDF to attach
              </button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
