import { useSearchParams } from 'react-router-dom';
import { Inbox, AlertTriangle } from 'lucide-react';
import { EmptyState, Avatar, Badge } from '../../components/ui/primitives.jsx';
import { useDeals } from '../../app/api/crmApi.js';

/**
 * The same deals as the board, as a sortable table.
 *
 * NOT a second implementation of the board. It reads the same endpoint family
 * through the same RTK Query cache, so a deal moved on the board is already
 * moved here — the two views cannot drift because there is nothing to keep in
 * step. What differs is the question each answers: the board asks "what is
 * where", the list asks "show me the 200 and let me sort them".
 *
 * Sorting is where the value is. "Stalest first" is the single most useful
 * ordering a sales manager has, and it is impossible to express on a board.
 */

const fmtMoney = (v) => (v ? `₹${(v / 100000).toFixed(1)}L` : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');

const daysInStage = (deal) => (deal.stageEnteredAt
  ? Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / 86_400_000)
  : null);

export function DealListView({ pipelineId }) {
  const [params, setParams] = useSearchParams();
  const sort = params.get('sort') || 'newest';

  const { data, isLoading, isError } = useDeals({
    pipeline: pipelineId,
    sort,
    open: params.get('open') || undefined,
    limit: 100,
  });

  const setSort = (v) => {
    const next = new URLSearchParams(params);
    next.set('sort', v);
    setParams(next, { replace: true });
  };

  if (isError) {
    return <EmptyState icon={AlertTriangle} title="That list could not be loaded" />;
  }
  if (isLoading || !data) return <div className="sm muted" style={{ padding: 24 }}>Loading…</div>;

  return (
    <>
      <div className="crm-toolbar">
        <select
          className="crm-select" value={sort}
          onChange={(e) => setSort(e.target.value)} aria-label="Sort deals"
        >
          <option value="newest">Newest first</option>
          <option value="value">Biggest first</option>
          {/* The reason this view exists. */}
          <option value="stalest">Longest in stage</option>
          <option value="closing">Closing soonest</option>
        </select>
        <span className="crm-muted">{data.total} deals</span>
      </div>

      {!data.items.length ? (
        <EmptyState
          icon={Inbox}
          title="No deals yet"
          hint="A qualified lead becomes a deal, and it appears here and on the board."
        />
      ) : (
        <div className="crm-rows">
          {data.items.map((deal) => {
            const days = daysInStage(deal);
            return (
              <div key={deal._id} className="crm-row crm-row--deal">
                <span className="crm-row__who">
                  <strong>{deal.title}</strong>
                  <span className="crm-muted">{deal.pipeline?.name}</span>
                </span>

                <span>
                  <Badge color="var(--text-subtle)" soft="var(--surface-2)">
                    {deal.stageName || 'Unknown stage'}
                  </Badge>
                </span>

                <span className="crm-row__value"><strong>{fmtMoney(deal.value)}</strong></span>

                <span className={days > 14 ? 'crm-cardx__age is-red' : days > 7 ? 'crm-cardx__age is-amber' : 'crm-muted'}>
                  {days == null ? '—' : `${days}d in stage`}
                </span>

                <span className="crm-row__owner">
                  {deal.assignedTo?.name
                    ? (
                      <span className="row gap-2" style={{ alignItems: 'center' }}>
                        <Avatar name={deal.assignedTo.name} size={22} />
                        {deal.assignedTo.name}
                      </span>
                    )
                    : <span className="crm-muted">Unassigned</span>}
                </span>

                <span className="crm-muted crm-row__when">{fmtDate(deal.expectedCloseDate)}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default DealListView;
