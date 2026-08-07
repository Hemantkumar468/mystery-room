import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { recordService } from './record.service.js';

export const recordController = {
  list: asyncHandler(async (req, res) => {
    const items = await recordService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Records fetched');
  }),

  get: asyncHandler(async (req, res) => {
    const record = await recordService.getById(req.params.id);
    return ApiResponse.ok(res, record);
  }),

  create: asyncHandler(async (req, res) => {
    const record = await recordService.create(req.body, req.user.id);
    return ApiResponse.created(res, record, 'Record created');
  }),

  update: asyncHandler(async (req, res) => {
    const record = await recordService.update(req.params.id, req.body, req.user.id);
    return ApiResponse.ok(res, record, 'Record updated');
  }),

  markOpened: asyncHandler(async (req, res) => {
    const record = await recordService.markOpened(req.params.id, req.user.id);
    return ApiResponse.ok(res, record, 'Marked opened');
  }),

  decision: asyncHandler(async (req, res) => {
    const record = await recordService.decide(
      req.params.id,
      req.body.decision,
      req.body.reason,
      req.user.id,
      req.body.remarks,
      req.user,
    );
    return ApiResponse.ok(res, record, 'Decision recorded');
  }),

  /**
   * Decide many records in one call.
   *
   * Partial success is the EXPECTED outcome, not an error: in a queue this
   * size another approver will have cleared some of these between the page
   * loading and the button being pressed. So this answers 200 with a
   * per-id breakdown rather than failing the batch.
   *
   * Deliberately NOT wrapped in a transaction — one stale record must not roll
   * back ninety-nine good decisions. Each item is independent, and each one
   * goes through the same `decide()` the single-record endpoint uses, so every
   * gate, audit row and notification behaves identically.
   */
  bulkDecision: asyncHandler(async (req, res) => {
    const { ids, decision, reason, remarks } = req.body;

    const succeeded = [];
    const failed = [];

    // Sequential, not Promise.all: `decide()` writes activity rows and can
    // trigger stage recomputation, and firing 100 of those concurrently at one
    // project is how you get lost updates on the project document.
    for (const id of ids) {
      try {
        // eslint-disable-next-line no-await-in-loop -- see above
        await recordService.decide(id, decision, reason, req.user.id, remarks, req.user);
        succeeded.push(id);
      } catch (err) {
        failed.push({
          id,
          code: err.details?.code || err.code || 'DECISION_FAILED',
          message: err.message || 'Could not record this decision',
        });
      }
    }

    return ApiResponse.ok(
      res,
      { succeeded, failed },
      `${succeeded.length} of ${ids.length} recorded`,
    );
  }),

  undoDecision: asyncHandler(async (req, res) => {
    const record = await recordService.undoDecision(req.params.id, req.user.id);
    return ApiResponse.ok(res, record, 'Decision reverted');
  }),

  comment: asyncHandler(async (req, res) => {
    const record = await recordService.addComment(req.params.id, req.body.body, req.user.id);
    return ApiResponse.ok(res, record, 'Comment added');
  }),

  remove: asyncHandler(async (req, res) => {
    await recordService.remove(req.params.id, req.user.id);
    return ApiResponse.ok(res, null, 'Record deleted');
  }),

  uploadMedia: asyncHandler(async (req, res) => {
    const ref = await recordService.uploadMedia(req.file);
    return ApiResponse.created(res, ref, 'File uploaded');
  }),

  destroyMedia: asyncHandler(async (req, res) => {
    await recordService.destroyMedia(req.body.publicId, req.body.resourceType);
    return ApiResponse.ok(res, null, 'File removed');
  }),
};

export default recordController;
