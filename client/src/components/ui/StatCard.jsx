import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { Sparkline, MiniBars } from '../charts/chartkit.jsx';

const DELTA_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus };

/**
 * Premium KPI tile: tinted icon chip + optional trend pill, a large tabular
 * value, a label, and a data-driven footer (sparkline / mini-bars / node).
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
  return (
    <div className="stat" style={{ '--accent': tint }}>
      <div className="stat-head">
        <div className="stat-icon" style={{ background: soft, color: tint }}>
          {Icon && <Icon size={19} />}
        </div>
        {delta && (
          <span className={`delta ${delta.dir}`}>
            <DeltaIcon size={12} />
            {delta.text}
          </span>
        )}
      </div>

      <div className={`stat-value ${gradient ? 'gradient-text' : ''}`}>{value}</div>
      <div className="stat-label">{label}</div>

      {spark && (
        <div style={{ margin: '12px -4px -4px' }}>
          <Sparkline data={spark} color={tint} />
        </div>
      )}
      {bars && (
        <div style={{ margin: '12px -2px -4px' }}>
          <MiniBars data={bars} color={tint} />
        </div>
      )}
      {foot && !spark && !bars && <div className="stat-trend" style={{ marginTop: 12 }}>{foot}</div>}
      {foot && (spark || bars) && (
        <div className="tiny muted" style={{ marginTop: 6 }}>{foot}</div>
      )}
    </div>
  );
}

export default StatCard;
