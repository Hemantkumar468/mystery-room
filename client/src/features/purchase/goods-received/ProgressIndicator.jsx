/**
 * Received against ordered — the number, the bar and what is still owed.
 *
 * The bar is green only at 100%: anything less is an open commitment, and a
 * green bar at 90% reads as "done" to somebody scanning the column. A row
 * with a shortage recorded goes red regardless of how much arrived, because
 * the balance is not coming.
 */
export function ProgressIndicator({ received, ordered, unit, pending, short = false }) {
  const pct = ordered ? Math.min(100, Math.round(((received || 0) / ordered) * 100)) : 0;
  const tone = short ? ' is-short' : pct < 100 ? ' is-partial' : '';
  return (
    <div className="gr-progress">
      <span className="gr-primary gr-nowrap">
        {received ?? '—'} of {ordered || '?'}{unit ? ` ${unit}` : ''}
      </span>
      <div className={`gr-bar${tone}`} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      {pending > 0 && <span className="gr-pending">{pending} pending</span>}
    </div>
  );
}

export default ProgressIndicator;
