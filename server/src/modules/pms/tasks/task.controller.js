import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { taskService } from './task.service.js';

export const taskController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await taskService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Tasks fetched', meta);
  }),

  board: asyncHandler(async (req, res) => {
    const board = await taskService.board(req.validatedQuery.project);
    return ApiResponse.ok(res, board);
  }),

  /** `{ open, recentlyDone }` — the two halves the My Tasks page renders. */
  myTasks: asyncHandler(async (req, res) => {
    const work = await taskService.myTasks(req.user.id);
    return ApiResponse.ok(res, work);
  }),

  get: asyncHandler(async (req, res) => {
    const task = await taskService.getById(req.params.id);
    return ApiResponse.ok(res, task);
  }),

  getByCode: asyncHandler(async (req, res) => {
    const task = await taskService.getByCode(req.params.code);
    return ApiResponse.ok(res, task);
  }),

  create: asyncHandler(async (req, res) => {
    const task = await taskService.create(req.body, req.user.id);
    return ApiResponse.created(res, task, 'Task created');
  }),

  update: asyncHandler(async (req, res) => {
    const task = await taskService.update(req.params.id, req.body, req.user);
    return ApiResponse.ok(res, task, 'Task updated');
  }),

  updateStatus: asyncHandler(async (req, res) => {
    const task = await taskService.updateStatus(req.params.id, req.body.status, req.user);
    return ApiResponse.ok(res, task, 'Status updated');
  }),

  /**
   * Many tasks, one status, one request — see taskService.bulkStatus().
   * Answers 200 with `{ succeeded, failed }` even when some ids fail, so the
   * caller can report exactly which rows moved.
   */
  bulkStatus: asyncHandler(async (req, res) => {
    const { ids, status } = req.body;
    const result = await taskService.bulkStatus(ids, status, req.user);
    const message = result.failed.length
      ? `${result.succeeded.length} updated, ${result.failed.length} could not be`
      : `${result.succeeded.length} task${result.succeeded.length === 1 ? '' : 's'} updated`;
    return ApiResponse.ok(res, result, message);
  }),

  comment: asyncHandler(async (req, res) => {
    const task = await taskService.addComment(req.params.id, req.body.body, req.user);
    return ApiResponse.ok(res, task, 'Comment added');
  }),

  submitApproval: asyncHandler(async (req, res) => {
    const task = await taskService.submitForApproval(req.params.id, req.user);
    return ApiResponse.ok(res, task, 'Submitted for approval');
  }),

  decide: asyncHandler(async (req, res) => {
    const task = await taskService.decide(
      req.params.id,
      req.body.decision,
      { reason: req.body.reason, remarks: req.body.remarks, signature: req.body.signature },
      req.user,
    );
    return ApiResponse.ok(res, task, req.body.decision === 'reject' ? 'Task rejected' : 'Task approved');
  }),

  addUpdate: asyncHandler(async (req, res) => {
    const task = await taskService.addUpdate(
      req.params.id,
      { body: req.body.body, files: req.files },
      req.user,
    );
    return ApiResponse.created(res, task, 'Update posted');
  }),

  uploadAttachment: asyncHandler(async (req, res) => {
    const task = await taskService.addAttachment(req.params.id, req.file, req.user);
    return ApiResponse.created(res, task, 'Attachment uploaded');
  }),

  deleteAttachment: asyncHandler(async (req, res) => {
    const task = await taskService.removeAttachment(
      req.params.id,
      req.params.attachmentId,
      req.user,
    );
    return ApiResponse.ok(res, task, 'Attachment removed');
  }),

  remove: asyncHandler(async (req, res) => {
    await taskService.remove(req.params.id, req.user.id);
    return ApiResponse.ok(res, null, 'Task deleted');
  }),
};

export default taskController;
