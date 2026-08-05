import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { branchService } from './branch.service.js';

export const branchController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await branchService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Branches fetched', meta);
  }),

  summary: asyncHandler(async (_req, res) => {
    const summary = await branchService.summary();
    return ApiResponse.ok(res, summary, 'Branch summary fetched');
  }),

  get: asyncHandler(async (req, res) => {
    const branch = await branchService.getById(req.params.id);
    return ApiResponse.ok(res, branch);
  }),

  create: asyncHandler(async (req, res) => {
    const branch = await branchService.create(req.body, req.user.id);
    return ApiResponse.created(res, branch, 'Branch created');
  }),

  update: asyncHandler(async (req, res) => {
    const branch = await branchService.update(req.params.id, req.body, req.user.id);
    return ApiResponse.ok(res, branch, 'Branch updated');
  }),
};

export default branchController;
