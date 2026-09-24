import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { flowService } from './flow.service.js';

/**
 * One endpoint per question the client flow asks. All read-only: creating and
 * editing a drawing, a vendor, a BOQ line or a contract still goes through the
 * records API, so a phase form and this read model can never disagree about
 * what any of them is.
 */
export const flowController = {
  getFlow: asyncHandler(async (req, res) => {
    const data = await flowService.getFlow(req.params.projectId);
    return ApiResponse.ok(res, data, 'Client flow state');
  }),

  getDrawings: asyncHandler(async (req, res) => {
    const data = await flowService.getDrawings(req.params.projectId);
    return ApiResponse.ok(res, data, 'Drawing checklist');
  }),

  getPanel: asyncHandler(async (req, res) => {
    const data = await flowService.getPanel(req.params.projectId);
    return ApiResponse.ok(res, data, 'Vendor panel');
  }),

  getPanelBoard: asyncHandler(async (req, res) => {
    const data = await flowService.getPanelBoard(req.params.projectId);
    return ApiResponse.ok(res, data, 'Vendor & contractor panel');
  }),

  getRateCard: asyncHandler(async (req, res) => {
    const data = await flowService.getRateCard(req.params.projectId, req.params.vendorId);
    return ApiResponse.ok(res, data, 'Rate card');
  }),

  getBoq: asyncHandler(async (req, res) => {
    const data = await flowService.getBoq(req.params.projectId);
    return ApiResponse.ok(res, data, 'BOQ workspace');
  }),

  getContracts: asyncHandler(async (req, res) => {
    const data = await flowService.getContracts(req.params.projectId);
    return ApiResponse.ok(res, data, 'Contracts');
  }),

  getPhaseCounts: asyncHandler(async (req, res) => {
    const data = await flowService.getPhaseCounts(req.params.projectId);
    return ApiResponse.ok(res, data, 'Records per phase');
  }),

  getDeposit: asyncHandler(async (req, res) => {
    const data = await flowService.getDeposit(req.params.projectId);
    return ApiResponse.ok(res, data, 'Deposit ledger');
  }),

  getOrderability: asyncHandler(async (req, res) => {
    const data = await flowService.getOrderability(req.params.projectId);
    return ApiResponse.ok(res, data, 'What can be ordered');
  }),
};

export default flowController;
