import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { dashboardService } from './dashboard.service.js';

export const dashboardController = {
  summary: asyncHandler(async (_req, res) => {
    const data = await dashboardService.summary();
    return ApiResponse.ok(res, data, 'Dashboard summary');
  }),
};

export default dashboardController;
