/**
 * One order, opened beside the sheet: what it is, what the vendor promised,
 * and its journey along BOQ → PO → Tracking → Delivery.
 *
 * Read-only on purpose. Editing an order stays on its project's own page,
 * where the Update panel, the GRN and the send controls already live — two
 * places that can write the same fields is how the tracker and the sheet
 * would start disagreeing. Both links out are at the top.
 *
 * Every step below is built from a field somebody actually filled: a step
 * with nothing behind it says so rather than inventing a date.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, ExternalLink, AlertTriangle } from 'lucide-react';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { TONE, inr, has, stampedBy, sentAtOf } from '../projects/orderTracking.jsx';
import { stageMeta, stageOf, clockOf, promiseOf, actionPathOf, otherPathOf } from './purchasePipeline.js';

/** One dot on the rail. `state` is done | now | pending | none. */
function Event({ state, title, who, when }) {
  return (
    <div className={`pu-ev is-${state}`}>
      <b>{title}</b>
      {who && <span className="pu-ev-who">{who}</span>}
      <span className="pu-ev-when">{when}</span>
    </div>
  );
}

export function PurchaseOrderDrawer({ row, onClose }) {
  /* Escape closes, and the page behind must not scroll while it is open. */
  useEffect(() => {
    if (!row) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  const { r, f, project } = row;
  const v = r.values || {};
  const stage = stageMeta(stageOf(row));
  const tone = TONE[f.status] || TONE.Ordered;
  const clock = clockOf(f);
  const { said, planned } = promiseOf(row);
  const waAt = sentAtOf(v.sent_whatsapp_at);
  const emailAt = sentAtOf(v.sent_email_at);
  const sentAt = waAt || emailAt;

  /* Where the line has got to along the flow, so an event before that point
     reads as done and everything after it as still to come.

     Shortfall is deliberately folded onto the delivery step rather than given
     a sixth position: goods arriving short is not further along than goods
     arriving in full, it is the same point with a worse outcome. Numbering it
     sixth would tick the GRN event on a line whose GRN is not booked. */
  const REACHED = ['all', 'vendor', 'raise', 'tracking', 'grn']
    .indexOf(stage.key === 'short' ? 'grn' : stage.key);
  const at = (i) => (i < REACHED ? 'done' : i === REACHED ? 'now' : 'pending');

  return (
    <>
      <button type="button" className="pu-scrim" aria-label="Close" onClick={onClose} />
      <aside className="pu-drawer" role="dialog" aria-modal="true" aria-label={`Order ${f.po}`}>
        <button type="button" className="pu-dw-x" onClick={onClose} aria-label="Close"><X size={16} /></button>

        <p className="pu-dw-id">{project.name}{project.city ? ` · ${project.city}` : ''}{project.code ? ` · ${project.code}` : ''}</p>
        <p className="pu-dw-id">Phase 5 BOQ · line #{r.seq ?? '—'} · {v.category || 'uncategorised'}</p>
        <h2 className="pu-dw-title">{r.title || v.item || 'Untitled line'}</h2>

        {/* The same action, worded and aimed the same way as the row's own
            button — a drawer that offers a different next step from the row
            it opened from is how two paths start disagreeing. */}
        <div className="pu-dw-acts">
          <Link className="btn btn-primary btn-sm" to={actionPathOf(row)}>
            {stage.action} <ExternalLink size={12} />
          </Link>
          <Link className="btn btn-ghost btn-sm" to={otherPathOf(row)}>
            {stage.goes === 'document' ? 'Tracking & notes' : 'The PO document'} <ExternalLink size={12} />
          </Link>
          {/* The one link with no Purchase equivalent — Phase 5 is a project
              page. It opens in a new tab so the sheet you were reading is
              still there when you come back. */}
          <a
            className="btn btn-ghost btn-sm"
            href={`/projects/${project.id}/phase/p13`}
            target="_blank"
            rel="noopener"
            title="Opens the project's Phase 5 BOQ in a new tab"
          >
            Its BOQ <ExternalLink size={12} />
          </a>
        </div>

        <dl className="pu-kv">
          <dt>Stage</dt>
          <dd><span className="pu-badge" style={{ color: tone.color, background: tone.soft }}>{stage.name}</span></dd>
          <dt>Category</dt><dd>{v.category || <span className="muted">not set</span>}</dd>
          <dt>PO number</dt>
          <dd>{v.po_number || <span className="muted">not raised yet</span>}
            {v.indent_number && <span className="tiny muted"> · indent {v.indent_number}</span>}</dd>
          <dt>Vendor</dt><dd>{v.vendor || <span className="muted">none named</span>}</dd>
          <dt>Quantity</dt>
          <dd>{v.quantity || '—'} {v.unit || ''} × {inr(v.rate)} = <b>{inr(f.amount)}</b></dd>
          <dt>Vendor said</dt>
          <dd>{f.due
            ? <>{said != null && <><b>{said} days</b> — </>}by {fmtDate(f.due)}</>
            : <span className="muted">no date given</span>}</dd>
          <dt>Against that</dt>
          <dd><span className={`pu-due is-${clock.tone}`}>{clock.text}</span></dd>
          <dt>Planned</dt>
          <dd>{planned != null
            ? <>{fmtDate(v.planned_start)} → {fmtDate(v.planned_end)} · {planned} days</>
            : <span className="muted">not planned on the BOQ</span>}</dd>
          {f.received != null && (
            <>
              <dt>Received</dt>
              <dd>{f.received} of {f.qty || '?'}
                {f.pending > 0 && <span className="pu-warn"> · {f.pending} still pending</span>}
                {f.excess > 0 && <span className="pu-warn"> · {f.excess} more than ordered</span>}</dd>
            </>
          )}
        </dl>

        <p className="pu-lb">BOQ line → vendor → PO → tracking → GRN</p>
        <div className="pu-tl">
          <Event
            state="done"
            title={`BOQ line priced${r.status === 'approved' ? ' and approved' : ''}`}
            who={r.createdBy?.name || null}
            when={fmtDateTime(r.createdAt)}
          />
          <Event
            state={at(1)}
            title={v.vendor ? `Vendor chosen · ${v.vendor}` : 'Vendor not chosen yet'}
            who={stampedBy(r, 'vendor')}
            when={v.vendor ? 'recorded on the line' : 'pending'}
          />
          <Event
            state={at(2)}
            title={v.po_number ? `Purchase order raised · ${v.po_number}` : 'Purchase order — not raised yet'}
            who={stampedBy(r, 'po_number')}
            when={v.po_number ? 'recorded on the order' : 'pending'}
          />
          <Event
            state={at(3)}
            title={sentAt
              ? `Sent to the vendor${waAt ? ' on WhatsApp' : ' by email'}`
              : 'Not sent to the vendor yet'}
            /* Only show who it went to when it actually went: the same box that
               holds a junk timestamp usually holds a junk number beside it. */
            who={sentAt ? (v.sent_whatsapp_to || v.sent_email_to || null) : null}
            when={sentAt ? fmtDateTime(sentAt) : 'pending'}
          />
          <Event
            state={at(3)}
            title={v.dispatch_date
              ? `Dispatched${v.transporter ? ` · ${v.transporter}` : ''}${v.lr_docket ? ` · LR ${v.lr_docket}` : ''}`
              : 'Dispatch not recorded'}
            who={stampedBy(r, 'dispatch_date')}
            when={v.dispatch_date ? fmtDate(v.dispatch_date) : 'pending'}
          />
          <Event
            state={at(3)}
            title={v.received_date
              ? `Delivered at site${has(v.received_quantity) ? ` · ${v.received_quantity} counted` : ''}`
              : 'Delivery not recorded'}
            who={v.received_by || stampedBy(r, 'received_date')}
            when={v.received_date ? fmtDate(v.received_date) : 'pending'}
          />
          <Event
            state={at(4)}
            title={v.grn_number ? `GRN booked · ${v.grn_number}` : 'GRN not booked'}
            who={stampedBy(r, 'grn_number')}
            when={v.grn_number ? 'line closed' : 'pending'}
          />
          {/* Only drawn when it happened. A shortfall row on every order would
              read as a step everybody still has to get through. */}
          {f.pending > 0 && f.received != null && (
            <Event
              state="now"
              title={`Short by ${f.pending} · ${f.received} of ${f.qty} arrived`}
              who={v.received_by || stampedBy(r, 'received_date')}
              when="the balance is still owed by the vendor"
            />
          )}
        </div>

        {v.shortage_note && (
          <p className="pu-dw-note"><AlertTriangle size={13} /> {v.shortage_note}</p>
        )}

        {f.lastBy && (
          <p className="tiny muted" style={{ marginTop: 16 }}>
            Last changed by {f.lastBy} · {fmtDateTime(f.lastAt)}
          </p>
        )}
      </aside>
    </>
  );
}

export default PurchaseOrderDrawer;
