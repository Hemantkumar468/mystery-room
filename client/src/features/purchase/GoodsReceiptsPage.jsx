/**
 * Goods received — every delivery and GRN across the company.
 *
 * The orders sheet asks "where is it?"; this one asks "what actually
 * arrived, and has it been invoiced?". One row per order that has reached
 * site: who received it, how much against how much was ordered, what is
 * still pending, what came short or damaged, and the invoice raised against
 * the receipt. Recording a GRN or raising the invoice happens on the order's
 * own project page, which every row links to.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Search, AlertTriangle, PackageCheck, Receipt, ExternalLink, Camera } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { TONE, inr } from '../projects/orderTracking.jsx';
import { usePurchaseOrders, isReceipt } from './usePurchaseOrders.js';

const CHIPS = [
  { key: 'all', label: 'All receipts', test: () => true },
  { key: 'full', label: 'Received in full', test: ({ f }) => f.status === 'Received (GRN)' },
  { key: 'partial', label: 'Partly received', test: ({ f }) => f.status === 'Partly Received' || (f.pending > 0 && f.status !== 'Short / Damaged') },
  { key: 'short', label: 'Short / damaged', test: ({ r, f }) => f.status === 'Short / Damaged' || Boolean(r.values?.shortage_note) },
  { key: 'invoiced', label: 'Invoiced', test: ({ r }) => Boolean(r.values?.invoice_number) },
  { key: 'to-invoice', label: 'GRN, no invoice yet', test: ({ r }) => Boolean(r.values?.grn_number) && !r.values?.invoice_number },
];

export function GoodsReceiptsPage() {
  const navigate = useNavigate();
  const { rows: all, isLoading } = usePurchaseOrders();
  const [params, setParams] = useSearchParams();
  const chip = params.get('view') || 'all';
  const projectFilter = params.get('project') || '';
  const search = params.get('q') || '';
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  /* Newest receipt first — "what arrived this week" is the question. */
  const receipts = useMemo(() => all.filter(isReceipt).sort((a, b) => {
    const da = a.r.values?.received_date || a.f.lastAt || 0;
    const db = b.r.values?.received_date || b.f.lastAt || 0;
    return new Date(db) - new Date(da);
  }), [all]);

  const projects = useMemo(() => {
    const m = new Map();
    for (const { project } of receipts) if (project.id && !m.has(project.id)) m.set(project.id, project);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [receipts]);

  const active = CHIPS.find((c) => c.key === chip) || CHIPS[0];
  const visible = receipts.filter((row) => {
    if (!active.test(row)) return false;
    if (projectFilter && row.project.id !== projectFilter) return false;
    if (search) {
      const { r, f, project } = row;
      const hay = [f.po, r.title, r.values?.item, r.values?.vendor, r.values?.grn_number, r.values?.invoice_number,
        r.values?.delivery_challan_no, r.values?.received_by, project.name, project.code].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const k = {
    grns: receipts.filter(({ r }) => Boolean(r.values?.grn_number)).length,
    partial: receipts.filter(CHIPS[2].test).length,
    short: receipts.filter(CHIPS[3].test).length,
    invoiced: receipts.filter(CHIPS[4].test).length,
    toInvoice: receipts.filter(CHIPS[5].test).length,
    receivedValue: receipts.reduce((s, { r, f }) => s + (f.received ?? 0) * Number(r.values?.rate || 0), 0),
  };

  return (
    <>
      <Topbar title="Goods Received" subtitle="Deliveries, GRNs and invoices across every centre" />
      <div className="content">
        <div className="col gap-3 fade-in">
          <div className="pt-kpis">
            <Kpi label="GRNs recorded" value={k.grns} tone="ok" />
            <Kpi label="Partly received" value={k.partial} tone={k.partial ? 'warn' : ''} />
            <Kpi label="Short / damaged" value={k.short} tone={k.short ? 'bad' : ''} />
            <Kpi label="Invoiced" value={k.invoiced} />
            <Kpi label="GRN, no invoice yet" value={k.toInvoice} tone={k.toInvoice ? 'warn' : ''} />
            <Kpi label="Value received (qty × rate)" value={inr(k.receivedValue)} small />
          </div>

          <div className="pu-toolbar">
            <label className="pt-search">
              <Search size={14} />
              <input value={search} onChange={(e) => setParam('q', e.target.value)} placeholder="Search GRN, invoice, PO, item, vendor, centre…" />
            </label>
            <select className="pt-select" value={projectFilter} onChange={(e) => setParam('project', e.target.value)} aria-label="Centre">
              <option value="">All centres</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ''}</option>)}
            </select>
            <span className="tiny muted" style={{ marginLeft: 'auto' }}>{visible.length} of {receipts.length} receipts</span>
          </div>

          <div className="pt-chips" style={{ margin: 0 }}>
            {CHIPS.map((c) => (
              <button type="button" key={c.key} className={`pt-chip${chip === c.key ? ' is-on' : ''}`} onClick={() => setParam('view', c.key === 'all' ? '' : c.key)}>
                {c.label} <span>{receipts.filter(c.test).length}</span>
              </button>
            ))}
          </div>

          {isLoading ? <SkTable rows={8} /> : receipts.length === 0 ? (
            <EmptyState icon={PackageCheck} title="Nothing received yet" hint="When a delivery is recorded on an order — a GRN, a partial receipt, a shortage — it appears here." />
          ) : visible.length === 0 ? (
            <EmptyState icon={Search} title="Nothing matches these filters" />
          ) : (
            <div className="pt-table-wrap">
              <table className="table pu-table">
                <thead>
                  <tr>
                    <th>GRN</th>
                    <th>Order</th>
                    <th>Centre</th>
                    <th>Vendor</th>
                    <th>Received</th>
                    <th>Against ordered</th>
                    <th>Status</th>
                    <th>Short / damaged</th>
                    <th>Invoice</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ r, f, project }) => {
                    const v = r.values || {};
                    const tone = TONE[f.status] || TONE.Ordered;
                    const pct = f.qty ? Math.min(100, Math.round(((f.received || 0) / f.qty) * 100)) : 0;
                    const photos = v.receipt_photos || [];
                    const orderPath = `/projects/${project.id}/procurement/${r._id}`;
                    return (
                      <tr key={r._id} onClick={() => navigate(orderPath)} title="Open this order">
                        <td className="pt-nowrap">
                          {v.grn_number ? <b>{v.grn_number}</b> : <span className="muted">No GRN yet</span>}
                          {v.delivery_challan_no && <div className="tiny muted">DC {v.delivery_challan_no}</div>}
                        </td>
                        <td>
                          <div className="pt-order">
                            <b>{f.po}</b>
                            <span>{r.title || v.item}</span>
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
                          {v.received_date ? <div>{fmtDate(v.received_date)}</div> : <span className="muted">—</span>}
                          {v.received_by && <div className="tiny muted">by {v.received_by}</div>}
                          {photos.length > 0 && <div className="tiny muted"><Camera size={11} /> {photos.length} proof file{photos.length === 1 ? '' : 's'}</div>}
                        </td>
                        <td className="pt-nowrap">
                          <div>{f.received ?? '—'} of {f.qty || '?'} {v.unit || ''}</div>
                          {f.pending > 0 && <div className="pt-late" style={{ color: 'var(--warning)' }}>{f.pending} pending</div>}
                          <div className={`pu-bar${pct < 100 ? ' is-partial' : ''}`}><span style={{ width: `${pct}%` }} /></div>
                        </td>
                        <td><Badge color={tone.color} soft={tone.soft}>{f.status}</Badge></td>
                        <td style={{ maxWidth: 220 }}>
                          {v.shortage_note ? <span className="tiny" style={{ color: 'var(--danger)' }}><AlertTriangle size={11} /> {v.shortage_note}</span> : <span className="muted">—</span>}
                        </td>
                        <td className="pt-nowrap">
                          {v.invoice_number ? (
                            <>
                              <div><Receipt size={12} /> {v.invoice_number}</div>
                              {v.sent_invoice_at && <div className="tiny muted">sent {fmtDateTime(v.sent_invoice_at)}</div>}
                            </>
                          ) : v.grn_number ? (
                            <Link className="btn btn-subtle btn-sm" to={`/projects/${project.id}/invoice/${r._id}`} onClick={(e) => e.stopPropagation()}>
                              <Receipt size={12} /> Raise invoice
                            </Link>
                          ) : <span className="muted tiny">Needs a GRN first</span>}
                        </td>
                        <td>
                          <Link className="btn btn-ghost btn-sm" to={orderPath} onClick={(e) => e.stopPropagation()} title="Everything about this order, on its own page">
                            Open <ExternalLink size={11} />
                          </Link>
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

function Kpi({ label, value, tone = '', small = false }) {
  return (
    <div className={`pt-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="pt-kpi-label">{label}</span>
      <span className={`pt-kpi-value${small ? ' is-small' : ''}`}>{value}</span>
    </div>
  );
}

export default GoodsReceiptsPage;
