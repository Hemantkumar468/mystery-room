/**
 * Every purchase order in the company, in one sheet.
 *
 * The project tracker (ProcurementTrackerPage) is this same sheet for ONE
 * project; here the rows come from every project, with a Centre column, and
 * the filters — centre, vendor, status, search — live in the URL so the
 * overview can deep-link ("all late orders", "everything with this vendor")
 * and a filtered view survives a refresh or a shared link.
 *
 * Read-only by design: clicking a row opens the order on its own project page,
 * where the Update form, the GRN and the send controls already are.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, AlertTriangle, ClipboardList, CheckCircle2 } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { FILTERS, NOT_SENT, TONE, inr, sentAtOf } from '../projects/orderTracking.jsx';
import { usePurchaseOrders } from './usePurchaseOrders.js';

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { rows, isLoading } = usePurchaseOrders();
  const [params, setParams] = useSearchParams();
  const filter = params.get('status') || 'all';
  const projectFilter = params.get('project') || '';
  const vendorFilter = params.get('vendor') || '';
  const search = params.get('q') || '';

  /* One setter: an empty value drops the key, so the URL stays clean. */
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const projects = useMemo(() => {
    const m = new Map();
    for (const { project } of rows) if (project.id && !m.has(project.id)) m.set(project.id, project);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);
  const vendorNames = useMemo(() => [...new Set(rows.map(({ r }) => r.values?.vendor).filter(Boolean))].sort(), [rows]);

  const visible = rows.filter(({ r, f, project }) => {
    if (filter === 'late' ? f.daysLate === 0 : filter !== 'all' && f.status !== filter) return false;
    if (projectFilter && project.id !== projectFilter) return false;
    if (vendorFilter && r.values?.vendor !== vendorFilter) return false;
    if (search) {
      const hay = [f.po, r.title, r.values?.item, r.values?.vendor, r.values?.category, r.values?.indent_number,
        r.values?.delivery_challan_no, r.values?.grn_number, project.name, project.code, project.city].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const lateCount = rows.filter(({ f }) => f.daysLate > 0).length;

  /** CSV with a UTF-8 BOM so Excel opens ₹ and names correctly — what is on screen, nothing wider. */
  const exportExcel = () => {
    const cols = [
      ['Centre', ({ project }) => project.name], ['Centre code', ({ project }) => project.code], ['City', ({ project }) => project.city],
      ['PO No.', ({ f }) => f.po], ['Indent No.', ({ r }) => r.values?.indent_number],
      ['Item', ({ r }) => r.title || r.values?.item], ['Category', ({ r }) => r.values?.category],
      ['Vendor', ({ r }) => r.values?.vendor], ['Qty ordered', ({ r }) => r.values?.quantity], ['Unit', ({ r }) => r.values?.unit],
      ['Rate', ({ r }) => r.values?.rate], ['Amount', ({ f }) => f.amount],
      ['Sent', ({ r }) => [sentAtOf(r.values?.sent_whatsapp_at) && `WhatsApp ${fmtDateTime(r.values.sent_whatsapp_at)}`, sentAtOf(r.values?.sent_email_at) && `Email ${fmtDateTime(r.values.sent_email_at)}`].filter(Boolean).join('; ')],
      ['Status', ({ f }) => f.status], ['Due', ({ f }) => f.due && fmtDate(f.due)], ['Days late', ({ f }) => f.daysLate || ''],
      ['Dispatched on', ({ r }) => r.values?.dispatch_date && fmtDate(r.values.dispatch_date)],
      ['Transporter', ({ r }) => r.values?.transporter], ['LR / Docket', ({ r }) => r.values?.lr_docket],
      ['Received on', ({ r }) => r.values?.received_date && fmtDate(r.values.received_date)],
      ['Qty received', ({ f }) => f.received], ['Qty pending', ({ f }) => f.pending], ['GRN No.', ({ r }) => r.values?.grn_number],
      ['Invoice No.', ({ r }) => r.values?.invoice_number],
      ['Last updated by', ({ f }) => f.lastBy], ['Last updated', ({ f }) => f.lastAt && fmtDateTime(f.lastAt)],
    ];
    const esc = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [cols.map(([h]) => esc(h)).join(','), ...visible.map((row) => cols.map(([, fn]) => esc(fn(row))).join(','))];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'purchase-orders.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <Topbar
        title="Purchase Orders"
        actions={(
          <button type="button" className="btn btn-subtle btn-sm" onClick={exportExcel} disabled={visible.length === 0} data-guide="pu-export">
            <Download size={14} /> Export to Excel
          </button>
        )}
      />
      <div className="content">
        <div className="col gap-3 fade-in">
          <div className="pu-toolbar">
            <label className="pt-search">
              <Search size={14} />
              <input value={search} onChange={(e) => setParam('q', e.target.value)} placeholder="Search PO, item, vendor, centre, GRN…" />
            </label>
            <select className="pt-select" value={projectFilter} onChange={(e) => setParam('project', e.target.value)} aria-label="Centre" data-guide="pu-centre">
              <option value="">All centres</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ''}</option>)}
            </select>
            <select className="pt-select" value={vendorFilter} onChange={(e) => setParam('vendor', e.target.value)} aria-label="Vendor">
              <option value="">All vendors</option>
              {vendorNames.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>{visible.length} of {rows.length} orders</span>
          </div>

          <div className="pt-chips" style={{ margin: 0 }} data-guide="pu-chips">
            {FILTERS.map((c) => {
              const n = c.key === 'all' ? rows.length : c.key === 'late' ? lateCount : rows.filter(({ f }) => f.status === c.key).length;
              return (
                <button type="button" key={c.key} className={`pt-chip${filter === c.key ? ' is-on' : ''}`} onClick={() => setParam('status', c.key === 'all' ? '' : c.key)}>
                  {c.label} <span>{n}</span>
                </button>
              );
            })}
          </div>

          {isLoading ? <SkTable rows={8} /> : rows.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No purchase orders yet" hint="Orders come from the BOQ lines in each project's Phase 5. Add them there and they appear here automatically." />
          ) : visible.length === 0 ? (
            <EmptyState icon={Search} title="Nothing matches these filters" hint="Try another status, centre or vendor — or clear the search." />
          ) : (
            <div className="pt-table-wrap" data-guide="pu-table">
              <table className="table pu-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Order</th>
                    <th>Centre</th>
                    <th>Vendor</th>
                    <th>Qty · Amount</th>
                    <th>Sent</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th>Received</th>
                    <th>Last update</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ r, f, project }, i) => {
                    const v = r.values || {};
                    const tone = TONE[f.status] || TONE.Ordered;
                    const waAt = sentAtOf(v.sent_whatsapp_at);
                    const emailAt = sentAtOf(v.sent_email_at);
                    return (
                      <tr
                        key={r._id}
                        className={f.daysLate ? 'is-late' : ''}
                        onClick={() => navigate(`/projects/${project.id}/procurement/${r._id}`)}
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
                        <td>
                          <div className="pu-centre">
                            <span>{project.name}</span>
                            <span className="tiny">{[project.code, project.city].filter(Boolean).join(' · ')}</span>
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
                              {waAt && <span><CheckCircle2 size={12} /> WhatsApp {fmtDateTime(waAt)}</span>}
                              {emailAt && <span><CheckCircle2 size={12} /> Email {fmtDateTime(emailAt)}</span>}
                            </div>
                          ) : <span className="muted">Not sent</span>}
                        </td>
                        <td><Badge color={tone.color} soft={tone.soft}>{f.status === NOT_SENT ? 'Not sent yet' : f.status}</Badge></td>
                        <td className="pt-nowrap">
                          {f.due ? <div>{fmtDate(f.due)}</div> : <span className="muted">—</span>}
                          {f.daysLate > 0 && <div className="pt-late"><AlertTriangle size={11} /> Late {f.daysLate} day{f.daysLate === 1 ? '' : 's'}</div>}
                          {v.dispatch_date && <div className="tiny muted">dispatched {fmtDate(v.dispatch_date)}</div>}
                        </td>
                        <td className="pt-nowrap">
                          {f.received == null ? <span className="muted">—</span> : (
                            <>
                              <div>{f.received} of {f.qty || '?'}</div>
                              {f.pending > 0 && <div className="pt-late" style={{ color: 'var(--warning)' }}>{f.pending} pending</div>}
                              {v.grn_number && <div className="tiny muted">GRN {v.grn_number}</div>}
                            </>
                          )}
                        </td>
                        <td className="pt-nowrap tiny">
                          {f.lastBy ? <><div>{f.lastBy}</div><div className="muted">{fmtDateTime(f.lastAt)}</div></> : <span className="muted">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default PurchaseOrdersPage;
