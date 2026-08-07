/**
 * Bulk property-intelligence sweep.
 *
 * Analysing a project's whole shortlist used to be a `for` loop in the browser:
 * one property at a time, each ~60–90s, and the whole sweep died if the user
 * navigated away or closed the tab. Ten properties meant sitting on that page
 * for ten minutes. This moves the loop server-side, where it survives the tab
 * and can run several properties at once.
 *
 * Concurrency is bounded (AI_BULK_CONCURRENCY, default 3) rather than unbounded
 * `Promise.all`. Each property is two-plus provider calls — with the research
 * fan-out it is four — so firing a whole shortlist at once multiplies straight
 * into vendor rate limits and earns a wall of 429s, which is slower than not
 * parallelising at all.
 *
 * Like the single-property runner this is detached in-process work with no job
 * queue: one process is the deployment shape, and `startSweep` is the seam to
 * swap for a real queue if that ever changes. Progress is not tracked in a
 * separate collection — it is derived from the AiAnalysis documents themselves
 * (see `sweepStatus`), so a restart cannot leave a sweep record lying about
 * claiming work that is no longer running.
 */

import { Record } from '../../pms/records/record.model.js';
import { Project } from '../../pms/projects/project.model.js';
import { logger } from '../../../config/logger.js';
import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/utils/ApiError.js';

import { AiAnalysis } from '../ai.model.js';
import { AI_ANALYSIS_KIND, AI_RUN_STATUS } from '../ai.constants.js';
import { startPropertyAnalysis } from './propertyIntelligence.service.js';

/** Sweeps currently running, keyed by project id — see `sweepStatus`. */
const active = new Map();

/**
 * Property Identification. Matched by explicit key rather than by
 * `captureMode === 'collection'`: every stage in a project is collection-mode,
 * so that match would sweep Site Evaluation assessments, commercial records and
 * department plans as if they were candidate properties — spending real money
 * scoring a "Financial" assessment row against a location rubric. The same
 * explicit-key reasoning is spelled out in PropertyIdentificationPage and used
 * by project.service.js and record.service.js.
 */
const PROPERTY_STAGE_KEY = 'p1';

/** Every candidate property in a project — the records a sweep may analyse. */
async function sweepableRecords(projectId) {
  const project = await Project.findById(projectId).select('stages');
  if (!project) throw ApiError.notFound('Project not found');

  const hasStage = (project.stages || []).some((s) => s.key === PROPERTY_STAGE_KEY);
  if (!hasStage) return [];

  return Record.find({ project: projectId, stageKey: PROPERTY_STAGE_KEY }).select('_id title seq');
}

/**
 * Split the candidates into what needs running and what already has a usable
 * report. `force` re-runs everything, which is what the UI's "re-analyse all"
 * affordance means — otherwise a sweep is idempotent and cheap to repeat.
 */
async function partition(projectId, records, force) {
  if (force) return { pending: records, fresh: [] };

  const latest = await AiAnalysis.find({
    project: projectId,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: AI_RUN_STATUS.SUCCEEDED,
  })
    .select('record completedAt')
    .sort({ completedAt: -1 });

  const ttlMs = config.ai.cacheTtlHours * 3600 * 1000;
  const freshIds = new Set(
    latest
      .filter((a) => a.completedAt && Date.now() - new Date(a.completedAt).getTime() < ttlMs)
      .map((a) => String(a.record)),
  );

  return {
    pending: records.filter((r) => !freshIds.has(String(r._id))),
    fresh: records.filter((r) => freshIds.has(String(r._id))),
  };
}

/**
 * Start a sweep and return immediately with what it is about to do.
 *
 * One sweep per project at a time: a second click while one is running returns
 * the running sweep's state rather than doubling the provider spend.
 */
export async function startSweep({ projectId, user, force = false }) {
  const existing = active.get(String(projectId));
  if (existing) return { ...summarise(existing), alreadyRunning: true };

  const records = await sweepableRecords(projectId);
  if (!records.length) {
    throw ApiError.badRequest('This project has no property records to analyse', {
      code: 'AI_NOTHING_TO_SWEEP',
    });
  }

  const { pending, fresh } = await partition(projectId, records, force);
  if (!pending.length) {
    return {
      total: records.length,
      queued: 0,
      skippedFresh: fresh.length,
      running: 0,
      done: 0,
      failed: 0,
      concurrency: config.ai.bulkConcurrency,
      alreadyRunning: false,
    };
  }

  const state = {
    projectId: String(projectId),
    total: records.length,
    queued: pending.length,
    skippedFresh: fresh.length,
    running: 0,
    done: 0,
    failed: 0,
    startedAt: Date.now(),
    concurrency: config.ai.bulkConcurrency,
  };
  active.set(String(projectId), state);

  // Detached on purpose — the caller returns 202 while this proceeds.
  void drain({ state, pending, user, force }).catch((err) => {
    logger.error('AI bulk sweep crashed', { projectId: String(projectId), error: err.message });
    active.delete(String(projectId));
  });

  return { ...summarise(state), alreadyRunning: false };
}

/**
 * Run `pending` through `concurrency` workers pulling from a shared cursor.
 *
 * A worker pool rather than fixed-size batches: batches move at the speed of
 * their slowest member and leave workers idle at every boundary, and analysis
 * times here range from 40s to well over two minutes.
 */
async function drain({ state, pending, user, force }) {
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;

      const record = pending[index];
      state.running += 1;
      try {
        await runToCompletion({ recordId: record._id, user, force });
        state.done += 1;
      } catch (err) {
        state.failed += 1;
        // One property failing must not abort the rest of the shortlist — the
        // failure is already recorded on that property's own analysis document.
        logger.warn('AI bulk sweep: property failed', {
          record: String(record._id),
          error: err.message,
        });
      } finally {
        state.running -= 1;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(state.concurrency, pending.length) },
    () => worker(),
  );
  await Promise.all(workers);

  logger.info('AI bulk sweep complete', {
    projectId: state.projectId,
    done: state.done,
    failed: state.failed,
    durationMs: Date.now() - state.startedAt,
  });
  active.delete(state.projectId);
}

/**
 * `startPropertyAnalysis` is fire-and-forget by design — it returns as soon as
 * the run document exists so the single-property endpoint can answer 202. A
 * sweep needs the opposite: it must know when one property is finished before
 * handing that worker slot to the next, or the concurrency limit means nothing.
 *
 * Polling the document is how that is bridged. It is deliberate rather than
 * lazy: the alternative is exporting the internal runner and having two call
 * paths into it, and the poll costs one indexed lookup every few seconds
 * against work that takes minutes.
 */
async function runToCompletion({ recordId, user, force }) {
  const { analysis, reused } = await startPropertyAnalysis({ recordId, user, force });

  // A cache hit or an already-finished run needs no waiting.
  if (reused && analysis.status === AI_RUN_STATUS.SUCCEEDED) return analysis;

  const deadlineMs = config.ai.runStaleMinutes * 60 * 1000;
  const startedAt = Date.now();

  for (;;) {
    const current = await AiAnalysis.findById(analysis._id).select('status error');
    if (!current) throw new Error('The analysis document disappeared mid-run');

    if (current.status === AI_RUN_STATUS.SUCCEEDED) return current;
    if (current.status === AI_RUN_STATUS.FAILED) {
      throw new Error(current.error?.message || 'Analysis failed');
    }
    if (Date.now() - startedAt > deadlineMs) {
      throw new Error('Analysis exceeded the stale-run deadline');
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 3000);
    });
  }
}

const summarise = (s) => ({
  total: s.total,
  queued: s.queued,
  skippedFresh: s.skippedFresh,
  running: s.running,
  done: s.done,
  failed: s.failed,
  concurrency: s.concurrency,
});

/**
 * Live sweep state for a project, or `null` when nothing is sweeping.
 *
 * Deliberately in-memory: a sweep is the lifetime of one process, and a
 * persisted sweep record would survive a restart claiming to track workers that
 * no longer exist. The per-property truth is on the AiAnalysis documents, which
 * the scores endpoint already serves, so nothing is lost by this being volatile
 * — a restart just means the button stops claiming to be busy, which is true.
 */
export function sweepStatus(projectId) {
  const state = active.get(String(projectId));
  if (!state) return null;
  return { ...summarise(state), startedAt: new Date(state.startedAt), running: true };
}

export default { startSweep, sweepStatus };
