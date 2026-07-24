import { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import { EmptyState } from './primitives.jsx';

const UNITS = [
  { key: 'days', label: 'Days', ms: 1000 * 60 * 60 * 24 },
  { key: 'hours', label: 'Hours', ms: 1000 * 60 * 60 },
  { key: 'minutes', label: 'Minutes', ms: 1000 * 60 },
  { key: 'seconds', label: 'Seconds', ms: 1000 },
];

function diffParts(ms) {
  let remaining = Math.max(0, ms);
  const parts = {};
  for (const u of UNITS) {
    parts[u.key] = Math.floor(remaining / u.ms);
    remaining -= parts[u.key] * u.ms;
  }
  return parts;
}

/**
 * Live D/H/M/S countdown to `target` (an ISO date/datetime string). No
 * external date library — this codebase has none beyond server-only dayjs.
 * Renders an "Overdue" state past the target, and an empty state when no
 * target is set yet.
 */
export function Countdown({ target }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target) {
    return <EmptyState icon={Rocket} title="Launch date not set" hint="Set the Launch Date & Time in Launch Details." />;
  }

  const targetMs = new Date(target).getTime();
  const remainingMs = targetMs - now;
  const overdue = remainingMs <= 0;
  const parts = diffParts(remainingMs);

  return (
    <div className="col gap-2">
      <div className="sl-analytics-row" style={{ width: '100%' }}>
        {UNITS.map((u) => (
          <div key={u.key} className="sl-analytics-tile" style={{ textAlign: 'center', flex: '1 1 0' }}>
            <span className="sl-analytics-value" style={{ fontSize: 20 }}>
              {String(overdue ? 0 : parts[u.key]).padStart(2, '0')}
            </span>
            <span className="sl-analytics-label">{u.label}</span>
          </div>
        ))}
      </div>
      {overdue && <div className="tiny" style={{ color: 'var(--danger)', fontWeight: 600 }}>Launch Overdue</div>}
    </div>
  );
}

export default Countdown;
