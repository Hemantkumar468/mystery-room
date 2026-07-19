import { ClipboardList, CheckCircle2, ThumbsUp, ThumbsDown, Gauge } from 'lucide-react';

/**
 * Five-up KPI strip at the top of the Site Evaluation dashboard. Built as
 * its own small, self-contained presentation component (not the shared
 * StatCard) — StatCard.jsx renders class names (.stat, .stat-head, .stat-
 * cap, …) that have no corresponding CSS anywhere in the app, so it always
 * renders unstyled; rather than depend on that pre-existing gap, this uses
 * the new `se-summary-card` styles that ship with this dashboard.
 *
 * All five numbers are derived, not fetched separately — `stats` is a plain
 * object the page computes once from the same scorecards the rest of the
 * dashboard already built.
 */
/** Maps each card to the KPI page it opens — shared by the dashboard (navigates away) and the KPI pages themselves (activeKey highlights the matching card). */
export const KPI_CARD_KEYS = {
  total: 'shortlisted',
  completed: 'completed',
  approved: 'approved',
  rejected: 'rejected',
  avgScore: 'scores',
};

export function SummaryCards({ stats, onCardClick }) {
  const cards = [
    {
      key: 'total', label: 'Total Shortlisted', value: stats.total, sub: 'All properties',
      icon: ClipboardList, tint: 'var(--primary)', soft: 'var(--primary-soft)',
    },
    {
      key: 'completed', label: 'Completed Evaluations', value: stats.completed, sub: `${stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}% Completed`,
      icon: CheckCircle2, tint: 'var(--secondary, var(--teal-500))', soft: 'var(--secondary-soft)',
    },
    {
      key: 'approved', label: 'Approved', value: stats.approved, sub: `${stats.total ? Math.round((stats.approved / stats.total) * 100) : 0}% of total`,
      icon: ThumbsUp, tint: 'var(--success)', soft: 'var(--success-soft)',
    },
    {
      key: 'rejected', label: 'Rejected', value: stats.rejected, sub: `${stats.total ? Math.round((stats.rejected / stats.total) * 100) : 0}% of total`,
      icon: ThumbsDown, tint: 'var(--danger)', soft: 'var(--danger-soft)',
    },
    {
      key: 'avgScore', label: 'Avg. Overall Score', value: stats.avgScore != null ? stats.avgScore : '—', sub: 'Out of 100',
      icon: Gauge, tint: 'var(--gold-500)', soft: 'var(--primary-soft)',
    },
  ];

  return (
    <div className="se-summary-grid">
      {cards.map((c) => {
        return (
          <button
            key={c.key}
            type="button"
            className={`se-summary-card${onCardClick ? ' clickable' : ''}`}
            onClick={onCardClick ? () => onCardClick(KPI_CARD_KEYS[c.key]) : undefined}
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
        );
      })}
    </div>
  );
}

export default SummaryCards;
