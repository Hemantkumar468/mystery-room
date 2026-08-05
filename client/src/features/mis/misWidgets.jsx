/**
 * The presentational pieces of the MIS dashboard. These are deliberately plain
 * divs rather than Recharts wrappers: a segmented mix bar, a set of meters and
 * a two-bar slip comparison are all simpler, sharper and far lighter as CSS
 * than as SVG charts, and they inherit theme tokens for free. The Recharts
 * kit still handles the genuinely chart-shaped panels lower down the page.
 */
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { fmtNumber } from '../../lib/format.js';

/**
 * Period-over-period movement chip. Renders nothing when the server sends no
 * delta — that means there was no comparable baseline, which is a different
 * statement from "it did not move" and must not look like one.
 */
export function Delta({ delta }) {
  if (!delta) return null;
  if (delta.change === 0) {
    return (
      <span className="mis-delta mis-delta--flat" title="No change vs the previous period">
        <Minus size={13} strokeWidth={2.6} />
        <span>0</span>
      </span>
    );
  }
  const up = delta.change > 0;
  const healthy = (delta.good === 'up') === up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const unit = delta.unit === 'pt' ? ' pts' : delta.unit;
  return (
    <span
      className={`mis-delta mis-delta--${healthy ? 'good' : 'bad'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta.change)}${unit || ''} vs the previous period`}
    >
      <Icon size={13} strokeWidth={2.6} />
      <span>{fmtNumber(Math.abs(delta.change))}</span>
    </span>
  );
}

/**
 * One headline metric: label, value + movement, a meter showing the value in
 * context, and the raw counts underneath. Renders as a link when there is a
 * list that explains the number, and as a plain div otherwise — so nothing
 * looks clickable unless it is.
 */
export function KpiCard({ label, value, delta, meter, meterColor, foot, to, alert = false }) {
  const body = (
    <>
      <div className="mis-kpi-label">{label}</div>
      <div className="row gap-2" style={{ alignItems: 'baseline' }}>
        <div className="mis-kpi-value">{value}</div>
        <Delta delta={delta} />
      </div>
      <div className="mis-kpi-meter">
        <span style={{ width: `${Math.min(100, Math.max(0, meter || 0))}%`, background: meterColor }} />
      </div>
      <div className="mis-kpi-foot">{foot}</div>
    </>
  );

  const className = `mis-kpi${alert ? ' mis-kpi--alert' : ''}`;
  if (!to) return <div className={className}>{body}</div>;
  return (
    <Link to={to} className={className}>
      {body}
    </Link>
  );
}

/**
 * The four-way task mix as one segmented bar plus a legend carrying the exact
 * counts. Percentages only sit inside a segment wide enough to hold them —
 * below that the legend is the only honest place for the number.
 */
export function SegmentedMix({ buckets, total, linkFor }) {
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
  const visible = buckets.filter((b) => b.count > 0);

  return (
    <>
      <div className="mis-seg" role="img" aria-label={visible.map((b) => `${b.label}: ${b.count}`).join(', ')}>
        {visible.map((b) => (
          <div
            key={b.key}
            className="mis-seg-part"
            style={{ flexGrow: b.count, flexBasis: 0, background: b.color }}
            title={`${b.label}: ${fmtNumber(b.count)} of ${fmtNumber(total)} (${pct(b.count)}%)`}
          >
            {pct(b.count) >= 8 && `${pct(b.count)}%`}
          </div>
        ))}
      </div>

      <div className="mis-seg-legend">
        {buckets.map((b) => {
          const to = linkFor?.(b);
          const content = (
            <>
              <span className="mis-legend-swatch" style={{ background: b.color }} />
              <span className="truncate">{b.label}</span>
              <span className="mis-legend-count">{fmtNumber(b.count)}</span>
            </>
          );
          return to ? (
            <Link key={b.key} to={to} className="mis-legend-row">{content}</Link>
          ) : (
            <div key={b.key} className="mis-legend-row">{content}</div>
          );
        })}
      </div>
    </>
  );
}

/** Project health as labelled meters — one row per health state. */
export function HealthMeters({ rows, total }) {
  return (
    <div>
      {rows.map((r) => (
        <div key={r.key} className="mis-health-row">
          <div className="mis-health-head">
            <span>{r.label}</span>
            <span className="mis-health-count">{fmtNumber(r.count)}</span>
          </div>
          <div className="mis-health-track" title={`${r.count} of ${total} projects`}>
            <span style={{ width: `${total ? (r.count / total) * 100 : 0}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Planned vs actual working days per stage. Both bars share one scale (the
 * widest value on the chart) so row-to-row comparison is honest, and the
 * actual bar turns red only when it overruns — the colour *is* the finding.
 */
export function SlipChart({ rows }) {
  const max = Math.max(...rows.flatMap((r) => [r.planned, r.actual]), 1);
  const width = (v) => `${Math.max(1.5, (v / max) * 100)}%`;

  return (
    <div>
      <div className="mis-slip-legend" style={{ justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <span className="row gap-2">
          <span className="mis-legend-swatch" style={{ background: 'var(--border-strong)' }} /> Planned
        </span>
        <span className="row gap-2">
          <span className="mis-legend-swatch" style={{ background: '#2563EB' }} /> Actual
        </span>
      </div>

      {rows.map((r) => {
        const over = r.slip > 0;
        return (
          <div key={r.stage} className="mis-slip-row">
            <div className="mis-slip-stage" title={r.stage}>{r.stage}</div>
            <div className="mis-slip-bars">
              <div
                className="mis-slip-bar"
                style={{ width: width(r.planned), background: 'var(--border-strong)' }}
                title={`${r.stage} — planned ${r.planned}d across ${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'}`}
              />
              <div
                className="mis-slip-bar"
                style={{ width: width(r.actual), background: over ? 'var(--danger)' : '#2563EB' }}
                title={`${r.stage} — actual ${r.actual}d across ${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'}`}
              />
            </div>
            <div
              className="mis-slip-delta"
              style={{ color: over ? 'var(--danger)' : 'var(--success)' }}
              title={over ? `${r.slip}d over plan` : `${Math.abs(r.slip)}d under plan`}
            >
              {over ? '+' : ''}{r.slip}d
            </div>
          </div>
        );
      })}
    </div>
  );
}
