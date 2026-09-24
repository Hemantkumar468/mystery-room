/**
 * AI Property Comparison — ranks the analysed candidates of one project.
 *
 * Sits under the properties table on Property Identification, where the
 * "which of these do we take forward?" question is actually asked. Reads only
 * from reports that already exist, so it is cheap: one call, no web research.
 *
 * Like the single-property panel, this recommends and never decides — the
 * Shortlist and Reject controls in the table above remain the only things that
 * change a record.
 */

import { useNavigate } from 'react-router-dom';
import { GitCompareArrows, Trophy, RefreshCw, ArrowRight, Info } from 'lucide-react';
import { SectionCard, EmptyState } from '../../components/ui/primitives.jsx';
import { useAiComparison, useRunAiComparison } from '../../app/api/aiApi.js';
import { fromNow } from '../../lib/format.js';
import { scoreColor, bandMeta, toneColor } from './aiUi.js';

export function SiteComparisonPanel({ projectId, analysedCount = 0, readOnly = false, canRun = true }) {
  const navigate = useNavigate();
  const { data: comparison, isLoading } = useAiComparison(projectId);
  const run = useRunAiComparison(projectId);

  const result = comparison?.status === 'succeeded' ? comparison.result : null;
  // The comparison is only meaningful once at least two properties have been
  // analysed — the server enforces this too, but saying so up front is kinder
  // than letting the button produce an error.
  const enoughToCompare = analysedCount >= 2;

  const action = canRun && !readOnly && enoughToCompare ? (
    <button
      type="button"
      className={result ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
      onClick={() => run.mutate()}
      disabled={run.isPending}
    >
      {run.isPending ? (
        <><span className="spinner" style={{ width: 12, height: 12 }} /> Comparing…</>
      ) : result ? (
        <><RefreshCw size={13} /> Refresh comparison</>
      ) : (
        <><GitCompareArrows size={13} /> Compare properties</>
      )}
    </button>
  ) : null;

  return (
    <div className="ai-panel">
      <SectionCard
        title="AI Property Comparison"
        subtitle={
          result
            ? `Ranked ${result.ranking?.length || 0} analysed properties · ${fromNow(comparison.completedAt)}`
            : 'Rank the analysed candidates against each other'
        }
        action={action}
      >
        {isLoading && (
          <div className="row gap-2 muted" style={{ padding: 16 }}>
            <span className="spinner" /> Loading comparison…
          </div>
        )}

        {!isLoading && !enoughToCompare && (
          <EmptyState
            icon={GitCompareArrows}
            title="Not enough analysed properties yet"
            hint="Run the AI location analysis on at least two properties, then come back to rank them against each other."
          />
        )}

        {!isLoading && enoughToCompare && !result && !run.isPending && (
          <EmptyState
            icon={GitCompareArrows}
            title="No comparison yet"
            hint={`${analysedCount} properties have been analysed. Compare them to see which stands up best and what each one costs you.`}
          />
        )}

        {run.isError && (
          <div className="ai-finding" style={{ '--ai-tone': 'var(--danger)' }}>
            <div className="ai-finding-title">Comparison failed</div>
            <div className="ai-finding-detail">
              {run.error?.response?.data?.message || 'An unexpected error occurred.'}
            </div>
          </div>
        )}

        {result && (
          <div className="col gap-5">
            {result.executive_summary && <p className="ai-summary">{result.executive_summary}</p>}

            {/* Ranking */}
            <div style={{ overflowX: 'auto' }}>
              <table className="ai-suggest-table">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Property</th>
                    <th style={{ width: 90 }}>Score</th>
                    <th>Verdict</th>
                    <th>Decisive factor</th>
                    <th>Trade-off</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {(result.ranking || []).map((r) => {
                    const isTop = r.recordId === result.recommended_property_ref;
                    return (
                      <tr key={r.recordId} style={isTop ? { background: 'var(--surface-2)' } : undefined}>
                        <td style={{ fontWeight: 800 }}>
                          {isTop ? (
                            <span title="Recommended" style={{ color: 'var(--success)' }}>
                              <Trophy size={14} style={{ verticalAlign: -2 }} />
                            </span>
                          ) : (
                            r.rank
                          )}
                        </td>
                        <td>
                          <div style={{ fontWeight: 650 }}>{r.title}</div>
                          <div className="ai-suggest-basis">
                            {[r.locality, r.city].filter(Boolean).join(', ')}
                          </div>
                        </td>
                        <td>
                          <span className="ai-score-cell" style={{ '--ai-tone': scoreColor(r.score) }}>
                            <span className="ai-score-dot" />
                            <span className="ai-score-num">{r.score ?? '—'}</span>
                          </span>
                          <div className="ai-suggest-basis">{r.band}</div>
                        </td>
                        <td className="ai-suggest-basis">{r.verdict}</td>
                        <td className="ai-suggest-basis">{r.decisive_factor}</td>
                        <td className="ai-suggest-basis">{r.trade_off}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm no-print"
                            title="Open this property"
                            aria-label={`Open ${r.title}`}
                            onClick={() => navigate(`/projects/${projectId}/property-identification/${r.recordId}`)}
                          >
                            <ArrowRight size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Where they actually differ */}
            {!!result.head_to_head?.length && (
              <div className="col gap-3">
                <div className="ai-place-group-title">Where these properties differ</div>
                <div className="ai-finding-grid">
                  {result.head_to_head.map((h, i) => (
                    <div key={i} className="ai-finding" style={{ '--ai-tone': toneColor('info') }}>
                      <div className="ai-finding-title">{h.dimension}</div>
                      <div className="ai-finding-detail">{h.finding}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.portfolio_advice && (
              <div className="col gap-2">
                <div className="ai-place-group-title"><Info size={13} /> On the shortlist as a whole</div>
                <p className="ai-summary">{result.portfolio_advice}</p>
              </div>
            )}

            {/* A property that was analysed but the model failed to rank must be
                visible — a silently dropped candidate is how a good site gets
                lost between two screens. */}
            {!!result.unranked?.length && (
              <div className="ai-disclaimer">
                Not ranked in this comparison: {result.unranked.map((u) => u.title).join(', ')}.
                Re-run the comparison to include them.
              </div>
            )}

            {!result.recommended_property_ref && (
              <div className="ai-disclaimer">
                The analysis did not recommend any of these properties outright. Read the
                portfolio note above before committing to the highest-ranked option.
              </div>
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export default SiteComparisonPanel;
