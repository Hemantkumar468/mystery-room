import { ClipboardList, CheckCircle2, Loader2, CircleDashed, Gauge, TrendingUp, ThumbsUp, ThumbsDown } from 'lucide-react';
import { scoreGradeFor } from '../records/scoring.js';

/**
 * Six-up KPI strip at the top of the Site Evaluation dashboard. Built as its
 * own small, self-contained presentation component (not the shared
 * StatCard) — StatCard.jsx renders class names (.stat, .stat-head, .stat-
 * cap, …) that have no corresponding CSS anywhere in the app, so it always
 * renders unstyled; rather than depend on that pre-existing gap, this uses
 * the new `se-summary-card` styles that ship with this dashboard.
 *
 * All numbers are derived, not fetched separately — `stats` is a plain
 * object the page computes once from the same scorecards the rest of the
 * dashboard already built.
 */
/** Maps each card to the KPI page it opens — only cards with a real drill-down page are clickable. */
export const KPI_CARD_KEYS = {
  total: 'shortlisted',
  completed: 'completed',
  approved: 'approved',
  rejected: 'rejected',
  avgScore: 'scores',
};

export function SummaryCards({ stats, onCardClick }) {
  const grade = scoreGradeFor(stats.avgScore);

  const cards = [
    {
      key: 'total', label: 'Total Shortlisted', value: stats.total, sub: 'Properties',
      icon: ClipboardList, tint: 'var(--primary)', soft: 'var(--primary-soft)',
    },
    {
      key: 'completed', label: 'Completed', value: stats.completed, sub: `${stats.total ? Math.round((stats.completed / stats.total) * 100) : 0}% of total`,
      icon: CheckCircle2, tint: 'var(--success)', soft: 'var(--success-soft)',
    },
    {
      key: 'inProgress', label: 'In Progress', value: stats.inProgress, sub: `${stats.total ? Math.round((stats.inProgress / stats.total) * 100) : 0}% of total`,
      icon: Loader2, tint: 'var(--warning)', soft: 'var(--warning-soft)',
    },
    {
      key: 'notStarted', label: 'Not Started', value: stats.notStarted, sub: `${stats.total ? Math.round((stats.notStarted / stats.total) * 100) : 0}% of total`,
      icon: CircleDashed, tint: '#EA580C', soft: '#FFEDD5',
    },
    {
      key: 'approved', label: 'Approved', value: stats.approved, sub: `${stats.total ? Math.round((stats.approved / stats.total) * 100) : 0}% of total`,
      icon: ThumbsUp, tint: 'var(--info)', soft: 'var(--info-soft)',
    },
    {
      key: 'rejected', label: 'Rejected', value: stats.rejected, sub: `${stats.total + stats.rejected ? Math.round((stats.rejected / (stats.total + stats.rejected)) * 100) : 0}% of total`,
      icon: ThumbsDown, tint: 'var(--danger)', soft: 'var(--danger-soft)',
    },
  ];

  return (
    <div className="se-summary-grid">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`se-summary-card${onCardClick && KPI_CARD_KEYS[c.key] ? ' clickable' : ''}`}
          onClick={onCardClick && KPI_CARD_KEYS[c.key] ? () => onCardClick(KPI_CARD_KEYS[c.key]) : undefined}
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

      {/* Overall Progress — spans the bar full-width instead of the icon layout above */}
      <div className="se-summary-card se-summary-card--progress">
        <div className="col gap-2" style={{ minWidth: 0, width: '100%' }}>
          <div className="row between" style={{ alignItems: 'baseline' }}>
            <span className="label">Overall Progress</span>
            <span className="value" style={{ fontSize: 18 }}>{stats.overallProgressPct}%</span>
          </div>
          <div className="se-progress-track">
            <div className="se-progress-fill" style={{ width: `${stats.overallProgressPct}%`, background: 'var(--primary)' }} />
          </div>
          <span className="sub">{stats.assessmentsDone} / {stats.assessmentsTotal} Assessments Completed</span>
        </div>
        <span className="icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
          <TrendingUp size={19} />
        </span>
      </div>

      {/* Average Score */}
      <button
        type="button"
        className={`se-summary-card${onCardClick ? ' clickable' : ''}`}
        onClick={onCardClick ? () => onCardClick(KPI_CARD_KEYS.avgScore) : undefined}
      >
        <div className="col" style={{ minWidth: 0 }}>
          <span className="label">Average Score</span>
          <span className="value">{stats.avgScore != null ? `${stats.avgScore}/100` : '—'}</span>
          <span className="sub" style={{ color: grade.color, fontWeight: 650 }}>{grade.label}</span>
        </div>
        <span className="icon" style={{ background: 'var(--primary-soft)', color: 'var(--gold-500)' }}>
          <Gauge size={19} />
        </span>
      </button>
    </div>
  );
}

export default SummaryCards;
