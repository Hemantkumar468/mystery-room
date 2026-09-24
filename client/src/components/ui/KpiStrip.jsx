import { AnimatedCounter } from '../../features/projects/closure/ClosureKit.jsx';

/**
 * Shared top-of-page KPI card strip — originally Site Evaluation's own
 * `EvaluationKpis.jsx`, generalized so every phase (4 through 10, plus 1-3)
 * can render its own metrics through the same visual language instead of
 * each phase reinventing its own stat-card component (this repo had six
 * separate ones before this: StatTile, ExecStatCard, AwStatCard,
 * ReadinessStatCard, KpiCard, ClosureKpiCard).
 *
 * `.se-ek-grid` (client/src/styles/site-evaluation-overview.css) auto-fits
 * any number of cards — a phase with 5 metrics and a phase with 11 both lay
 * out correctly, no per-phase CSS needed.
 *
 * Purely presentational: every number comes from `cards`, which the calling
 * page computes once from its own real data — no fetch, no fabrication here.
 *
 * @param {Array<{
 *   key: string, label: string, value: number|string|null,
 *   valueSuffix?: string, sub?: string, subColor?: string,
 *   icon: React.ComponentType, color: string, soft: string,
 *   onClick?: () => void,
 * }>} cards
 */
export function KpiStrip({ cards }) {
  return (
    <div className="se-ek-grid">
      {cards.map((c) => {
        const clickable = !!c.onClick;
        return (
          <button
            key={c.key}
            type="button"
            className={`se-ek-card${clickable ? ' clickable' : ''}`}
            style={{ '--ek-accent': c.color, '--ek-soft': c.soft }}
            onClick={clickable ? c.onClick : undefined}
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
              {c.sub && <span className="se-ek-sub" style={c.subColor ? { color: c.subColor, fontWeight: 650 } : undefined}>{c.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default KpiStrip;
