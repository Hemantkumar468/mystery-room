import { PackageSearch } from 'lucide-react';

const Bar = ({ w, h = 12, style }) => (
  <span className="gr-sk" style={{ display: 'block', width: w, height: h, ...style }} />
);

/**
 * The loading shape of this page, not a spinner: the cards, the filter bar
 * and the rows land in the positions they will occupy, so nothing jumps when
 * the data arrives.
 */
export function GoodsReceivedSkeleton({ rows = 6 }) {
  return (
    <div className="gr" aria-busy="true" aria-label="Loading goods received">
      <div className="gr-stats">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="gr-stat" key={i}>
            <span className="gr-sk gr-stat-icon" />
            <div className="gr-stat-body" style={{ flex: 1 }}>
              <Bar w="70%" h={9} />
              <Bar w="42%" h={20} style={{ marginTop: 6 }} />
              <Bar w="80%" h={9} style={{ marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>

      <div className="gr-filters">
        <Bar w={360} h={42} style={{ maxWidth: '100%', borderRadius: 8 }} />
        <Bar w={220} h={42} style={{ maxWidth: '100%', borderRadius: 8 }} />
        <Bar w={110} h={42} style={{ marginLeft: 'auto', borderRadius: 8 }} />
      </div>

      <div className="gr-chips">
        {[110, 140, 132, 138, 96, 168].map((w) => <Bar key={w} w={w} h={36} style={{ borderRadius: 999 }} />)}
      </div>

      <div className="gr-table-card">
        <Bar w="100%" h={52} style={{ borderRadius: 0 }} />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid var(--gr-border-light)' }}>
            {[140, 120, 130, 120, 110, 140, 120, 150, 120].map((w, j) => <Bar key={j} w={w} h={14} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Nothing matched — with the way out, not just the bad news. */
export function GoodsReceivedEmpty({ title, hint, onClear }) {
  return (
    <div className="gr-table-card">
      <div className="gr-empty">
        <span className="gr-empty-icon"><PackageSearch size={28} strokeWidth={1.6} /></span>
        <span className="gr-empty-title">{title}</span>
        <span className="gr-empty-hint">{hint}</span>
        {onClear && (
          <button type="button" className="gr-filter-btn" onClick={onClear}>Clear filters</button>
        )}
      </div>
    </div>
  );
}

export default GoodsReceivedSkeleton;
