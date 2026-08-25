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
import { aiStatus, assertAiAvailable, withProvider } from './providers/index.js';
import { startPropertyAnalysis, isStaleRun } from './analysis/propertyIntelligence.service.js';
import { startSweep, sweepStatus } from './analysis/bulkSweep.service.js';
import { runSiteComparison, latestAnalysesForProject } from './analysis/siteComparison.service.js';
import { buildScore } from './analysis/scoring.js';
import { draftAssessment } from './analysis/assessmentPrefill.service.js';
import { designGuidance, savedDesignGuidance } from './analysis/designGuidance.service.js';
import { procurementBrief, savedProcurementBrief } from './analysis/procurementBrief.service.js';
import { marketScout, expansionRadar } from './analysis/marketIntelligence.service.js';
import { askMap } from './analysis/askMap.service.js';

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

  /**
   * Draft one assessment form for a property so the expert edits rather than
   * starts blank. Returns suggested values only — nothing is persisted, and the
   * expert's submit is still what creates the record.
   */
  async prefillAssessment({ recordId, stageKey, assessmentType }) {
    assertAiAvailable();
    return draftAssessment({ recordId, stageKey, assessmentType });
  },

  /**
   * Design ideas before drawing, or a second read after one is uploaded.
   * Advice only — see designGuidance.service.js.
   */
  async designGuidance({ propertyRecordId, mode, drawingRecordId, force, user }) {
    assertAiAvailable();
    return designGuidance({ propertyRecordId, mode, drawingRecordId, force, user });
  },

  /**
   * Plain-language procurement brief for one project's order tracker: what to
   * chase today (with a ready-to-send message each), what is late, what is
   * fine. Advice only — it changes nothing on the orders.
   */
  async procurementBrief({ projectId, user, force }) {
    assertAiAvailable();
    return procurementBrief({ projectId, user, force });
  },

  /** The saved brief, if any — no provider call. */
  async savedProcurementBrief(projectId) {
    return savedProcurementBrief(projectId);
  },

  /** The saved run, if any — no provider call, so it is free and instant. */
  async savedDesignGuidance({ propertyRecordId, mode, drawingRecordId }) {
    return savedDesignGuidance({ propertyRecordId, mode, drawingRecordId });
  },

  /**
   * Small in-field writing help for one textarea: draft it, or tidy what the
   * user wrote. Kept deliberately modest — a few plain sentences grounded in
   * the rest of the form, never a report. The user's own text is the anchor in
   * `improve` mode: fix and tighten it, don't replace their meaning.
   */
  /** Network Map: any question, answered from company data + web research. */
  askMap,
  /** Network Map: a grounded research dossier on one city. */
  marketScout,
  /** Network Map: the next cities to open, ranked against the live network. */
  expansionRadar,

  async fieldAssist({ label, helpText, currentValue, context, mode, kind = 'field', instructions }) {
    assertAiAvailable();

    /* Two voices, one endpoint. `field` fills a form box (terse, 2–4
       sentences). `message` writes a whole outbound message to a vendor —
       greeting by name, the order facts, one clear ask, sign-off — because a
       PO sent as four clipped sentences reads as brusque, and one sent as a
       form answer reads as broken. */
    const system = kind === 'message'
      ? [
        'You are the correspondence writer for Mystery Rooms, an escape-room company in',
        'India, writing to a vendor. Reply with ONLY the message text — plain text, no',
        'markdown, no subject line, no commentary.',
        '',
        'Quality bar — this is the standard to match (an email example):',
        '---',
        'Dear Ramesh ji,',
        '',
        'Greetings from Mystery Rooms. We are pleased to place purchase order PO-4A21 for',
        'our upcoming Pune centre.',
        '',
        'We require 10 custom sofas at the agreed rate of ₹1,00,000 each, a total of',
        '₹10,00,000. We would need delivery at the site by 30 August 2026 to keep our',
        'fit-out on schedule.',
        '',
        'Kindly confirm acceptance of this order and your expected delivery date. The',
        'detailed PO document is attached for your records.',
        '',
        'Warm regards,',
        'Mystery Rooms — Projects Team',
        '---',
        '',
        'Rules:',
        '- Channel: for email, full paragraphs with blank lines like the example,',
        '  120–180 words. For WhatsApp, the same warmth compressed to 60–100 words,',
        '  no letter layout.',
        '- Use the *_display values from the context verbatim for money and dates —',
        '  never raw numbers like 100000 or dates like 2026-08-30.',
        '- Greet the contact by name (add "ji" only if the tone is friendly/Hinglish).',
        '- One clear ask: confirm acceptance and the delivery date.',
        '- Complete, natural sentences. Never compress into a data dump; never pad',
        '  with filler ("hope this finds you well" is banned).',
        '- Never invent facts, prices, dates or terms not present in the context or',
        '  the sender\'s instructions.',
        mode === 'improve'
          ? '- Improve the user\'s existing message: keep every fact and their intent, raise it to the quality bar above.'
          : '- Write fresh from the context, to the quality bar above.',
      ].join('\n')
      : [
        'You help fill ONE text field on a business form. Reply with the field text only —',
        'no headings, no markdown, no preamble. 2–4 short plain sentences a non-technical',
        'reader would write. Ground every statement in the form data given; if the data',
        'does not support a claim, leave it out rather than inventing it.',
        mode === 'improve'
          ? 'Improve the user\'s existing text: fix grammar, tighten wording, keep their meaning and every fact they stated. Add at most one sentence of genuinely implied detail.'
          : 'Draft the field from the form data alone.',
      ].join('\n');

    const prompt = [
      `Field: ${label}${helpText ? ` (${helpText})` : ''}`,
      /* The sender's own direction outranks the default shape — tone, language
         ("write it in Hindi"), extra points ("mention 50% advance") — but never
         the no-invented-facts rule: a requested claim absent from the context
         still gets left out. */
      instructions?.trim()
        ? `The sender's instructions — follow them (they override the default tone and language, but never invent facts):\n${instructions.trim()}`
        : '',
      mode === 'improve' ? `The user's current text:\n${currentValue}` : '',
      'Other values already on the form:',
      JSON.stringify(context || {}, null, 1).slice(0, 3000),
    ].filter(Boolean).join('\n\n');

    const result = await withProvider('synthesize', {
      system,
      prompt,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      schemaName: 'field_assist',
      maxOutputTokens: 600,
    });

    const payload = result?.json ?? result;
    return { text: (payload?.text || '').trim() };
  },
};

export default aiService;
