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
    return ApiResponse.created(res, record, 'Record added');
  }),

  update: asyncHandler(async (req, res) => {
    const record = await recordService.update(req.params.id, req.body, req.user.id);
    return ApiResponse.ok(res, record, 'Record updated');
  }),

  decide: asyncHandler(async (req, res) => {
    const { decision, reason } = req.body;
    const record = await recordService.decide(req.params.id, decision, reason, req.user.id);
    return ApiResponse.ok(res, record, `Record ${record.status}`);
  }),

  undoDecision: asyncHandler(async (req, res) => {
    const record = await recordService.undoDecision(req.params.id, req.user.id);
    return ApiResponse.ok(res, record, 'Decision reverted');
  }),

  remove: asyncHandler(async (req, res) => {
    await recordService.remove(req.params.id, req.user.id);
    return ApiResponse.ok(res, null, 'Record deleted');
  }),
};

export default recordController;
