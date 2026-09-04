import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { approvalService } from './approval.service.js';

export const approvalController = {
  submission: asyncHandler(async (req, res) => {
    const data = await approvalService.submissionFor(req.params.taskId);
    return ApiResponse.ok(res, data, 'Task submission');
  }),

  history: asyncHandler(async (req, res) => {
    const data = await approvalService.historyFor(req.params.taskId);
    return ApiResponse.ok(res, data, 'Task decision history');
  }),

  analysis: asyncHandler(async (req, res) => {
    const data = await approvalService.analysisFor(req.params.taskId);
    return ApiResponse.ok(res, data, 'Task analysis');
  }),
};

export default approvalController;
