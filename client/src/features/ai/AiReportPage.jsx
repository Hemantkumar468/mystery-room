import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, History, Clock, Coins, AlertTriangle } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { useRecord } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { usePropertyAnalysis, usePropertyAnalysisHistory } from '../../app/api/aiApi.js';
import { fmtDateTime, fromNow, fmtDuration } from '../../lib/format.js';
import { bandMeta, scoreColor } from './aiUi.js';
import {
  ScoreHero, PillarBars, FindingGrid, RiskGrid, LocationProfile, NearbyPlaces,
  CommercialRead, RecommendationBlock, ConfidenceBlock, SourceList, SiteVisitQuestions,
} from './ReportSections.jsx';

/**
 * The full AI location-intelligence report for one property, as a page rather
 * than a panel — printable, linkable, and able to show any run in the record's
 * history, not only the newest.
 *
 * The panel on the property page is a summary with a collapsed history list of
 * score-and-date rows. Those rows were not openable, so every previous run's
 * reasoning was stored server-side (`historyForRecord` returns the complete
 * presented analysis for each) and shown nowhere. A report that cost real money
 * to produce and informs a multi-year lease should be readable, comparable
 * against the run before it, and exportable for people who will never log in.
 *
 * `?run=<id>` selects a historical run; without it, the latest is shown.
 *
 * PDF is `window.print()` against print CSS, the same mechanism every other
 * report page here uses (Closure, Assessment, Commercial). No PDF library:
 * the browser's own engine paginates better than anything bundled would, and
 * it keeps live text selectable and searchable rather than rasterised.
 */
export function AiReportPage() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');

  const { data: project } = useProject(id);
  const { data: record } = useRecord(recordId);
  const { data: latest, isLoading } = usePropertyAnalysis(recordId, { includeBrief: true });
  const { data: history } = usePropertyAnalysisHistory(recordId, true);
  const [showBrief, setShowBrief] = useState(false);

  // A run named in the URL wins; otherwise the newest. Falling back to
  // `latest` rather than erroring means a stale bookmark still shows the
  // current report instead of a dead end.
  const runs = history || [];
  const analysis = (runId && runs.find((r) => String(r._id) === runId)) || latest;
  const isHistorical = Boolean(analysis && latest && String(analysis._id) !== String(latest._id));

  const title = record?.title || record?.values?.property_name || 'Property';

  if (isLoading && !analysis) {
    return (
      <>
        <Topbar title="AI Report" />
        <div className="content"><div className="content-narrow col gap-3"><SkBlock h={220} /><SkBlock h={320} /></div></div>
      </>
    );
  }

  if (!analysis || analysis.status !== 'succeeded') {
    return (
      <>
        <Topbar
          title={(
            <span className="row gap-3">
              <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
              AI Report
            </span>
          )}
        />
        <div className="content">
          <div className="card">
            <EmptyState
              icon={AlertTriangle}
              title={analysis?.status === 'failed' ? 'That analysis failed' : 'No completed analysis yet'}
              hint={
                analysis?.error
                || 'Run the AI location analysis on this property first — it takes about a minute.'
              }
              action={<button className="btn btn-primary" onClick={() => navigate(-1)}>Back to property</button>}
            />
          </div>
        </div>
      </>
    );
  }

  const r = analysis.result || {};
  const meta = bandMeta(analysis.score);

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
            AI Report
          </span>
        )}
        actions={(
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Download size={15} /> Download PDF
          </button>
        )}
      />

      <div className="content">
        <div className="content-narrow col gap-3 fade-in ai-report">
          {/* Print-only header. The Topbar and sidebar are hidden on paper, so
              without this the PDF would open with no indication of what it is
              or which property it concerns. */}
          <div className="ai-report-printhead">
            <h1>AI Location Intelligence Report</h1>
            <p>
              <b>{title}</b>
              {record?.values?.city && ` · ${[record.values.locality, record.values.city].filter(Boolean).join(', ')}`}
            </p>
            <p>
              {project?.code} · {project?.name} · generated {fmtDateTime(analysis.completedAt || analysis.createdAt)}
            </p>
          </div>

          {isHistorical && (
            <div className="ai-report-histbanner">
              <History size={15} />
              <span>
                Viewing an earlier run from <b>{fmtDateTime(analysis.createdAt)}</b> — not the current report.
              </span>
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => setParams({})}>
                Show latest
              </button>
            </div>
          )}

          <div className="card" style={{ padding: 18 }}>
            <ScoreHero score={analysis.score} result={r} />
          </div>

          <div className="card" style={{ padding: 18 }}>
            <RecommendationBlock recommendation={r.recommendation} score={analysis.score} />
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h3 className="section-title">Scoring against the rubric</h3>
            <PillarBars pillars={r.pillars} />
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h3 className="section-title">Strengths</h3>
            <FindingGrid items={r.strengths} tone="success" emptyText="No strengths recorded." />
            <h3 className="section-title" style={{ marginTop: 18 }}>Concerns</h3>
            <FindingGrid items={r.concerns} tone="warning" emptyText="No concerns recorded." />
          </div>

          {(r.risks?.length > 0) && (
            <div className="card" style={{ padding: 18 }}>
              <h3 className="section-title">Risks</h3>
              <RiskGrid risks={r.risks} />
            </div>
          )}

          {r.locationProfile && (
            <div className="card" style={{ padding: 18 }}>
              <h3 className="section-title">Location profile</h3>
              <LocationProfile profile={r.locationProfile} />
            </div>
          )}

          {r.nearby && (
            <div className="card" style={{ padding: 18 }}>
              <h3 className="section-title">What is nearby</h3>
              <NearbyPlaces nearby={r.nearby} />
            </div>
          )}

          {r.commercial && (
            <div className="card" style={{ padding: 18 }}>
              <h3 className="section-title">Commercial read</h3>
              <CommercialRead commercial={r.commercial} />
            </div>
          )}

          {r.siteVisitQuestions?.length > 0 && (
            <div className="card" style={{ padding: 18 }}>
              <h3 className="section-title">Ask on the site visit</h3>
              <SiteVisitQuestions questions={r.siteVisitQuestions} />
            </div>
          )}

          <div className="card" style={{ padding: 18 }}>
            <h3 className="section-title">How much to trust this</h3>
            <ConfidenceBlock score={analysis.score} confidence={analysis.score?.confidence} />
            <h3 className="section-title" style={{ marginTop: 18 }}>Sources</h3>
            <SourceList citations={analysis.research?.citations} />
          </div>

          {/* Provenance. A report that informs a lease has to be able to say
              which model produced it, under which prompt and rubric version,
              what it cost and who asked for it — otherwise two reports that
              disagree cannot be told apart. */}
          <div className="card" style={{ padding: 18 }}>
            <h3 className="section-title">How this was produced</h3>
            <div className="ai-report-provenance">
              <div><span>Model</span><b>{analysis.provider} · {analysis.model}</b></div>
              <div><span>Grounded</span><b>{analysis.research?.grounded === false ? 'No — desk reasoning only' : `Yes · ${analysis.research?.citations?.length || 0} sources`}</b></div>
              <div><span>Prompt / rubric</span><b>{analysis.promptVersion} · {analysis.rubricVersion}</b></div>
              <div><span>Requested by</span><b>{analysis.requestedBy?.name || '—'}</b></div>
              <div><span>Completed</span><b>{fmtDateTime(analysis.completedAt || analysis.createdAt)}</b></div>
              <div>
                <span>Cost</span>
                <b>
                  {analysis.usage?.totalTokens ? `${analysis.usage.totalTokens.toLocaleString()} tokens` : '—'}
                  {analysis.usage?.costUsd ? ` · ~$${analysis.usage.costUsd}` : ''}
                  {analysis.durationMs ? ` · ${fmtDuration(Math.round(analysis.durationMs / 1000))}` : ''}
                </b>
              </div>
            </div>

            {analysis.research?.brief && (
              <div style={{ marginTop: 14 }}>
                <button type="button" className="btn btn-subtle btn-sm no-print" onClick={() => setShowBrief((s) => !s)}>
                  {showBrief ? 'Hide' : 'Show'} the raw research brief
                </button>
                {showBrief && <pre className="ai-report-brief">{analysis.research.brief}</pre>}
              </div>
            )}
          </div>

          {/* Full run history — every previous report, openable. */}
          {runs.length > 1 && (
            <div className="card" style={{ padding: 18 }} data-print="avoid">
              <h3 className="section-title">
                Previous runs <span className="tiny muted">({runs.length})</span>
              </h3>
              <div className="col gap-1" style={{ marginTop: 8 }}>
                {runs.map((h) => {
                  const hm = bandMeta(h.score);
                  const active = String(h._id) === String(analysis._id);
                  return (
                    <button
                      key={h._id}
                      type="button"
                      className={`ai-report-run${active ? ' active' : ''}`}
                      onClick={() => setParams(String(h._id) === String(latest?._id) ? {} : { run: String(h._id) })}
                    >
                      <span className="ai-score-cell" style={{ '--ai-tone': scoreColor(h.score?.overall), minWidth: 54 }}>
                        <span className="ai-score-dot" />
                        <span className="ai-score-num">{h.score?.overall ?? '—'}</span>
                      </span>
                      <span style={{ minWidth: 120, textAlign: 'left' }}>
                        {h.status === 'succeeded' ? hm.label : h.status === 'failed' ? 'Failed' : h.status}
                      </span>
                      <span className="muted" style={{ flex: 1, textAlign: 'left' }}>
                        <Clock size={11} style={{ marginRight: 5, verticalAlign: -1 }} />
                        {fmtDateTime(h.createdAt)} · {fromNow(h.createdAt)}
                      </span>
                      {h.usage?.totalTokens > 0 && (
                        <span className="tiny muted">
                          <Coins size={11} style={{ marginRight: 4, verticalAlign: -1 }} />
                          {h.usage.totalTokens.toLocaleString()}
                        </span>
                      )}
                      <span className="row gap-2" style={{ alignItems: 'center' }}>
                        {h.requestedBy?.name && <Avatar name={h.requestedBy.name} color={h.requestedBy.avatarColor} size={22} />}
                        {active && <Badge color={meta.color} soft>Viewing</Badge>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <p className="ai-report-footnote">
            This report is decision support, not a decision. Every figure is the model’s reading of
            public sources listed above; nothing here changes a record’s status or shortlists a
            property. Verify anything material on the site visit.
          </p>
        </div>
      </div>
    </>
  );
}

export default AiReportPage;
