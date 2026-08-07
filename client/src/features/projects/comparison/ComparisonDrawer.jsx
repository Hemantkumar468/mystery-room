import { Modal } from '../../../components/ui/Modal.jsx';
import { Badge } from '../../../components/ui/primitives.jsx';
import { fmtCurrency } from '../../../lib/format.js';
import { TRAFFIC_META, RISK_META, trafficForPercent } from '../records/scoring.js';

const SectionScoreCell = ({ pct }) => (
  <div className="row gap-2" style={{ alignItems: 'center' }}>
    <Badge color={TRAFFIC_META[trafficForPercent(pct)].color}>{TRAFFIC_META[trafficForPercent(pct)].emoji}</Badge>
    <span>{pct != null ? `${pct}/100` : '—'}</span>
  </div>
);

/**
 * Side-by-side property comparison — Amazon-product-compare style: metrics
 * run down the left as row labels, one column per selected property. Built
 * on the shared Modal (large format), so it inherits the fixed-header/
 * scrollable-body layout and Esc/backdrop-close behavior every other modal
 * in the app already has, rather than a bespoke comparison-only dialog.
 *
 * Takes scorecards (from scoring.js's computeScorecard), not raw records —
 * every number/traffic-light/risk shown here is the exact same derived
 * value the comparison table and the recommendation card use, so the three
 * views can never disagree with each other.
 */
export function ComparisonDrawer({ open, onClose, scorecards }) {
  if (!open) return null;

  const rows = [
    { label: 'City', render: (s) => s.property.values?.city || '—' },
    { label: 'Locality', render: (s) => s.property.values?.locality || '—' },
    { label: 'Feasibility', render: (s) => <SectionScoreCell pct={s.sections.feasibility?.percent} /> },
    { label: 'Financial', render: (s) => <SectionScoreCell pct={s.sections.financial?.percent} /> },
    { label: 'Technical', render: (s) => <SectionScoreCell pct={s.sections.technical?.percent} /> },
    { label: 'Operational', render: (s) => <SectionScoreCell pct={s.sections.operational?.percent} /> },
    { label: 'Return on Investment', render: (s) => (s.roi != null ? `${s.roi}%` : '—') },
    { label: 'Estimated Investment', render: (s) => fmtCurrency(s.investment) },
    { label: 'Monthly Revenue', render: (s) => fmtCurrency(s.monthlyRevenue) },
    { label: 'Investment Recovery Time', render: (s) => (s.paybackMonths != null ? `${s.paybackMonths} mo` : '—') },
    { label: 'Risk Level', render: (s) => <Badge color={RISK_META[s.riskLevel].color}>{RISK_META[s.riskLevel].label}</Badge> },
    {
      label: 'Overall Score',
      render: (s) => (
        <span className="row gap-2" style={{ alignItems: 'center', fontWeight: 600 }}>
          <Badge color={TRAFFIC_META[s.trafficOverall].color}>{TRAFFIC_META[s.trafficOverall].emoji}</Badge>
          {s.overallScore != null ? `${s.overallScore}/100` : 'Incomplete'}
        </span>
      ),
    },
    { label: 'Recommendation', render: (s) => <Badge color={TRAFFIC_META[s.trafficOverall].color}>{s.recommendation}</Badge> },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Compare Properties" subtitle={`${scorecards.length} selected`} width={null} className="modal-lg">
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 220 + scorecards.length * 200 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 160 }}>Metric</th>
              {scorecards.map((s) => (
                <th key={s.property._id} style={{ minWidth: 200 }}>
                  {s.rank && <div className="tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>Rank #{s.rank}</div>}
                  {s.property.title || 'Untitled Property'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{row.label}</td>
                {scorecards.map((s) => (
                  <td key={s.property._id}>{row.render(s)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default ComparisonDrawer;
