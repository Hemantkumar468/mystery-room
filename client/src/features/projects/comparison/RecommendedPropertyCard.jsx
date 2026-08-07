import { Star, Building2, Check, Bookmark } from 'lucide-react';
import { fmtCurrency } from '../../../lib/format.js';
import { reasonsFor } from '../records/scoring.js';

/**
 * Premium "top pick" card — always exactly one property: the highest-ranked
 * scorecard in the pool passed in (already sorted by scoring.js's
 * compareScorecards, so rank #1 is simply pool[0] once filtered to fully-
 * approved properties). Renders nothing when no property has finished
 * evaluation yet, rather than guessing off incomplete data.
 */
export function RecommendedPropertyCard({ scorecards }) {
  const pool = scorecards.filter((s) => s.isFullyApproved);
  const top = pool[0];
  if (!top) return null;

  const reasons = reasonsFor(top, pool);

  const metrics = [
    { label: 'Overall Score', value: `${top.overallScore}/100` },
    { label: 'Return on Investment', value: top.roi != null ? `${top.roi}%` : '—' },
    { label: 'Investment', value: fmtCurrency(top.investment) },
    { label: 'Monthly Revenue', value: fmtCurrency(top.monthlyRevenue) },
    { label: 'Investment Recovery Time', value: top.paybackMonths != null ? `${top.paybackMonths} Months` : '—' },
  ];

  return (
    <div className="se-recommended">
      <div className="se-recommended-ribbon"><Bookmark size={16} color="#fff" fill="#fff" /></div>
      <div className="se-recommended-thumb"><Building2 size={34} /></div>

      <div className="col gap-1" style={{ minWidth: 180, position: 'relative', zIndex: 1 }}>
        <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><Star size={12} color="var(--gold-500)" /> Recommended Property</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{top.property.title || 'Untitled Property'}</span>
        <span className="tiny muted">{top.property.values?.city || '—'}{top.property.values?.locality ? `, ${top.property.values.locality}` : ''}</span>
      </div>

      <div className="se-recommended-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="col gap-1">
            <span className="se-metric-label">{m.label}</span>
            <span className="se-metric-value">{m.value}</span>
          </div>
        ))}
      </div>

      <div className="col gap-2" style={{ minWidth: 260, position: 'relative', zIndex: 1 }}>
        <span className="tiny subtle upper">Reasons</span>
        {reasons.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 12, rowGap: 4 }}>
            {reasons.map((r) => (
              <span key={r} className="row gap-2 sm" style={{ alignItems: 'center', whiteSpace: 'nowrap' }}>
                <Check size={13} color="var(--success)" /> {r}
              </span>
            ))}
          </div>
        ) : <span className="tiny muted">Approved on every section</span>}
      </div>
    </div>
  );
}

export default RecommendedPropertyCard;
