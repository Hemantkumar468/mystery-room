import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { initials } from '../../lib/format.js';
import {
  TASK_STATUS_META,
  PROJECT_STATUS_META,
  HEALTH_META,
  PRIORITY_META,
} from '../../lib/ui.js';

export function Badge({ color = '#6B7280', soft, children, dot = false, style }) {
  const bg = soft || `${color}1A`;
  return (
    <span
      className="badge"
      style={{ background: bg, color, ...style }}
    >
      {dot && <span className="badge-dot" style={{ background: color }} />}
      {children}
    </span>
  );
}

const metaBadge = (map, fallbackLabel) =>
  function MetaBadge({ value, dot = true }) {
    const m = map[value] || { label: value || fallbackLabel, color: '#6b7280' };
    return (
      <Badge color={m.color} soft={m.soft} dot={dot}>
        {m.label}
      </Badge>
    );
  };

export const StatusBadge = metaBadge(TASK_STATUS_META, 'Unknown');
export const ProjectStatusBadge = metaBadge(PROJECT_STATUS_META, 'Unknown');
export const HealthBadge = metaBadge(HEALTH_META, 'Unknown');

export function PriorityBadge({ value }) {
  const m = PRIORITY_META[value] || PRIORITY_META.medium;
  return <Badge color={m.color} dot>{m.label}</Badge>;
}

export function Avatar({ name, color = '#ce8c24', size = 30, title }) {
  return (
    <span
      className="avatar"
      title={title || name}
      style={{ background: color, width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people = [], max = 4 }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="avatar-stack">
      {/*
        Composite key: the same user can legitimately appear more than once in a
        list (e.g. a project with duplicate members), so a bare `_id` would
        collide. Pairing it with the render index guarantees uniqueness.
      */}
      {shown.map((p, i) => (
        <Avatar key={`${p?._id || 'anon'}-${i}`} name={p?.name} color={p?.avatarColor} size={28} />
      ))}
      {extra > 0 && (
        <span className="avatar" style={{ background: 'var(--ink-500)', width: 28, height: 28 }}>
          +{extra}
        </span>
      )}
    </div>
  );
}

export function ProgressBar({ value = 0, height = 8, gradient }) {
  return (
    <div className="progress" style={{ height }}>
      <div
        className="progress-bar"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: gradient }}
      />
    </div>
  );
}

export function ProgressRing({ value = 0, size = 46, stroke = 5, color = 'var(--primary)' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, value) / 100) * c;
  return (
    <svg width={size} height={size} className="ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
    </svg>
  );
}

export function Spinner({ label }) {
  return (
    <div className="row gap-2 muted" style={{ padding: 'var(--space-4)' }}>
      <span className="spinner" /> {label}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="center" style={{ minHeight: 320 }}>
      <span className="spinner" style={{ width: 26, height: 26 }} />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={34} strokeWidth={1.4} />}
      <div className="col gap-1 center">
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
        {hint && <div className="sm muted">{hint}</div>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '', ...rest }) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

/** Generic icon + tinted-text info banner, e.g. "About Phase Completion" explainers. */
export function InfoPanel({ icon: Icon, tone = 'info', title, children }) {
  return (
    <div className={`info-panel info-panel--${tone}`}>
      {Icon && <Icon size={18} className="info-panel-icon" />}
      <div className="col gap-1">
        {title && <div className="info-panel-title">{title}</div>}
        <div className="info-panel-body">{children}</div>
      </div>
    </div>
  );
}

export function SectionCard({
  title, subtitle, action, children, bodyClass = 'card-body',
  collapsible = false, defaultCollapsed = false, style, className,
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const showBody = !collapsible || open;
  return (
    <div className={`card${className ? ` ${className}` : ''}`} style={style}>
      {(title || action || collapsible) && (
        <div
          className="card-head"
          onClick={collapsible ? () => setOpen((o) => !o) : undefined}
          style={collapsible ? { cursor: 'pointer', userSelect: 'none' } : undefined}
        >
          <div className="col">
            {title && <div className="section-title">{title}</div>}
            {subtitle && <div className="sm muted">{subtitle}</div>}
          </div>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
            {collapsible && (
              <ChevronDown
                size={17}
                className="muted"
                style={{ transition: 'transform 0.2s ease', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
              />
            )}
          </div>
        </div>
      )}
      {showBody && <div className={bodyClass}>{children}</div>}
    </div>
  );
}
