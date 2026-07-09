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

  create: asyncHandler(async (req, res) => {
    const project = await projectService.create(req.body, req.user.id);
    return ApiResponse.created(res, project, 'Project created');
  }),

  update: asyncHandler(async (req, res) => {
    const project = await projectService.update(req.params.id, req.body, req.user.id);
    return ApiResponse.ok(res, project, 'Project updated');
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

  activity: asyncHandler(async (req, res) => {
    const items = await activityService.listForProject(req.params.id, 30);
    return ApiResponse.ok(res, items);
  }),

  remove: asyncHandler(async (req, res) => {
    await projectService.remove(req.params.id);
    return ApiResponse.ok(res, null, 'Project deleted');
  }),
};

export default projectController;
