import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { whatsappAdminService } from './whatsapp.service.js';

export const whatsappController = {
  getSettings: asyncHandler(async (req, res) => {
    const settings = await whatsappAdminService.getSettings();
    return ApiResponse.ok(res, settings);
  }),

  updateSettings: asyncHandler(async (req, res) => {
    const settings = await whatsappAdminService.updateSettings(req.body, req.user.id);
    return ApiResponse.ok(res, settings, 'Settings updated');
  }),

  verify: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.verify();
    return ApiResponse.ok(res, result);
  }),

  listTemplates: asyncHandler(async (req, res) => {
    const templates = await whatsappAdminService.listTemplates(req.validatedQuery || {});
    return ApiResponse.ok(res, templates, 'Templates fetched');
  }),

  createTemplate: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.createTemplate(req.body, req.user.id);
    return ApiResponse.created(res, result, result.note);
  }),

  syncTemplates: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.syncTemplates();
    return ApiResponse.ok(res, result, `Synced ${result.total} templates`);
  }),

  updateTemplate: asyncHandler(async (req, res) => {
    const template = await whatsappAdminService.updateTemplate(req.params.id, req.body);
    return ApiResponse.ok(res, template, 'Template updated');
  }),

  deleteTemplate: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.deleteTemplate(req.params.id);
    return ApiResponse.ok(res, result, 'Template removed');
  }),

  listEventMaps: asyncHandler(async (req, res) => {
    const maps = await whatsappAdminService.listEventMaps();
    return ApiResponse.ok(res, maps, 'Event mappings fetched');
  }),

  upsertEventMap: asyncHandler(async (req, res) => {
    const map = await whatsappAdminService.upsertEventMap(req.body, req.user.id);
    return ApiResponse.ok(res, map, 'Event mapping saved');
  }),

  deleteEventMap: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.deleteEventMap(req.params.id);
    return ApiResponse.ok(res, result, 'Event mapping removed');
  }),

  listLogs: asyncHandler(async (req, res) => {
    const logs = await whatsappAdminService.listLogs(req.validatedQuery || {});
    return ApiResponse.ok(res, logs, 'Logs fetched');
  }),

  logSummary: asyncHandler(async (req, res) => {
    const summary = await whatsappAdminService.logSummary();
    return ApiResponse.ok(res, summary);
  }),

  refreshLogStatus: asyncHandler(async (req, res) => {
    const log = await whatsappAdminService.refreshLogStatus(req.params.id);
    return ApiResponse.ok(res, log, `Message is "${log.status}"`);
  }),

  testSend: asyncHandler(async (req, res) => {
    const result = await whatsappAdminService.testSend(req.body, req.user.id);
    return ApiResponse.created(res, result, result.note);
  }),
};

export default whatsappController;
