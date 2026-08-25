import { useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Send, Truck, PackageCheck, CheckCircle2, AlertTriangle, Sparkles, Copy, MessageCircle,
  Printer, Phone, Mail, MapPin, ClipboardList, FileText,
} from 'lucide-react';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useRecord, useGlobalStageRecords, useUpdateRecordTracking, useAddRecordComment,
} from '../../app/api/recordsApi.js';
import { useFieldAssist } from '../../app/api/aiApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  BOQ_STAGE, STATUSES, NOT_SENT, TONE, num, has, inr, todayLocal, factsOf, stampedBy, OrderEditor, OrderHistory,
} from './orderTracking.jsx';

/**
 * One purchase order, on its own page.
 *
 * Route: /projects/:id/procurement/:recordId   (a Phase 5 BOQ line)
 *
 * The tracker is the sheet; this is the row opened up. Everything about the
 * order in one place — where it is (a five-step timeline with dates and
 * names), what was ordered and from whom (with the vendor's phone and email
 * one tap away), the full Update form always open, what arrived against what
 * was ordered, the paper trail, an AI-drafted chase message, notes, and the
 * complete who-changed-what history. Same data and rules as the sheet
 * (orderTracking.jsx), so nothing can read differently here.
 */

const CHASE_CHIPS = [
  { key: 'dispatch', label: 'Ask for dispatch date', text: 'Ask for the confirmed dispatch date.' },
  { key: 'pending', label: 'Ask about pending qty', text: 'Ask when the pending quantity will be sent.' },
  { key: 'urgent', label: 'Urgent', text: 'Make it clear this is urgent for the store opening.' },
  { key: 'hinglish', label: 'Hinglish', text: 'Write in friendly Hinglish (Roman script).' },
];

/** Who last touched a field, else who set the status to a given value. */
const whoFor = (record, field, statusValue) => stampedBy(record, field)
  || [...(record.changeLog || [])].reverse().find((c) => c.field === 'order_status' && c.to === statusValue)?.by?.name
  || null;
const whenStatus = (record, statusValue) => [...(record.changeLog || [])].reverse().find((c) => c.field === 'order_status' && c.to === statusValue)?.at || null;

export default function OrderDetailPage() {
  const { id, recordId } = useParams();
  const { goBack } = useGoBack(`/projects/${id}/procurement`);
  const [searchParams] = useSearchParams();
  const fromTask = searchParams.get('task');
  const user = useAppSelector(selectCurrentUser);
  const canEdit = can.capture(user?.role);

  const { data: project } = useProject(id);
  const { data: record, isLoading } = useRecord(recordId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: vendorsResp } = useGlobalStageRecords('p12');
  const track = useUpdateRecordTracking(id, BOQ_STAGE);
  const addComment = useAddRecordComment(id, BOQ_STAGE);
  const assist = useFieldAssist();

  const boqSchema = template?.stages?.find((s) => s.key === BOQ_STAGE)?.masterDataSchema || [];
  const statusOptions = boqSchema.find((f) => f.key === 'order_status')?.options || STATUSES;
  const trackerReady = boqSchema.some((f) => f.tracker);
  const v = record?.values || {};
  const f = useMemo(() => (record ? factsOf(record) : null), [record]);
  const vendors = vendorsResp?.data || vendorsResp || [];
  const vendor = useMemo(() => {
    const target = String(v.vendor || '').trim().toLowerCase();
    return vendors.find((x) => String(x.values?.vendor_name || '').trim().toLowerCase() === target)?.values || null;
  }, [vendors, v.vendor]);

  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [chips, setChips] = useState(() => new Set());
  const [chase, setChase] = useState('');
  const [chaseErr, setChaseErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editorKey, setEditorKey] = useState(0); // bumping it reloads the form from what is saved — only on Cancel or after a save, never from a background refetch
  const [savedAt, setSavedAt] = useState(null);

  const save = async (values, why) => {
    setError(null);
    try { await track.mutateAsync({ id: recordId, values, note: why }); return true; } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not save that change.');
      return false;
    }
  };
  const changeStatus = async (next) => {
    const values = { order_status: next };
    if (next === 'Dispatched' && !has(v.dispatch_date)) values.dispatch_date = todayLocal();
    if (next === 'Received (GRN)') {
      if (!has(v.received_quantity)) values.received_quantity = num(v.quantity);
      values.pending_quantity = 0;
      if (!has(v.received_date)) values.received_date = todayLocal();
    }
    if (next === 'Cancelled') values.pending_quantity = 0;
    await save(values, 'Status changed on the order page');
  };
  const addNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    await addComment.mutateAsync({ id: recordId, body: note.trim() });
    setNote('');
  };

  /** A short vendor follow-up, grounded only in this order's facts. */
  const draftChase = async () => {
    setChaseErr(null);
    const instructions = [
      'A short WhatsApp follow-up (3–5 sentences) about this purchase order. Name the PO, say what we are waiting for, ask one clear question with a date.',
      ...CHASE_CHIPS.filter((c) => chips.has(c.key)).map((c) => c.text),
    ].join(' ');
    try {
      const out = await assist.mutateAsync({
        label: 'WhatsApp follow-up to the vendor',
        mode: 'suggest',
        kind: 'message',
        instructions,
        context: {
          channel: 'WhatsApp',
          po_number: f.po,
          project: project?.name,
          city: project?.city,
          vendor_name: vendor?.vendor_name || v.vendor,
          contact_person: vendor?.contact_person,
          item: record?.title || v.item,
          quantity_display: [v.quantity, v.unit].filter(Boolean).join(' ') || undefined,
          amount_display: inr(f.amount),
          status: f.status,
          sent_on_display: v.sent_whatsapp_at || v.sent_email_at ? fmtDate(v.sent_whatsapp_at || v.sent_email_at) : undefined,
          promised_delivery_display: f.due ? fmtDate(f.due) : undefined,
          days_late: f.daysLate || undefined,
          received_display: f.received != null ? `${f.received} of ${f.qty}` : undefined,
          pending_display: f.pending != null && f.pending > 0 ? String(f.pending) : undefined,
        },
      });
      if (out?.text) setChase(out.text);
    } catch (e) {
      setChaseErr(e?.response?.data?.message || 'AI is unavailable right now.');
    }
  };
  const copyChase = async () => {
    try { await navigator.clipboard.writeText(chase); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* text stays visible */ }
  };
  const phone = String(vendor?.contact_phone || '').replace(/[^\d]/g, '');
  const waHref = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(chase)}` : null;

  if (isLoading || !record || !f) return (<><Topbar title="Purchase order" /><div className="content"><SkDetail /></div></>);
  if (record.stageKey !== BOQ_STAGE) {
    return (
      <>
        <Topbar title="Purchase order" />
        <div className="content"><EmptyState icon={ClipboardList} title="This record is not a purchase order" hint="Orders are the BOQ lines of Phase 5." /></div>
      </>
    );
  }

  const tone = TONE[f.status] || TONE.Ordered;
  const sentAt = v.sent_whatsapp_at || v.sent_email_at;
  const pct = f.qty ? Math.min(100, Math.round(((f.received || 0) / f.qty) * 100)) : 0;

  /* The five moments of an order's life. A step shows its date, person and
     details ONLY once it is done — the history may hold an earlier "Dispatched"
     that was later undone, and a step that has not happened must say so. */
  const moved = ['Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged'].includes(f.status);
  const delivered = ['Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged'].includes(f.status);
  const raw = [
    { key: 'sent', name: 'Sent', icon: Send, done: Boolean(sentAt), when: sentAt, who: whoFor(record, v.sent_whatsapp_at ? 'sent_whatsapp_at' : 'sent_email_at'), extra: [v.sent_whatsapp_at && 'WhatsApp', v.sent_email_at && 'Email'].filter(Boolean).join(' + ') },
    { key: 'ordered', name: 'Ordered', icon: FileText, done: f.status !== NOT_SENT, when: whenStatus(record, 'Ordered') || sentAt, who: whoFor(record, null, 'Ordered'), extra: f.due ? `due ${fmtDate(f.due)}` : '' },
    { key: 'dispatched', name: 'Dispatched', icon: Truck, done: moved, when: v.dispatch_date || whenStatus(record, 'Dispatched'), who: whoFor(record, 'dispatch_date', 'Dispatched'), extra: [v.transporter, v.lr_docket && `LR ${v.lr_docket}`, v.delivery_challan_no && `DC ${v.delivery_challan_no}`].filter(Boolean).join(' · ') },
    { key: 'delivered', name: 'Delivered', icon: MapPin, done: delivered, when: v.received_date || whenStatus(record, 'Delivered'), who: whoFor(record, 'received_date', 'Delivered'), extra: f.received != null ? `${f.received} of ${f.qty} received` : '' },
    { key: 'received', name: 'Received (GRN)', icon: PackageCheck, done: f.status === 'Received (GRN)', bad: f.status === 'Short / Damaged', when: v.received_date || whenStatus(record, 'Received (GRN)'), who: whoFor(record, 'grn_number', 'Received (GRN)'), extra: v.grn_number ? `GRN ${v.grn_number}` : '' },
  ];
  const steps = raw.map((st) => (st.done || st.bad ? st : { ...st, when: null, who: null, extra: '' }));
  const currentIdx = steps.findIndex((s) => !s.done);

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back to the order tracker">
              <ArrowLeft size={16} />
            </button>
            {f.po} <span className="tiny muted" style={{ fontWeight: 500 }}>{record.title || v.item} · {project?.name}</span>
            {fromTask && (
              <Link className="btn btn-subtle btn-sm" to={`/projects/${id}/tasks/${fromTask}`}><ArrowLeft size={12} /> Back to my task</Link>
            )}
          </span>
        )}
      />

      <div className="content col gap-4">
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        {/* Where it is, at a glance — then the five moments of its life. */}
        <section className="card">
          <div className="card-body">
          <div className="od-head">
            <div className="od-title">
              <h2>{record.title || v.item}</h2>
              <div className="od-facts">
                <span>PO <b>{f.po}</b></span>
                {v.indent_number && <span>Indent <b>{v.indent_number}</b></span>}
                {v.category && <span><b>{v.category}</b></span>}
                <span>from <b>{v.vendor || '—'}</b></span>
                <span><b>{v.quantity || '—'} {v.unit || ''}</b> @ {inr(v.rate)} = <b>{inr(f.amount)}</b></span>
              </div>
              <div className="row gap-2" style={{ alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                {canEdit && trackerReady ? (
                  <select className="pt-select pt-status" style={{ color: tone.color, background: tone.soft }} value={f.status === NOT_SENT ? '' : f.status} onChange={(e) => changeStatus(e.target.value)} aria-label="Order status" data-guide="od-status">
                    {f.status === NOT_SENT && <option value="" disabled>Not sent yet</option>}
                    {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : <Badge color={tone.color} soft={tone.soft}>{f.status}</Badge>}
                {f.daysLate > 0 && <span className="pt-late"><AlertTriangle size={12} /> Late {f.daysLate} day{f.daysLate === 1 ? '' : 's'} — due was {fmtDate(f.due)}</span>}
                {f.daysLate === 0 && f.due && !f.closed && <span className="tiny muted">due {fmtDate(f.due)}</span>}
                {f.lastBy && <span className="tiny muted">· last update {f.lastBy}, {fmtDateTime(f.lastAt)}</span>}
              </div>
            </div>
            <div className="od-actions">
              <Link className="btn btn-primary btn-sm" to={`/projects/${id}/purchase-order/${recordId}`} data-guide="od-po">
                {sentAt ? <><Printer size={14} /> Purchase order (print / resend)</> : <><Send size={14} /> Send the purchase order</>}
              </Link>
            </div>
          </div>
          <div className="od-timeline">
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.key} className={`od-step${s.done ? ' is-done' : ''}${i === currentIdx ? ' is-current' : ''}${s.bad ? ' is-bad' : ''}`}>
                  <span className="od-step-name">{s.done ? <CheckCircle2 size={13} /> : <Icon size={13} />} {s.bad ? 'Short / Damaged' : s.name}</span>
                  <span className="od-step-when">{s.when ? (String(s.when).length > 10 ? fmtDateTime(s.when) : fmtDate(s.when)) : (i === currentIdx ? 'next' : '—')}</span>
                  {(s.who || s.extra) && <span className="od-step-who">{[s.who && `by ${s.who}`, s.extra].filter(Boolean).join(' · ')}</span>}
                </div>
              );
            })}
          </div>
          </div>
        </section>

        <div className="od-grid">
          <div className="col gap-4">
            {/* The Update form, always open: this page IS the place to record things. */}
            <section className="card">
              <div className="card-head"><h2 className="card-title">Update this order</h2>{savedAt && <span className="tiny" style={{ color: 'var(--success)' }} data-guide="od-saved"><CheckCircle2 size={12} /> Saved {fmtDateTime(savedAt)}</span>}</div>
              <div className="card-body">
              {canEdit && trackerReady ? (
                <OrderEditor
                  compact
                  key={editorKey}
                  record={record}
                  facts={f}
                  vendor={vendor}
                  statusOptions={statusOptions}
                  saving={track.isLoading || track.isPending}
                  onCancel={() => setEditorKey((k) => k + 1)}
                  onSave={async (values) => { if (await save(values, 'Updated on the order page')) { setSavedAt(new Date()); setEditorKey((k) => k + 1); flashSuccess('Order updated'); } }}
                />
              ) : <p className="tiny muted" style={{ margin: 0 }}>{trackerReady ? 'You can view this order but not change it.' : 'Tracking fields are not on this template yet.'}</p>}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">Received against ordered</h2></div>
              <div className="card-body col gap-2">
                <div className="od-progress"><span style={{ width: `${pct}%` }} /></div>
                <div className="row gap-3" style={{ fontSize: 13, flexWrap: 'wrap' }}>
                  <span>Ordered <b>{f.qty || '—'} {v.unit || ''}</b></span>
                  <span>Received <b>{f.received ?? '—'}</b></span>
                  <span style={{ color: f.pending ? 'var(--warning)' : 'inherit' }}>Pending <b>{f.pending ?? (f.qty || '—')}</b></span>
                  {v.received_date && <span className="muted">on {fmtDate(v.received_date)}</span>}
                  {v.grn_number && <span className="muted">GRN {v.grn_number}</span>}
                </div>
                {v.shortage_note && <div className="pt-alert"><AlertTriangle size={14} /> Short / damaged: {v.shortage_note}</div>}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">History</h2></div>
              <div className="card-body"><OrderHistory record={record} /></div>
            </section>
          </div>

          <aside className="col gap-4">
            <section className="card">
              <div className="card-head"><h2 className="card-title">Vendor</h2></div>
              <div className="card-body">
              {vendor ? (
                <dl className="od-kv">
                  <dt>Name</dt><dd><b>{vendor.vendor_name}</b>{vendor.contact_person ? ` — ${vendor.contact_person}` : ''}</dd>
                  {vendor.contact_phone && <><dt>Phone</dt><dd><a href={`tel:${vendor.contact_phone}`}><Phone size={12} /> {vendor.contact_phone}</a> · <a href={`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}`} target="_blank" rel="noreferrer"><MessageCircle size={12} /> WhatsApp</a></dd></>}
                  {vendor.email && <><dt>Email</dt><dd><a href={`mailto:${vendor.email}`}><Mail size={12} /> {vendor.email}</a></dd></>}
                  {vendor.address && <><dt>Address</dt><dd>{vendor.address}</dd></>}
                  {vendor.gst_number && <><dt>GST</dt><dd>{vendor.gst_number}</dd></>}
                  {vendor.payment_terms && <><dt>Payment terms</dt><dd>{vendor.payment_terms}</dd></>}
                </dl>
              ) : <p className="tiny muted" style={{ margin: 0 }}>{v.vendor ? `"${v.vendor}" is not in the vendor master — add them on the Vendors page to see their contact details here.` : 'No vendor on this line yet.'}</p>}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">Paper trail</h2></div>
              <div className="card-body">
              <dl className="od-kv">
                <dt>PO number</dt><dd>{f.po}</dd>
                <dt>Indent number</dt><dd>{v.indent_number || '—'}</dd>
                <dt>Sent</dt><dd>{v.sent_whatsapp_at && <>WhatsApp {fmtDateTime(v.sent_whatsapp_at)}{v.sent_whatsapp_to ? ` → ${v.sent_whatsapp_to}` : ''}<br /></>}{v.sent_email_at && <>Email {fmtDateTime(v.sent_email_at)}{v.sent_email_to ? ` → ${v.sent_email_to}` : ''}</>}{!sentAt && '—'}</dd>
                <dt>Promised delivery</dt><dd>{v.promised_delivery ? fmtDate(v.promised_delivery) : (v.planned_end ? `${fmtDate(v.planned_end)} (planned)` : '—')}</dd>
                <dt>Transporter</dt><dd>{v.transporter || '—'}</dd>
                <dt>LR / docket</dt><dd>{v.lr_docket || '—'}</dd>
                <dt>Delivery challan</dt><dd>{v.delivery_challan_no || '—'}</dd>
                <dt>GRN number</dt><dd>{v.grn_number || '—'}</dd>
              </dl>
              </div>
            </section>

            <section className="card od-chase" data-guide="od-chase">
              <div className="card-head"><h2 className="card-title"><Sparkles size={15} /> Chase the vendor</h2></div>
              <div className="card-body col gap-2">
                <div className="od-chase-chips">
                  {CHASE_CHIPS.map((c) => (
                    <button type="button" key={c.key} className={`pt-chip${chips.has(c.key) ? ' is-on' : ''}`} onClick={() => setChips((p) => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })}>{c.label}</button>
                  ))}
                </div>
                <button type="button" className="btn btn-subtle btn-sm" onClick={draftChase} disabled={assist.isLoading || assist.isPending}>
                  <Sparkles size={13} /> {assist.isLoading || assist.isPending ? 'Writing…' : chase ? 'Write it again' : 'Draft a follow-up message'}
                </button>
                {chaseErr && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {chaseErr}</div>}
                {chase && (
                  <>
                    <textarea value={chase} onChange={(e) => setChase(e.target.value)} aria-label="Follow-up message" />
                    <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={copyChase}><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
                      {waHref && <a className="btn btn-primary btn-sm" href={waHref} target="_blank" rel="noreferrer"><MessageCircle size={12} /> Open in WhatsApp</a>}
                    </div>
                    <span className="tiny muted">Edit it first if you like — nothing is sent until you send it.</span>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card-head"><h2 className="card-title">Notes</h2></div>
              <div className="card-body col gap-2">
                {(record.comments || []).length === 0 && <p className="tiny muted" style={{ margin: 0 }}>No notes yet — anything worth remembering about this order goes here.</p>}
                <ul className="od-notes">
                  {[...(record.comments || [])].reverse().map((c) => (
                    <li key={c._id || c.createdAt}>{c.body}<span className="tiny muted">{c.author?.name || ''} · {fmtDateTime(c.createdAt)}</span></li>
                  ))}
                </ul>
                <form className="row gap-2" onSubmit={addNote} data-guide="od-note-form">
                  <input className="pt-select" style={{ flex: 1, minWidth: 0 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. vendor says 2 days delay)" />
                  <button type="submit" className="btn btn-subtle btn-sm" disabled={!note.trim() || addComment.isLoading || addComment.isPending}>Add</button>
                </form>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}
