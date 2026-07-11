import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { templateService } from './template.service.js';

export const templateController = {
  list: asyncHandler(async (req, res) => {
    const { items, meta } = await templateService.list(req.validatedQuery || {});
    return ApiResponse.ok(res, items, 'Templates fetched', meta);
  }),

  get: asyncHandler(async (req, res) => {
    const template = await templateService.getById(req.params.id);
    return ApiResponse.ok(res, template);
  }),

  getDefault: asyncHandler(async (_req, res) => {
    const template = await templateService.getDefault();
    return ApiResponse.ok(res, template, template ? 'Default template' : 'No default template set');
  }),

  setDefault: asyncHandler(async (req, res) => {
    const template = await templateService.setDefault(req.params.id);
    return ApiResponse.ok(res, template, 'Default template updated');
  }),

  create: asyncHandler(async (req, res) => {
    const template = await templateService.create(req.body, req.user.id);
    return ApiResponse.created(res, template, 'Template created');
  }),

  update: asyncHandler(async (req, res) => {
    const template = await templateService.update(req.params.id, req.body);
    return ApiResponse.ok(res, template, 'Template updated');
  }),

  publish: asyncHandler(async (req, res) => {
    const template = await templateService.publish(req.params.id);
    return ApiResponse.ok(res, template, 'Template published');
  }),

  archive: asyncHandler(async (req, res) => {
    const template = await templateService.archive(req.params.id);
    return ApiResponse.ok(res, template, 'Template archived');
  }),

  clone: asyncHandler(async (req, res) => {
    const template = await templateService.clone(req.params.id, req.user.id);
    return ApiResponse.created(res, template, 'Template cloned');
  }),

  remove: asyncHandler(async (req, res) => {
    await templateService.remove(req.params.id);
    return ApiResponse.ok(res, null, 'Template deleted');
  }),
};

export default templateController;
