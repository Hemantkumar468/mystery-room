/**
 * Property-intelligence pipeline.
 *
 *   context → research (grounded) → synthesis (structured) → score → persist
 *
 * Runs detached from the HTTP request. A grounded research call plus a
 * synthesis call routinely takes 30–90s; holding a request open that long is
 * fragile (proxy timeouts, a user navigating away kills the work). Instead the
 * controller creates a `queued` document, returns 202 immediately, and this
 * module drives the run to completion in the background while the client polls.
 *
 * There is no job queue: a single process is the deployment shape here, and a
 * detached async function plus the stale-run sweep in ai.service.js covers the
 * one failure mode that matters (a restart mid-run). If this ever runs
 * multi-instance, `startRun` is the seam to swap for a real queue — nothing
 * else in the module would change.
 */

import { Project } from '../../pms/projects/project.model.js';
import { Template } from '../../pms/templates/template.model.js';
import { Record } from '../../pms/records/record.model.js';
import { activityService } from '../../pms/activity/activity.service.js';
import { logger } from '../../../config/logger.js';
import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';

import { AiAnalysis } from '../ai.model.js';
import {
  AI_ANALYSIS_KIND,
  AI_RUN_STATUS,
  PROMPT_VERSION,
  RUBRIC_VERSION,
  estimateCostUsd,
  stepFor,
} from '../ai.constants.js';
import { withProvider } from '../providers/index.js';
import { dedupeCitations } from '../providers/base.js';
import { buildPropertyContext, fingerprintOf, validateContext } from './context.js';
import { propertyIntelligenceSchema } from './schema.js';
import {
  RESEARCH_SYSTEM,
  SYNTHESIS_SYSTEM,
  RESEARCH_TRACKS,
  mergeResearchTracks,
  buildSynthesisPrompt,
} from './prompts.js';
import { buildScore } from './scoring.js';

/**
 * Token ceilings per call. Research is prose and bounded by how much the web
 * actually yields; the budget is per *track*, and each track covers a third of
 * the old single-call remit, so a smaller ceiling buys the same total evidence.
 * The synthesis budget is deliberately generous: the report schema is large,
 * and on reasoning models the internal thinking spend counts against this
 * ceiling — an under-budgeted call fails with MAX_TOKENS after having already
 * paid for the research.
 */
const RESEARCH_MAX_TOKENS = 4000;
const SYNTHESIS_MAX_TOKENS = 16000;

/**
 * Run every research track concurrently and merge what came back.
 *
 * A track that fails does not fail the analysis — three-quarters of a brief
 * still supports a scored report, and `mergeResearchTracks` tells synthesis
 * exactly which topic is missing so it scores that pillar conservatively rather
 * than reading the silence as "nothing found". All tracks failing is a genuine
 * failure and propagates.
 *
 * Provider is pinned across tracks: the first track to answer decides, and the
 * rest of the pipeline follows it, so one report's evidence cannot be a blend
 * of several vendors' search indexes.
 */
async function runResearchTracks(ctx) {
  const settled = await Promise.all(
    RESEARCH_TRACKS.map(async (track) => {
      try {
        const res = await withProvider('research', {
          system: RESEARCH_SYSTEM,
          prompt: track.build(ctx),
          maxOutputTokens: RESEARCH_MAX_TOKENS,
        });
        return { ok: true, key: track.key, label: track.label, ...res };
      } catch (err) {
        logger.warn('AI research track failed', { track: track.key, error: err.message });
        return { ok: false, key: track.key, label: track.label, error: err.message };
      }
    }),
  );

  const ok = settled.filter((r) => r.ok);
  if (!ok.length) {
    const why = settled.map((r) => `${r.label}: ${r.error}`).join(' | ');
    throw new ApiError(502, `AI research failed on every track. ${why}`, {
      code: 'AI_RESEARCH_FAILED',
    });
  }

  return {
    text: mergeResearchTracks(settled),
    citations: dedupeCitations(ok.flatMap((r) => r.citations || [])),
    searchCount: ok.reduce((n, r) => n + (r.searchCount || 0), 0),
    provider: ok[0].provider,
    model: ok[0].model,
    // Grounded only if every completed track was — one uncited track means part
    // of this brief is the model's priors, and the report should say so.
    grounded: ok.every((r) => r.grounded !== false),
    usages: ok.map((r) => r.usage),
    failedTracks: settled.filter((r) => !r.ok).map((r) => r.key),
  };
}

/** Load the record with everything the pipeline and the report need. */
async function loadSubject(recordId) {
  const record = await Record.findById(recordId);
  if (!record) throw ApiError.notFound('Property record not found');

  const project = await Project.findById(record.project).select(
    'name code city state stages template',
  );
  if (!project) throw ApiError.notFound('Project not found for this record');

  const templateId = project.template?.ref;
  const template = templateId ? await Template.findById(templateId).select('stages') : null;
  const schema =
    template?.stages?.find((s) => s.key === record.stageKey)?.masterDataSchema || [];

  return { record, project, schema };
}

/** Persist a progress step so a polling client can narrate the run. */
async function setProgress(analysisId, stepKey) {
  const step = stepFor(stepKey);
  await AiAnalysis.findByIdAndUpdate(analysisId, {
    progress: { step: step.key, label: step.label, pct: step.pct },
  });
}

/**
 * Create the run document and kick it off.
 *
 * Returns the document immediately. When a valid cached report exists and
 * `force` is not set, that report is returned instead and nothing is spent.
 */
export async function startPropertyAnalysis({ recordId, user, force = false }) {
  const { record, project, schema } = await loadSubject(recordId);

  const ctx = buildPropertyContext(record, project, schema);
  const valid = validateContext(ctx);
  if (!valid.ok) throw ApiError.badRequest(valid.reason, { code: 'AI_INSUFFICIENT_CONTEXT' });

  const fingerprint = fingerprintOf(ctx);

  // Reuse an identical, still-fresh report rather than paying for it twice.
  if (!force) {
    const cached = await AiAnalysis.findOne({
      record: record._id,
      kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
      fingerprint,
      status: AI_RUN_STATUS.SUCCEEDED,
    }).sort({ createdAt: -1 });

    if (cached && !cached.isStale(config.ai.cacheTtlHours)) {
      return { analysis: cached, reused: true };
    }
  }

  // One run at a time per record — a double-click must not buy two reports.
  const inFlight = await AiAnalysis.findOne({
    record: record._id,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: { $in: [AI_RUN_STATUS.QUEUED, AI_RUN_STATUS.RUNNING] },
  }).sort({ createdAt: -1 });

  if (inFlight && !isStaleRun(inFlight)) {
    return { analysis: inFlight, reused: true, alreadyRunning: true };
  }

  const analysis = await AiAnalysis.create({
    project: project._id,
    record: record._id,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: AI_RUN_STATUS.QUEUED,
    progress: { ...stepFor('context') },
    fingerprint,
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    subject: subjectSnapshot(ctx, record),
    requestedBy: user?._id,
  });

  // Detached on purpose — the caller returns 202 while this proceeds.
  void runPropertyAnalysis({ analysisId: analysis._id, ctx, project, record, user }).catch(
    (err) => logger.error('AI property analysis crashed', { error: err.message, analysisId: String(analysis._id) }),
  );

  return { analysis, reused: false };
}

/** A snapshot of the property as analysed, kept beside the report. */
function subjectSnapshot(ctx, record) {
  return {
    title: record.title || ctx.propertyName,
    seq: record.seq,
    propertyName: ctx.propertyName,
    locality: ctx.locality,
    city: ctx.city,
    area: ctx.area,
    floor: ctx.floor,
    commercials: ctx.commercials,
    gps: ctx.gps,
    mapUrl: ctx.mapUrl,
    recordStatus: record.status,
  };
}

export const isStaleRun = (analysis) =>
  Date.now() - new Date(analysis.updatedAt).getTime() > config.ai.runStaleMinutes * 60 * 1000;

/** Drive one run to completion. Never throws — failures land on the document. */
async function runPropertyAnalysis({ analysisId, ctx, project, record, user }) {
  const startedAt = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, searchCount: 0 };
  const addUsage = (u = {}) => {
    usage.inputTokens += u.inputTokens || 0;
    usage.outputTokens += u.outputTokens || 0;
    usage.totalTokens += u.totalTokens || 0;
    usage.calls += 1;
  };

  try {
    await AiAnalysis.findByIdAndUpdate(analysisId, {
      status: AI_RUN_STATUS.RUNNING,
      progress: { ...stepFor('research') },
    });

    // ── 1. Grounded research (tracks run concurrently) ─────
    const research = await runResearchTracks(ctx);
    research.usages.forEach(addUsage);
    usage.searchCount = research.searchCount || 0;

    await AiAnalysis.findByIdAndUpdate(analysisId, {
      research: {
        brief: research.text,
        citations: research.citations || [],
        searchQueries: research.searchQueries || [],
        provider: research.provider,
        model: research.model,
        // Adapters that can degrade to an ungrounded call report it; the ones
        // whose search tool is not optional simply omit the flag.
        grounded: research.grounded !== false,
      },
      progress: { ...stepFor('synthesis') },
    });

    // ── 2. Structured synthesis ────────────────────────────
    // Pinned to the provider that did the research: a report whose evidence
    // and reasoning came from two different models is far harder to defend.
    const synthesis = await withProvider(
      'synthesize',
      {
        system: SYNTHESIS_SYSTEM,
        prompt: buildSynthesisPrompt(ctx, research.text),
        schema: propertyIntelligenceSchema,
        schemaName: 'property_intelligence_report',
        maxOutputTokens: SYNTHESIS_MAX_TOKENS,
      },
      { preferred: research.provider },
    );
    addUsage(synthesis.usage);

    // ── 3. Deterministic scoring ───────────────────────────
    await setProgress(analysisId, 'scoring');
    const score = buildScore(synthesis.json, {
      citationCount: (research.citations || []).length,
    });

    usage.estimatedCostUsd = estimateCostUsd(
      synthesis.model,
      usage.inputTokens,
      usage.outputTokens,
    );

    await AiAnalysis.findByIdAndUpdate(analysisId, {
      status: AI_RUN_STATUS.SUCCEEDED,
      progress: { ...stepFor('done') },
      provider: synthesis.provider,
      model: synthesis.model,
      result: synthesis.json,
      score,
      usage,
      durationMs: Date.now() - startedAt,
      completedAt: new Date(),
      error: undefined,
    });

    await activityService.log({
      project: project._id,
      entityType: 'record',
      entityId: record._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: user?._id,
      message: `ran an AI location analysis on ${record.seq ? `#${record.seq} ` : ''}"${
        record.title || ctx.propertyName
      }" — scored ${score.overall ?? '—'}/100 (${score.bandLabel})`,
      meta: {
        stageKey: record.stageKey,
        ai: true,
        score: score.overall,
        band: score.band,
        provider: synthesis.provider,
      },
    });

    logger.info('AI property analysis complete', {
      analysisId: String(analysisId),
      score: score.overall,
      provider: synthesis.provider,
      durationMs: Date.now() - startedAt,
      tokens: usage.totalTokens,
    });
  } catch (err) {
    logger.error('AI property analysis failed', {
      analysisId: String(analysisId),
      error: err.message,
    });
    await AiAnalysis.findByIdAndUpdate(analysisId, {
      status: AI_RUN_STATUS.FAILED,
      // Partial usage is still recorded — a run that failed at synthesis has
      // already spent real money on research, and hiding that is misleading.
      usage: {
        ...usage,
        estimatedCostUsd: estimateCostUsd(null, usage.inputTokens, usage.outputTokens),
      },
      durationMs: Date.now() - startedAt,
      error: { message: err.message?.slice(0, 500), code: err.code || 'AI_RUN_FAILED' },
    }).catch(() => {
      /* the run already failed; a failed status write must not mask the cause */
    });
  }
}
