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
    );
    return ApiResponse.ok(res, record, 'Decision recorded');
  }),

  undoDecision: asyncHandler(async (req, res) => {
    const record = await recordService.undoDecision(req.params.id, req.user.id);
    return ApiResponse.ok(res, record, 'Decision reverted');
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
