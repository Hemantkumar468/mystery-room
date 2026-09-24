/**
 * What the Goods Received sheet counts, filters and exports.
 *
 * Lifted verbatim out of GoodsReceiptsPage so the chips, the KPI cards and
 * the export all read ONE set of predicates. They already had to agree — the
 * "Partly received" card and the "Partly received" chip are the same
 * question asked twice — and keeping the tests in the page meant the card
 * indexed into CHIPS by position (`CHIPS[2].test`), which silently
 * re-pointed at a different filter the moment somebody reordered the array.
 */
import { fmtDate, fmtDateTime } from '../../../lib/format.js';

export const CHIPS = [
  { key: 'all', label: 'All receipts', test: () => true },
  { key: 'full', label: 'Received in full', test: ({ f }) => f.status === 'Received (GRN)' },
  { key: 'partial', label: 'Partly received', test: ({ f }) => f.status === 'Partly Received' || (f.pending > 0 && f.status !== 'Short / Damaged') },
  { key: 'short', label: 'Short / damaged', test: ({ r, f }) => f.status === 'Short / Damaged' || Boolean(r.values?.shortage_note) },
  { key: 'invoiced', label: 'Invoiced', test: ({ r }) => Boolean(r.values?.invoice_number) },
  { key: 'to-invoice', label: 'GRN, no invoice yet', test: ({ r }) => Boolean(r.values?.grn_number) && !r.values?.invoice_number },
];

/** By key, so a caller names the filter it wants instead of indexing into the array. */
export const chipBy = (key) => CHIPS.find((c) => c.key === key) || CHIPS[0];

/** Free-text haystack for one receipt row — every field the search box claims to cover. */
export function matchesSearch(row, term) {
  if (!term) return true;
  const { r, f, project } = row;
  const v = r.values || {};
  const hay = [f.po, r.title, v.item, v.vendor, v.grn_number, v.invoice_number,
    v.delivery_challan_no, v.received_by, project.name, project.code]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(term.toLowerCase());
}

/** The six numbers on the cards, from the same predicates the chips use. */
export function summariseReceipts(receipts) {
  return {
    grns: receipts.filter(({ r }) => Boolean(r.values?.grn_number)).length,
    partial: receipts.filter(chipBy('partial').test).length,
    short: receipts.filter(chipBy('short').test).length,
    invoiced: receipts.filter(chipBy('invoiced').test).length,
    toInvoice: receipts.filter(chipBy('to-invoice').test).length,
    receivedValue: receipts.reduce((s, { r, f }) => s + (f.received ?? 0) * Number(r.values?.rate || 0), 0),
  };
}

/**
 * Export columns — what is on screen, in screen order. Shared with
 * exportCsv (comparison/exportUtils.js), which is the export helper the rest
 * of the app already uses.
 */
export const EXPORT_COLUMNS = [
  { label: 'GRN No.', get: ({ r }) => r.values?.grn_number },
  { label: 'Delivery challan', get: ({ r }) => r.values?.delivery_challan_no },
  { label: 'PO', get: ({ f }) => f.po },
  { label: 'Item', get: ({ r }) => r.title || r.values?.item },
  { label: 'Centre', get: ({ project }) => project.name },
  { label: 'Centre code', get: ({ project }) => project.code },
  { label: 'City', get: ({ project }) => project.city },
  { label: 'Vendor', get: ({ r }) => r.values?.vendor },
  { label: 'Received on', get: ({ r }) => (r.values?.received_date ? fmtDate(r.values.received_date) : '') },
  { label: 'Received by', get: ({ r }) => r.values?.received_by },
  { label: 'Qty received', get: ({ f }) => f.received },
  { label: 'Qty ordered', get: ({ f }) => f.qty },
  { label: 'Qty pending', get: ({ f }) => f.pending },
  { label: 'Unit', get: ({ r }) => r.values?.unit },
  { label: 'Status', get: ({ f }) => f.status },
  { label: 'Short / damaged', get: ({ r }) => r.values?.shortage_note },
  { label: 'Invoice No.', get: ({ r }) => r.values?.invoice_number },
  { label: 'Invoice sent', get: ({ r }) => (r.values?.sent_invoice_at ? fmtDateTime(r.values.sent_invoice_at) : '') },
  { label: 'Rate', get: ({ r }) => r.values?.rate },
  { label: 'Value received', get: ({ r, f }) => (f.received ?? 0) * Number(r.values?.rate || 0) },
];
