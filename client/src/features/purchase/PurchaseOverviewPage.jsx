/**
 * Purchasing at a glance, across every centre: what is open, what has not
 * even been sent, what is on the road, what is late — and the same numbers
 * per centre and per vendor, each one a click away from the orders behind it.
 *
 * Reads the same Phase 5 BOQ lines every project's tracker reads; nothing is
 * stored here. Acting on an order (send, update, GRN) stays on the project's
 * own pages, which every row links to.
 */
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Send, Truck, PackageCheck, AlertTriangle, IndianRupee, Building2, Handshake, ArrowRight, ExternalLink,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { fmtDate } from '../../lib/format.js';
import { TONE } from '../projects/orderTracking.jsx';
import { usePurchaseOrders, summarise, groupBy, inrShort } from './usePurchaseOrders.js';

function Stat({ icon: Icon, label, value, tone, small = false, to }) {
  const navigate = useNavigate();
  const Tag = to ? 'button' : 'div';
  return (
    <Tag
      type={to ? 'button' : undefined}
      className={`pu-stat${to ? ' is-link' : ''}`}
      onClick={to ? () => navigate(to) : undefined}
      title={to ? 'See these orders' : undefined}
    >
      <span className="pu-stat-icon" style={{ color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)` }}>
        <Icon size={16} />
      </span>
      <div className="col" style={{ minWidth: 0 }}>
        <span className={`pu-stat-value${small ? ' is-small' : ''}`}>{value}</span>
        <span className="pu-stat-label">{label}</span>
      </div>
    </Tag>
  );
}

export function PurchaseOverviewPage() {
  const navigate = useNavigate();
  const { rows, isLoading } = usePurchaseOrders();

  if (isLoading) {
    return (<><Topbar title="Purchase Overview" /><div className="content"><SkCharts /></div></>);
  }

  const k = summarise(rows);
  const byCentre = groupBy(rows, (row) => row.project.id, (row) => row.project)
    .sort((a, b) => b.late - a.late || b.open - a.open);
  const byVendor = groupBy(rows, ({ r }) => r.values?.vendor)
    .filter((g) => g.key !== '—')
    .sort((a, b) => b.orderedValue - a.orderedValue)
    .slice(0, 8);
  const late = rows.filter(({ f }) => f.daysLate > 0).sort((a, b) => b.f.daysLate - a.f.daysLate).slice(0, 8);

  return (
    <>
      <Topbar title="Purchase Overview" subtitle="Every order, every centre, every vendor" />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          <div className="pu-stat-grid">
            <Stat icon={ShoppingCart} label="Open orders" value={k.open} tone="var(--primary)" to="/purchase/orders" />
            <Stat icon={Send} label="Not sent yet" value={k.notSent} tone={k.notSent ? 'var(--warning)' : 'var(--text-subtle)'} to="/purchase/orders?status=Not%20sent%20yet" />
            <Stat icon={Truck} label="Dispatched / delivered" value={k.inTransit} tone="var(--info)" to="/purchase/orders?status=Dispatched" />
            <Stat icon={PackageCheck} label="Received (GRN)" value={k.received} tone="var(--success)" to="/purchase/receipts" />
            <Stat icon={AlertTriangle} label="Late" value={k.late} tone={k.late ? 'var(--danger)' : 'var(--text-subtle)'} to="/purchase/orders?status=late" />
            <Stat icon={IndianRupee} label="Ordered value" value={inrShort(k.orderedValue)} tone="var(--primary)" small />
            <Stat icon={IndianRupee} label="Received value" value={inrShort(k.receivedValue)} tone="var(--success)" small />
          </div>

          <div className="row gap-4 wrap" style={{ alignItems: 'flex-start' }}>
            <SectionCard
              title="By centre"
              subtitle="Each project's orders — click a row for its orders, or open its tracker"
              style={{ flex: '1.5 1 420px' }}
              action={<Link className="tbrief-link" to="/purchase/orders">All orders <ArrowRight size={12} /></Link>}
            >
              {byCentre.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable">
                    <thead><tr><th>Centre</th><th>Orders</th><th>Not sent</th><th>On the way</th><th>Received</th><th>Late</th><th>Value</th><th /></tr></thead>
                    <tbody>
                      {byCentre.map((g) => (
                        <tr key={g.key} onClick={() => navigate(`/purchase/orders?project=${encodeURIComponent(g.key)}`)}>
                          <td>
                            <div className="pu-centre">
                              <span className="sm" style={{ fontWeight: 600 }}>{g.label.name}</span>
                              <span className="tiny">{[g.label.code, g.label.city].filter(Boolean).join(' · ')}</span>
                            </div>
                          </td>
                          <td>{g.orders}</td>
                          <td>{g.notSent ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{g.notSent}</span> : <span className="muted">0</span>}</td>
                          <td>{g.inTransit}</td>
                          <td>{g.received}</td>
                          <td>{g.late ? <span className="pt-late"><AlertTriangle size={11} /> {g.late}</span> : <span className="muted">0</span>}</td>
                          <td className="pt-nowrap">{inrShort(g.orderedValue)}</td>
                          <td>
                            {g.key !== '—' && (
                              <Link
                                className="btn btn-ghost btn-sm"
                                to={`/projects/${g.key}/procurement`}
                                onClick={(e) => e.stopPropagation()}
                                title="Open this centre's order tracker"
                              >
                                Tracker <ExternalLink size={11} />
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon={Building2} title="No purchase orders yet" hint="Orders come from the BOQ lines in each project's Phase 5. Add them there and they appear here." />
              )}
            </SectionCard>

            <SectionCard
              title="Late — chase today"
              subtitle="Past the promised date and not yet received"
              style={{ flex: '1 1 300px' }}
              action={late.length > 0 && <Link className="tbrief-link" to="/purchase/orders?status=late">All late <ArrowRight size={12} /></Link>}
            >
              {late.length ? (
                <div className="col">
                  {late.map(({ r, f, project }) => (
                    <Link key={r._id} to={`/projects/${project.id}/procurement/${r._id}`} className="pu-late-row">
                      <div className="col" style={{ minWidth: 0 }}>
                        <span className="sm truncate" style={{ fontWeight: 600 }}>{f.po} · {r.title || r.values?.item}</span>
                        <span className="tiny muted truncate">{r.values?.vendor || 'No vendor'} · {project.name} · due {fmtDate(f.due)}</span>
                      </div>
                      <span className="pt-late" style={{ whiteSpace: 'nowrap' }}><AlertTriangle size={11} /> {f.daysLate}d</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={PackageCheck} title="Nothing is late" hint="Every open order is still inside its promised delivery date." />
              )}
            </SectionCard>
          </div>

          <SectionCard title="Vendors with the most on order" subtitle="By ordered value — click for that vendor's orders">
            {byVendor.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-clickable">
                  <thead><tr><th>Vendor</th><th>Orders</th><th>Open</th><th>Late</th><th>Received</th><th>Ordered value</th></tr></thead>
                  <tbody>
                    {byVendor.map((g) => (
                      <tr key={g.key} onClick={() => navigate(`/purchase/orders?vendor=${encodeURIComponent(g.key)}`)}>
                        <td><span className="sm" style={{ fontWeight: 600 }}>{g.key}</span></td>
                        <td>{g.orders}</td>
                        <td>{g.open}</td>
                        <td>{g.late ? <span className="pt-late"><AlertTriangle size={11} /> {g.late}</span> : <span className="muted">0</span>}</td>
                        <td>{g.received}</td>
                        <td className="pt-nowrap">{inrShort(g.orderedValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Handshake} title="No vendor on any order yet" hint="Pick a vendor on the BOQ line and the spend rolls up here." />
            )}
          </SectionCard>

          <SectionCard title="Orders by status">
            <div className="row gap-2 wrap">
              {[['Not sent yet', k.notSent], ['Ordered', rows.filter(({ f }) => f.status === 'Ordered').length], ['Dispatched', rows.filter(({ f }) => f.status === 'Dispatched').length],
                ['Delivered', rows.filter(({ f }) => f.status === 'Delivered').length], ['Partly Received', rows.filter(({ f }) => f.status === 'Partly Received').length],
                ['Received (GRN)', k.received], ['Short / Damaged', rows.filter(({ f }) => f.status === 'Short / Damaged').length], ['Cancelled', rows.filter(({ f }) => f.status === 'Cancelled').length]]
                .map(([s, n]) => {
                  const tone = TONE[s] || TONE.Ordered;
                  return <Badge key={s} color={tone.color} soft={tone.soft} dot>{s}: {n}</Badge>;
                })}
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export default PurchaseOverviewPage;
