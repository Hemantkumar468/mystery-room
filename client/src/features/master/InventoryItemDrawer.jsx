import { Link } from 'react-router-dom';
import {
  Pencil, Warehouse, ArrowDownLeft, ArrowUpRight, ClipboardCheck, ExternalLink, PackageX,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { useGetStockQuery, useGetItemHistoryQuery, STOCK_STATUS } from '../../app/api/imsApi.js';
import { n, money, CategoryPill, VisibilityTag, Thumb } from './inventoryUi.jsx';

/**
 * One catalogue item, opened from the master's eye icon.
 *
 * WHY IT SHOWS STOCK AT ALL, on a page that deliberately holds no quantities.
 * "What is this thing" and "have we got any" are asked in the same breath by
 * the same person, and making them switch modules to finish the thought is the
 * friction that gets a system worked around. The master still does not OWN the
 * count — this reads it from the IMS, live, through `/ims/stock?item=…`, and
 * the numbers come from the same aggregation the IMS grid uses, so the two can
 * never disagree.
 *
 * A DRAWER rather than a dialog: it is a side note on the row you were reading,
 * and the table behind it stays visible and in place, so closing it returns you
 * to exactly where you were rather than to the top of the list.
 */

/** One `<dt>/<dd>` pair, as the small tiles the drawer is built from. */
function Fact({ label, value, title }) {
  return (
    <div className="inv-fact" title={title}>
      <span className="inv-fact-label">{label}</span>
      <span className="inv-fact-value">{value}</span>
    </div>
  );
}

const MOVEMENT_ICON = {
  in: ArrowDownLeft, transfer_in: ArrowDownLeft, out: ArrowUpRight, transfer_out: ArrowUpRight, adjust: ClipboardCheck,
};

export default function InventoryItemDrawer({ item, onClose, onEdit }) {
  /* Both reads are skipped entirely while the drawer is shut — an open prop of
     `null` must not cost two requests on every render of the table behind it. */
  const { data: stockRaw, isLoading: stockLoading } = useGetStockQuery(
    { item: item?._id, limit: 50 },
    { skip: !item?._id },
  );
  const { data: historyRaw } = useGetItemHistoryQuery(
    { itemId: item?._id, limit: 8 },
    { skip: !item?._id },
  );

  if (!item) return null;

  const stock = stockRaw?.rows ? stockRaw : (stockRaw?.data ?? {});
  const rows = stock.rows || [];
  const history = historyRaw?.data ?? historyRaw ?? [];

  const totalUnits = rows.reduce((sum, r) => sum + (r.onHand || 0), 0);
  const stockedAt = rows.filter((r) => r.onHand > 0).length;
  const needsAction = rows.filter((r) => ['out', 'critical', 'low'].includes(r.status)).length;

  return (
    <Modal
      open
      onClose={onClose}
      variant="drawer"
      width={null}
      title={item.name}
      subtitle={item.sku}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Link to={`/ims/stock?item=${item._id}`} className="btn btn-ghost btn-sm" onClick={onClose}>
            <Warehouse size={14} /> Manage stock
          </Link>
          <div className="row gap-2">
            {onEdit && (
              <button type="button" className="btn btn-ghost" onClick={() => { onEdit(item); onClose(); }}>
                <Pencil size={14} /> Edit
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    >
      <div className="inv-drawer">
        <div className="inv-drawer-hero">
          <Thumb src={item.imageUrl} alt={item.name} size={96} radius={12} className="inv-drawer-img" />
          <div className="col gap-2" style={{ minWidth: 0 }}>
            <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <CategoryPill value={item.category} />
              <VisibilityTag value={item.visibility} archived={item.active === false} />
            </div>
            <span className={item.price == null ? 'inv-price inv-price--none' : 'inv-price'} style={{ fontSize: 20 }}>
              {item.price == null ? 'Not priced' : money(item.price)}
              {item.price != null && item.unit && <span className="tiny muted" style={{ fontWeight: 500 }}> / {item.unit}</span>}
            </span>
            {item.notes && <span className="tiny muted">{item.notes}</span>}
          </div>
        </div>

        <div className="inv-facts">
          <Fact label="Unit" value={item.unit || '—'} />
          <Fact label="Vendor" value={item.vendorName || '—'} />
          <Fact label="Vendor contact" value={item.vendorDetails || '—'} />
          <Fact
            label="Source"
            value={item.source === 'sheet' ? 'BoxHero export' : 'Added here'}
            title={item.source === 'sheet' ? 'Migrated from the spreadsheet' : 'Created on this page'}
          />
        </div>

        {/* ── the live count ─────────────────────────────────────────── */}
        <div className="col gap-2">
          <h3 className="inv-section-title"><Warehouse size={13} /> Stock right now</h3>

          {stockLoading ? (
            <span className="tiny muted">Reading the count…</span>
          ) : rows.length === 0 ? (
            <div className="inv-fact" style={{ alignItems: 'flex-start' }}>
              <span className="inv-fact-label">Not stocked anywhere</span>
              <span className="tiny muted">
                No location carries this item yet. Receiving it into a location on{' '}
                <Link to="/ims/stock" onClick={onClose} style={{ color: 'var(--primary)' }}>Inventory → Stock</Link>{' '}
                creates its first stock row.
              </span>
            </div>
          ) : (
            <>
              <div className="inv-facts">
                <Fact label="Total on hand" value={`${n(totalUnits)}${item.unit ? ` ${item.unit}` : ''}`} />
                <Fact label="Locations holding it" value={`${stockedAt} of ${rows.length}`} />
                <Fact
                  label="Needs ordering"
                  value={needsAction ? `${needsAction} location${needsAction === 1 ? '' : 's'}` : 'None'}
                  title="At or under the safety level somebody set for that location"
                />
              </div>

              <div className="col gap-1">
                {rows.map((r) => {
                  const status = STOCK_STATUS[r.status] || STOCK_STATUS.unset;
                  return (
                    <div key={r._id} className="inv-cat" title={status.hint}>
                      <span className="inv-cat-name">
                        {r.locationName}
                        <span className="tiny muted"> · {r.locationCode}</span>
                      </span>
                      <span className={`inv-tag inv-tag--${status.tone === 'success' ? 'listed' : status.tone === 'muted' ? 'unlisted' : 'archived'}`}>
                        {status.label}
                      </span>
                      <span className="inv-cat-count">
                        <b style={{ color: 'var(--text)', fontSize: 13 }}>{n(r.onHand)}</b>
                        {r.safetyStock > 0 ? ` / ${n(r.safetyStock)} min` : ' · no floor'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── the last few movements ─────────────────────────────────── */}
        <div className="col gap-2">
          <h3 className="inv-section-title"><ClipboardCheck size={13} /> Recent movements</h3>
          {history.length === 0 ? (
            <span className="tiny muted">
              <PackageX size={11} style={{ verticalAlign: -1 }} /> Nothing has moved yet — every receipt, issue and
              count will appear here, newest first.
            </span>
          ) : (
            <div className="col gap-1">
              {history.map((m) => {
                const Icon = MOVEMENT_ICON[m.type] || ClipboardCheck;
                const up = m.delta > 0;
                return (
                  <div key={m._id} className="inv-cat">
                    <Icon size={14} style={{ flex: 'none', color: up ? 'var(--success)' : 'var(--danger)' }} />
                    <span className="inv-cat-name" style={{ fontWeight: 500 }}>
                      {m.location?.name || '—'}
                      {m.reason && <span className="tiny muted"> · {m.reason.replace(/_/g, ' ')}</span>}
                    </span>
                    <span className="inv-cat-count">
                      <b style={{ color: up ? 'var(--success)' : 'var(--danger)', fontSize: 13 }}>
                        {up ? '+' : ''}{n(m.delta)}
                      </b>
                      {' → '}{n(m.balanceAfter)}
                    </span>
                  </div>
                );
              })}
              <Link to={`/ims/movements?item=${item._id}`} className="tiny" onClick={onClose} style={{ color: 'var(--primary)', fontWeight: 600 }}>
                See the full ledger <ExternalLink size={10} />
              </Link>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
