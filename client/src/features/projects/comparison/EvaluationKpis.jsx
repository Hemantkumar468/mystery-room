import { Building2, CheckCircle2, Clock, XCircle, Star } from 'lucide-react';
import { AnimatedCounter } from '../closure/ClosureKit.jsx';
import { scoreGradeFor } from '../records/scoring.js';

/**
 * Top KPI strip for the Site Evaluation dashboard — five enterprise cards:
 * Shortlisted / Approved / Pending Assessment / Not Started / Avg Score.
 *
 * Purely presentational. Every number comes from `stats`, the object the page
 * already computes once from the same scorecards the rest of the dashboard
 * uses (see summaryStats in SiteEvaluationPage.jsx) — no separate fetch, no
 * fabricated value. `onCardClick(kpiKey)` reuses the page's existing KPI
 * drill-down navigation; cards without a drill-down page are non-clickable.
 */
export function EvaluationKpis({ stats, onCardClick }) {
  const pct = (n) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  const grade = scoreGradeFor(stats.avgScore);

  const cards = [
    {
      key: 'total', label: 'Shortlisted', value: stats.total, sub: 'Total Properties',
      icon: Building2, color: '#6366F1', soft: 'rgba(99,102,241,0.12)', kpiKey: 'shortlisted',
    },
    {
      key: 'approved', label: 'Approved', value: stats.approved, sub: `${pct(stats.approved)}% of total`,
      icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)', kpiKey: 'approved',
    },
    {
      key: 'inProgress', label: 'Pending Assessment', value: stats.inProgress, sub: `${pct(stats.inProgress)}% of total`,
      icon: Clock, color: 'var(--warning)', soft: 'var(--warning-soft)', kpiKey: null,
    },
    {
      key: 'notStarted', label: 'Not Started', value: stats.notStarted, sub: `${pct(stats.notStarted)}% of total`,
      icon: XCircle, color: 'var(--danger)', soft: 'var(--danger-soft)', kpiKey: null,
    },
    {
      key: 'avgScore', label: 'Avg. Score',
      value: stats.avgScore != null ? stats.avgScore : null,
      valueSuffix: stats.avgScore != null ? '/100' : null,
      sub: stats.avgScore != null ? grade.label : 'When scored',
      subColor: stats.avgScore != null ? grade.color : undefined,
      icon: Star, color: 'var(--info)', soft: 'var(--info-soft)', kpiKey: 'scores',
    },
  ];

  return (
    <div className="se-ek-grid">
      {cards.map((c) => {
        const clickable = onCardClick && c.kpiKey;
        return (
          <button
            key={c.key}
            type="button"
            className={`se-ek-card${clickable ? ' clickable' : ''}`}
            style={{ '--ek-accent': c.color, '--ek-soft': c.soft }}
            onClick={clickable ? () => onCardClick(c.kpiKey) : undefined}
            title={clickable ? `View ${c.label}` : undefined}
          >
            <span className="se-ek-icon" style={{ background: c.soft, color: c.color }}>
              <c.icon size={19} />
            </span>
            <span className="se-ek-body">
              <span className="se-ek-value">
                {c.value != null ? <AnimatedCounter value={c.value} /> : '—'}
                {c.value != null && c.valueSuffix && <small className="se-ek-suffix">{c.valueSuffix}</small>}
              </span>
              <span className="se-ek-label">{c.label}</span>
              <span className="se-ek-sub" style={c.subColor ? { color: c.subColor, fontWeight: 650 } : undefined}>{c.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default EvaluationKpis;
