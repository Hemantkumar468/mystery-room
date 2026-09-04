import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { vendorService } from './vendor.service.js';

export const vendorController = {
  listProjects: asyncHandler(async (_req, res) => {
    const data = await vendorService.listProjects();
    return ApiResponse.ok(res, data, 'Projects with vendors');
  }),

  listForProject: asyncHandler(async (req, res) => {
    const data = await vendorService.listForProject(req.params.projectId);
    return ApiResponse.ok(res, data, 'Project vendors');
  }),

  getDetail: asyncHandler(async (req, res) => {
    const data = await vendorService.getDetail(req.params.projectId, req.params.vendorId);
    return ApiResponse.ok(res, data, 'Vendor detail');
  }),
};

export default vendorController;
