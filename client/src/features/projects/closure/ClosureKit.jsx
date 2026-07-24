/**
 * Presentational building blocks shared by every Project Closure (Phase 10)
 * surface — the Command Center's tabs and the printable Closure Report.
 *
 * Everything here is deliberately dumb: it renders whatever
 * closureAnalytics.js derived and shows "—" for `null`. No component in this
 * file substitutes a zero, an average or a placeholder for a missing figure.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Badge, ProgressBar, ProgressRing } from '../../../components/ui/primitives.jsx';
import { scoreTone, gradeOf } from './closureAnalytics.js';

/** Respect the OS "reduce motion" setting for every animation in this kit. */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Counts up to `value` on mount and on every change. `format` renders the
 * intermediate numbers, so a currency or percentage counter animates in its
 * own notation. A null/undefined value renders "—" and never animates —
 * animating a missing measurement into existence is exactly the kind of
 * fabrication this module avoids.
 */
export function AnimatedCounter({ value, format = (n) => String(Math.round(n)), duration = 900, placeholder = '—' }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(value ?? 0);
  const frameRef = useRef();

  useEffect(() => {
    if (value == null) return undefined;
    if (reduced) { setShown(value); return undefined; }
    const from = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast settle, no bounce past the real figure.
      const eased = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * eased);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration, reduced]);

  if (value == null) return <span className="tabular">{placeholder}</span>;
  return <span className="tabular">{format(shown)}</span>;
}

/** Up / down / flat arrow for a trend figure, coloured by whether it's good news. */
export function TrendChip({ value, suffix = '%', goodWhenPositive = true, label }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.05;
  const positive = value > 0;
  const good = flat ? null : positive === goodWhenPositive;
  const color = good == null ? '#6B7280' : good ? '#059669' : '#DC2626';
  const Icon = flat ? Minus : positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="pcc-trend" style={{ color, background: `${color}14` }}>
      <Icon size={12} strokeWidth={2.4} />
      {`${positive && !flat ? '+' : ''}${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}${suffix}`}
      {label && <span className="pcc-trend-label">{label}</span>}
    </span>
  );
}

/**
 * One KPI card in the top dashboard strip — icon, animated counter, optional
 * trend, optional progress track and a status badge. `onClick` turns it into a
 * button that deep-links to the tab it summarises.
 */
export function ClosureKpiCard({
  icon: Icon, label, value, format, suffix, color = '#2563EB',
  trend, trendSuffix, trendGoodWhenPositive = true, progress, badge, badgeColor, hint, onClick,
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`card pcc-kpi${onClick ? ' pcc-kpi-clickable' : ''}`}
      onClick={onClick}
      style={{ '--kpi-accent': color }}
    >
      <div className="pcc-kpi-head">
        <span className="pcc-kpi-icon"><Icon size={16} strokeWidth={2.2} /></span>
        {badge && <Badge color={badgeColor || color} soft={`${badgeColor || color}1A`} dot>{badge}</Badge>}
      </div>
      <div className="pcc-kpi-value">
        <AnimatedCounter value={value} format={format} />
        {value != null && suffix && <span className="pcc-kpi-suffix">{suffix}</span>}
      </div>
      <span className="pcc-kpi-label">{label}</span>
      {progress != null && <ProgressBar value={progress} height={5} gradient={color} />}
      <div className="pcc-kpi-foot">
        {trend != null && <TrendChip value={trend} suffix={trendSuffix} goodWhenPositive={trendGoodWhenPositive} />}
        {hint && <span className="tiny muted">{hint}</span>}
      </div>
    </Tag>
  );
}

/** Label-over-value fact, the unit every summary grid in this phase is built from. */
export function InfoTile({ label, value, tone, mono }) {
  return (
    <div className="pcc-info-tile">
      <span className="tiny subtle upper">{label}</span>
      <span className={`sm${mono ? ' tabular' : ''}`} style={{ fontWeight: 650, color: tone || 'var(--text)' }}>
        {value == null || value === '' ? '—' : value}
      </span>
    </div>
  );
}

/** A named 0–100 score as a labelled bar — the row unit of every scorecard. */
export function ScoreBar({ label, value, hint, width = 96 }) {
  const color = scoreTone(value);
  return (
    <div className="pcc-score-row">
      <span className="sm pcc-score-row-label">{label}</span>
      <div className="pcc-score-row-track" style={{ minWidth: width }}>
        <ProgressBar value={value ?? 0} height={6} gradient={color} />
      </div>
      <span className="sm tabular" style={{ fontWeight: 700, color, minWidth: 44, textAlign: 'right' }}>
        {value == null ? '—' : `${Math.round(value)}%`}
      </span>
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

/** A ringed score with its label underneath — the Score Breakdown strip's unit. */
export function ScoreRingTile({ label, value, size = 62 }) {
  const color = scoreTone(value);
  return (
    <div className="pcc-ring-tile">
      <div className="pcc-ring-tile-visual">
        <ProgressRing value={value ?? 0} size={size} stroke={6} color={color} />
        <span className="pcc-ring-tile-value" style={{ color }}>
          {value == null ? '—' : Math.round(value)}
        </span>
      </div>
      <span className="pcc-ring-tile-label">{label}</span>
    </div>
  );
}

/** A–D performance grade pill, shared by the vendor and department scorecards. */
export function GradePill({ score, grade }) {
  const g = grade ?? gradeOf(score);
  const color = scoreTone(score);
  return <span className="pcc-grade" style={{ color, background: `${color}1A`, borderColor: `${color}44` }}>{g}</span>;
}

/** Compact stat used inside an analysis panel's header strip. */
export function MetricTile({ label, value, tone, sub }) {
  return (
    <div className="pcc-metric-tile">
      <span className="pcc-metric-label">{label}</span>
      <span className="pcc-metric-value" style={{ color: tone }}>{value ?? '—'}</span>
      {sub && <span className="tiny muted">{sub}</span>}
    </div>
  );
}

/** Empty-but-explained state — says which submission would populate the panel. */
export function AwaitingData({ icon: Icon, title, hint }) {
  return (
    <div className="pcc-awaiting">
      {Icon && <Icon size={30} strokeWidth={1.4} />}
      <div className="col gap-1 center">
        <span style={{ fontWeight: 650 }}>{title}</span>
        {hint && <span className="sm muted" style={{ textAlign: 'center' }}>{hint}</span>}
      </div>
    </div>
  );
}
