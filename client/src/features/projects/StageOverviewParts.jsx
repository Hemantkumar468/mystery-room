import { Avatar } from '../../components/ui/primitives.jsx';
import { SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { fmtDateTime, fromNow } from '../../lib/format.js';

/** One labeled fact in a Stage Overview grid — shared across every phase page's overview card. */
export function InfoTile({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 100 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 500, color: tone || 'var(--text)' }}>{value ?? '—'}</span>
    </div>
  );
}

/** Responsive grid wrapper for a row of InfoTiles. */
export const tileGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 'var(--space-3)' };

/** Shared activity-feed row list — every phase's Stage Overview/Activity Timeline card, "View Timeline" modals, and "View Full Timeline" all render the same shape. */
export function ActivityList({ items, loading }) {
  if (loading) return <SkeletonActivity rows={4} />;
  if (!items.length) return <div className="empty sm text-left" style={{ padding: '16px 12px', textAlign: 'left' }}>No activity yet</div>;
  return (
    <div className="col gap-2">
      {items.map((a) => (
        <div key={a._id} className="row gap-3" style={{ alignItems: 'flex-start' }}>
          <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
          <div className="col grow text-left" style={{ textAlign: 'left' }}>
            <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
            <div className="tiny muted">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
