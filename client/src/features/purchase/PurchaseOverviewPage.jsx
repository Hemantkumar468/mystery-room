/**
 * Purchasing at a glance, across every centre.
 *
 * The page answers three questions in the order somebody asks them: where are
 * the orders (the four destination cards and the five numbers), where is the
 * money (the category split), and who do I chase today (late orders, by centre
 * and by vendor).
 *
 * Every card and every row is a link into the sheet, filtered to exactly the
 * orders it just counted — so a number on this page and the rows behind it can
 * never describe different sets.
 *
 * Reads the same Phase 5 BOQ lines every project's tracker reads; nothing is
 * stored here. Acting on an order (raise, send, update, GRN) stays on the
 * pages that own it, which every row links to.
 */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Building2, Handshake, ArrowRight, ExternalLink, PackageCheck,
  FileText, ShoppingCart, Truck, LayoutGrid, IndianRupee, Clock, CheckCircle2,
  ChevronRight, Zap, Sofa, Wind, Grid3x3, Boxes, MoreHorizontal, Search, X,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { fmtDate } from '../../lib/format.js';
import { CLOSED, inr } from '../projects/orderTracking.jsx';
import { purchaseOrderPath } from '../projects/orderRoutes.js';
import { usePurchaseOrders, summarise, groupBy, inrShort } from './usePurchaseOrders.js';
import { categoryOf, stageOf, valueOf, lateOf } from './purchasePipeline.js';

/**
 * The four places to go, each carrying its own numbers.
 *
 * A card that only says "Delivery & GRN" makes you click to find out whether
 * it matters; one that says how many, how much and how many are overdue
 * answers that first. `stage` is the filter the sheet opens with.
 */
const DESTINATIONS = [
  { stage: 'raise', title: 'To raise', hint: 'vendor chosen, no PO yet', icon: FileText, tone: 'var(--warning)' },
  { stage: 'tracking', title: 'On the way', hint: 'ordered, nothing received', icon: ShoppingCart, tone: 'var(--info)' },
  { stage: 'grn', title: 'Received', hint: 'arrived in full, GRN booked', icon: Truck, tone: 'var(--success)' },
  { stage: 'all', title: 'All Order Lines', hint: 'every stage', icon: LayoutGrid, tone: 'var(--primary)' },
];

/**
 * A category's mark, chosen by what the category IS rather than by its place in
 * the list — so the same trade keeps the same icon however the table is sorted
 * or filtered. Anything the BOQ names that is not here gets the neutral mark;
 * this is for recognition at a glance, not a taxonomy.
 */
const CATEGORY_ICON = {
  electrical: { icon: Zap, tone: 'var(--warning)' },
  furniture: { icon: Sofa, tone: 'var(--info)' },
  flooring: { icon: Grid3x3, tone: 'var(--success)' },
  hvac: { icon: Wind, tone: 'var(--info)' },
  civil: { icon: Boxes, tone: 'var(--text-subtle)' },
};
const categoryMark = (name) => CATEGORY_ICON[String(name).toLowerCase()]
  || { icon: MoreHorizontal, tone: 'var(--text-subtle)' };

/** A destination card: an icon, the count, the value, and what is late in it. */
function NavCard({ title, hint, rows, to, icon: Icon, tone }) {
  const navigate = useNavigate();
  const late = lateOf(rows);
  return (
    <button type="button" className="pu-ncard" onClick={() => navigate(to)}>
      <span className="pu-ncard-top">
        <span
          className="pu-ncard-icon"
          style={{ color: tone, background: `color-mix(in srgb, ${tone} 13%, transparent)` }}
        >
          <Icon size={17} />
        </span>
        <span className="pu-ncard-id">
          <span className="pu-ncard-t">{title}</span>
          <span className="pu-ncard-w">{hint}</span>
        </span>
        <span className="pu-ncard-c" style={{ color: tone }}>{rows.length}</span>
      </span>
      {/* A rule between what the card IS and what it is worth: the count above
          answers "how many", the footer "how much, and how bad". */}
      <span className="pu-ncard-ft">
        <b>{inrShort(valueOf(rows))}</b>
        {late
          ? <span className="pu-pill pu-pill--late"><AlertTriangle size={11} /> {late} overdue</span>
          : <span className="pu-pill pu-pill--ok">on track</span>}
      </span>
    </button>
  );
}

/** One headline number, with the icon that says which kind of number it is. */
function Stat({ label, value, icon: Icon, tone }) {
  return (
    <div className="pu-card">
      <span
        className="pu-card-icon"
        style={{ color: tone, background: `color-mix(in srgb, ${tone} 13%, transparent)` }}
      >
        <Icon size={16} />
      </span>
      <span className="pu-card-body">
        <b style={{ color: tone }}>{value}</b>
        <span>{label}</span>
      </span>
    </div>
  );
}

/** The "View all …" link every section carries in its corner. */
const ViewAll = ({ to, children }) => (
  <Link className="pu-viewall" to={to}>{children} <ArrowRight size={12} /></Link>
);

export function PurchaseOverviewPage() {
  const navigate = useNavigate();
  /** Every project's Phase 5 BOQ lines, in one read. */
  const { rows, isLoading } = usePurchaseOrders();

  /* The scope lives in the URL so a narrowed view survives a reload and can be
     sent to somebody — and because the Purchase Orders sheet reads these two
     parameters under the same names, which is what lets every card below hand
     its filter through instead of dropping it at the door. */
  const [params, setParams] = useSearchParams();
  const project = params.get('project') || '';
  const search = (params.get('q') || '').trim().toLowerCase();
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  /* What every link below must carry to keep the reader inside their scope. */
  const scopeQs = (extra) => {
    const q = new URLSearchParams();
    /* Only when there IS one. The sheets take a single centre or nothing, so
       a card pressed while this page is showing every centre carries its stage
       across and leaves the centre to be chosen there. */
    if (project) q.set('project', project);
    if (params.get('q')) q.set('q', params.get('q'));
    Object.entries(extra || {}).forEach(([k2, v]) => { if (v) q.set(k2, v); });
    const str = q.toString();
    return str ? `?${str}` : '';
  };

  /* The centres that actually have orders, named as the reader knows them.
     Built from `rows` and not from the project list, so the dropdown can never
     offer a centre whose every card would then read zero. */
  const centres = useMemo(() => {
    const seen = new Map();
    for (const row of rows) {
      if (!row.project.id || seen.has(row.project.id)) continue;
      seen.set(row.project.id, row.project);
    }
    return [...seen.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows]);

  /* EVERY NUMBER BELOW COMES FROM HERE. A summary whose cards count one set
     and whose tables list another is worse than no filter at all. */
  const scoped = useMemo(() => rows.filter((row) => {
    if (project && row.project.id !== project) return false;
    if (!search) return true;
    const v = row.r.values || {};
    return [v.po_number, v.item, row.r.title, v.vendor, v.grn_number, row.project.name, row.project.city]
      .some((x) => String(x || '').toLowerCase().includes(search));
  }), [rows, project, search]);

  if (isLoading) {
    return (<><Topbar title="Purchase Overview" /><div className="content"><SkCharts /></div></>);
  }

  const centre = centres.find((c) => c.id === project) || null;
  const k = summarise(scoped);
  const atStage = (key) => (key === 'all' ? scoped : scoped.filter((row) => stageOf(row) === key));

  /* Where the money sits — by the BOQ's own category, which is the only
     grouping the form actually records. */
  const byCategory = groupBy(scoped, categoryOf).sort((a, b) => b.orderedValue - a.orderedValue);
  const total = k.orderedValue || 1;

  const byCentre = groupBy(scoped, (row) => row.project.id, (row) => row.project)
    .sort((a, b) => b.late - a.late || b.open - a.open);
  const byVendor = groupBy(scoped, ({ r }) => r.values?.vendor)
    .filter((g) => g.key !== '—')
    .sort((a, b) => b.orderedValue - a.orderedValue)
    .slice(0, 6);
  const late = scoped.filter(({ f }) => f.daysLate > 0)
    .sort((a, b) => b.f.daysLate - a.f.daysLate).slice(0, 4);

  return (
    <>
      <Topbar title="Purchase Overview" />
      <div className="content">
        <div className="col gap-4 fade-in">

          {/* The scope. Nothing chosen means every centre, which is what the
              page is for; choosing one narrows every card, table and list
              below it rather than opening a different page. */}
          <div className="pu-scope">
            <label className="pu-scope-find">
              <Search size={15} />
              <input
                type="search"
                value={params.get('q') || ''}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search PO, item, vendor, project, GRN…"
                aria-label="Search purchase orders"
              />
            </label>
            <select
              className="pt-select pu-scope-centre"
              value={project}
              onChange={(e) => setParam('project', e.target.value)}
              aria-label="Project"
            >
              <option value="">All projects ({rows.length} lines)</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.city ? ` · ${c.city}` : ''}
                </option>
              ))}
            </select>
            {(project || search) && (
              <button
                type="button"
                className="btn btn-subtle btn-sm"
                onClick={() => setParams(new URLSearchParams(), { replace: true })}
              >
                <X size={13} /> Clear
              </button>
            )}
            {/* Said plainly, because every number on the page is now this
                subset and nothing else says so. */}
            <span className="pu-scope-count tiny muted">
              {centre
                ? `${centre.name} — ${scoped.length} of ${rows.length} order lines`
                : `${scoped.length} order line${scoped.length === 1 ? '' : 's'} across ${centres.length} centre${centres.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {scoped.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="Nothing matches this scope"
              hint={project
                ? 'This centre has no BOQ lines yet, or none match the search. Clear the filter to see every centre.'
                : 'No order line matches that search. Clear it to see every centre.'}
            />
          ) : (
          <>
          <div className="pu-ncards">
            {DESTINATIONS.map((d) => (
              <NavCard
                key={d.stage}
                title={d.title}
                hint={d.hint}
                icon={d.icon}
                tone={d.tone}
                rows={atStage(d.stage)}
                to={`/purchase/orders${scopeQs(d.stage === 'all' ? null : { stage: d.stage })}`}
              />
            ))}
          </div>

          <div className="pu-cards">
            <Stat label="Order lines" value={k.orders} icon={ShoppingCart} tone="var(--info)" />
            <Stat label="Total order value" value={inrShort(k.orderedValue)} icon={IndianRupee} tone="var(--primary)" />
            <Stat label="Still open" value={k.open} icon={Clock} tone="var(--info)" />
            <Stat
              label={'Past the vendor’s own date'}
              value={k.late}
              icon={AlertTriangle}
              tone={k.late ? 'var(--danger)' : 'var(--text-subtle)'}
            />
            <Stat label="Closed with a GRN" value={k.received} icon={CheckCircle2} tone="var(--success)" />
          </div>

          <div className="pu-split">
            <SectionCard
              title="Where the money sits"
              subtitle="The BOQ split by its own categories"
              action={<ViewAll to={`/purchase/orders${scopeQs()}`}>View all categories</ViewAll>}
            >
              {byCategory.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable">
                    <thead>
                      <tr>
                        <th>Category</th><th>Lines</th><th>Open</th><th>Late</th>
                        <th>Value</th><th style={{ width: 170 }}>Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byCategory.map((g) => {
                        const mark = categoryMark(g.key);
                        const pct = Math.round((g.orderedValue / total) * 100);
                        return (
                          <tr key={g.key} onClick={() => navigate(`/purchase/orders?category=${encodeURIComponent(g.key)}`)}>
                            <td>
                              <span className="pu-catcell">
                                <span
                                  className="pu-catcell-icon"
                                  style={{ color: mark.tone, background: `color-mix(in srgb, ${mark.tone} 13%, transparent)` }}
                                >
                                  <mark.icon size={13} />
                                </span>
                                <b>{g.key}</b>
                              </span>
                            </td>
                            <td>{g.orders}</td>
                            <td>{g.open}</td>
                            <td>{g.late ? <span className="pt-late"><AlertTriangle size={11} /> {g.late}</span> : <span className="muted">0</span>}</td>
                            <td className="pt-nowrap"><b>{inr(g.orderedValue)}</b></td>
                            <td>
                              <span className="pu-share">
                                <span className="pu-share-pct">{pct}%</span>
                                <span className="pu-mini"><i style={{ width: `${pct}%`, background: mark.tone }} /></span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* The column adds up: three categories and a share bar
                        invite the question "of what?", and the answer was only
                        available in a card two rows above. */}
                    <tfoot>
                      <tr>
                        <td><b>All categories</b></td>
                        <td><b>{k.orders}</b></td>
                        <td><b>{k.open}</b></td>
                        <td>{k.late ? <span className="pt-late"><AlertTriangle size={11} /> {k.late}</span> : <span className="muted">0</span>}</td>
                        <td className="pt-nowrap"><b>{inr(k.orderedValue)}</b></td>
                        <td><span className="pu-share"><span className="pu-share-pct">100%</span></span></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <EmptyState icon={Building2} title="No purchase orders yet" hint="Orders come from the BOQ lines in each project's Phase 5." />
              )}
            </SectionCard>

            <SectionCard
              title="Late — chase today"
              subtitle="Past the promised date and not yet received"
              action={late.length > 0 && <ViewAll to={`/purchase/orders${scopeQs({ stage: 'over' })}`}>View all</ViewAll>}
            >
              {late.length ? (
                <div className="col">
                  {late.map(({ r, f, project }) => (
                    <Link key={r._id} to={purchaseOrderPath(project.id, r._id)} className="pu-late-row">
                      <span className="pu-late-icon"><AlertTriangle size={13} /></span>
                      <span className="col" style={{ minWidth: 0, flex: 1 }}>
                        <span className="sm truncate" style={{ fontWeight: 600 }}>{f.po} · {r.title || r.values?.item}</span>
                        <span className="tiny muted truncate">
                          {r.values?.vendor || 'No vendor'} · {project.name} · due {fmtDate(f.due)}
                        </span>
                      </span>
                      <span className="pu-pill pu-pill--late">{f.daysLate}d</span>
                      <ChevronRight size={14} className="pu-late-caret" />
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState icon={PackageCheck} title="Nothing is late" hint="Every open order is still inside its promised delivery date." />
              )}
            </SectionCard>
          </div>

          {/* Full width each, not side by side. "By centre" carries eight columns;
              sharing a row with the six-column vendor table put 1303px of
              table into 1240px of page, and both scrolled sideways inside
              their own cards. Stacked, each has room to spare. */}
          <div className="pu-stack">
            <SectionCard
              title="By centre"
              subtitle="Each project's orders — click a row for its orders, or open its tracker"
              action={<ViewAll to={`/purchase/orders${scopeQs()}`}>View all orders</ViewAll>}
            >
              {byCentre.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table table-clickable">
                    <thead>
                      <tr>
                        <th>Centre</th><th>Orders</th><th>Not sent</th><th>On way</th>
                        <th>Received</th><th>Late</th><th>Value</th><th aria-label="Action" />
                      </tr>
                    </thead>
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
                              <a
                                className="btn btn-ghost btn-sm"
                                href={`/projects/${g.key}/procurement`}
                                target="_blank"
                                rel="noopener"
                                onClick={(e) => e.stopPropagation()}
                                title="Opens this centre's own Phase 6 tracker in a new tab"
                              >
                                Tracker <ExternalLink size={11} />
                              </a>
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
              title="Vendors with the most on order"
              subtitle="By ordered value — click for that vendor's orders"
              action={byVendor.length > 0 && <ViewAll to={`/purchase/orders${scopeQs()}`}>View all vendors</ViewAll>}
            >
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
          </div>

          <p className="pu-note">
            <b>Read the cards with the numbers.</b> An order can sit in a perfectly healthy stage
            and still be overdue — every red count above is measured against the date the vendor
            itself gave, not against an internal target. {CLOSED.size} statuses close an order
            ({[...CLOSED].join(' and ')}); everything else is still ours to chase.
          </p>
          </>
          )}

        </div>
      </div>
    </>
  );
}

export default PurchaseOverviewPage;
