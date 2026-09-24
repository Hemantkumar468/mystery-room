import { ArrowDownUp } from 'lucide-react';
import { GoodsReceivedRow } from './GoodsReceivedRow.jsx';

const COLUMNS = [
  { key: 'grn', label: 'GRN', width: 180, sortable: true },
  { key: 'order', label: 'Order', width: 160 },
  { key: 'centre', label: 'Centre', width: 170 },
  { key: 'vendor', label: 'Vendor', width: 160 },
  { key: 'received', label: 'Received', width: 150, sortable: true },
  { key: 'against', label: 'Against ordered', width: 175 },
  { key: 'status', label: 'Status', width: 175 },
  { key: 'short', label: 'Short / damaged', width: 200 },
  { key: 'invoice', label: 'Invoice', width: 165 },
  { key: 'actions', label: '', width: 72 },
];

/**
 * The sheet. Column widths are declared once, in a colgroup, so the header
 * and every row agree without each cell carrying its own width — and so the
 * table degrades to a horizontal scroll instead of squeezing ten columns
 * into a phone.
 */
export function GoodsReceivedTable({ rows, sort, onSort }) {
  return (
    <div className="gr-table-card">
      <div className="gr-table-scroll">
        <table className="gr-table">
          <colgroup>
            {COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable ? (
                    <button type="button" className="gr-sort" onClick={() => onSort(c.key)}>
                      {c.label} <ArrowDownUp size={12} />
                    </button>
                  ) : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <GoodsReceivedRow key={row.r._id} row={row} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default GoodsReceivedTable;
