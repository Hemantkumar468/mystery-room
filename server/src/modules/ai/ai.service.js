/**
 * AI module facade — everything the controller needs, and the one place that
 * knows how a stored run is presented to a client.
 */

import { config } from '../../config/index.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../core/utils/ApiError.js';

import { AiAnalysis } from './ai.model.js';
import {
  AI_ANALYSIS_KIND,
  AI_RUN_STATUS,
  SCORE_PILLARS,
  VERDICT_BANDS,
  RUBRIC_VERSION,
  PROMPT_VERSION,
} from './ai.constants.js';
import { aiStatus, assertAiAvailable } from './providers/index.js';
import { startPropertyAnalysis, isStaleRun } from './analysis/propertyIntelligence.service.js';
import { startSweep, sweepStatus } from './analysis/bulkSweep.service.js';
import { runSiteComparison, latestAnalysesForProject } from './analysis/siteComparison.service.js';
import { buildScore } from './analysis/scoring.js';

/**
 * Mark abandoned runs as failed.
 *
 * A run lives in an in-process async function, so a server restart mid-run
 * leaves a document stuck in `running` forever. Rather than a background timer,
 * runs are swept lazily on read — the only moment anyone can observe the stale
 * state is the moment someone looks at it.
 */
async function sweepStaleRuns(filter) {
  const cutoff = new Date(Date.now() - config.ai.runStaleMinutes * 60 * 1000);
  const res = await AiAnalysis.updateMany(
    { ...filter, status: { $in: [AI_RUN_STATUS.QUEUED, AI_RUN_STATUS.RUNNING] }, updatedAt: { $lt: cutoff } },
    {
      status: AI_RUN_STATUS.FAILED,
      error: {
        message: 'The analysis stopped unexpectedly (the server may have restarted). Run it again.',
        code: 'AI_RUN_ABANDONED',
      },
    },
  );
  if (res.modifiedCount) {
    logger.warn('Swept abandoned AI runs', { count: res.modifiedCount });
  }
}

/**
 * Shape a stored run for the client.
 *
 * The research brief is heavy (several thousand words) and only the detail
 * view wants it, so it ships only when asked for. Citations always ship —
 * they are how a reader checks the report.
 */
export function presentAnalysis(analysis, { includeBrief = false } = {}) {
  if (!analysis) return null;
  const doc = typeof analysis.toObject === 'function' ? analysis.toObject() : analysis;

  const research = doc.research || {};
  return {
    _id: doc._id,
    kind: doc.kind,
    status: doc.status,
    progress: doc.progress,
    project: doc.project,
    record: doc.record,
    subject: doc.subject,
    provider: doc.provider,
    model: doc.model,
    result: doc.result,
    score: doc.score,
    usage: doc.usage,
    durationMs: doc.durationMs,
    error: doc.error,
    requestedBy: doc.requestedBy,
    promptVersion: doc.promptVersion,
    rubricVersion: doc.rubricVersion,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    completedAt: doc.completedAt,
    research: {
      citations: research.citations || [],
      searchQueries: research.searchQueries || [],
      provider: research.provider,
      model: research.model,
      // Older documents predate the flag; absence means the run was grounded.
      grounded: research.grounded !== false,
      ...(includeBrief ? { brief: research.brief } : {}),
      briefLength: research.brief ? research.brief.length : 0,
    },
    isStale:
      doc.status === AI_RUN_STATUS.SUCCEEDED && doc.completedAt
        ? Date.now() - new Date(doc.completedAt).getTime() > config.ai.cacheTtlHours * 3600 * 1000
        : false,
  };
}

export const aiService = {
  /** Provider/config status, plus the rubric so the UI can render it verbatim. */
  status() {
    return {
      ...aiStatus(),
      rubric: {
        version: RUBRIC_VERSION,
        promptVersion: PROMPT_VERSION,
        pillars: SCORE_PILLARS,
        bands: VERDICT_BANDS,
      },
      cacheTtlHours: config.ai.cacheTtlHours,
    };
  },

  /** Start (or reuse) a property analysis. */
  async analyseProperty({ recordId, user, force }) {
    assertAiAvailable();
    await sweepStaleRuns({ record: recordId });
    const { analysis, reused, alreadyRunning } = await startPropertyAnalysis({
      recordId,
      user,
      force,
    });
    return { analysis: presentAnalysis(analysis), reused: Boolean(reused), alreadyRunning: Boolean(alreadyRunning) };
  },

  /** Latest run for a record — any status, so a failure is visible too. */
  async latestForRecord(recordId, { includeBrief = false } = {}) {
    await sweepStaleRuns({ record: recordId });
    const analysis = await AiAnalysis.findOne({
      record: recordId,
      kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'name role avatarColor');

    return presentAnalysis(analysis, { includeBrief });
  },

  /** Every run for a record, newest first — the audit trail. */
  async historyForRecord(recordId, limit = 20) {
    const runs = await AiAnalysis.find({
      record: recordId,
      kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('requestedBy', 'name role avatarColor');

    return runs.map((r) => presentAnalysis(r));
  },

  /**
   * Compact per-record scores for a whole project — what the properties table
   * needs to show an AI Score column without fetching every full report.
   */
  async scoresForProject(projectId) {
    await sweepStaleRuns({ project: projectId });
    const analyses = await latestAnalysesForProject(projectId);

    return analyses.map((a) => ({
      recordId: String(a.record),
      analysisId: String(a._id),
      // Run state, not just the score: a bulk sweep polls this endpoint to
      // narrate itself, and "no score yet" cannot distinguish a property that
      // is mid-analysis from one that failed or was never started.
      status: a.status,
      progress: a.progress || null,
      overall: a.score?.overall ?? null,
      band: a.score?.band || null,
      bandLabel: a.score?.bandLabel || null,
      bandTone: a.score?.bandTone || null,
      confidence: a.score?.confidence ?? null,
      decision: a.result?.recommendation?.decision || null,
      headline: a.result?.recommendation?.headline || '',
      completedAt: a.completedAt,
      isStale: a.completedAt
        ? Date.now() - new Date(a.completedAt).getTime() > config.ai.cacheTtlHours * 3600 * 1000
        : false,
    }));
  },

  /**
   * Start a whole-project sweep. Returns immediately with what it will do; the
   * client narrates progress off `scoresForProject` plus `sweepProgress`.
   */
  async analyseAllProperties({ projectId, user, force }) {
    assertAiAvailable();
    return startSweep({ projectId, user, force });
  },

  /** Live sweep state, or null when nothing is running for this project. */
  sweepProgress(projectId) {
    return sweepStatus(projectId);
  },

  /** Run a fresh cross-property comparison. */
  async compareSites({ projectId, user }) {
    assertAiAvailable();
    const analysis = await runSiteComparison({ projectId, user });
    return presentAnalysis(analysis);
  },

  /** The most recent comparison for a project, if one has been run. */
  async latestComparison(projectId) {
    await sweepStaleRuns({ project: projectId, kind: AI_ANALYSIS_KIND.SITE_COMPARISON });
    const analysis = await AiAnalysis.findOne({
      project: projectId,
      kind: AI_ANALYSIS_KIND.SITE_COMPARISON,
    })
      .sort({ createdAt: -1 })
      .populate('requestedBy', 'name role avatarColor');

    return presentAnalysis(analysis);
  },

  /**
   * Re-score a stored report against the current rubric without calling a
   * provider — the payoff of keeping scoring deterministic and separate. Lets
   * a weight change be applied to historical reports for free.
   */
  async rescore(analysisId) {
    const analysis = await AiAnalysis.findById(analysisId);
    if (!analysis) throw ApiError.notFound('Analysis not found');
    if (analysis.status !== AI_RUN_STATUS.SUCCEEDED) {
      throw ApiError.badRequest('Only a completed analysis can be re-scored');
    }

    analysis.score = buildScore(analysis.result, {
      citationCount: (analysis.research?.citations || []).length,
    });
    analysis.rubricVersion = RUBRIC_VERSION;
    await analysis.save();

    return presentAnalysis(analysis);
  },
};

export default aiService;
