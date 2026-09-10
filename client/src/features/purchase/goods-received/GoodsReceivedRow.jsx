import { useNavigate } from 'react-router-dom';
import {
  MapPin, Paperclip, TriangleAlert, Eye, FileText, Receipt, Copy,
} from 'lucide-react';
import { fmtDate } from '../../../lib/format.js';
import { ClampText } from '../../../components/ui/ClampText.jsx';
import { purchaseOrderPath } from '../../projects/orderRoutes.js';
import { ReceiptStatusBadge } from './ReceiptStatusBadge.jsx';
import { ProgressIndicator } from './ProgressIndicator.jsx';
import { InvoiceAction } from './InvoiceAction.jsx';
import { TableActionMenu } from './TableActionMenu.jsx';

/**
 * One receipt.
 *
 * The row is a link surface — clicking anywhere that is not itself a control
 * opens the order — which is why every nested control stops propagation.
 */
export function GoodsReceivedRow({ row }) {
  const navigate = useNavigate();
  const { r, f, project } = row;
  const v = r.values || {};
  const orderPath = purchaseOrderPath(project.id, r._id);
  const photos = v.receipt_photos || [];
  const short = f.status === 'Short / Damaged' || Boolean(v.shortage_note);

  /**
   * Only destinations that exist. There is no delete-GRN or download-GRN
   * endpoint on this module, and a menu item that silently does nothing is
   * worse than one that is absent — every entry here lands somewhere real.
   */
  const items = [
    { key: 'view', label: 'View details', icon: Eye, to: orderPath },
    { key: 'doc', label: 'Purchase order', icon: FileText, to: `${orderPath}/document` },
    ...(v.grn_number
      ? [{ key: 'invoice', label: v.invoice_number ? 'View invoice' : 'Raise invoice', icon: Receipt, to: `${orderPath}/invoice` }]
      : []),
    ...(v.grn_number
      ? [{ key: 'copy', label: 'Copy GRN number', icon: Copy, onClick: () => navigator.clipboard?.writeText(v.grn_number) }]
      : []),
  ];

  return (
    <tr onClick={() => navigate(orderPath)} title="Open this order">
      <td>
        <div className="gr-cell gr-nowrap">
          {v.grn_number ? <span className="gr-strong">{v.grn_number}</span> : <span className="gr-primary gr-none">No GRN yet</span>}
          <span className="gr-sub">
            {v.delivery_challan_no && `DC ${v.delivery_challan_no}`}
            {v.delivery_challan_no && v.received_date && ' · '}
            {v.received_date && fmtDate(v.received_date)}
          </span>
        </div>
      </td>

      <td>
        <div className="gr-cell">
          <span className="gr-strong">{f.po}</span>
          <ClampText as="span" lines={2} className="gr-sub" title={r.title || v.item} onMore={() => navigate(orderPath)}>
            {r.title || v.item}
          </ClampText>
        </div>
      </td>

      <td>
        <div className="gr-cell">
          <span className="gr-primary">{project.name}</span>
          <span className="gr-sub">
            <MapPin size={11} />
            {[project.code, project.city].filter(Boolean).join(' · ') || '—'}
          </span>
        </div>
      </td>

      <td>
        <div className="gr-cell">
          {v.vendor
            ? (
              <ClampText as="span" lines={2} className="gr-primary" title={v.vendor} onMore={() => navigate(orderPath)}>
                {v.vendor}
              </ClampText>
            )
            : <span className="gr-primary gr-none">—</span>}
        </div>
      </td>

      <td>
        <div className="gr-cell gr-nowrap">
          {v.received_date ? <span className="gr-primary">{fmtDate(v.received_date)}</span> : <span className="gr-primary gr-none">—</span>}
          {v.received_by && <span className="gr-sub">by {v.received_by}</span>}
          {photos.length > 0 && (
            <span className="gr-sub"><Paperclip size={11} /> {photos.length} proof file{photos.length === 1 ? '' : 's'}</span>
          )}
        </div>
      </td>

      <td>
        <ProgressIndicator received={f.received} ordered={f.qty} unit={v.unit} pending={f.pending} short={short} />
      </td>

      <td><div className="gr-cell"><ReceiptStatusBadge status={f.status} /></div></td>

      <td>
        <div className="gr-cell">
          {/* The one free-text column on this sheet, and the one that broke it:
              a shortage note is whatever the storekeeper typed, so a paragraph
              here made a single row taller than the screen. Two lines, then
              "View more" onto the order, where the note is shown in full
              beside the GRN it belongs to. */}
          {v.shortage_note
            ? (
              <span className="gr-issue">
                <TriangleAlert size={13} />
                <ClampText as="span" lines={2} className="gr-issue-text" title={v.shortage_note} onMore={() => navigate(orderPath)}>
                  {v.shortage_note}
                </ClampText>
              </span>
            )
            : <span className="gr-none">—</span>}
        </div>
      </td>

      <td>
        <div className="gr-cell">
          <InvoiceAction
            invoiceNumber={v.invoice_number}
            sentAt={v.sent_invoice_at}
            grnNumber={v.grn_number}
            invoicePath={`${orderPath}/invoice`}
          />
        </div>
      </td>

      <td>
        <div className="gr-cell">
          <TableActionMenu items={items} label={`Actions for ${v.grn_number || f.po}`} />
        </div>
      </td>
    </tr>
  );
}

export default GoodsReceivedRow;
