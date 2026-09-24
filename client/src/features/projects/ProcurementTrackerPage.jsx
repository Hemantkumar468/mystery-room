import { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Download, Sparkles, RefreshCw, ChevronDown, ChevronUp, History, ClipboardList,
  Truck, PackageCheck, AlertTriangle, Search, Send, CheckCircle2, Copy, ExternalLink,
} from 'lucide-react';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { PhaseBrief } from '../../components/ui/PhaseBrief.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords, useGlobalStageRecords, useUpdateRecordTracking } from '../../app/api/recordsApi.js';
import { useProcurementBrief, useSavedProcurementBrief } from '../../app/api/aiApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { TASK_STATUS_META } from '../../lib/ui.js';
import {
  STAGE_KEY, BOQ_STAGE, STATUSES, NOT_SENT, TONE, FILTERS, num, has, inr, todayLocal, factsOf, stampedBy, sentAtOf, OrderEditor, OrderHistory,
} from './orderTracking.jsx';

/**
 * Phase 6 — Purchase Orders & Delivery Tracking.
 *
 * Route: /projects/:id/procurement   (stage key p15)
 *
 * One sheet, one row per purchase order — and a purchase order IS a Phase 5
 * BOQ line, so nothing is re-entered here. Each row shows, left to right, what
 * a coordinator actually asks: was it sent (when, how, to whom), where is it
 * now (status), when is it due (and how late), what arrived against what was
 * ordered (received / pending), the paper trail (PO, indent, challan, GRN) and
 * who last touched it. Status changes inline; everything else through the
 * row's Update panel, in place — no popups.
 *
 * Rules this page applies for the user rather than asking them to:
 *   - no status until the order is sent → "Not sent yet"; first send → Ordered
 *   - received < ordered → Partly Received, pending = ordered − received
 *   - received ≥ ordered → Received (GRN)
 *   - due date passed and not closed → Late N days, in red
 * Every change goes through PATCH /records/:id/tracking, which stamps who and
 * when into the record's changeLog — the History panel on each row.
 */

export default function ProcurementTrackerPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { goBack } = useGoBack(`/projects/${id}`);
  // Arrived from a task's "Open the phase"? Offer the way back by name.
  const [searchParams] = useSearchParams();
  const fromTask = searchParams.get('task');
  const user = useAppSelector(selectCurrentUser);
  const canEdit = can.capture(user?.role);
  const canDecide = can.decide(user?.role);

  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: recordsResp } = useStageRecords(id, BOQ_STAGE);
  const { data: vendorsResp } = useGlobalStageRecords('p12');
  const { data: taskResp } = useTasks({ project: id, stageKey: STAGE_KEY, limit: 50 });
  const track = useUpdateRecordTracking(id, BOQ_STAGE);
  const { resolve } = useEmployees();

  const stage = useMemo(() => project?.stages?.find((s) => s.key === STAGE_KEY), [project]);
  const boqSchema = template?.stages?.find((s) => s.key === BOQ_STAGE)?.masterDataSchema || [];
  const statusOptions = boqSchema.find((f) => f.key === 'order_status')?.options || STATUSES;
  const trackerReady = boqSchema.some((f) => f.tracker);
  const records = recordsResp?.data || recordsResp || [];
  const vendors = vendorsResp?.data || vendorsResp || [];
  const tasks = taskResp?.data || taskResp || [];

  const rows = useMemo(() => {
    const today = new Date();
    return [...records]
      .filter((r) => !['rejected', 'archived'].includes(r.status))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((r) => ({ r, f: factsOf(r, today) }));
  }, [records]);

  const vendorOf = (name) => {
    const target = String(name || '').trim().toLowerCase();
    return vendors.find((x) => String(x.values?.vendor_name || '').trim().toLowerCase() === target)?.values || null;
  };

  const [filter, setFilter] = useState('all');
  const [vendorFilter, setVendorFilter] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null); // record id → { mode: 'edit' | 'history' }
  const [error, setError] = useState(null);

  const vendorNames = useMemo(() => [...new Set(rows.map(({ r }) => r.values?.vendor).filter(Boolean))].sort(), [rows]);
  const visible = rows.filter(({ r, f }) => {
    if (filter === 'late' ? f.daysLate === 0 : filter !== 'all' && f.status !== filter) return false;
    if (vendorFilter && r.values?.vendor !== vendorFilter) return false;
    if (search) {
      const hay = [f.po, r.title, r.values?.item, r.values?.vendor, r.values?.category, r.values?.indent_number,
        r.values?.delivery_challan_no, r.values?.grn_number].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const kpi = useMemo(() => ({
    orders: rows.length,
    notSent: rows.filter(({ f }) => f.status === NOT_SENT).length,
    inTransit: rows.filter(({ f }) => ['Dispatched', 'Delivered'].includes(f.status)).length,
    received: rows.filter(({ f }) => f.status === 'Received (GRN)').length,
    late: rows.filter(({ f }) => f.daysLate > 0).length,
    orderedValue: rows.reduce((s, { f }) => s + f.amount, 0),
    receivedValue: rows.filter(({ f }) => f.status === 'Received (GRN)').reduce((s, { f }) => s + f.amount, 0),
  }), [rows]);

  /** One tracking write, with the sentence that explains a refusal. */
  const save = async (record, values, note) => {
    setError(null);
    try {
      await track.mutateAsync({ id: record._id, values, note });
      return true;
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not save that change.');
      return false;
    }
  };

  /** Status dropdown: the obvious companions are filled in so one click is enough. */
  const changeStatus = async (record, next) => {
    const v = record.values || {};
    const values = { order_status: next };
    const today = todayLocal();
    if (next === 'Dispatched' && !has(v.dispatch_date)) values.dispatch_date = today;
    if (next === 'Received (GRN)') {
      if (!has(v.received_quantity)) values.received_quantity = num(v.quantity);
      values.pending_quantity = 0;
      if (!has(v.received_date)) values.received_date = today;
    }
    if (next === 'Cancelled') values.pending_quantity = 0;
    await save(record, values, 'Status changed on the tracker');
  };

  /** CSV with a UTF-8 BOM so Excel opens ₹ and names correctly. */
  const exportExcel = () => {
    const cols = [
      ['No.', ({ r }) => r.seq], ['PO No.', ({ f }) => f.po], ['Indent No.', ({ r }) => r.values?.indent_number],
      ['Item', ({ r }) => r.title || r.values?.item], ['Category', ({ r }) => r.values?.category],
      ['Vendor', ({ r }) => r.values?.vendor], ['Qty ordered', ({ r }) => r.values?.quantity], ['Unit', ({ r }) => r.values?.unit],
      ['Rate', ({ r }) => r.values?.rate], ['Amount', ({ f }) => f.amount],
      ['WhatsApp sent', ({ r }) => sentAtOf(r.values?.sent_whatsapp_at) && fmtDateTime(r.values.sent_whatsapp_at)],
      ['WhatsApp to', ({ r }) => r.values?.sent_whatsapp_to],
      ['Email sent', ({ r }) => sentAtOf(r.values?.sent_email_at) && fmtDateTime(r.values.sent_email_at)],
      ['Email to', ({ r }) => r.values?.sent_email_to],
      ['Status', ({ f }) => f.status], ['Due', ({ f }) => f.due && fmtDate(f.due)], ['Days late', ({ f }) => f.daysLate || ''],
      ['Dispatched on', ({ r }) => r.values?.dispatch_date && fmtDate(r.values.dispatch_date)],
      ['Transporter', ({ r }) => r.values?.transporter], ['LR / Docket', ({ r }) => r.values?.lr_docket],
      ['Delivery challan', ({ r }) => r.values?.delivery_challan_no],
      ['Received on', ({ r }) => r.values?.received_date && fmtDate(r.values.received_date)],
      ['Qty received', ({ f }) => f.received], ['Qty pending', ({ f }) => f.pending], ['GRN No.', ({ r }) => r.values?.grn_number],
      ['Short / damaged', ({ r }) => r.values?.shortage_note], ['Remarks', ({ r }) => r.values?.tracking_remarks],
      ['Last updated by', ({ f }) => f.lastBy], ['Last updated', ({ f }) => f.lastAt && fmtDateTime(f.lastAt)],
    ];
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(([h]) => esc(h)).join(','), ...visible.map((row) => cols.map(([, fn]) => esc(fn(row))).join(','))];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project?.code || 'project'}-purchase-orders.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doerName = (t) => resolve(t.assignee?._id || t.assignee)?.name || resolve(t.primaryAssignee)?.name || t.brief?.who || 'Unassigned';

  if (isLoading) return (<><Topbar title="Purchase Orders & Delivery Tracking" /><div className="content"><SkDetail /></div></>);
  if (!stage) {
    return (
      <>
        <Topbar title="Purchase Orders & Delivery Tracking" />
        <div className="content">
          <EmptyState icon={ClipboardList} title="This project has no Phase 6" hint="It may be on a template without the order tracker." />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            {stage.name}
            <span className="tiny muted" style={{ fontWeight: 500 }}>{project?.name}</span>
            {fromTask && (
              <Link className="btn btn-subtle btn-sm" to={`/projects/${id}/tasks/${fromTask}`} data-guide="pt-back-task">
                <ArrowLeft size={12} /> Back to my task
              </Link>
            )}
          </span>
        )}
      />

      <div className="content col gap-4 pt-page">
        <div className="stage-explain">
          <div className="stage-explain-main">
            <p className="stage-explain-text">
              Every BOQ line from Phase 5 is a purchase order. Send it, then keep this sheet true as the vendor
              reports — the PO, indent, challan and GRN numbers, what arrived against what was ordered, and who
              updated what, when.
            </p>
          </div>
          {stage.status === 'completed' && <Badge color="var(--success)" soft="var(--success-soft)" dot>Complete</Badge>}
        </div>

        {/* Three steps, always visible until every order has been sent — the
            first-time user's map of the page. Collapses to one line after. */}
        <details className="ph-brief pt-how" open={kpi.notSent > 0}>
          <summary>How this sheet works — three steps</summary>
          <ol className="pt-steps">
            <li><Send size={14} /> <b>Send the order.</b> Click <i>Order</i> on a row: the PO opens, ready to send by WhatsApp or email. The send time and the PO number are recorded for you.</li>
            <li><Truck size={14} /> <b>Track it.</b> Change <i>Status</i> as the vendor reports. Click <i>Update</i> — or anywhere on the row to open the order on its own page — to add the challan / LR number and the promised date. Late orders turn red.</li>
            <li><PackageCheck size={14} /> <b>Receive it.</b> On delivery, click <i>Update</i> and enter the quantity received and the GRN number. Pending quantity and “Partly Received” are worked out for you.</li>
          </ol>
        </details>

        <details className="ph-brief">
          <summary>What, who, when &amp; how for this phase</summary>
          <div style={{ marginTop: 10 }}><PhaseBrief stage={stage} /></div>
        </details>

        {/* The numbers a coordinator checks first thing. */}
        <div className="pt-kpis">
          <Kpi label="Orders" value={kpi.orders} />
          <Kpi label="Not sent" value={kpi.notSent} tone={kpi.notSent ? 'warn' : ''} />
          <Kpi label="Dispatched / delivered" value={kpi.inTransit} />
          <Kpi label="Received (GRN)" value={kpi.received} tone="ok" />
          <Kpi label="Late" value={kpi.late} tone={kpi.late ? 'bad' : ''} />
          <Kpi label="Ordered value" value={inr(kpi.orderedValue)} small />
          <Kpi label="Received value" value={inr(kpi.receivedValue)} small />
        </div>

        {!trackerReady && (
          <div className="pt-alert">
            <AlertTriangle size={14} /> The BOQ form on this project’s template has no tracking fields yet — an administrator
            needs to refresh the “Branch Opening — Client Flow” template. Until then the sheet is read-only.
          </div>
        )}
        {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}

        <section className="card pt-card">
          <div className="card-head pt-toolbar">
            <h2 className="card-title">Purchase orders</h2>
            <div className="pt-filters">
              <label className="pt-search">
                <Search size={14} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO, item, vendor, challan, GRN…" />
              </label>
              <select className="pt-select" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} aria-label="Vendor">
                <option value="">All vendors</option>
                {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <button type="button" className="btn btn-subtle btn-sm" onClick={exportExcel} data-guide="pt-export">
                <Download size={14} /> Export to Excel
              </button>
            </div>
          </div>
          <div className="pt-chips">
            {FILTERS.map((c) => {
              const n = c.key === 'all' ? rows.length : c.key === 'late' ? kpi.late : rows.filter(({ f }) => f.status === c.key).length;
              return (
                <button type="button" key={c.key} className={`pt-chip${filter === c.key ? ' is-on' : ''}`} onClick={() => setFilter(c.key)}>
                  {c.label} <span>{n}</span>
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No purchase orders yet"
              hint="Orders come from the BOQ lines in Phase 5. Add them there and they appear here automatically."
            />
          ) : visible.length === 0 ? (
            <EmptyState icon={Search} title="Nothing matches that filter" />
          ) : (
            <div className="pt-table-wrap" data-guide="pt-table">
              <table className="table pt-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Order</th>
                    <th>Vendor</th>
                    <th>Qty · Amount</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Received</th>
                    <th>Paper trail</th>
                    <th>Last update</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ r, f }, i) => {
                    const v = r.values || {};
                    const isOpen = open?.id === r._id;
                    const tone = TONE[f.status] || TONE.Ordered;
                    return (
                      <RowGroup key={r._id}>
                        <tr
                          className={`pt-row${f.daysLate ? ' is-late' : ''}${isOpen ? ' is-open' : ''}`}
                          onClick={(ev) => { if (!ev.target.closest('button, select, a, input, textarea, label')) navigate(`/projects/${id}/procurement/${r._id}`); }}
                          title="Open this order"
                        >
                          <td className="muted">{i + 1}</td>
                          <td>
                            <div className="pt-order">
                              <b>{f.po}</b>
                              <span>{r.title || v.item}</span>
                              {v.category && <span className="tiny muted">{v.category}</span>}
                            </div>
                          </td>
                          <td>{v.vendor || <span className="muted">—</span>}</td>
                          <td className="pt-nowrap">
                            <div>{v.quantity || '—'} {v.unit || ''}</div>
                            <div className="tiny muted">{inr(f.amount)}</div>
                          </td>
                          <td className="pt-nowrap">
                            {f.sent ? (
                              <div className="pt-sent">
                                {sentAtOf(v.sent_whatsapp_at) && <span title={`${v.sent_whatsapp_to || ''} ${stampedBy(r, 'sent_whatsapp_at') ? `· by ${stampedBy(r, 'sent_whatsapp_at')}` : ''}`}><CheckCircle2 size={12} /> WhatsApp {fmtDateTime(v.sent_whatsapp_at)}</span>}
                                {sentAtOf(v.sent_email_at) && <span title={`${v.sent_email_to || ''} ${stampedBy(r, 'sent_email_at') ? `· by ${stampedBy(r, 'sent_email_at')}` : ''}`}><CheckCircle2 size={12} /> Email {fmtDateTime(v.sent_email_at)}</span>}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => navigate(`/projects/${id}/purchase-order/${r._id}`)}
                                data-guide="pt-order"
                              >
                                <Send size={12} /> Send order
                              </button>
                            )}
                          </td>
                          <td>
                            {canEdit && trackerReady ? (
                              <select
                                className="pt-select pt-status"
                                style={{ color: tone.color, background: tone.soft }}
                                value={f.status === NOT_SENT ? '' : f.status}
                                onChange={(e) => changeStatus(r, e.target.value)}
                                data-guide="pt-status"
                                aria-label="Order status"
                              >
                                {f.status === NOT_SENT && <option value="" disabled>Not sent yet</option>}
                                {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                              </select>
                            ) : (
                              <Badge color={tone.color} soft={tone.soft}>{f.status}</Badge>
                            )}
                          </td>
                          <td className="pt-nowrap">
                            {f.due ? <div>{fmtDate(f.due)}</div> : <span className="muted">—</span>}
                            {f.daysLate > 0 && <div className="pt-late"><AlertTriangle size={11} /> Late {f.daysLate} day{f.daysLate === 1 ? '' : 's'}</div>}
                            {f.receivedLate > 0 && f.closed && <div className="tiny muted">received {f.receivedLate}d late</div>}
                            {v.dispatch_date && <div className="tiny muted">dispatched {fmtDate(v.dispatch_date)}</div>}
                          </td>
                          <td className="pt-nowrap">
                            {f.received == null ? <span className="muted">—</span> : (
                              <>
                                <div>{f.received} of {f.qty || '?'}</div>
                                {f.pending > 0 && <div className="pt-late" style={{ color: 'var(--warning)' }}>{f.pending} pending</div>}
                                {v.received_date && <div className="tiny muted">{fmtDate(v.received_date)}</div>}
                              </>
                            )}
                          </td>
                          <td className="pt-nowrap tiny">
                            {v.indent_number && <div>Indent {v.indent_number}</div>}
                            {v.delivery_challan_no && <div>DC {v.delivery_challan_no}</div>}
                            {v.lr_docket && <div>LR {v.lr_docket}</div>}
                            {v.grn_number && <div>GRN {v.grn_number}</div>}
                            {!v.indent_number && !v.delivery_challan_no && !v.lr_docket && !v.grn_number && <span className="muted">—</span>}
                          </td>
                          <td className="pt-nowrap tiny">
                            {f.lastBy ? <><div>{f.lastBy}</div><div className="muted">{fmtDateTime(f.lastAt)}</div></> : <span className="muted">—</span>}
                          </td>
                          <td>
                            <div className="pt-actions">
                              {canEdit && trackerReady && (
                                <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpen(isOpen && open.mode === 'edit' ? null : { id: r._id, mode: 'edit' })} data-guide="pt-update">
                                  Update {isOpen && open.mode === 'edit' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              )}
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(isOpen && open.mode === 'history' ? null : { id: r._id, mode: 'history' })} title="Who changed what, when">
                                <History size={12} /> {(r.changeLog || []).length || ''}
                              </button>
                              <Link className="btn btn-ghost btn-sm" to={`/projects/${id}/procurement/${r._id}`} title="Everything about this order, on its own page" data-guide="pt-open">
                                Open <ExternalLink size={11} />
                              </Link>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="pt-panel-row">
                            <td colSpan={11}>
                              {open.mode === 'edit' ? (
                                <OrderEditor
                                  record={r}
                                  facts={f}
                                  vendor={vendorOf(v.vendor)}
                                  statusOptions={statusOptions}
                                  saving={track.isLoading || track.isPending}
                                  onCancel={() => setOpen(null)}
                                  onSave={async (values) => { if (await save(r, values, 'Updated on the tracker')) setOpen(null); }}
                                />
                              ) : (
                                <OrderHistory record={r} />
                              )}
                            </td>
                          </tr>
                        )}
                      </RowGroup>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="ph-grid">
          <div className="col gap-4">
            <AiBrief projectId={id} rows={rows} canRun={canEdit} />

            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Who does what here</h2>
                <span className="tiny muted">{tasks.length} assignment{tasks.length === 1 ? '' : 's'}</span>
              </div>
              {tasks.length === 0 ? (
                <EmptyState icon={ClipboardList} title="No one is assigned to this phase yet" />
              ) : (
                <div className="ph-jobs">
                  {tasks.map((t) => {
                    const meta = TASK_STATUS_META[t.status] || {};
                    return (
                      <button type="button" key={t._id} className="ph-job" onClick={() => navigate(`/projects/${id}/tasks/${t.code}`)}>
                        <span className="ph-job-main">
                          <span className="ph-job-title">{t.title}</span>
                          {t.brief?.how && <span className="ph-job-how">{t.brief.how}</span>}
                        </span>
                        <span className="ph-job-who">
                          <span className="ph-job-who-name">{doerName(t)}</span>
                          {t.plannedEnd && <span className="ph-job-when">by {fmtDate(t.plannedEnd)}</span>}
                        </span>
                        <span className="ph-job-status"><Badge color={meta.color} soft={meta.soft}>{meta.label || t.status}</Badge></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className="col gap-4">
            <section className="card">
              <div className="card-head"><h2 className="card-title">Phase status</h2></div>
              <div className="col gap-2">
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  <Badge color={stage.status === 'completed' ? 'var(--success)' : 'var(--primary)'} soft={stage.status === 'completed' ? 'var(--success-soft)' : undefined} dot>
                    {stage.status === 'completed' ? 'Complete' : stage.status === 'in_progress' ? 'In progress' : 'Not started'}
                  </Badge>
                  <span className="tiny muted">{fmtDate(stage.plannedStart)} – {fmtDate(stage.plannedEnd)}</span>
                </div>
                {stage.exitCriteria && <p className="tiny muted" style={{ margin: 0 }}>Done when: {stage.exitCriteria}</p>}
                <p className="tiny muted" style={{ margin: 0 }}>
                  {rows.filter(({ f }) => f.moved || f.status === 'Cancelled').length} of {rows.length} orders dispatched or closed.
                </p>
                {/* No "complete this phase" button: the phase is complete
                    when its tasks are. Dispatching an order is what carries
                    it forward, and the count above is what says how far. */}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}

/** React needs one element per map item; a Fragment with a key does it without extra markup. */
function RowGroup({ children }) { return <>{children}</>; }

function Kpi({ label, value, tone = '', small = false }) {
  return (
    <div className={`pt-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="pt-kpi-label">{label}</span>
      <span className={`pt-kpi-value${small ? ' is-small' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * The in-place Update panel. Only changed fields are sent; the status is
 * worked out from the received quantity unless the user picked one.
 */
function AiBrief({ projectId, rows, canRun }) {
  const { data: saved } = useSavedProcurementBrief(projectId);
  const run = useProcurementBrief();
  const [fresh, setFresh] = useState(null);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(null);
  const brief = fresh || saved;

  const generate = async () => {
    setErr(null);
    try {
      const out = await run.mutateAsync({ projectId, force: true });
      setFresh(out && out.summary === undefined && out.data ? out.data : out);
    } catch (e) {
      setErr(e?.response?.data?.message || 'The AI brief is not available right now.');
    }
  };
  const copy = async (text, i) => {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked — the text is visible to select */ }
  };
  const rowByPo = (po) => rows.find(({ f }) => f.po === po)?.r;
  const busy = run.isLoading || run.isPending;

  return (
    <section className="card pt-ai" data-guide="pt-ai">
      <div className="card-head">
        <h2 className="card-title"><Sparkles size={15} /> What to chase today</h2>
        {canRun && rows.length > 0 && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={generate} disabled={busy}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} /> {busy ? 'Thinking…' : brief ? 'Refresh' : 'Get today’s brief'}
          </button>
        )}
      </div>
      {err && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {err}</div>}
      {!brief ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          {rows.length === 0 ? 'Once there are orders, AI can tell you which ones need a nudge and draft the message.'
            : 'AI reads this sheet and tells you which orders need a nudge today — with a ready-to-send message for each. Suggestions only; nothing is changed.'}
        </p>
      ) : (
        <div className="col gap-3">
          <p className="pt-ai-summary">{brief.summary}</p>
          {brief.chaseToday?.length > 0 && (
            <div className="col gap-2">
              {brief.chaseToday.map((c, i) => {
                const rec = rowByPo(c.po);
                return (
                  <div key={i} className="pt-chase">
                    <div className="pt-chase-head">
                      <b>{c.po}</b>{c.vendor && <span> · {c.vendor}</span>}
                      <span className="tiny muted"> — {c.why}</span>
                    </div>
                    {c.message && (
                      <div className="pt-chase-msg">
                        <span>{c.message}</span>
                        <div className="row gap-1">
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(c.message, i)}><Copy size={12} /> {copied === i ? 'Copied' : 'Copy'}</button>
                          {rec && <Link className="btn btn-ghost btn-sm" to={`/projects/${projectId}/purchase-order/${rec._id}`}>Open order <ExternalLink size={11} /></Link>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {brief.risks?.length > 0 && (
            <ul className="pt-ai-list"><li className="pt-ai-list-title">Risks</li>{brief.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          {brief.goingWell?.length > 0 && (
            <ul className="pt-ai-list is-ok"><li className="pt-ai-list-title">Going well</li>{brief.goingWell.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          <span className="tiny muted">
            {brief.saved ? `Saved brief from ${fmtDateTime(brief.savedAt)}` : `Generated ${fmtDateTime(brief.savedAt)}`} · suggestions only, grounded in this sheet
          </span>
        </div>
      )}
    </section>
  );
}

