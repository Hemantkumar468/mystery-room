import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { misService } from './mis.service.js';

export const misController = {
  portfolio: asyncHandler(async (_req, res) => {
    const report = await misService.report({});
    return ApiResponse.ok(res, report, 'MIS portfolio report');
  }),

  project: asyncHandler(async (req, res) => {
    const report = await misService.report({ projectId: req.params.id });
    return ApiResponse.ok(res, report, 'MIS project report');
  }),
};

export default misController;
