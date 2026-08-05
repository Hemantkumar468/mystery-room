import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { projectService } from './project.service.js';
import { activityService } from '../activity/activity.service.js';

export const projectController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await projectService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Projects fetched', meta);
  }),

  get: asyncHandler(async (req, res) => {
    const project = await projectService.getById(req.params.id);
    return ApiResponse.ok(res, project);
  }),

  getByCode: asyncHandler(async (req, res) => {
    const project = await projectService.getByCode(req.params.code);
    return ApiResponse.ok(res, project);
  }),

  create: asyncHandler(async (req, res) => {
    const project = await projectService.create(req.body, req.user.id);
    return ApiResponse.created(res, project, 'Project created');
  }),

  update: asyncHandler(async (req, res) => {
    const project = await projectService.update(req.params.id, req.body, req.user.id);
    return ApiResponse.ok(res, project, 'Project updated');
  }),

  publishDraft: asyncHandler(async (req, res) => {
    const project = await projectService.publishDraft(req.params.id, req.user.id);
    return ApiResponse.ok(res, project, 'Project created');
  }),

  updateMasterData: asyncHandler(async (req, res) => {
    const { stageKey, values } = req.body;
    const project = await projectService.updateMasterData(
      req.params.id,
      stageKey,
      values,
      req.user.id,
    );
    return ApiResponse.ok(res, project, 'Master data saved');
  }),

  completeStage: asyncHandler(async (req, res) => {
    // The full actor (not just the id) — p8's Final Approval and p9's Launch
    // Store are manager/admin-only, enforced inside the service.
    const project = await projectService.completeStage(
      req.params.id,
      req.params.stageKey,
      req.user.id,
      req.user,
    );
    return ApiResponse.ok(res, project, 'Stage marked as completed');
  }),

  reopenStage: asyncHandler(async (req, res) => {
    const project = await projectService.reopenStage(req.params.id, req.params.stageKey, req.user.id);
    return ApiResponse.ok(res, project, 'Stage reopened');
  }),

  // `limit` lets the Phase 10 Audit Log pull the full closure trail (default
  // stays 30 so every existing caller is unaffected).
  activity: asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 30;
    const items = await activityService.listForProject(req.params.id, Math.min(limit, 500));
    return ApiResponse.ok(res, items);
  }),

  closureReadiness: asyncHandler(async (req, res) => {
    const gates = await projectService.closureReadiness(req.params.id);
    return ApiResponse.ok(res, gates);
  }),

  archive: asyncHandler(async (req, res) => {
    const project = await projectService.archiveProject(req.params.id, req.user.id, req.body?.remarks);
    return ApiResponse.ok(res, project, 'Project archived');
  }),

  closureAudit: asyncHandler(async (req, res) => {
    const entry = await projectService.logClosureAudit(req.params.id, req.body.event, req.user.id);
    return ApiResponse.ok(res, entry, 'Closure audit event recorded');
  }),

  remove: asyncHandler(async (req, res) => {
    await projectService.remove(req.params.id, req.user.id);
    return ApiResponse.ok(res, null, 'Project deleted');
  }),
};

export default projectController;
