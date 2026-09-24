import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, Plus, CalendarClock, TrendingUp, Clock, User, Building2,
} from 'lucide-react';
import { Badge, Avatar, Spinner } from '../../components/ui/primitives.jsx';
import { useDeal, useMoveDeal } from '../../app/api/crmApi.js';
import { TaskFormModal } from './TaskFormModal.jsx';
import { LostReasonModal } from './LostReasonModal.jsx';
import { CrmTimeline } from './CrmTimeline.jsx';

/**
 * One deal, opened from a board card or the list.
 *
 * THE STAGE HISTORY IS THE POINT OF THIS SCREEN. The board says where a deal
 * is; only this says how it got there and how long each step took. "Twenty-one
 * days in Negotiation" is the sentence that starts a useful conversation, and
 * it exists nowhere else in the product.
 *
 * Moving stage from here goes through the same mutation the board's drag does,
 * including the lost-reason gate — one path, so a deal cannot be closed
 * without a reason just because it was closed from a different screen.
 */

const fmtMoney = (v) => (v ? `₹${(v / 100000).toFixed(1)}L` : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : '—');

/** Hours as something a person reads: 4h, 3d, 2w. */
function readableDuration(hours) {
  if (hours == null) return null;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days}d` : `${Math.round(days / 7)}w`;
}

export function DealDrawer({ id, onClose }) {
  const { data, isLoading, isError } = useDeal(id);
  const move = useMoveDeal();
  const [addingTask, setAddingTask] = useState(false);
  const [pendingLoss, setPendingLoss] = useState(null);
  const [error, setError] = useState(null);

  if (!id) return null;

  const deal = data?.deal;
  const stages = data?.stages || [];

  const changeStage = (stageId) => {
    const target = stages.find((s) => String(s._id) === String(stageId));
    if (!target || String(target._id) === String(deal.stage)) return;

    // The same gate the board applies. Asking for the reason AFTER the move
    // is how deals end up closed with no reason recorded at all.
    if (target.isLost) { setPendingLoss({ stageId }); return; }
    setError(null);
    move.mutate({ id, stage: String(stageId) }, {
      onError: (err) => setError(err?.response?.data?.message || 'Could not move that deal.'),
    });
  };

  const daysInStage = deal?.stageEnteredAt
    ? Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / 86_400_000)
    : null;

  return (
    <>
      <div className="crm-scrim" role="presentation" onClick={onClose} />

      <aside className="crm-drawer" aria-label="Deal details">
        <header className="crm-drawer__head">
          <div style={{ minWidth: 0 }}>
            <strong className="crm-drawer__name">{deal?.title || 'Deal'}</strong>
            {deal && (
              <div className="crm-muted crm-drawer__sub">
                {fmtMoney(deal.value)}
                {deal.pipeline?.name ? ` · ${deal.pipeline.name}` : ''}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {isLoading && <div style={{ padding: 24 }}><Spinner label="Loading…" /></div>}
        {isError && (
          <div className="crm-drawer__body">
            <p className="crm-muted">That deal could not be opened.</p>
          </div>
        )}

        {deal && (
          <div className="crm-drawer__body">
            {error && <div className="crm-form__error">{error}</div>}

            <dl className="crm-facts">
              <div>
                <dt>Stage</dt>
                <dd>
                  <select
                    className="crm-select" value={String(deal.stage)}
                    onChange={(e) => changeStage(e.target.value)}
                    disabled={move.isPending}
                    aria-label="Stage"
                  >
                    {stages.map((s) => (
                      <option key={s._id} value={String(s._id)}>{s.name}</option>
                    ))}
                  </select>
                </dd>
              </div>
              <div>
                <dt>In this stage</dt>
                <dd className={daysInStage > 14 ? 'crm-cardx__age is-red' : daysInStage > 7 ? 'crm-cardx__age is-amber' : ''}>
                  {daysInStage == null ? '—' : `${daysInStage} days`}
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  {deal.assignedTo?.name ? (
                    <span className="row gap-2" style={{ alignItems: 'center' }}>
                      <Avatar name={deal.assignedTo.name} size={20} /> {deal.assignedTo.name}
                    </span>
                  ) : 'Unassigned'}
                </dd>
              </div>
              <div>
                <dt>Expected close</dt>
                <dd>{fmtDate(deal.expectedCloseDate)}</dd>
              </div>
              {deal.stageProbability != null && (
                <div>
                  <dt>Weighted</dt>
                  {/* Value × the stage's own probability. Arithmetic, not a
                      prediction — which is why it can be quoted. */}
                  <dd>
                    <TrendingUp size={13} aria-hidden />{' '}
                    {fmtMoney(Math.round((deal.value * deal.stageProbability) / 100))}
                    <span className="crm-muted"> at {deal.stageProbability}%</span>
                  </dd>
                </div>
              )}
              {deal.closedAt && (
                <div>
                  <dt>Closed</dt>
                  <dd>{fmtDate(deal.closedAt)}</dd>
                </div>
              )}
            </dl>

            {deal.lostReason && (
              <div className="crm-dnc">
                <span>
                  <strong>Lost — {deal.lostReason.replace(/_/g, ' ')}</strong>
                  {deal.lostNotes && <span className="crm-muted"> {deal.lostNotes}</span>}
                </span>
              </div>
            )}

            <div className="crm-drawer__contact">
              {deal.contact?.name && (
                <Link className="crm-chip" to={`/crm/contacts?open=${deal.contact._id}`}>
                  <User size={14} aria-hidden /> {deal.contact.name}
                </Link>
              )}
              {deal.company?.name && (
                <Link className="crm-chip" to={`/crm/companies?open=${deal.company._id}`}>
                  <Building2 size={14} aria-hidden /> {deal.company.name}
                </Link>
              )}
              {deal.lead && (
                <Link className="crm-chip" to={`/crm/leads?open=${deal.lead}`}>
                  the enquiry it came from
                </Link>
              )}
            </div>

            {/* ── How it got here ─────────────────────────────────
                The one thing no other screen can show. */}
            <section>
              <h3 className="crm-section__title"><Clock size={14} aria-hidden /> Stage history</h3>
              <ol className="crm-stagehist">
                {(deal.stageHistory || []).map((h, i) => (
                  <li key={`${h.stageId}-${h.enteredAt}`} className={h.exitedAt ? '' : 'is-current'}>
                    <span className="crm-stagehist__name">{h.stageName}</span>
                    <span className="crm-stagehist__time">
                      {h.exitedAt
                        ? readableDuration(h.durationHours)
                        : `${daysInStage ?? 0}d · now`}
                    </span>
                    <span className="crm-muted">{fmtDate(h.enteredAt)}</span>
                    {i === 0 && <span className="crm-muted">created</span>}
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <div className="crm-card__head">
                <h3 className="crm-section__title"><CalendarClock size={14} aria-hidden /> Open tasks</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingTask(true)}>
                  <Plus size={14} /> Add
                </button>
              </div>
              {data.tasks?.length ? (
                <ul className="crm-minilist">
                  {data.tasks.map((t) => (
                    <li key={t._id}>
                      <span style={{ padding: '7px 8px', display: 'block' }}>
                        <strong>{t.title}</strong>
                        <span className="crm-muted"> · due {fmtDate(t.dueAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="crm-muted">Nothing planned. A deal with no next step is a deal going quiet.</p>
              )}
            </section>

            <h3 className="crm-section__title">History</h3>
            <CrmTimeline items={data.timeline} />
          </div>
        )}
      </aside>

      <TaskFormModal
        open={addingTask}
        onClose={() => setAddingTask(false)}
        entityType="deal"
        entityId={id}
        entityLabel={deal?.title}
      />

      <LostReasonModal
        open={Boolean(pendingLoss)}
        deal={deal}
        pending={move.isPending}
        onCancel={() => setPendingLoss(null)}
        onConfirm={(reason) => {
          move.mutate({ id, stage: pendingLoss.stageId, ...reason });
          setPendingLoss(null);
        }}
      />
    </>
  );
}

export default DealDrawer;
