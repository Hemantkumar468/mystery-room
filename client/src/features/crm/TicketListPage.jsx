import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, Plus, LifeBuoy, AlertTriangle, RefreshCw, Clock,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Avatar, Badge } from '../../components/ui/primitives.jsx';
import { useTickets, useTicketSummary } from '../../app/api/crmApi.js';
import { TicketDrawer } from './TicketDrawer.jsx';
import { TicketFormModal } from './TicketFormModal.jsx';
import './crm.css';

/**
 * The support queue, ordered by the deadline rather than by arrival.
 *
 * A ticket list sorted newest-first is an archive; sorted by deadline it is a
 * queue, and the next thing to do is always at the top. That is the whole
 * argument for the SLA clock existing at all.
 *
 * THE CLOCK IS SHOWN IN WORKING TIME. "2h left" means two hours the office is
 * open for, so a ticket raised on Friday evening does not spend the weekend
 * counting down towards a breach nobody could have prevented — see
 * server/src/modules/crm/tickets/businessHours.js. The server does that
 * arithmetic and sends an instant; this page only renders the gap to it.
 */

const PRIORITY_COLOUR = {
  urgent: '#dc2626', high: '#d97706', normal: '#2563eb', low: 'var(--text-subtle)',
};
const STATUS_LABEL = {
  open: 'Open', pending: 'Waiting on customer', resolved: 'Resolved', closed: 'Closed',
};

/** How long until a deadline, in plain words. Past it, how long ago. */
function untilLabel(due) {
  if (!due) return null;
  const ms = new Date(due) - Date.now();
  const mins = Math.round(Math.abs(ms) / 60000);
  const size = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
  return ms >= 0 ? `${size} left` : `${size} over`;
}

/**
 * The deadline cell.
 *
 * `breached` comes from the server, which stamped it when the deadline passed;
 * this does NOT re-derive it from the clock. A page that decides for itself
 * what counts as late would disagree with the report the moment anyone edited
 * a holiday list.
 */
function Due({ due, breached, done }) {
  if (done || !due) return <span className="crm-muted">—</span>;
  const label = untilLabel(due);
  if (breached) {
    return (
      <Badge color="#dc2626" soft="var(--surface-2)">
        <AlertTriangle size={11} aria-hidden />
        {' '}
        {label}
      </Badge>
    );
  }
  const soon = new Date(due) - Date.now() < 60 * 60 * 1000;
  return soon
    ? (
      <Badge color="#d97706" soft="var(--surface-2)">
        <Clock size={11} aria-hidden />
        {' '}
        {label}
      </Badge>
    )
    : <span className="crm-muted">{label}</span>;
}

export function TicketListPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  const query = {
    search: params.get('search') || undefined,
    status: params.get('status') || undefined,
    priority: params.get('priority') || undefined,
    breached: params.get('breached') || undefined,
  };
  const { data, isFetching, isError, refetch } = useTickets(query);
  const { data: summary } = useTicketSummary();

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const openId = params.get('open');
  const openTicket = (id) => setFilter('open', String(id));
  const items = data?.items || [];

  return (
    <>
      <Topbar
        title="Tickets"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New ticket
          </button>
        )}
      />

      <div className="content col gap-4">
        {summary && (
          <div className="crm-boardtotals">
            <span><strong>{summary.open}</strong> open</span>
            <span className="crm-muted">{summary.pending} waiting on the customer</span>
            {/* Breaches are the only number worth colouring: everything else is
                context, and a wall of red teaches people to stop looking. */}
            {(summary.breachedFirstResponse > 0 || summary.breachedResolution > 0) && (
              <button
                type="button" className="btn btn-ghost btn-sm"
                onClick={() => setFilter('breached', params.get('breached') ? '' : 'true')}
              >
                <Badge color="#dc2626" soft="var(--surface-2)">
                  <AlertTriangle size={11} aria-hidden />
                  {' '}
                  {summary.breachedFirstResponse}
                  {' '}
                  past first response
                </Badge>
              </button>
            )}
            <span className="crm-muted">
              {/* Null rather than zero when nothing has been answered: a zero
                  here reads as instant service, which is the opposite of true. */}
              {summary.medianFirstResponseMinutes == null
                ? 'no responses yet'
                : `typically answered in ${summary.medianFirstResponseMinutes} working minutes`}
            </span>
          </div>
        )}

        <div className="crm-toolbar">
          <label className="crm-search">
            <Search size={15} aria-hidden />
            <input
              className="crm-search__input" type="search" placeholder="Search subject or ticket number"
              defaultValue={params.get('search') || ''}
              onChange={(e) => setFilter('search', e.target.value.trim())}
            />
          </label>

          <select
            className="crm-select" value={params.get('status') || ''}
            onChange={(e) => setFilter('status', e.target.value)} aria-label="Status"
          >
            <option value="">Open and waiting</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <select
            className="crm-select" value={params.get('priority') || ''}
            onChange={(e) => setFilter('priority', e.target.value)} aria-label="Priority"
          >
            <option value="">Any priority</option>
            {['urgent', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          {(query.search || query.status || query.priority || query.breached) && (
            <button
              type="button" className="btn btn-ghost btn-sm"
              onClick={() => setParams({}, { replace: true })}
            >
              Clear
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={refetch} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} /> Refresh
          </button>
        </div>

        {isError ? (
          <EmptyState
            icon={AlertTriangle} title="Tickets could not be loaded"
            hint="The list is not showing an empty queue — it could not ask."
            action={<button type="button" className="btn btn-primary" onClick={refetch}>Try again</button>}
          />
        ) : !items.length ? (
          <EmptyState
            icon={LifeBuoy}
            title={query.search || query.status ? 'Nothing matches those filters' : 'No open tickets'}
            hint={query.search || query.status
              ? 'Try clearing the filters.'
              : 'When a customer reports a problem, raise it here so the clock starts.'}
          />
        ) : (
          <div className="crm-rows">
            {items.map((t) => (
              <button
                type="button" key={t._id} className="crm-row"
                onClick={() => openTicket(t._id)}
              >
                <span className="crm-row__who">
                  <strong>{t.subject}</strong>
                  <span className="crm-muted">
                    {[
                      t.number,
                      t.requester?.name,
                      STATUS_LABEL[t.status] || t.status,
                      t.reopenCount ? `reopened ${t.reopenCount}×` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>

                <span className="crm-row__tags">
                  <Badge color={PRIORITY_COLOUR[t.priority]} soft="var(--surface-2)">{t.priority}</Badge>
                  {/* Two clocks, and which one matters depends on where the
                      ticket is: before anyone has replied the first-response
                      deadline is the live one, after that it is resolution. */}
                  {t.firstRespondedAt
                    ? (
                      <Due
                        due={t.dueResolutionAt}
                        breached={t.resolutionBreached}
                        done={['resolved', 'closed'].includes(t.status)}
                      />
                    )
                    : <Due due={t.dueFirstResponseAt} breached={t.firstResponseBreached} />}
                </span>

                <span className="crm-row__owner">
                  {t.assignedTo
                    ? <Avatar name={t.assignedTo.name} color={t.assignedTo.avatarColor} size={26} />
                    : <span className="crm-muted">—</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && <TicketDrawer id={openId} onClose={() => setFilter('open', '')} />}
      {adding && <TicketFormModal onClose={() => setAdding(false)} />}
    </>
  );
}

export default TicketListPage;
