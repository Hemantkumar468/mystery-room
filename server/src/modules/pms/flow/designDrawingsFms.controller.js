import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { designDrawingsFmsService as fms } from './designDrawingsFms.service.js';

/**
 * Design & Drawings FMS — the multi-project dashboard and its project-level
 * detail, plus the assign/approve/resend actions.
 *
 * Everything here reads and writes through the same `p11` Records and
 * `DRAWING_CHECKLIST` master the single-project checklist (flow.controller.js)
 * already uses, so a change made from here shows up there and vice versa.
 */
export const designDrawingsFmsController = {
  getOverview: asyncHandler(async (req, res) => {
    const data = await fms.getFmsOverview();
    return ApiResponse.ok(res, data, 'Design & Drawings overview');
  }),

  getBreakdown: asyncHandler(async (req, res) => {
    /* `validatedQuery`, not `query` — validate.js parks the coerced,
       stripped values there and leaves req.query as raw strings. */
    const data = await fms.getFmsBreakdown({
      metric: req.params.metric,
      ...(req.validatedQuery || req.query || {}),
    });
    return ApiResponse.ok(res, data, 'Design & Drawings breakdown');
  }),

  getProject: asyncHandler(async (req, res) => {
    const data = await fms.getFmsProject(req.params.projectId);
    return ApiResponse.ok(res, data, 'Design & Drawings — project detail');
  }),

  assign: asyncHandler(async (req, res) => {
    const plan = await fms.assignDrawing({
      projectId: req.params.projectId,
      drawingNo: req.params.drawingNo,
      ...req.body,
      actorId: req.user.id,
    });
    return ApiResponse.ok(res, plan, 'Assignment saved');
  }),

  approve: asyncHandler(async (req, res) => {
    const data = await fms.approveDrawing({
      projectId: req.params.projectId,
      drawingNo: req.params.drawingNo,
      actorId: req.user.id,
      actor: req.user,
    });
    return ApiResponse.ok(res, data, 'Drawing approved');
  }),

  resend: asyncHandler(async (req, res) => {
    const data = await fms.resendDrawing({
      projectId: req.params.projectId,
      drawingNo: req.params.drawingNo,
      reason: req.body.reason,
      actorId: req.user.id,
    });
    return ApiResponse.ok(res, data, 'Sent back to the designer');
  }),

  getRevisions: asyncHandler(async (req, res) => {
    const data = await fms.getDrawingRevisions({
      projectId: req.params.projectId,
      drawingNo: req.params.drawingNo,
    });
    return ApiResponse.ok(res, data, 'Revision history');
  }),
};

export default designDrawingsFmsController;
