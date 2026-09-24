import { ProgressRing } from '../../components/ui/primitives.jsx';

export const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Hex values (match the --chart-* tokens) for Recharts, which paints SVG attributes. */
export const CHART_HEX = { gold: '#e0a13a', teal: '#16a79a' };

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const round = (v, d = 0) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
export const pct = (v) => (isNum(v) ? `${round(v)}%` : '—');
export const num = (v, d = 1) => (isNum(v) ? String(round(v, d)) : '—');
export const fmtInt = (v) => (isNum(v) ? new Intl.NumberFormat('en-IN').format(Math.round(v)) : '—');

/** Traffic-light colour for a 0–100 score. */
export const scoreColor = (s) =>
  !isNum(s) ? 'var(--text-subtle)' : s >= 80 ? 'var(--success)' : s >= 60 ? 'var(--warning)' : 'var(--danger)';

export function ScoreRing({ value, size = 44 }) {
  if (!isNum(value)) return <span className="subtle" style={{ fontWeight: 700 }}>—</span>;
  return (
    <span className="score-ring" style={{ width: size, height: size }} title={`${round(value)} / 100`}>
      <ProgressRing value={value} size={size} stroke={4} color={scoreColor(value)} />
      <span className="tabular" style={{ color: scoreColor(value) }}>{round(value)}</span>
    </span>
  );
}

export function ScoreNum({ value }) {
  return (
    <span className="score-num tabular" style={{ color: scoreColor(value), fontSize: 15 }}>
      {isNum(value) ? round(value) : '—'}
    </span>
  );
}

export function TeamChips({ teams = [], max = 3 }) {
  if (!teams?.length) return null;
  const shown = teams.slice(0, max);
  return (
    <span className="row gap-1 wrap">
      {shown.map((t) => (
        <span
          key={t._id}
          className="chip chip-sm"
          style={{
            background: `color-mix(in srgb, ${t.color || 'var(--text-muted)'} 14%, transparent)`,
            borderColor: 'transparent',
            color: t.color || 'var(--text-muted)',
          }}
        >
          {t.name}
        </span>
      ))}
      {teams.length > max && <span className="tiny subtle">+{teams.length - max}</span>}
    </span>
  );
}
