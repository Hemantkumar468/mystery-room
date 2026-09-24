import { Link } from 'react-router-dom';
import { FileText, Receipt } from 'lucide-react';
import { fmtDateTime } from '../../../lib/format.js';

/**
 * The invoice column, in its three real states: billed, ready to bill, and
 * not yet receivable. "Needs a GRN" is deliberately not a disabled button —
 * a greyed-out control invites clicking and explains nothing, whereas the
 * sentence names the missing step.
 */
export function InvoiceAction({ invoiceNumber, sentAt, grnNumber, invoicePath }) {
  if (invoiceNumber) {
    return (
      <div className="gr-cell">
        <span className="gr-invoice-done"><Receipt size={13} /> {invoiceNumber}</span>
        {sentAt && <span className="gr-sub">sent {fmtDateTime(sentAt)}</span>}
      </div>
    );
  }
  if (grnNumber) {
    return (
      <Link className="gr-invoice-btn" to={invoicePath} onClick={(e) => e.stopPropagation()}>
        <FileText size={14} /> Raise invoice
      </Link>
    );
  }
  return <span className="gr-sub gr-none">Needs a GRN</span>;
}

export default InvoiceAction;
