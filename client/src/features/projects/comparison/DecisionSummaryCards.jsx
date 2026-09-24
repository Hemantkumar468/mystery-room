import { ThumbsUp, ThumbsDown, Clock, ArrowUpRight } from 'lucide-react';

/**
 * Primary decision-status KPI strip for the Site Evaluation dashboard header
 * — Approved / Rejected / Pending Decision / Eligible for Phase 3. Distinct
 * from (and rendered above) the existing `SummaryCards`, which tracks
 * assessment *evaluation* progress rather than the final approve/reject
 * *decision* these cards are about.
 *
 * Reuses the same `se-summary-card` visual language as `SummaryCards` so the
 * two strips read as one system, just in a 4-up grid (`se-decision-grid`)
 * instead of the 8-up evaluation-progress grid.
 */
export function DecisionSummaryCards({ stats, onCardClick }) {
  const cards = [
    {
      key: 'approved', label: 'Approved', value: stats.approved, sub: 'Properties',
      icon: ThumbsUp, tint: 'var(--success)', soft: 'var(--success-soft)', kpiKey: 'approved',
    },
    {
      key: 'rejected', label: 'Rejected', value: stats.rejected, sub: 'Property',
      icon: ThumbsDown, tint: 'var(--danger)', soft: 'var(--danger-soft)', kpiKey: 'rejected',
    },
    {
      key: 'pending', label: 'Pending', value: stats.pending, sub: 'Property',
      icon: Clock, tint: 'var(--warning)', soft: 'var(--warning-soft)', kpiKey: null,
    },
    {
      key: 'eligible', label: 'Eligible for Phase 3', value: stats.eligible, sub: 'Properties',
      icon: ArrowUpRight, tint: 'var(--info)', soft: 'var(--info-soft)', kpiKey: 'approved',
    },
  ];

  return (
    <div className="se-decision-grid">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`se-summary-card${onCardClick && c.kpiKey ? ' clickable' : ''}`}
          onClick={onCardClick && c.kpiKey ? () => onCardClick(c.kpiKey) : undefined}
        >
          <div className="col" style={{ minWidth: 0 }}>
            <span className="label">{c.label}</span>
            <span className="value">{c.value}</span>
            <span className="sub">{c.sub}</span>
          </div>
          <span className="icon" style={{ background: c.soft, color: c.tint }}>
            <c.icon size={19} />
          </span>
        </button>
      ))}
    </div>
  );
}

export default DecisionSummaryCards;
