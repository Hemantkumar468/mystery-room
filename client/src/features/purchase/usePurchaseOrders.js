import { useMemo } from 'react';
import { useGlobalStageRecords } from '../../app/api/recordsApi.js';
import { BOQ_STAGE, CLOSED, factsOf, num } from '../projects/orderTracking.jsx';
import { byNewestFirst } from './purchasePipeline.js';

/**
 * Every purchase order in the company — the Phase 5 BOQ lines (stage p13) of
 * every project, read once with no project filter, exactly the way the vendor
 * master reads p12. Each row carries the same derived facts the project's
 * tracker shows (orderTracking.jsx#factsOf), so "late" or "partly received"
 * means one thing everywhere.
 *
 * The server populates `project` with name/code/city on this list, which is
 * what lets these pages say WHERE an order is without a second request.
 *
 * Rows come back NEWEST FIRST, which is the order every purchase list reads
 * in unless it sorts again for itself.
 */
export function usePurchaseOrders() {
  const { data: resp, isLoading, isFetching } = useGlobalStageRecords(BOQ_STAGE);
  const rows = useMemo(() => {
    const today = new Date();
    const records = resp?.data || resp || [];
    return [...records]
      /**
       * ARCHIVED IS GONE; SENT BACK IS NOT.
       *
       * Rejected lines used to be dropped here with everything else, which
       * was right while rejection was a quiet record state. It is now Step
       * 2's second verb — "Send back", with a reason the dialog insists on
       * — and a line that vanishes the moment somebody returns it takes the
       * reason with it. The person who wrote it never learns it came back,
       * which is precisely the failure that dialog exists to prevent.
       *
       * They only ever SURFACE on Step 1 (the register) and Step 2 (the
       * checker's desk): `stageOf` sends anything unapproved to 'check', so
       * no later step can show one. And they carry no money — see
       * `factsOf`, which zeroes a sent-back line's amount so the BOQ value
       * and every step total stay what the company is actually committed to.
       */
      .filter((r) => r.status !== 'archived')
      .map((r) => ({ r, f: factsOf(r, today), project: projectOf(r) }))
      /* Latest to oldest — see purchasePipeline.js#byNewestFirst. Sorting by
         centre name instead put the alphabet at the top of every purchase
         screen and today's work wherever its centre happened to fall; the
         centre is a FILTER on these pages, never the reading order. Pages
         that want their own order (Goods Received sorts on its columns) sort
         again over this one. */
      .sort(byNewestFirst);
  }, [resp]);
  return { rows, isLoading, isFetching };
}

/** The populated project, or a stub when the list was not populated. */
function projectOf(r) {
  const p = r.project;
  if (p && typeof p === 'object') return { id: String(p._id || ''), name: p.name || '—', code: p.code || '', city: p.city || '' };
  return { id: String(p || ''), name: '—', code: '', city: '' };
}

/** Has anything been received on this order — a GRN in progress or done. */
export const isReceipt = ({ r, f }) => f.received != null
  || ['Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged'].includes(f.status)
  || Boolean(r.values?.grn_number);

/** The overview's numbers, from the rows. */
export function summarise(rows) {
  const open = rows.filter(({ f }) => !CLOSED.has(f.status));
  return {
    orders: rows.length,
    open: open.length,
    notSent: rows.filter(({ f }) => !f.sent && f.status === 'Not sent yet').length,
    inTransit: rows.filter(({ f }) => ['Dispatched', 'Delivered'].includes(f.status)).length,
    partly: rows.filter(({ f }) => ['Partly Received', 'Short / Damaged'].includes(f.status)).length,
    received: rows.filter(({ f }) => f.status === 'Received (GRN)').length,
    late: rows.filter(({ f }) => f.daysLate > 0).length,
    orderedValue: rows.reduce((s, { f }) => s + f.amount, 0),
    receivedValue: rows.filter(({ f }) => f.status === 'Received (GRN)').reduce((s, { f }) => s + f.amount, 0),
    invoiced: rows.filter(({ r }) => Boolean(r.values?.invoice_number)).length,
    pendingQty: rows.reduce((s, { f }) => s + (f.pending || 0), 0),
  };
}

/** Rows grouped by a key, each with its own summary. */
export function groupBy(rows, keyOf, labelOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || '—';
    if (!groups.has(key)) groups.set(key, { key, label: labelOf ? labelOf(row) : key, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map((g) => ({ ...g, ...summarise(g.rows) }));
}

/** Rupees, short: ₹12.4 L / ₹1.2 Cr — the overview reads totals, not paise. */
export function inrShort(v) {
  const n = num(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}
