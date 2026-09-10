/**
 * Goods received — every delivery and GRN across the company.
 *
 * The orders sheet asks "where is it?"; this one asks "what actually
 * arrived, and has it been invoiced?". One row per order that has reached
 * site: who received it, how much against how much was ordered, what is
 * still pending, what came short or damaged, and the invoice raised against
 * the receipt. Recording a GRN or raising the invoice happens on the order's
 * own page, which every row links to.
 *
 * This file is composition only. The predicates live in
 * goods-received/receiptFilters.js and every piece of chrome is its own
 * component under goods-received/ — the page had grown to a single 218-line
 * function in which the KPI row indexed into the chip array by position, and
 * the table markup was inlined three levels deep inside a ternary.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { exportCsv } from '../projects/comparison/exportUtils.js';
import { purchaseParentPath } from './config/purchase.routes.config.js';
import { usePurchaseOrders, isReceipt } from './usePurchaseOrders.js';
import { CHIPS, chipBy, summariseReceipts, EXPORT_COLUMNS } from './goods-received/receiptFilters.js';
import { GoodsReceivedStats } from './goods-received/GoodsReceivedStats.jsx';
import { GoodsReceivedFilters } from './goods-received/GoodsReceivedFilters.jsx';
import { ReceiptFilterChips } from './goods-received/ReceiptFilterChips.jsx';
import { GoodsReceivedTable } from './goods-received/GoodsReceivedTable.jsx';
import { GoodsReceivedSkeleton, GoodsReceivedEmpty } from './goods-received/GoodsReceivedSkeleton.jsx';
import './goods-received/goodsReceived.css';

/** What a row sorts on, per sortable column. */
const SORT_VALUE = {
  received: ({ r, f }) => new Date(r.values?.received_date || f.lastAt || 0).getTime() || 0,
  grn: ({ r }) => (r.values?.grn_number || '').toLowerCase(),
};

export function GoodsReceiptsPage() {
  const { rows: all, isLoading } = usePurchaseOrders();
  const [params, setParams] = useSearchParams();
  /* Sort is local state, not a URL param: it is a way of reading the sheet,
     not a way of naming what is on it, and adding it to the address would
     make two links to the same filtered list look different. */
  const [sort, setSort] = useState({ key: 'received', dir: 'desc' });
  const [chipsOpen, setChipsOpen] = useState(true);

  const chip = params.get('view') || 'all';
  /* Two states: a centre is chosen, or it is not. No company-wide option —
     that view is the Overview's. */
  const projectFilter = params.get('project') || '';
  const oneCentre = Boolean(projectFilter);
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const receipts = useMemo(() => all.filter(isReceipt), [all]);

  const projects = useMemo(() => {
    const m = new Map();
    for (const { project } of receipts) if (project.id && !m.has(project.id)) m.set(project.id, project);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [receipts]);

  const active = chipBy(chip);

  /* EVERYTHING ON THE PAGE COUNTS THIS. The centre and the search narrow it;
     the status chip does not, because a chip must not empty the row of chips
     it sits in. The six cards used to count every receipt in the company while
     the table beneath them was already down to one centre — a headline and a
     list describing different sets. */
  const scoped = useMemo(
    () => receipts.filter((row) => !oneCentre || row.project.id === projectFilter),
    [receipts, oneCentre, projectFilter],
  );

  const visible = useMemo(() => {
    const pick = SORT_VALUE[sort.key] || SORT_VALUE.received;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return scoped
      .filter((row) => active.test(row))
      .sort((a, b) => {
        const va = pick(a);
        const vb = pick(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
      });
  }, [scoped, active, sort]);

  const k = useMemo(() => summariseReceipts(scoped), [scoped]);
  const counts = useMemo(
    () => Object.fromEntries(CHIPS.map((c) => [c.key, scoped.filter(c.test).length])),
    [scoped],
  );

  /* How many receipts each centre holds, so the picker says what it opens. */
  const countAt = (pid) => receipts.filter((row) => row.project.id === pid).length;

  /* Choosing a centre is not a filter to clear — it is what makes the sheet
     exist. Only narrowing PAST it counts. */
  const filtered = Boolean(chip !== 'all' || oneCentre);
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  /* Exports WHAT IS ON SCREEN — the current filters and the current sort,
     nothing wider. Same promise the Purchase Orders sheet makes. */
  const onExport = () => exportCsv(visible, EXPORT_COLUMNS, 'goods-received.csv');

  const onSort = (key) => setSort((s) => (
    s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }
  ));

  return (
    <>
      {/* Name, back, export. Nothing else introduces the page: the reader
          arrived from the nav item that already said where they were going. */}
      <Topbar
        title="Goods Received"
        back={purchaseParentPath('purchase-receipts')}
        actions={(
          <button
            type="button"
            className="btn btn-subtle btn-sm"
            onClick={onExport}
            disabled={!oneCentre || visible.length === 0}
            data-guide="pu-export"
          >
            <Download size={14} /> Export to Excel
          </button>
        )}
      />
      <div className="content">
        {isLoading ? (
          <GoodsReceivedSkeleton />
        ) : (
          <div className="gr fade-in">
            {/* The numbers only exist once there is a centre to count them
                for; before that they would be the company's, under a page
                showing nothing. */}
            {oneCentre && <GoodsReceivedStats k={k} />}

            <GoodsReceivedFilters
              centre={projectFilter}
              onCentre={(v) => setParam('project', v)}
              projects={projects}
              countAt={countAt}
              showing={oneCentre ? visible.length : null}
              total={scoped.length}
              chipsOpen={chipsOpen}
              onToggleChips={() => setChipsOpen((o) => !o)}
              filtered={filtered}
            />

            {/* Until a project is named, one line saying what the picker above
                will do — the same shape Data Explorer waits in, without the
                icon. */}
            {!oneCentre ? (
              <div className="empty gr-pick">
                <div className="col gap-1 center">
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                    Select a project to see its goods received
                  </div>
                  <div className="sm muted">
                    Choose one above and everything fills in for it — every GRN and part-delivery
                    against that project&rsquo;s orders, what is still pending, and what is invoiced.
                  </div>
                </div>
              </div>
            ) : (
              <>
                {chipsOpen && (
                  <ReceiptFilterChips
                    chips={CHIPS}
                    active={chip}
                    counts={counts}
                    onPick={(key) => setParam('view', key === 'all' ? '' : key)}
                  />
                )}

                {receipts.length === 0 ? (
                  <GoodsReceivedEmpty
                    title="Nothing received yet"
                    hint="When a delivery is recorded on an order — a GRN, a partial receipt, a shortage — it appears here."
                  />
                ) : visible.length === 0 ? (
                  <GoodsReceivedEmpty
                    title="No goods received found"
                    hint="No goods receipts match your current filters."
                    onClear={clearFilters}
                  />
                ) : (
                  <GoodsReceivedTable rows={visible} sort={sort} onSort={onSort} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default GoodsReceiptsPage;
