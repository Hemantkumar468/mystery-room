/**
 * Property Intelligence — the AI report for one candidate property.
 *
 * Drops into the Property detail page as a self-contained section. Owns the
 * run lifecycle (start → poll → render) and every state that lifecycle can be
 * in; all rendering of a finished report is delegated to ReportSections.
 *
 * Deliberate framing throughout: this panel *advises* the shortlisting
 * decision, it never makes it. Nothing here writes to the record, changes a
 * status, or pre-fills a form — the Shortlist and Reject buttons remain the
 * human's, exactly where they were.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Sparkles, RefreshCw, AlertCircle, Search, Brain, Calculator,
  FileText, History, ChevronDown, Clock, Coins, CheckCircle2,
} from 'lucide-react';
import { SectionCard, EmptyState } from '../../components/ui/primitives.jsx';
import {
  useAiStatus, usePropertyAnalysis, useRunPropertyAnalysis, usePropertyAnalysisHistory,
} from '../../app/api/aiApi.js';
import { fmtDateTime, fromNow } from '../../lib/format.js';
import { bandMeta, scoreColor, fmtDuration, isRunning } from './aiUi.js';
import {
  ScoreHero, PillarBars, FindingGrid, RiskGrid, LocationProfile, NearbyPlaces,
  CommercialRead, RecommendationBlock, SuggestedInputs, SiteVisitQuestions,
  ConfidenceBlock, SourceList,
} from './ReportSections.jsx';

/** Mirrors the server's RUN_STEPS so the wait is narrated, not just spun at. */
const RUN_STEPS = [
  { key: 'context', label: 'Reading the property record', icon: FileText },
  { key: 'research', label: 'Researching the catchment on the web', icon: Search },
  { key: 'synthesis', label: 'Scoring the site against the rubric', icon: Brain },
  { key: 'scoring', label: 'Computing the weighted score', icon: Calculator },
];

function RunningState({ analysis }) {
  const currentKey = analysis?.progress?.step || 'context';
  const pct = analysis?.progress?.pct ?? 5;
  const currentIndex = Math.max(0, RUN_STEPS.findIndex((s) => s.key === currentKey));

  return (
    <div className="ai-run-state">
      <Sparkles size={26} style={{ color: 'var(--primary)' }} />
      <div className="col gap-1 center">
        <div style={{ fontWeight: 700, fontSize: 14 }}>Analysing this location…</div>
        <div className="sm muted">
          Searching local sources and scoring the site. This usually takes 30–90 seconds —
          you can leave this page and come back.
        </div>
      </div>

      <div className="ai-progress-track">
        <div className="ai-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="ai-run-steps">
        {RUN_STEPS.map((step, i) => {
          const Icon = step.icon;
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div
              key={step.key}
              className={`ai-run-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
            >
              {done ? <CheckCircle2 size={13} /> : active ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Icon size={13} />}
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Previous runs — the audit trail of how a property's read changed over time. */
function HistoryList({ recordId, open }) {
  const { data: history, isLoading } = usePropertyAnalysisHistory(recordId, open);
  if (!open) return null;
  if (isLoading) return <div className="sm muted" style={{ padding: '8px 0' }}>Loading history…</div>;
  if (!history?.length) return <div className="ai-suggest-basis">No previous runs.</div>;

  return (
    <div className="col gap-2" style={{ paddingTop: 8 }}>
      {history.map((h) => {
        const meta = bandMeta(h.score);
        return (
          <div key={h._id} className="row gap-3" style={{ alignItems: 'center', fontSize: 12 }}>
            <span className="ai-score-cell" style={{ '--ai-tone': scoreColor(h.score?.overall), minWidth: 54 }}>
              <span className="ai-score-dot" />
              <span className="ai-score-num">{h.score?.overall ?? '—'}</span>
            </span>
            <span style={{ minWidth: 110, color: 'var(--text-subtle)' }}>
              {h.status === 'succeeded' ? meta.label : h.status === 'failed' ? 'Failed' : h.status}
            </span>
            <span className="muted" style={{ flex: 1 }}>
              {fmtDateTime(h.createdAt)} · {fromNow(h.createdAt)}
            </span>
            <span className="muted">{h.requestedBy?.name || '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

export function PropertyIntelligencePanel({ recordId, readOnly = false, canRun = true }) {
  const { data: status, isLoading: statusLoading } = useAiStatus();
  const { data: analysis, isLoading } = usePropertyAnalysis(recordId);
  const run = useRunPropertyAnalysis(recordId);
  // The report route hangs off this page's own path. Safe because this panel
  // is only ever rendered by PropertyDetailPage, whose URL already ends in the
  // record id — deriving it beats threading projectId through as a new prop.
  const navigate = useNavigate();
  const location = useLocation();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);

  const running = isRunning(analysis) || run.isPending;
  const result = analysis?.result;
  // Boolean, not the truthy `result` object — it is passed straight through as
  // the `force` flag, which the API validates as a boolean.
  const ready = Boolean(analysis?.status === 'succeeded' && result);

  /* ── AI not configured ─────────────────────────────── */
  if (!statusLoading && status && !status.available) {
    return (
      <SectionCard title="AI Location Intelligence" subtitle="Not configured">
        <EmptyState
          icon={Sparkles}
          title="AI analysis is not switched on"
          hint={
            status.reason ||
            'Add an AI provider API key to the server environment to enable property analysis.'
          }
        />
      </SectionCard>
    );
  }

  const startRun = (force) => run.mutate({ force });

  /* ── Header actions ────────────────────────────────── */
  const action = (
    <div className="row gap-2 wrap no-print">
      {/* The panel is a summary. The full report — every pillar, the risks,
          the sources, the provenance, and every previous run openable — lives
          on its own printable page, which is also what "Download PDF" needs. */}
      {ready && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate(`${location.pathname.replace(/\/$/, '')}/ai-report`)}
          title="Open the full report — printable, with run history"
        >
          <FileText size={13} /> Full report
        </button>
      )}
      {ready && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setHistoryOpen((o) => !o)}
          title="Previous runs"
        >
          <History size={13} /> History
        </button>
      )}
      {canRun && !readOnly && (
        <button
          type="button"
          className={ready ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm'}
          onClick={() => startRun(ready)}
          disabled={running || run.isPending}
        >
          {running ? (
            <><span className="spinner" style={{ width: 12, height: 12 }} /> Analysing…</>
          ) : ready ? (
            <><RefreshCw size={13} /> Re-analyse</>
          ) : (
            <><Sparkles size={13} /> Analyse this location</>
          )}
        </button>
      )}
    </div>
  );

  const subtitle = ready
    ? `${analysis.provider || 'AI'} · ${analysis.model || ''} · ${fromNow(analysis.completedAt)}`
    : 'AI-assisted site screening — advisory only';

  return (
    <div className="ai-panel">
      <SectionCard title="AI Location Intelligence" subtitle={subtitle} action={action}>
        {/* ── Loading ── */}
        {isLoading && !analysis && (
          <div className="row gap-2 muted" style={{ padding: 16 }}>
            <span className="spinner" /> Loading analysis…
          </div>
        )}

        {/* ── Running ── */}
        {running && <RunningState analysis={analysis} />}

        {/* ── Failed ── */}
        {!running && analysis?.status === 'failed' && (
          <div className="col gap-3">
            <div className="ai-finding" style={{ '--ai-tone': 'var(--danger)' }}>
              <div className="ai-finding-head">
                <span className="ai-finding-title">
                  <AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                  The analysis could not be completed
                </span>
              </div>
              <div className="ai-finding-detail">
                {analysis.error?.message || 'An unexpected error occurred.'}
              </div>
            </div>
            {canRun && !readOnly && (
              <div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => startRun(true)}>
                  <RefreshCw size={13} /> Try again
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Never run ── */}
        {!running && !analysis && !isLoading && (
          <EmptyState
            icon={Sparkles}
            title="No analysis yet"
            hint="Run an AI analysis to research this location's catchment, demand drivers, competition, accessibility and risks before shortlisting."
            action={
              canRun && !readOnly ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => startRun(false)}>
                  <Sparkles size={13} /> Analyse this location
                </button>
              ) : null
            }
          />
        )}

        {/* ── Report ── */}
        {!running && ready && (
          <div className="col gap-5">
            <ScoreHero score={analysis.score} result={result} />

            {analysis.isStale && (
              <div className="ai-disclaimer">
                This report is more than a week old. Catchments and competition change —
                consider re-analysing before it informs a final decision.
              </div>
            )}

            {/* A run that never reached the web is desk reasoning, not research.
                It has to be labelled as such wherever the report is read. */}
            {analysis.research?.grounded === false && (
              <div className="ai-disclaimer" style={{ '--ai-tone': 'var(--warning)' }}>
                <b>No web research in this run.</b> The provider's search tool was unavailable,
                so this report is the model's prior knowledge only — no sources were consulted.
                Treat every local figure as unverified, and re-analyse once search is enabled.
              </div>
            )}

            {/* Run provenance. An analysis that steers a lease decision has to
                say plainly who ran it, on what, and at what cost. */}
            <div className="ai-meta-strip">
              <span><Clock size={11} style={{ verticalAlign: -1 }} /> {fmtDuration(analysis.durationMs)}</span>
              <span><b>{analysis.research?.citations?.length || 0}</b> sources</span>
              {analysis.usage?.totalTokens ? (
                <span><b>{analysis.usage.totalTokens.toLocaleString()}</b> tokens</span>
              ) : null}
              {analysis.usage?.estimatedCostUsd ? (
                <span title="Indicative provider cost for this run">
                  <Coins size={11} style={{ verticalAlign: -1 }} /> ~${analysis.usage.estimatedCostUsd.toFixed(3)}
                </span>
              ) : null}
              <span>Run by <b>{analysis.requestedBy?.name || 'system'}</b> · {fmtDateTime(analysis.completedAt)}</span>
            </div>

            <HistoryList recordId={recordId} open={historyOpen} />

            <Block title="Score breakdown" hint="Each pillar scored independently; the weighted total is computed by the system, not the model. Click a row for the reasoning and evidence behind it.">
              <PillarBars pillars={analysis.score?.pillars} />
            </Block>

            <Block title="Location profile">
              <LocationProfile profile={result.location_profile} />
            </Block>

            <Block title="What works here">
              <FindingGrid items={result.strengths} tone="success" emptyText="No strengths recorded." />
            </Block>

            <Block title="What to watch">
              <FindingGrid items={result.concerns} tone="warning" emptyText="No concerns recorded." />
            </Block>

            <Block title="Risk register">
              <RiskGrid risks={result.risks} />
            </Block>

            <Block title="What's around this site">
              <NearbyPlaces nearby={result.nearby} />
            </Block>

            <Block title="Commercial read">
              <CommercialRead commercial={result.commercial_read} />
            </Block>

            <Block title="Recommendation">
              <RecommendationBlock recommendation={result.recommendation} score={analysis.score} />
            </Block>

            <Block title="Suggested inputs for Site Evaluation" hint="Drafts for the assessment experts — never applied automatically.">
              <SuggestedInputs inputs={result.assessment_inputs} />
            </Block>

            <Block title="Verify on site" hint="Questions this desk analysis could not settle.">
              <SiteVisitQuestions questions={result.site_visit_questions} />
            </Block>

            <Block title="Confidence & gaps">
              <ConfidenceBlock score={analysis.score} confidence={result.confidence} />
            </Block>

            <Block title="Sources">
              <SourceList citations={analysis.research?.citations} />
            </Block>

            {/* The raw research brief, on demand — the full evidence base behind
                every claim above, for anyone who wants to audit it. */}
            <div className="no-print">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setBriefOpen((o) => !o)}
                aria-expanded={briefOpen}
              >
                <ChevronDown
                  size={13}
                  style={{ transition: 'transform 0.2s ease', transform: briefOpen ? 'rotate(0)' : 'rotate(-90deg)' }}
                />
                {briefOpen ? 'Hide' : 'Show'} the full research brief
              </button>
              {briefOpen && <ResearchBrief recordId={recordId} />}
            </div>

            <div className="ai-disclaimer">
              <b>How to read this.</b> This report is desk research by a language model with web
              search, scored against a fixed rubric. It is decision <i>support</i>, not a decision:
              figures are estimates, some findings are inference rather than verified fact (each
              pillar says which), and nothing replaces a physical site visit or the four expert
              assessments in Site Evaluation. Check the sources before acting on anything material.
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The brief is several thousand words, so it is fetched only when opened —
 * `includeBrief` is a separate query key, which keeps the polling query that
 * every visit runs small.
 */
function ResearchBrief({ recordId }) {
  const { data, isLoading } = usePropertyAnalysis(recordId, { includeBrief: true });
  if (isLoading) return <div className="sm muted" style={{ padding: 12 }}>Loading brief…</div>;
  const brief = data?.research?.brief;
  if (!brief) return <div className="ai-suggest-basis">No research brief was stored for this run.</div>;

  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: 12,
        lineHeight: 1.65,
        color: 'var(--text-muted, var(--text-subtle))',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 14,
        marginTop: 10,
        maxHeight: 460,
        overflow: 'auto',
        fontFamily: 'inherit',
      }}
    >
      {brief}
    </pre>
  );
}

/** A titled sub-section inside the panel. */
function Block({ title, hint, children }) {
  return (
    <div className="col gap-3">
      <div className="col gap-1">
        <div className="ai-place-group-title" style={{ marginBottom: 0 }}>{title}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.5 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export default PropertyIntelligencePanel;
