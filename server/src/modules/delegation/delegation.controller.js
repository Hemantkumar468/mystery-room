import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { delegationService } from './delegation.service.js';
import { lifecycle } from './delegation.lifecycle.js';
import { REMARK_CHANNELS } from '../../core/constants/ops.js';

/** Run a lifecycle action, then answer with the task's full, fresh detail. */
const act = (fn, message) =>
  asyncHandler(async (req, res) => {
    const result = await fn(req);
    const id = result?.created?._id || req.params.id;
    const detail = await delegationService.getById(id, req.user);
    const msg = typeof message === 'function' ? message(result) : message;
    return ApiResponse.ok(res, detail, msg, result?.outcome ? { outcome: result.outcome, revisionsRemaining: result.revisionsRemaining } : undefined);
  });

export const delegationController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await delegationService.list(req.validatedQuery || {}, req.user);
    return ApiResponse.ok(res, items, 'Tasks fetched', meta);
  }),

  summary: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.summary(req.validatedQuery || {}, req.user)),
  ),

  get: asyncHandler(async (req, res) => ApiResponse.ok(res, await delegationService.getById(req.params.id, req.user))),

  create: asyncHandler(async (req, res) => {
    const created = await delegationService.create(req.body, req.user);
    return ApiResponse.created(res, created, created.length > 1 ? `${created.length} tasks assigned` : 'Task assigned');
  }),

  update: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.update(req.params.id, req.body, req.user), 'Task updated'),
  ),

  remove: asyncHandler(async (req, res) => {
    const r = await delegationService.remove(req.params.id, req.user);
    return ApiResponse.ok(res, r, r.deleted > 1 ? `Moved to trash with ${r.deleted - 1} sub-task(s)` : 'Moved to trash');
  }),

  restore: asyncHandler(async (req, res) => {
    const r = await delegationService.restore(req.params.id, req.user);
    return ApiResponse.ok(res, r, 'Task restored');
  }),

  deleted: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.listDeleted(req.validatedQuery || {}, req.user)),
  ),

  collaborators: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.recentCollaborators(req.user)),
  ),

  comment: asyncHandler(async (req, res) =>
    ApiResponse.created(res, await delegationService.addComment(req.params.id, req.body, req.user), 'Comment added'),
  ),

  /* Lifecycle */
  setStatus: act((req) => lifecycle.setStatus(req.params.id, req.body, req.user), 'Status updated'),
  complete: act((req) => lifecycle.complete(req.params.id, req.body, req.user), 'Task submitted'),
  approve: act((req) => lifecycle.approve(req.params.id, req.body, req.user), 'Task approved'),
  sendBack: act((req) => lifecycle.sendBack(req.params.id, req.body, req.user), 'Task sent back for rework'),
  reopen: act((req) => lifecycle.reopen(req.params.id, req.body, req.user), 'Task reopened'),
  revise: act(
    (req) => lifecycle.reviseDueDate(req.params.id, req.body, req.user),
    (r) =>
      ({
        'initial-date-set': 'Due date set',
        revised: `Revision recorded — ${r.revisionsRemaining} same-week revision(s) left`,
        shifted: 'Moved to another week — a new task was opened',
      })[r.outcome],
  ),
  dependent: act(
    (req) => lifecycle.markDependent(req.params.id, req.body, req.user),
    (r) => (r.reassigned ? 'Task handed over to the person it depends on' : 'Marked as dependent'),
  ),
  blocked: act((req) => lifecycle.setBlocked(req.params.id, req.body, req.user), 'Task flagged as blocked'),
  reassign: act((req) => lifecycle.reassign(req.params.id, req.body, req.user), 'Task reassigned'),
  managementRemark: act(
    (req) => lifecycle.channelRemark(req.params.id, REMARK_CHANNELS.MANAGEMENT, req.body, req.user),
    'Follow-up recorded',
  ),
  coordinatorRemark: act(
    (req) => lifecycle.channelRemark(req.params.id, REMARK_CHANNELS.COORDINATOR, req.body, req.user),
    'Note added',
  ),

  followup: asyncHandler(async (req, res) =>
    ApiResponse.created(res, await lifecycle.logFollowup(req.params.id, req.body, req.user), 'Follow-up logged'),
  ),

  reminders: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await lifecycle.setReminders(req.params.id, req.body.reminders, req.user), 'Reminders saved'),
  ),

  /* Templates */
  listTemplates: asyncHandler(async (_req, res) => ApiResponse.ok(res, await delegationService.listTemplates())),
  createTemplate: asyncHandler(async (req, res) =>
    ApiResponse.created(res, await delegationService.createTemplate(req.body, req.user), 'Template saved'),
  ),
  updateTemplate: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.updateTemplate(req.params.id, req.body, req.user), 'Template updated'),
  ),
  removeTemplate: asyncHandler(async (req, res) => {
    await delegationService.removeTemplate(req.params.id, req.user);
    return ApiResponse.ok(res, null, 'Template deleted');
  }),

  /* Recurrences */
  listRecurrences: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.listRecurrences(req.validatedQuery || {}, req.user)),
  ),
  getRecurrence: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.getRecurrence(req.params.id, req.user)),
  ),
  updateRecurrence: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await delegationService.updateRecurrence(req.params.id, req.body, req.user), 'Repeat rule updated'),
  ),
  previewRecurrence: asyncHandler(async (req, res) => ApiResponse.ok(res, delegationService.preview(req.body))),
};

export default delegationController;
