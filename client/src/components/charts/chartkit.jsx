/**
 * Small Recharts wrappers pre-styled to the Vault design system so every chart
 * across the app shares one look (themed tooltip, brand colors, tabular numbers).
 */
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { CHART_COLORS } from '../../lib/ui.js';

const axisProps = {
  tick: { fill: 'var(--text-subtle)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--border)' },
};

export function ChartTooltip({ active, payload, label, valueSuffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-2)',
        padding: '8px 12px',
        fontSize: 12.5,
      }}
    >
      {label != null && <div style={{ fontWeight: 650, marginBottom: 4 }}>{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="row gap-2" style={{ justifyContent: 'space-between' }}>
          <span className="row gap-2 muted">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.payload?.color }} />
            {p.name}
          </span>
          <span className="tabular" style={{ fontWeight: 600 }}>
            {p.value}
            {valueSuffix}
          </span>
        </div>
      ))}
    </div>
  );
}

export function DonutChart({ data, height = 220, innerRadius = 58, outerRadius = 84, centerLabel }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color || CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      {centerLabel && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
          }}
        >
          <div className="center col">
            <div style={{ fontSize: 26, fontWeight: 750 }} className="tabular">{centerLabel.value ?? total}</div>
            <div className="tiny muted upper">{centerLabel.label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ComparisonBar({ data, keys, height = 260, suffix = '' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={0} angle={-12} textAnchor="end" height={48} />
        <YAxis {...axisProps} />
        <Tooltip content={<ChartTooltip valueSuffix={suffix} />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {keys.map((k, i) => (
          <Bar key={k.key} dataKey={k.key} name={k.name} fill={k.color || CHART_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={26} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendArea({ data, dataKey, name, color = '#16a79a', height = 240, suffix = '' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} allowDecimals={false} />
        <Tooltip content={<ChartTooltip valueSuffix={suffix} />} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2.5} fill={`url(#grad-${dataKey})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Sparkline({ data = [], color = '#e0a13a', height = 38, id }) {
  const points = data.map((v, i) => ({ i, v }));
  const gid = `spark-${id || color.replace('#', '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 3, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MiniBars({ data = [], color = '#e0a13a', height = 38 }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ top: 3, right: 0, left: 0, bottom: 0 }} barCategoryGap={2}>
        <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HBar({ data, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis type="number" {...axisProps} allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...axisProps} width={92} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-hover)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        <Bar dataKey="open" name="Open" stackId="a" fill="#16a79a" radius={[0, 0, 0, 0]} maxBarSize={20} />
        <Bar dataKey="overdue" name="Overdue" stackId="a" fill="#f43f5e" radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export { Line, LineChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid };
