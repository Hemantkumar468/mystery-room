/**
 * Cross-property comparison.
 *
 * Ranks the candidate properties of one project against each other, on top of
 * the individual reports that already exist. Deliberately a single synthesis
 * call with no web research: every fact was established and cited when each
 * property was analysed, so re-researching here would cost money to produce
 * evidence that might contradict the reports being compared.
 *
 * The server ranks by weighted score first (analysis/scoring.js#compareAnalyses)
 * and hands the model that ordering as an input — the model's job is to explain
 * the separation, name the trade-offs, and overrule the arithmetic where a
 * business reason justifies it, which it must then state.
 */

import { Project } from '../../pms/projects/project.model.js';
import { Record } from '../../pms/records/record.model.js';
import { activityService } from '../../pms/activity/activity.service.js';
import { logger } from '../../../config/logger.js';
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
import { siteComparisonSchema } from './schema.js';
import { COMPARISON_SYSTEM, buildComparisonPrompt } from './prompts.js';
import { compareAnalyses } from './scoring.js';

const COMPARISON_MAX_TOKENS = 8000;
/** Beyond this the prompt bloats and the ranking blurs; the weakest are cut. */
const MAX_PROPERTIES = 8;

/** The most recent successful report per record, newest run wins. */
export async function latestAnalysesForProject(projectId) {
  const analyses = await AiAnalysis.find({
    project: projectId,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: AI_RUN_STATUS.SUCCEEDED,
  })
    .sort({ createdAt: -1 })
    .lean();

  const latestByRecord = new Map();
  for (const a of analyses) {
    const key = String(a.record);
    if (!latestByRecord.has(key)) latestByRecord.set(key, a);
  }
  return [...latestByRecord.values()];
}

const bullets = (items, take = 3) =>
  (items || [])
    .slice(0, take)
    .map((i) => `${i.title}${i.detail ? ` — ${i.detail}` : ''}`)
    .join('; ');

/** Flatten one report into the compact block the comparison prompt consumes. */
function toPromptProperty(analysis, record) {
  const subject = analysis.subject || {};
  const result = analysis.result || {};
  const score = analysis.score || {};

  return {
    // `ref` is what the model must echo back to identify a property. The record
    // id is used rather than a name because two candidates can share a name,
    // and a hallucinated id fails the lookup loudly instead of mis-attributing.
    ref: String(analysis.record),
    title: subject.title || record?.title || 'Untitled property',
    locality: subject.locality,
    city: subject.city,
    area: subject.area,
    floor: subject.floor,
    commercials: subject.commercials,
    score: score.overall,
    band: score.bandLabel || 'Not scored',
    confidence: score.confidence,
    pillarLine: (score.pillars || [])
      .map((p) => `${p.key} ${p.score ?? '—'}`)
      .join(', '),
    decision: result.recommendation?.decision || 'unknown',
    summary: result.executive_summary || 'No summary recorded.',
    strengths: bullets(result.strengths),
    concerns: bullets(result.concerns),
    dealBreakers: (result.recommendation?.deal_breakers || []).join('; '),
  };
}

/**
 * Build (or rebuild) the comparison for a project. Synchronous relative to its
 * caller — one call over already-gathered data completes in a few seconds,
 * so unlike the property pipeline this needs no background/polling machinery.
 */
export async function runSiteComparison({ projectId, user }) {
  const project = await Project.findById(projectId).select('name code city stages');
  if (!project) throw ApiError.notFound('Project not found');

  const analyses = await latestAnalysesForProject(projectId);
  if (analyses.length < 2) {
    throw ApiError.badRequest(
      'At least two analysed properties are needed to compare. Run the AI analysis on more properties first.',
      { code: 'AI_NOT_ENOUGH_PROPERTIES' },
    );
  }

  const records = await Record.find({
    _id: { $in: analyses.map((a) => a.record) },
  }).select('title seq status values.city values.locality');
  const recordById = new Map(records.map((r) => [String(r._id), r]));

  // Rank by the deterministic score, then cap — if more candidates exist than
  // fit, the weakest are dropped rather than the newest, and the cut is logged.
  const ranked = [...analyses].sort(compareAnalyses);
  const shortlist = ranked.slice(0, MAX_PROPERTIES);
  if (ranked.length > MAX_PROPERTIES) {
    logger.info('AI comparison capped', {
      projectId: String(projectId),
      considered: ranked.length,
      compared: shortlist.length,
    });
  }

  const properties = shortlist.map((a) => toPromptProperty(a, recordById.get(String(a.record))));

  const analysis = await AiAnalysis.create({
    project: project._id,
    kind: AI_ANALYSIS_KIND.SITE_COMPARISON,
    status: AI_RUN_STATUS.RUNNING,
    progress: { ...stepFor('synthesis') },
    promptVersion: PROMPT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    subject: {
      projectName: project.name,
      projectCode: project.code,
      comparedCount: properties.length,
      consideredCount: ranked.length,
      refs: properties.map((p) => p.ref),
    },
    requestedBy: user?._id,
  });

  const startedAt = Date.now();
  try {
    const projectSummary = [
      `PROJECT: ${project.name} (${project.code})`,
      `TARGET CITY: ${project.city || 'not specified'}`,
      `PROPERTIES COMPARED: ${properties.length}${
        ranked.length > properties.length
          ? ` (top ${properties.length} of ${ranked.length} analysed, by weighted score)`
          : ''
      }`,
    ].join('\n');

    const synthesis = await withProvider('synthesize', {
      system: COMPARISON_SYSTEM,
      prompt: buildComparisonPrompt({ projectSummary, properties }),
      schema: siteComparisonSchema,
      schemaName: 'site_comparison_report',
      maxOutputTokens: COMPARISON_MAX_TOKENS,
    });

    // Re-attach each ranked entry to the property it names. A ref the model
    // invented, or one it dropped, is caught here rather than surfacing in the
    // UI as a blank row.
    const byRef = new Map(properties.map((p) => [p.ref, p]));
    const ranking = (synthesis.json?.ranking || [])
      .filter((r) => byRef.has(String(r.property_ref)))
      .sort((a, b) => (a.rank || 99) - (b.rank || 99))
      .map((r, i) => {
        const p = byRef.get(String(r.property_ref));
        return {
          ...r,
          rank: i + 1, // renumber densely; the model's own numbering can skip
          recordId: p.ref,
          title: p.title,
          locality: p.locality,
          city: p.city,
          score: p.score,
          band: p.band,
          confidence: p.confidence,
        };
      });

    const missing = properties.filter((p) => !ranking.some((r) => r.recordId === p.ref));
    if (missing.length) {
      logger.warn('AI comparison omitted properties', {
        projectId: String(projectId),
        missing: missing.map((m) => m.title),
      });
    }

    const usage = {
      ...synthesis.usage,
      calls: 1,
      estimatedCostUsd: estimateCostUsd(
        synthesis.model,
        synthesis.usage?.inputTokens,
        synthesis.usage?.outputTokens,
      ),
    };

    const recommendedRef = String(synthesis.json?.recommended_property_ref || '');
    const updated = await AiAnalysis.findByIdAndUpdate(
      analysis._id,
      {
        status: AI_RUN_STATUS.SUCCEEDED,
        progress: { ...stepFor('done') },
        provider: synthesis.provider,
        model: synthesis.model,
        result: {
          ...synthesis.json,
          ranking,
          // Only echo a recommendation that maps to a real compared property.
          recommended_property_ref: byRef.has(recommendedRef) ? recommendedRef : '',
          unranked: missing.map((m) => ({ recordId: m.ref, title: m.title })),
        },
        usage,
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      },
      { new: true },
    );

    await activityService.log({
      project: project._id,
      entityType: 'project',
      entityId: project._id,
      action: ACTIVITY_ACTIONS.UPDATED,
      actor: user?._id,
      message: `ran an AI comparison across ${properties.length} analysed properties`,
      meta: { ai: true, kind: AI_ANALYSIS_KIND.SITE_COMPARISON, provider: synthesis.provider },
    });

    return updated;
  } catch (err) {
    logger.error('AI site comparison failed', {
      projectId: String(projectId),
      error: err.message,
    });
    await AiAnalysis.findByIdAndUpdate(analysis._id, {
      status: AI_RUN_STATUS.FAILED,
      durationMs: Date.now() - startedAt,
      error: { message: err.message?.slice(0, 500), code: err.code || 'AI_RUN_FAILED' },
    }).catch(() => {});
    throw err;
  }
}
