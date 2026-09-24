import { memo } from 'react';
import { Scale, ClipboardList } from 'lucide-react';
import { SectionCard, Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { fmtCurrency } from '../../../lib/format.js';
import {
  SECTION_WEIGHTS, weightedPoints, TRAFFIC_META, RISK_META, trafficForRoi,
} from '../records/scoring.js';

const MAX_COMPARE = 4;

const AnalysisRow = memo(function AnalysisRow({ scorecard: s, selected, onToggle }) {
  return (
    <tr>
      <td><input type="checkbox" checked={selected} onChange={() => onToggle(String(s.property._id))} aria-label={`Select ${s.property.title || 'property'}`} /></td>
      <td className="mono tiny subtle">{s.rank ? `#${s.rank}` : '—'}</td>
      <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{s.property.title || 'Untitled Property'}</td>
      {Object.keys(SECTION_WEIGHTS).map((key) => (
        <td key={key} className="mono" style={{ whiteSpace: 'nowrap' }}>
          {weightedPoints(s.sections[key]?.percent, key)}/{SECTION_WEIGHTS[key]}
        </td>
      ))}
      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.overallScore}/100</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span style={{ color: TRAFFIC_META[trafficForRoi(s.roi)].color, fontWeight: 500 }}>{s.roi != null ? `${s.roi}%` : '—'}</span>
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>{fmtCurrency(s.investment)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{fmtCurrency(s.monthlyRevenue)}</td>
      <td style={{ whiteSpace: 'nowrap' }}>{s.paybackMonths != null ? `${s.paybackMonths} mo` : '—'}</td>
      <td style={{ whiteSpace: 'nowrap' }}><Badge color={RISK_META[s.riskLevel].color}>{RISK_META[s.riskLevel].label}</Badge></td>
      <td style={{ whiteSpace: 'nowrap' }}><Badge color={TRAFFIC_META[s.trafficOverall].color}>{s.recommendation}</Badge></td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span className={`se-rank-badge${s.rank === 1 ? ' gold' : ''}`}>{s.rank ? `#${s.rank}` : '—'}</span>
      </td>
    </tr>
  );
}, (prev, next) => prev.scorecard === next.scorecard && prev.selected === next.selected);

/**
 * Property Analysis & Comparison — the compact, checkbox-enabled table
 * every metric on the dashboard traces back to. Rows come in pre-ranked
 * (scoring.js's rankScorecards, applied once by the page), so this
 * component only renders — no sorting/scoring logic lives here, keeping the
 * scoring model in exactly one place.
 */
export function PropertyAnalysisTable({ scorecards, selectedIds, onToggle, onCompareSelected }) {
  return (
    <SectionCard
      title="Property Analysis & Comparison"
      subtitle={`${scorecards.length} evaluated ${scorecards.length === 1 ? 'property' : 'properties'}`}
    >
      {scorecards.length ? (
        <div className="col gap-3">
          <div className="se-analysis-table" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th rowSpan={2}></th>
                  <th rowSpan={2}>Rank</th>
                  <th rowSpan={2}>Property Name</th>
                  <th colSpan={4} style={{ textAlign: 'center' }}>Assessments (Score/100)</th>
                  <th rowSpan={2}>Overall Score</th>
                  <th rowSpan={2}>Return on Investment</th>
                  <th rowSpan={2}>Investment</th>
                  <th rowSpan={2}>Monthly Revenue</th>
                  <th rowSpan={2}>Recovery Time</th>
                  <th rowSpan={2}>Risk</th>
                  <th rowSpan={2}>Recommendation</th>
                  <th rowSpan={2}>Rank</th>
                </tr>
                <tr>
                  <th>Feasibility (25)</th>
                  <th>Financial (35)</th>
                  <th>Technical (20)</th>
                  <th>Operational (20)</th>
                </tr>
              </thead>
              <tbody>
                {scorecards.map((s) => (
                  <AnalysisRow
                    key={s.property._id}
                    scorecard={s}
                    selected={selectedIds.has(String(s.property._id))}
                    onToggle={onToggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="tiny muted">{selectedIds.size} properties selected{selectedIds.size >= MAX_COMPARE ? ` (max ${MAX_COMPARE})` : ''}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={selectedIds.size < 2}
              onClick={onCompareSelected}
              title={selectedIds.size < 2 ? 'Select at least 2 properties to compare' : undefined}
            >
              <Scale size={13} /> Compare Selected ({selectedIds.size})
            </button>
          </div>
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No evaluated properties yet" hint="A property appears here once all four assessments are Approved." />
      )}
    </SectionCard>
  );
}

export { MAX_COMPARE };
export default PropertyAnalysisTable;
