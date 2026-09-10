import { useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, MessageCircle, Mail, MapPin, Phone, Sparkles, Send,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useSendEmail } from '../../app/api/commsApi.js';
import { useFieldAssist } from '../../app/api/aiApi.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { useRecord, useGlobalStageRecords, useAddRecordComment, useUpdateRecordTracking } from '../../app/api/recordsApi.js';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  ISSUER, GST_RATE, taxOf, money, amountInWords, voucherDate, stateLine, addressLines,
} from './poDocument.js';
/* The name→master lookup lives with the other order rules now, so this page
   and the Purchase sheet cannot drift into two slightly different matchers. */
import { matchVendor } from './orderTracking.jsx';

/**
 * One purchase order, ready to leave the building: the branded document
 * (print → PDF), the vendor's own details fetched from Phase 4B, and the two
 * ways it actually gets sent in this business — WhatsApp and email — each with
 * an editable message template and an audit trail.
 *
 * Route: /projects/:id/purchase-order/:recordId  (a p13 BOQ record)
 *
 * Honesty notes, deliberately visible in the UI copy:
 *  - WhatsApp/email open the user's OWN apps (wa.me / mailto) with the message
 *    prefilled. Neither protocol can attach a file programmatically, so the
 *    flow is: download the PDF here, attach it in the app that opens. A real
 *    DoubleTick/SMTP integration can replace this without changing the page.
 *  - Every send is logged as a comment on the record — who, which channel,
 *    when — so the order's history answers "was this actually sent?".
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const inr = (v) => `₹${num(v).toLocaleString('en-IN')}`;

/** The Phase 4B vendor record matching this order's vendor name, if any. */
export default function PurchaseOrderPage() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();

  const { data: project } = useProject(id);
  const { data: record, isLoading } = useRecord(recordId);
  /* GLOBAL, not project-scoped: the form's vendor picker reads the whole
     vendor master (scope: 'global'), so a vendor recorded under another
     project is perfectly choosable — looking them up only in THIS project's
     records made the printed PO silently drop their phone/address/GST. */
  const { data: vendorResp } = useGlobalStageRecords('p12');
  const addComment = useAddRecordComment(id, record?.stageKey || 'p13');
  const track = useUpdateRecordTracking(id, record?.stageKey || 'p13');

  /* The paperwork is editable HERE, before sending — PO number, indent,
     the delivery date the vendor promised, special instructions. All
     tracker fields: the approved item/qty/rate stay frozen; what changes
     is the document around them. */
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(null); // null until opened
  const openEdit = () => {
    setDraft({
      po_number: v.po_number || '',
      indent_number: v.indent_number || '',
      promised_delivery: v.promised_delivery ? String(v.promised_delivery).slice(0, 10) : '',
      tracking_remarks: v.tracking_remarks || '',
    });
    setEditOpen(true);
  };
  const saveEdit = async () => {
    const values = {};
    for (const [k, val] of Object.entries(draft)) {
      if (String(v[k] ?? '') !== String(val ?? '')) values[k] = val === '' ? null : val;
    }
    if (Object.keys(values).length) {
      await track.mutateAsync({ id, values, note: 'PO details edited on the PO page' });
      flashSuccess('PO details updated');
    }
    setEditOpen(false);
  };

  const v = record?.values || {};
  const vendors = vendorResp?.data || vendorResp || [];
  const vendor = useMemo(() => matchVendor(vendors, v.vendor), [vendors, v.vendor]);
  const vv = vendor?.values || {};

  /* p13 BOQ lines and p15 indents are the same order wearing different field
     keys (item/items, amount/total_value, category/stream). Normalised once
     here so the document, the message and the AI context all agree. */
  const itemText = v.item || v.items;
  /* p13 schedules with planned_start/planned_end; p15 with expected_dispatch/
     expected_delivery (delivery is REQUIRED there) — one pair for the doc. */
  const deliverFrom = v.planned_start || v.expected_dispatch;
  const deliverBy = v.promised_delivery || v.planned_end || v.expected_delivery || v.planned_start;
  const hasUnit = Boolean(v.unit);
  const category = v.category || v.stream;
  /* First explicitly-stored total wins — including a deliberate 0 (free-of-
     charge / fully-adjusted line). Only when neither is set does the
     arithmetic fall back to quantity × rate. */
  const storedTotal = [v.amount, v.value].map((x) => (x === '' || x == null ? NaN : Number(x))).find(Number.isFinite);
  const amount = storedTotal !== undefined ? storedTotal : num(v.quantity) * num(v.rate);
  /* Worked out once here, printed twice below (the tax rows and the
     total). Two call sites computing GST separately is how a document
     ends up with rows that do not add up to its own total. */
  const tax = taxOf(amount, ISSUER.gstin, vv.gst, GST_RATE);
  /* What the grid shows: the computed lines when there are any, otherwise the
     same labels with no amount. CGST + SGST is the shape to fall back to —
     it is the within-state case, and every order here is placed from one
     office. */
  const taxRows = tax.lines.length
    ? tax.lines
    : [{ label: 'CGST', amount: null }, { label: 'SGST', amount: null }];

  const poNumber = String(v.po_number || '').trim()
    || `PO-${record?.seq != null ? String(record.seq).padStart(3, '0') : String(recordId || '').slice(-6).toUpperCase()}`;

  /* Editable message — a sensible default the sender can rewrite or replace
     wholesale before anything opens. Rebuilt if the record changes. */
  const defaultMessage = useMemo(() => [
    `Dear ${vv.contact_person || vv.vendor_name || v.vendor || 'Sir/Madam'},`,
    '',
    `Greetings from Mystery Rooms. Please find our purchase order ${poNumber} for the ${project?.name || ''} project:`,
    '',
    `• Item: ${itemText || '—'}${v.description ? ` — ${v.description}` : ''}`,
    `• Quantity: ${v.quantity || '—'} ${v.unit || ''}`.trim(),
    `• Rate: ${inr(v.rate)}  |  Amount: ${inr(amount)}`,
    deliverBy ? `• Required by: ${fmtDate(deliverBy)}` : null,
    '',
    'The detailed PO document is attached. Kindly confirm acceptance and the delivery date.',
    '',
    'Regards,',
    'Mystery Rooms — Projects Team',
  ].filter((line) => line !== null).join('\n'),
  [vv, v, poNumber, project, amount]);

  /* Everything the AI writer is allowed to say — the order's real facts.
     Anything not in here it is instructed to leave out, never invent. */
  const orderContext = {
    po_number: poNumber,
    project: project?.name,
    city: project?.city,
    vendor_name: vv.vendor_name || v.vendor,
    contact_person: vv.contact_person,
    item: itemText,
    description: v.description,
    quantity_display: [v.quantity, v.unit].filter(Boolean).join(' ') || undefined,
    /* *_display fields are what the writer is told to quote verbatim — a
       message can only read as well as its inputs, and raw "100000" or
       "2026-08-30" is exactly what made drafts feel machine-written. */
    rate_display: v.rate ? inr(v.rate) : undefined,
    amount_display: amount ? inr(amount) : undefined,
    required_by_display: deliverBy ? fmtDate(deliverBy) : undefined,
  };

  const [message, setMessage] = useState(null); // null = follow the default
  const text = message ?? defaultMessage;

  /**
   * Log the send on the record, so the audit trail answers "was it sent?" —
   * as a comment (the human-readable send log) AND as structured stamps on
   * the line, so the Phase 6 tracker shows "WhatsApp 21 Aug 10:32 · Email
   * 21 Aug 10:40" without parsing prose. The first send also fixes the PO
   * number on the line and moves its status to Ordered.
   */
  const logSend = (channel, to) => {
    addComment.mutate({
      id: recordId,
      body: `📤 Purchase order ${poNumber} sent via ${channel}${to ? ` to ${to}` : ''}.`,
    });
    if (record?.stageKey === 'p13') {
      const ch = String(channel).toLowerCase() === 'whatsapp' ? 'whatsapp' : 'email';
      track.mutate({
        id: recordId,
        values: {
          [`sent_${ch}_at`]: new Date().toISOString(),
          [`sent_${ch}_to`]: to || '',
          ...(v.po_number ? {} : { po_number: poNumber }),
          ...(v.order_status ? {} : { order_status: 'Ordered' }),
        },
        note: `Sent via ${channel}`,
      });
    }
  };

  const sendWhatsApp = () => {
    const phone = String(phoneTo).replace(/[^\d]/g, '');
    const url = phone
      ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener');
    logSend('WhatsApp', phoneTo || null);
  };

  /* Email goes through a compose dialog: To (prefetched from the vendor,
     editable, comma-separated for more), CC, subject, body and attachments.
     Sending uses the server's SMTP once configured; until then the server
     answers 503 and the dialog offers the mail-app fallback. */
  const [waPhone, setWaPhone] = useState(null); // null = the vendor's number
  const phoneTo = (waPhone ?? vv.contact_phone) || '';
  /* The email panel lives in the split composer below and owns its own
     fields; it registers its send function here so the ONE send button
     fires both channels. */
  const emailSendRef = useRef(null);

  /* Both channels on by default: in practice a purchase order goes out on
     WhatsApp AND by email — the chat gets a reply, the email is the record.
     Either can be switched off before sending. */
  const [channels, setChannels] = useState({ whatsapp: true, email: true });

  /* A note typed here is the same comment a send writes, on the same record —
     so "PO sent via WhatsApp" and "vendor wants 3 more days" sit in one list,
     in order. The mutation was already on this page for the send log; only the
     box to type into was missing, which meant the PO could be emailed from
     here but nothing about it could be written down without opening the order
     page as well. */
  const [note, setNote] = useState('');
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    await addComment.mutateAsync({ id: recordId, body: note.trim() });
    setNote('');
  };
  const toggle = (k) => setChannels((c) => ({ ...c, [k]: !c[k] }));
  const chosen = [channels.whatsapp && 'WhatsApp', channels.email && 'Email'].filter(Boolean);

  /* WhatsApp opens in its own tab and email opens our compose dialog here, so
     firing both is safe — WhatsApp goes first, while the click is still the
     user gesture a popup blocker wants to see. */
  const sendChosen = () => {
    // WhatsApp first, while the click is still the user gesture a popup
    // blocker wants to see; the email sends in place, no tab involved.
    if (channels.whatsapp) sendWhatsApp();
    if (channels.email) emailSendRef.current?.();
  };

  if (isLoading) return (<><Topbar title="Purchase Order" /><div className="content"><SkDetail /></div></>);
  if (!record) return (<><Topbar title="Purchase Order" /><div className="content"><p className="muted">Order not found.</p></div></>);

  return (
    <>
      <div className="po-topbar">
        <Topbar
          title={(
            <span className="row gap-3" style={{ alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back">
                <ArrowLeft size={16} />
              </button>
              {poNumber}
              <Badge soft="var(--surface-2)">{v.vendor || 'No vendor set'}</Badge>
            </span>
          )}
        />
      </div>

      <div className="content po-layout">
        {/* ── The document. This block IS the PDF: Download prints only it. ── */}
        {/* ── The document. This block IS the PDF: Download prints only it.

            Laid out as a Tally purchase-order voucher, because that is the
            shape every vendor and every accountant already reads: a boxed
            party block, a voucher block beside it, the goods grid with the
            tax lines inside it, the total in words, and a signature box.
            Nothing here is decorative — each box is a field somebody looks
            for in a fixed place. ── */}
        <article className="po-doc" id="po-print-area">
          <h1 className="po-title">PURCHASE ORDER</h1>

          {/* The head is ONE table, not two columns: the rule between the
              two party blocks lines up with the rule under the reference
              number because they are rows of the same grid. Rowspans, exactly
              as the voucher has them. */}
          <table className="po-head">
            <tbody>
              <tr>
                <td className="po-cell po-cell--party" rowSpan={3}>
                  <span className="po-lbl">Invoice To</span>
                  <b className="po-party">{ISSUER.name}</b>
                  {ISSUER.addressLines.map((l) => <div key={l}>{l}</div>)}
                  {/* Labels always; values when there are any. */}
                  <div>GST NO - {ISSUER.gstNo}</div>
                  <div>GSTIN/UIN: {ISSUER.gstin}</div>
                  <div>State Name&nbsp;: {stateLine(ISSUER.gstin, ISSUER.stateName)}</div>
                </td>
                <td className="po-cell" rowSpan={2}>
                  <span className="po-lbl">Voucher No.</span>
                  <b>{poNumber}</b>
                </td>
                <td className="po-cell">
                  <span className="po-lbl">Dated</span>
                  <b>{voucherDate(record?.createdAt)}</b>
                </td>
              </tr>
              <tr>
                <td className="po-cell">
                  <span className="po-lbl">Mode/Terms of Payment</span>
                  {vv.payment_terms && <span>{vv.payment_terms}</span>}
                </td>
              </tr>
              <tr>
                <td className="po-cell">
                  <span className="po-lbl">Reference No. &amp; Date.</span>
                  {v.indent_number && <b>{v.indent_number}</b>}
                </td>
                <td className="po-cell">
                  <span className="po-lbl">Other References</span>
                  {project?.code && <span>{project.code}</span>}
                </td>
              </tr>
              <tr>
                <td className="po-cell po-cell--party" rowSpan={2}>
                  <span className="po-lbl">Supplier (Bill from)</span>
                  <b className="po-party">{vv.vendor_name || v.vendor || '\u2014'}</b>
                  {addressLines(vv.address).map((l, i) => <div key={`${l}-${i}`}>{l}</div>)}
                  <div className="po-gst"><span>GSTIN/UIN</span><span>: {vv.gst || ''}</span></div>
                  <div className="po-gst"><span>State Name</span><span>: {vv.gst ? stateLine(vv.gst) : ''}</span></div>
                  {!vendor && v.vendor && (
                    <div className="po-missing no-print">
                      Not in the vendor master yet &mdash; add them on the Vendors page (Phase 4B)
                      and their address and GSTIN fill in here.
                    </div>
                  )}
                </td>
                <td className="po-cell">
                  <span className="po-lbl">Dispatched through</span>
                  {v.transporter && <span>{v.transporter}</span>}
                </td>
                <td className="po-cell">
                  <span className="po-lbl">Destination</span>
                  <span>{[project?.name, project?.city].filter(Boolean).join(' \u00b7 ')}</span>
                </td>
              </tr>
              <tr>
                <td className="po-cell po-cell--grow" colSpan={2}>
                  <span className="po-lbl">Terms of Delivery</span>
                  <span>
                    {deliverBy ? `Delivery by ${fmtDate(deliverBy)}` : 'To be confirmed'}
                    {v.tracking_remarks ? ` \u00b7 ${v.tracking_remarks}` : ''}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>

          {/* The goods grid. The tax lines sit INSIDE it, right-aligned against
              the Amount column, exactly where a Tally voucher puts them. */}
          <table className="po-items">
            <thead>
              <tr>
                <th className="po-sl">Sl<br />No.</th>
                <th className="po-desc">Description of Goods</th>
                <th className="po-qty">Quantity</th>
                <th className="po-rate">Rate</th>
                <th className="po-per">per</th>
                <th className="po-amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="po-sl">1</td>
                <td className="po-desc">
                  <b>&quot;{itemText || '\u2014'}&quot;</b>
                  {v.description && <div className="po-sku">{v.description}</div>}
                </td>
                <td className="po-qty">{v.quantity ? `${Number(v.quantity).toLocaleString('en-IN')}${v.unit ? ` ${v.unit}` : ''}` : '\u2014'}</td>
                <td className="po-rate">{money(v.rate)}</td>
                <td className="po-per">{v.unit || ''}</td>
                <td className="po-amt">{money(amount)}</td>
              </tr>

              {/* Always drawn. When the tax cannot be worked out — no GSTIN on
                  one side — the labels stand and the amount is left blank,
                  which is the one honest thing a money column can say when it
                  does not know. The reference voucher shows these two rows;
                  a document whose rows appear and vanish is a different
                  document each time it is printed. */}
              {taxRows.map((l) => (
                <tr key={l.label} className="po-taxrow">
                  <td className="po-sl" />
                  <td className="po-desc"><i>{l.label}</i></td>
                  <td className="po-qty" />
                  <td className="po-rate" />
                  <td className="po-per" />
                  <td className="po-amt">{l.amount == null ? '' : money(l.amount)}</td>
                </tr>
              ))}

              {/* When the tax cannot be worked out — no GSTIN on one side — the
                  document simply carries no tax lines. It does NOT explain
                  itself on the page: a purchase order goes to a vendor, and a
                  note about our own missing data has no business being on it.
                  A supply to an unregistered vendor genuinely has no GST lines,
                  so an order without them is a normal document, not a broken
                  one. */}

              {/* Tally leaves the middle of the page empty; the total sits at
                  the foot of the grid however short the order is. */}
              <tr className="po-fill"><td className="po-sl" /><td className="po-desc" /><td className="po-qty" /><td className="po-rate" /><td className="po-per" /><td className="po-amt" /></tr>
            </tbody>
            <tfoot>
              <tr>
                <td className="po-sl" />
                <td className="po-desc"><b>Total</b></td>
                <td className="po-qty"><b>{v.quantity ? `${Number(v.quantity).toLocaleString('en-IN')}${v.unit ? ` ${v.unit}` : ''}` : ''}</b></td>
                <td className="po-rate" />
                <td className="po-per" />
                <td className="po-amt"><b>&#8377; {money(tax.grand)}</b></td>
              </tr>
            </tfoot>
          </table>
          {/* One box, as on the voucher: the words at the top, E. & O.E on
              the same line at the right, and the signature block sitting in
              its bottom-right corner rather than floating underneath. */}
          <div className="po-foot">
            <div className="po-foot-top">
              <span className="po-lbl">Amount Chargeable (in words)</span>
              <span className="po-eoe">E. &amp; O.E</span>
            </div>
            <b className="po-inwords">{amountInWords(tax.grand)}</b>
            <div className="po-sign">
              <div className="po-sign-box">
                <b>for {ISSUER.name}</b>
                <span className="po-sign-line">Authorised Signatory</span>
              </div>
            </div>
          </div>

          <p className="po-generated">This is a Computer Generated Document</p>
        </article>

        {/* ── Actions — never printed. ── */}
        <aside className="po-side no-print">
          <section className="card">
            <div className="card-head">
              <h2 className="card-title">PO details</h2>
              {!editOpen && (
                <button type="button" className="btn btn-subtle btn-sm" onClick={openEdit}>Edit</button>
              )}
            </div>
            <div className="po-actions">
              {editOpen && draft ? (
                <>
                  <label className="pt-field"><span>PO number</span>
                    <input value={draft.po_number} onChange={(e) => setDraft((d) => ({ ...d, po_number: e.target.value }))} placeholder={poNumber} />
                  </label>
                  <label className="pt-field"><span>Indent number</span>
                    <input value={draft.indent_number} onChange={(e) => setDraft((d) => ({ ...d, indent_number: e.target.value }))} />
                  </label>
                  <label className="pt-field"><span>Deliver by (vendor promised)</span>
                    <input type="date" value={draft.promised_delivery} onChange={(e) => setDraft((d) => ({ ...d, promised_delivery: e.target.value }))} />
                  </label>
                  <label className="pt-field"><span>Special instructions (printed on the PO)</span>
                    <textarea rows={2} value={draft.tracking_remarks} onChange={(e) => setDraft((d) => ({ ...d, tracking_remarks: e.target.value }))} placeholder="e.g. 50% advance on confirmation, balance on delivery" />
                  </label>
                  <div className="row gap-2">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(false)}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={track.isLoading || track.isPending} onClick={saveEdit}>
                      {track.isLoading || track.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              ) : (
                <dl className="od-kv">
                  <dt>PO number</dt><dd>{poNumber}</dd>
                  <dt>Indent</dt><dd>{v.indent_number || '—'}</dd>
                  <dt>Deliver by</dt><dd>{v.promised_delivery ? fmtDate(v.promised_delivery) : (deliverBy ? fmtDate(deliverBy) : '—')}</dd>
                  {v.tracking_remarks && <><dt>Instructions</dt><dd>{v.tracking_remarks}</dd></>}
                </dl>
              )}
              <p className="tiny muted" style={{ margin: 0 }}>The item, quantity and rate come from the approved BOQ line and stay locked — only the paperwork around them is editable. Every change is logged with your name.</p>
            </div>
          </section>

          <section className="card">
            <div className="card-head"><h2 className="card-title">Document</h2></div>
            <div className="po-actions">
              {/* THE action this page exists for, first and unmissable — the
                  composer itself sits below the fold, and nobody new should
                  have to discover that by scrolling. */}
              <button
                type="button"
                className="btn btn-primary"
                data-guide="po-send-jump"
                onClick={() => document.getElementById('po-send')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <Send size={14} /> Send to vendor — WhatsApp & Email ↓
              </button>
              <button type="button" className="btn btn-subtle" onClick={() => window.print()}>
                <Printer size={14} /> Preview / Download PDF
              </button>
              <p className="tiny muted">
                Opens your browser&rsquo;s print preview — choose &ldquo;Save as PDF&rdquo; to download.
              </p>
            </div>
          </section>

          {/* Sending lives in the full-width split composer below the grid —
              both channels visible, nothing hidden behind a dialog. */}

          {/* Always rendered, not only once something has been sent: an empty
              notes box invites the first note, whereas a card that appears
              later cannot be found by anyone looking for it now. */}
          <section className="card">
            <div className="card-head"><h2 className="card-title">Notes &amp; send log</h2></div>
            <div className="card-body col gap-2">
              {(record.comments || []).length === 0 && (
                <p className="tiny muted" style={{ margin: 0 }}>
                  Nothing yet — every send is logged here, and anything worth remembering about
                  this order goes in the same list.
                </p>
              )}
              <ul className="po-log">
                {[...(record.comments || [])].reverse().slice(0, 12).map((c) => (
                  <li key={c._id || c.createdAt}>
                    <span>{c.body}</span>
                    <span className="tiny muted">
                      {[c.author?.name, fmtDateTime(c.createdAt)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              <form className="row gap-2" onSubmit={addNote}>
                <input
                  className="pt-select"
                  style={{ flex: 1, minWidth: 0 }}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note (e.g. vendor confirmed on call, 2 days delay)"
                />
                <button
                  type="submit"
                  className="btn btn-subtle btn-sm"
                  disabled={!note.trim() || addComment.isLoading || addComment.isPending}
                >
                  Add
                </button>
              </form>
            </div>
          </section>
        </aside>

        {/* ── Send to vendor: BOTH channels, side by side, everything visible
            and editable before anything leaves. One send button below fires
            whichever channels are ticked (both, by default — the chat gets the
            reply, the email is the record). ── */}
        <section className="card no-print po-sendbar" id="po-send" data-guide="po-send">
          <div className="card-head">
            <h2 className="card-title">Send to vendor</h2>
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
                  orderContext={orderContext}
                  defaultTo={vv.email || ''}
                  defaultSubject={`Purchase Order ${poNumber} — Mystery Rooms`}
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
                    <label className="label" htmlFor="po-wa-to">To (phone)</label>
                    <input id="po-wa-to" className="input" value={phoneTo} onChange={(e) => setWaPhone(e.target.value)} placeholder="+91…" />
                  </div>
                  <div className="col gap-1">
                    <label className="label" htmlFor="po-msg">Message</label>
                    <textarea id="po-msg" className="textarea" rows={9} value={text} onChange={(e) => setMessage(e.target.value)} />
                    <AiMessageButtons channel="WhatsApp" context={orderContext} value={text} onText={(t) => setMessage(t)} />
                    {message !== null && (
                      <button type="button" className="tbrief-link" onClick={() => setMessage(null)}>Reset to the standard template</button>
                    )}
                  </div>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    Opens WhatsApp in a new tab with this message ready — you press send there.
                    Direct in-app sending plugs in here once the WhatsApp Business API is connected.
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
                title={chosen.length === 0 ? 'Tick at least one channel' : undefined}
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

/**
 * Compose-and-send. Everything is editable before anything leaves: recipients
 * (comma-separated), CC, subject, body, and real attachments that travel WITH
 * the mail once SMTP is configured. Until then the server answers 503 and this
 * dialog says so plainly and offers the mail-app fallback instead of failing
 * silently.
 */
export function EmailComposerPanel({ orderContext, defaultTo, defaultSubject, defaultBody, registerSend, onSent, disabled }) {
  const send = useSendEmail();
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const doSend = async () => {
    setError(null);
    try {
      const fd = new FormData();
      fd.append('to', to);
      if (cc.trim()) fd.append('cc', cc);
      if (bcc.trim()) fd.append('bcc', bcc);
      fd.append('subject', subject);
      fd.append('text', body);
      for (const f of files) fd.append('attachments', f);
      await send.mutateAsync(fd);
      onSent(to);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'SMTP_NOT_CONFIGURED' || err?.response?.status === 503) setNotConfigured(true);
      else setError(err?.response?.data?.message || 'Could not send — try again.');
    }
  };

  // The parent's single Send button triggers this panel.
  registerSend?.(doSend);

  const mailFallback = () => {
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    onSent(to);
  };

  return (
      <div className="col gap-2" style={disabled ? { pointerEvents: 'none' } : undefined}>
        <div className="col gap-1">
          <label className="label" htmlFor="em-to">To</label>
          <input id="em-to" className="input" value={to} onChange={(e) => setTo(e.target.value)}
            placeholder="vendor@example.com — separate several with commas" />
          <span className="tiny muted">Fetched from the vendor&rsquo;s Phase 4B record — add more, comma-separated.</span>
        </div>
        <div className="po-ccbcc">
          <div className="col gap-1">
            <label className="label" htmlFor="em-cc">CC <span className="np-optional">Optional</span></label>
            <input id="em-cc" className="input" value={cc} onChange={(e) => setCc(e.target.value)} />
          </div>
          <div className="col gap-1">
            <label className="label" htmlFor="em-bcc">BCC <span className="np-optional">Optional</span></label>
            <input id="em-bcc" className="input" value={bcc} onChange={(e) => setBcc(e.target.value)} />
          </div>
        </div>
        <div className="col gap-1">
          <label className="label" htmlFor="em-sub">Subject</label>
          <input id="em-sub" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div className="col gap-1">
          <label className="label" htmlFor="em-body">Message</label>
          <textarea id="em-body" className="textarea" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          <AiMessageButtons channel="email" context={orderContext} value={body} onText={setBody} />
        </div>
        <div className="col gap-1">
          <label className="label" htmlFor="em-att">Attachments <span className="np-optional">Up to 5</span></label>
          <input id="em-att" type="file" multiple
            onChange={(e) => setFiles([...(e.target.files || [])].slice(0, 5))} />
          {files.length > 0 && (
            <span className="tiny muted">{files.map((f) => f.name).join(' · ')}</span>
          )}
          <span className="tiny muted">Tip: download the PO PDF first and attach it here.</span>
        </div>

        {error && <p className="sm" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
        {notConfigured && (
          <div className="ai-prefill" style={{ borderStyle: 'solid' }}>
            <p className="sm" style={{ margin: 0 }}>
              <strong>Email sending isn&rsquo;t connected yet.</strong> Add SMTP_HOST, SMTP_USER and
              SMTP_PASS to the server&rsquo;s .env and this button sends for real — everything here is
              already built for it. Meanwhile:
            </p>
            <button type="button" className="btn btn-subtle btn-sm" onClick={mailFallback}>
              <Mail size={14} /> Open in your mail app instead
            </button>
          </div>
        )}
        {send.isPending && <span className="tiny muted">Sending…</span>}
      </div>
  );
}


/**
 * The AI writer for an outbound vendor message, in both channels.
 * Write drafts a fresh message from the order's facts; Improve keeps what the
 * sender typed and polishes it. Either way the result lands in the editable
 * box — the human verifies, then sends. It is never sent for them.
 */
/**
 * One-tap directions for the writer. Each chip is a plain-language instruction
 * — tap several and they combine ("Formal" + "Hindi" + your own line). Chips
 * are starting points, not the ceiling: the free-text line takes anything.
 */
const STYLE_CHIPS = [
  { key: 'formal', label: 'Formal', text: 'Formal, respectful business tone.' },
  { key: 'friendly', label: 'Friendly', text: 'Warm and friendly, like a long-standing business relationship.' },
  { key: 'urgent', label: 'Urgent', text: 'Convey urgency — this order is time-critical.' },
  { key: 'short', label: 'Short', text: 'As brief as possible — a few lines only.' },
  { key: 'hindi', label: 'Hindi', text: 'Write it in Hindi (Devanagari).' },
  { key: 'hinglish', label: 'Hinglish', text: 'Write it in Hinglish — conversational Hindi in Latin script.' },
];

export function AiMessageButtons({ channel, context, value, onText }) {
  const assist = useFieldAssist();
  const [err, setErr] = useState(null);
  const [chips, setChips] = useState(() => new Set());
  const [direction, setDirection] = useState('');

  const toggleChip = (key) => setChips((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const run = async (mode) => {
    setErr(null);
    const instructions = [
      ...STYLE_CHIPS.filter((c) => chips.has(c.key)).map((c) => c.text),
      direction.trim(),
    ].filter(Boolean).join(' ');
    try {
      const out = await assist.mutateAsync({
        label: `${channel} message to the vendor`,
        mode,
        kind: 'message',
        instructions: instructions || undefined,
        currentValue: mode === 'improve' ? String(value || '') : undefined,
        context: { ...context, channel },
      });
      if (out?.text) onText(out.text);
    } catch (e) {
      setErr(e?.response?.data?.message || 'AI is unavailable right now.');
    }
  };

  return (
    <div className="aiw">
      <div className="aiw-chips">
        {STYLE_CHIPS.map((c) => (
          <button
            type="button"
            key={c.key}
            className={`aiw-chip${chips.has(c.key) ? ' is-on' : ''}`}
            onClick={() => toggleChip(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="aiw-row">
        <input
          className="input aiw-input"
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          placeholder={'Tell AI how you want it — e.g. "mention 50% advance", "add our GST number"'}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); run('suggest'); } }}
        />
        <button type="button" className="fassist-btn" disabled={assist.isPending} onClick={() => run('suggest')}>
          <Sparkles size={11} aria-hidden /> {assist.isPending ? 'Writing…' : 'Write with AI'}
        </button>
        {Boolean(String(value || '').trim()) && (
          <button type="button" className="fassist-btn" disabled={assist.isPending} onClick={() => run('improve')}>
            Improve
          </button>
        )}
      </div>
      {err && <span className="fassist-err">{err}</span>}
    </div>
  );
}
