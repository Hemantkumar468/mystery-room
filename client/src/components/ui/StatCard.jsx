import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Sparkline, MiniBars } from '../charts/chartkit.jsx';

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus };

/**
 * KPI tile — label + big number floating above a chart that bleeds to the
 * card's edges, so the metric and its trend read as a single object. No accent
 * rails or corner glows; the chart itself carries the metric's colour.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  tint = 'var(--primary)',
  soft = 'var(--primary-soft)',
  delta,
  spark,
  bars,
  gradient = false,
  foot,
}) {
  const DeltaIcon = delta ? DELTA_ICON[delta.dir] || Minus : null;
  const hasChart = Boolean(spark || bars);
  return (
    <div className="stat">
      <div className="stat-top" style={hasChart ? undefined : { paddingBottom: 15 }}>
        <div className="stat-head">
          <span className="stat-icon" style={{ background: soft, color: tint }}>
            {Icon && <Icon size={16} />}
          </span>
          <span className="stat-cap">{label}</span>
          {delta && (
            <span className={`delta ${delta.dir}`}>
              <DeltaIcon size={12} />
              {delta.text}
            </span>
          )}
        </div>
        <div className={`stat-value ${gradient ? 'gradient-text' : ''}`}>{value}</div>
        {foot && <div className="stat-foot">{foot}</div>}
      </div>

      {hasChart && (
        <div className="stat-chart">
          {spark ? (
            <Sparkline data={spark} color={tint} height={48} bleed />
          ) : (
            <MiniBars data={bars} color={tint} height={48} bleed />
          )}
        </div>
      )}
    </div>
  );
}

export default StatCard;
