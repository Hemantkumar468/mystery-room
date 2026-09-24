import { useState } from 'react';
import {
  X, AlertTriangle, Clock, Send, CheckCircle2, PauseCircle, RotateCcw, TrendingUp, Star,
} from 'lucide-react';
import { Avatar, Badge, Spinner } from '../../components/ui/primitives.jsx';
import {
  useTicket, useRespondToTicket, useSetTicketStatus, useSetTicketPriority, useAssignTicket,
} from '../../app/api/crmApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { CrmTimeline } from './CrmTimeline.jsx';

/**
 * One ticket, its clock, and what to do about it.
 *
 * REPLYING IS THE PRIMARY ACTION and sits at the top, because it is the only
 * thing that stops the first-response clock. Changing status, reassigning, or
 * reading the ticket do not — a desk that could satisfy its SLA without
 * talking to the customer would report beautifully and serve nobody, so the
 * server refuses to count them and this screen says so out loud.
 *
 * "Waiting on customer" is offered as a first-class button rather than buried
 * in a status dropdown, because it is the state that stops the clock fairly.
 * If it is hard to reach, nobody uses it, and the desk gets measured on delays
 * that were never theirs.
 */

const PRIORITY_COLOUR = {
  urgent: '#dc2626', high: '#d97706', normal: '#2563eb', low: 'var(--text-subtle)',
};

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '—');

/** Working minutes, said the way a person would say them. */
const workingTime = (mins) => {
  if (mins == null) return '—';
  if (mins < 60) return `${mins} working minutes`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m ? ` ${m}m` : ''} of working time`;
};

export function TicketDrawer({ id, onClose }) {
  const { data, isLoading, isError } = useTicket(id);
  const respond = useRespondToTicket();
  const setStatus = useSetTicketStatus();
  const setPriority = useSetTicketPriority();
  const assign = useAssignTicket();
  const { employees } = useEmployees();

  const [reply, setReply] = useState('');

  if (!id) return null;
  const ticket = data?.ticket;
  const progress = data?.progress;
  const done = ticket && ['resolved', 'closed'].includes(ticket.status);

  const send = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    await respond.mutateAsync({ id, body: reply.trim() });
    setReply('');
  };

  return (
    <>
      <div className="crm-scrim" role="presentation" onClick={onClose} />

      <aside className="crm-drawer" aria-label="Ticket details">
        <header className="crm-drawer__head">
          <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            <div>
              <strong className="crm-drawer__name">{ticket?.subject || 'Ticket'}</strong>
              {ticket && (
                <div className="crm-muted crm-drawer__sub">
                  {ticket.number}
                  {ticket.requester?.name ? ` · ${ticket.requester.name}` : ''}
                </div>
              )}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {isLoading && <div style={{ padding: 24 }}><Spinner label="Loading…" /></div>}
        {isError && (
          <div className="crm-drawer__body">
            <p className="crm-muted">That ticket could not be opened — it may belong to someone else.</p>
          </div>
        )}

        {ticket && (
          <div className="crm-drawer__body">
            {/* ── The clock ───────────────────────────────── */}
            <section className="crm-card">
              <div className="row gap-2" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <Badge color={PRIORITY_COLOUR[ticket.priority]} soft="var(--surface-2)">{ticket.priority}</Badge>
                <span className="crm-muted">{ticket.status}</span>
                {ticket.reopenCount > 0 && (
                  <Badge color="#d97706" soft="var(--surface-2)">
                    <RotateCcw size={11} aria-hidden />
                    {' '}
                    reopened
                    {' '}
                    {ticket.reopenCount}
                    ×
                  </Badge>
                )}
              </div>

              <dl className="crm-facts" style={{ marginTop: 12 }}>
                <dt>First response</dt>
                <dd>
                  {ticket.firstRespondedAt
                    ? `answered in ${workingTime(ticket.firstResponseMinutes)}`
                    : `due ${fmt(ticket.dueFirstResponseAt)}`}
                  {ticket.firstResponseBreached && (
                    <>
                      {' '}
                      <Badge color="#dc2626" soft="var(--surface-2)"><AlertTriangle size={11} aria-hidden /> breached</Badge>
                    </>
                  )}
                </dd>

                <dt>Resolution</dt>
                <dd>
                  {ticket.resolvedAt
                    ? `resolved in ${workingTime(ticket.resolutionMinutes)}`
                    : `due ${fmt(ticket.dueResolutionAt)}`}
                  {ticket.resolutionBreached && (
                    <>
                      {' '}
                      <Badge color="#dc2626" soft="var(--surface-2)"><AlertTriangle size={11} aria-hidden /> breached</Badge>
                    </>
                  )}
                </dd>

                {ticket.pendingMinutes > 0 && (
                  <>
                    <dt>Waiting on customer</dt>
                    {/* Shown because it is subtracted from every figure above,
                        and a number that quietly changes the others should be
                        visible rather than inferred. */}
                    <dd className="crm-muted">
                      {workingTime(ticket.pendingMinutes)}
                      {' '}
                      — not counted against the desk
                    </dd>
                  </>
                )}
              </dl>

              {/* THE LIVE NUMBER, and the reason the ladder fires. Shown as a
                  bar because "78%" alone does not tell you whether that is
                  nearly fine or nearly late — the position in the track does. */}
              {progress && (
                <div style={{ marginTop: 12 }}>
                  <div className="crm-slabar" aria-hidden>
                    <span
                      className={progress.percent >= 100 ? 'is-over' : progress.percent >= 75 ? 'is-warn' : ''}
                      style={{ width: `${Math.min(progress.percent, 100)}%` }}
                    />
                  </div>
                  <p className="crm-muted sm" style={{ marginTop: 5 }}>
                    {progress.percent}
                    % of the
                    {' '}
                    {progress.clock.replace('-', ' ')}
                    {' '}
                    target used
                    {progress.percent >= 75 && progress.percent < 100 && ' — due soon'}
                  </p>
                </div>
              )}

              {ticket.escalationLevel > 0 && (
                <p className="sm" style={{ marginTop: 8 }}>
                  <Badge color="#dc2626" soft="var(--surface-2)">
                    <TrendingUp size={11} aria-hidden />
                    {' '}
                    Escalated to level
                    {' '}
                    {ticket.escalationLevel}
                  </Badge>
                  {' '}
                  <span className="crm-muted">
                    {(ticket.escalationHistory || []).map((e) => e.audience).join(' → ')}
                  </span>
                </p>
              )}

              {ticket.csat?.score && (
                <p className="sm" style={{ marginTop: 8 }}>
                  <Badge color="#10b981" soft="var(--surface-2)">
                    <Star size={11} aria-hidden />
                    {' '}
                    {ticket.csat.score}
                    /5 from the customer
                  </Badge>
                  {ticket.csat.comment && <span className="crm-muted"> “{ticket.csat.comment}”</span>}
                </p>
              )}

              <p className="crm-muted sm" style={{ marginTop: 8 }}>
                <Clock size={12} aria-hidden />
                {' '}
                Deadlines are working hours, so a ticket raised on a Friday evening is not
                late on Saturday morning.
              </p>
            </section>

            {/* ── Reply: the only thing that stops the clock ─ */}
            {!done && (
              <form className="crm-card" onSubmit={send}>
                <label className="crm-form__field">
                  <span className="crm-form__label">
                    {ticket.firstRespondedAt ? 'Reply to the customer' : 'First response to the customer'}
                  </span>
                  <textarea
                    className="input" rows={3} value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="What are you telling them?"
                  />
                  {!ticket.firstRespondedAt && (
                    <span className="crm-muted">
                      This is what stops the first-response clock — an internal note or a
                      status change does not.
                    </span>
                  )}
                </label>
                <button
                  type="submit" className="btn btn-primary btn-sm"
                  disabled={respond.isPending || !reply.trim()}
                >
                  <Send size={14} /> {respond.isPending ? 'Sending…' : 'Record response'}
                </button>
              </form>
            )}

            {/* ── What to do with it ────────────────────────── */}
            <section className="crm-card">
              <h3 className="crm-section__title">Move it on</h3>
              <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                {ticket.status !== 'pending' && !done && (
                  <button
                    type="button" className="btn btn-subtle btn-sm"
                    onClick={() => setStatus.mutate({ id, status: 'pending' }, { onError: () => {} })}
                  >
                    <PauseCircle size={14} /> Waiting on customer
                  </button>
                )}
                {ticket.status === 'pending' && (
                  <button
                    type="button" className="btn btn-subtle btn-sm"
                    onClick={() => setStatus.mutate({ id, status: 'open' }, { onError: () => {} })}
                  >
                    They replied — back to open
                  </button>
                )}
                {!done && (
                  <button
                    type="button" className="btn btn-primary btn-sm"
                    onClick={() => setStatus.mutate({ id, status: 'resolved' }, { onError: () => {} })}
                  >
                    <CheckCircle2 size={14} /> Resolved
                  </button>
                )}
                {done && (
                  <button
                    type="button" className="btn btn-subtle btn-sm"
                    onClick={() => setStatus.mutate({ id, status: 'open' }, { onError: () => {} })}
                  >
                    <RotateCcw size={14} /> Reopen
                  </button>
                )}
              </div>

              <div className="row gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <label className="crm-form__field" style={{ minWidth: 160 }}>
                  <span className="crm-form__label">Priority</span>
                  <select
                    className="crm-select" value={ticket.priority}
                    onChange={(e) => setPriority.mutate({ id, priority: e.target.value }, { onError: () => {} })}
                  >
                    {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  {/* Measured from when the ticket was raised, so bumping the
                      priority cannot quietly buy a fresh window. */}
                  <span className="crm-muted">Moves the deadline, measured from when it was raised.</span>
                </label>

                <label className="crm-form__field" style={{ minWidth: 160 }}>
                  <span className="crm-form__label">Owner</span>
                  <select
                    className="crm-select" value={String(ticket.assignedTo?._id || '')}
                    onChange={(e) => assign.mutate({ id, assignedTo: e.target.value }, { onError: () => {} })}
                  >
                    <option value="">Unassigned</option>
                    {/* `emp.id`, not `emp._id` — useEmployees maps users through
                        toEmployee(), which exposes `id`. Reading the wrong one
                        gave every option an empty value, so the dropdown
                        rendered names correctly and reassigning did nothing at
                        all. React's duplicate-key warning was the only symptom. */}
                    {(employees || []).map((emp) => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            {ticket.description && (
              <section className="crm-card">
                <h3 className="crm-section__title">What was reported</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{ticket.description}</p>
              </section>
            )}

            <section className="crm-card">
              <h3 className="crm-section__title">History</h3>
              <CrmTimeline items={data.timeline} />
            </section>

            {ticket.assignedTo && (
              <p className="crm-muted sm row gap-1" style={{ alignItems: 'center' }}>
                <Avatar name={ticket.assignedTo.name} color={ticket.assignedTo.avatarColor} size={20} />
                {ticket.assignedTo.name}
              </p>
            )}
          </div>
        )}
      </aside>
    </>
  );
}

export default TicketDrawer;
