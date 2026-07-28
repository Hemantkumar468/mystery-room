import { StatusCodes } from 'http-status-codes';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { aiService } from './ai.service.js';

export const aiController = {
  /**
   * Provider configuration + the live rubric. Unauthenticated clients never
   * reach this (the router authenticates first), but it deliberately reveals
   * only whether a key is present — never the key itself.
   */
  status: asyncHandler(async (_req, res) => {
    return ApiResponse.ok(res, aiService.status(), 'AI status');
  }),

  /**
   * Start a property analysis.
   *
   * 202 Accepted when work was actually started — the report is not ready and
   * the client must poll. 200 when a valid cached report was returned instead,
   * so the UI can render immediately rather than polling for something that is
   * already complete.
   */
  analyseProperty: asyncHandler(async (req, res) => {
    const { analysis, reused, alreadyRunning } = await aiService.analyseProperty({
      recordId: req.params.recordId,
      user: req.user,
      force: req.body?.force,
    });

    const message = reused
      ? alreadyRunning
        ? 'An analysis is already running for this property'
        : 'Returned the existing analysis for this property'
      : 'Analysis started';

    return ApiResponse.send(res, {
      statusCode: reused && !alreadyRunning ? StatusCodes.OK : StatusCodes.ACCEPTED,
      data: { analysis, reused, alreadyRunning },
      message,
    });
  }),

  /** Latest run for a property — the endpoint the client polls. */
  getPropertyAnalysis: asyncHandler(async (req, res) => {
    const analysis = await aiService.latestForRecord(req.params.recordId, {
      includeBrief: req.validatedQuery?.includeBrief,
    });
    return ApiResponse.ok(res, analysis, analysis ? 'Analysis' : 'No analysis yet');
  }),

  /** Every run for a property, newest first. */
  getPropertyHistory: asyncHandler(async (req, res) => {
    const history = await aiService.historyForRecord(
      req.params.recordId,
      req.validatedQuery?.limit,
    );
    return ApiResponse.ok(res, history, 'Analysis history');
  }),

  /** Compact scores for every analysed property in a project. */
  getProjectScores: asyncHandler(async (req, res) => {
    const scores = await aiService.scoresForProject(req.params.projectId);
    return ApiResponse.ok(res, scores, 'Project AI scores');
  }),

  /** Run a fresh cross-property comparison (a few seconds — no polling). */
  compareSites: asyncHandler(async (req, res) => {
    const analysis = await aiService.compareSites({
      projectId: req.params.projectId,
      user: req.user,
    });
    return ApiResponse.ok(res, analysis, 'Comparison ready');
  }),

  getComparison: asyncHandler(async (req, res) => {
    const analysis = await aiService.latestComparison(req.params.projectId);
    return ApiResponse.ok(res, analysis, analysis ? 'Comparison' : 'No comparison yet');
  }),

  /** Re-apply the current rubric to a stored report — no provider call. */
  rescore: asyncHandler(async (req, res) => {
    const analysis = await aiService.rescore(req.params.id);
    return ApiResponse.ok(res, analysis, 'Re-scored against the current rubric');
  }),
};

export default aiController;
