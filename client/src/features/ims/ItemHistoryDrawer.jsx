import { Link } from 'react-router-dom';
import {
  ArrowDownLeft, ArrowUpRight, ClipboardCheck, ArrowLeftRight, PackageX, ExternalLink,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useGetItemHistoryQuery } from '../../app/api/imsApi.js';
import { n, money, Thumb } from '../master/inventoryUi.jsx';
import { StockBar, StatusPill } from './imsUi.jsx';

/**
 * One item's ledger at one location — the drill-down behind a stock row.
 *
 * THIS IS WHY THE LEDGER EXISTS. The question people actually bring to a stock
 * system is never "how many are there" — the shelf answers that. It is "there
 * should be nine and there are six, what happened", and only a record of what
 * happened can answer it. So every row shows the change, who made it, why, and
 * the balance it left behind, newest first.
 *
 * BALANCES ARE SHOWN AS STORED, not recomputed from the rows above them. They
 * were frozen at the moment each movement was written, which is what makes the
 * trail auditable: if the running balance ever drifts, these say exactly which
 * row it drifted at. Re-deriving them here would hide the very thing somebody
 * opened this drawer to find.
 */

const ICON = {
  in: ArrowDownLeft,
  transfer_in: ArrowDownLeft,
  out: ArrowUpRight,
  transfer_out: ArrowUpRight,
  adjust: ClipboardCheck,
};

const TYPE_LABEL = {
  in: 'Received',
  out: 'Issued',
  adjust: 'Counted',
  transfer_in: 'Transferred in',
  transfer_out: 'Transferred out',
};

/** "2 Sep 2026, 4:18 pm" — a movement is read against when it happened. */
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

export default function ItemHistoryDrawer({ row, onClose }) {
  const { data: raw, isLoading } = useGetItemHistoryQuery(
    { itemId: row?.item, location: row?.location, limit: 60 },
    { skip: !row?.item },
  );

  if (!row) return null;
  const history = raw?.data ?? raw ?? [];

  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      width={null}
      title={row.name}
      subtitle={`${row.sku} · ${row.locationName}`}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Link to={`/ims/movements?item=${row.item}`} className="btn btn-ghost btn-sm" onClick={onClose}>
            <ExternalLink size={14} /> Open in the ledger
          </Link>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="inv-drawer">
        <div className="inv-drawer-hero">
          <Thumb src={row.imageUrl} alt={row.name} size={72} radius={12} />
          <div className="col gap-2" style={{ minWidth: 0, flex: 1 }}>
            <StockBar onHand={row.onHand} safetyStock={row.safetyStock} status={row.status} />
            <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusPill status={row.status} />
              {row.price != null && <span className="inv-price">{money(row.value)} held</span>}
            </div>
          </div>
        </div>

        <div className="inv-facts">
          <div className="inv-fact">
            <span className="inv-fact-label">On hand</span>
            <span className="inv-fact-value">{n(row.onHand)} {row.unit || ''}</span>
          </div>
          <div className="inv-fact">
            <span className="inv-fact-label">Safety level</span>
            <span className="inv-fact-value">{row.safetyStock > 0 ? n(row.safetyStock) : 'Not set'}</span>
          </div>
          <div className="inv-fact">
            <span className="inv-fact-label">Reorder qty</span>
            <span className="inv-fact-value">{row.reorderQty > 0 ? n(row.reorderQty) : '—'}</span>
          </div>
          <div className="inv-fact">
            <span className="inv-fact-label">Last counted</span>
            <span className="inv-fact-value" style={{ fontSize: 12 }}>{row.lastCountedAt ? when(row.lastCountedAt) : 'Never'}</span>
          </div>
        </div>

        <div className="col gap-2">
          <h3 className="inv-section-title"><ClipboardCheck size={13} /> Movement history</h3>

          {isLoading ? (
            <span className="tiny muted">Reading the ledger…</span>
          ) : history.length === 0 ? (
            <div className="inv-fact" style={{ alignItems: 'flex-start' }}>
              <span className="inv-fact-label"><PackageX size={12} style={{ verticalAlign: -2 }} /> Nothing yet</span>
              <span className="tiny muted">
                This row was created at zero and has not moved. Use <b>Stock in</b> to record the
                opening quantity, or <b>Count</b> if you are entering what a stocktake found.
              </span>
            </div>
          ) : (
            <div className="col gap-1">
              {history.map((m) => {
                const Icon = ICON[m.type] || ClipboardCheck;
                const dir = m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : 'flat';
                return (
                  <div key={m._id} className="ims-row" style={{ alignItems: 'flex-start' }}>
                    <Icon
                      size={16}
                      style={{ flex: 'none', marginTop: 2, color: dir === 'up' ? 'var(--success)' : dir === 'down' ? 'var(--danger)' : 'var(--text-subtle)' }}
                    />
                    <span className="ims-row-main">
                      <span className="ims-row-name">
                        {TYPE_LABEL[m.type] || m.type}
                        {m.counterparty?.name && (
                          <span className="tiny muted">
                            {' '}<ArrowLeftRight size={10} style={{ verticalAlign: -1 }} /> {m.counterparty.name}
                          </span>
                        )}
                      </span>
                      <span className="ims-row-sub">
                        {when(m.at)} · {m.by?.name || 'System'}
                        {m.reference && <> · ref {m.reference}</>}
                      </span>
                      {m.note && <span className="ims-row-sub" style={{ fontStyle: 'italic' }}>{m.note}</span>}
                    </span>
                    <span className="col" style={{ alignItems: 'flex-end', gap: 2, flex: 'none' }}>
                      <span className={`ims-move ims-move--${dir}`}>
                        {m.delta > 0 ? '+' : ''}{n(m.delta)}
                      </span>
                      <span className="tiny muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {n(m.balanceBefore)} → <b style={{ color: 'var(--text)' }}>{n(m.balanceAfter)}</b>
                      </span>
                      {m.reason && <span className="ims-reason">{m.reason.replace(/_/g, ' ')}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
