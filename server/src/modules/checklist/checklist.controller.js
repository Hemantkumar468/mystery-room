import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { checklistService as svc } from './checklist.service.js';

const q = (req) => req.validatedQuery || {};

export const checklistController = {
  listTasks: asyncHandler(async (req, res) => {
    const { items, total } = await svc.listTasks(q(req), req.user);
    return ApiResponse.ok(res, items, 'Checklist tasks', { total, shown: items.length });
  }),
  getTask: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.getTask(req.params.id, req.user))),
  getMaster: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.getMaster(req.params.id, req.user))),
  summary: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.summary(q(req), req.user))),
  departments: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.departments(q(req), req.user))),
  report: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.departmentReport(q(req), req.user))),

  listMasters: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.listMasters(q(req), req.user))),
  createMaster: asyncHandler(async (req, res) => {
    const r = await svc.createMaster(req.body, req.user);
    return ApiResponse.created(res, r, `${r.generated} checklist occurrence(s) scheduled`);
  }),
  updateMaster: asyncHandler(async (req, res) => {
    const r = await svc.updateMaster(req.params.id, req.body, req.user);
    const parts = [`${r.cascaded} upcoming adjusted`];
    if (r.generated) parts.push(`${r.generated} added`);
    if (r.removed) parts.push(`${r.removed} removed`);
    return ApiResponse.ok(res, r, `Routine updated — ${parts.join(', ')}`);
  }),
  stopMaster: asyncHandler(async (req, res) => {
    const r = await svc.stopMaster(req.params.id, req.user);
    return ApiResponse.ok(res, r, `Routine stopped — ${r.removed} upcoming removed, history kept`);
  }),

  complete: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await svc.complete(req.params.id, req.body, req.user), 'Checklist task completed'),
  ),
  nonFunctional: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await svc.markNonFunctional(req.params.id, req.body, req.user), 'Marked non-functional'),
  ),
  reopen: asyncHandler(async (req, res) =>
    ApiResponse.ok(res, await svc.reopen(req.params.id, req.body, req.user), 'Checklist task reopened'),
  ),
  reassign: asyncHandler(async (req, res) => {
    const r = await svc.reassign(req.params.id, req.body, req.user);
    return ApiResponse.ok(res, r, r.futureCount ? `Reassigned — ${r.futureCount} upcoming moved too` : 'Reassigned');
  }),
  remarks: asyncHandler(async (req, res) => {
    const r = await svc.addRemarks(req.body, req.user);
    return ApiResponse.ok(res, r, `Remark added to ${r.updated} task(s)`);
  }),

  listSites: asyncHandler(async (req, res) => ApiResponse.ok(res, await svc.listSites(q(req), req.user))),
  addSite: asyncHandler(async (req, res) => ApiResponse.created(res, await svc.addSite(req.body, req.user), 'Site added')),
  renameSite: asyncHandler(async (req, res) => {
    const r = await svc.renameSite(req.params.id, req.body, req.user);
    return ApiResponse.ok(res, r, `Renamed — ${r.tasks} task(s) and ${r.masters} routine(s) updated`);
  }),
  removeSite: asyncHandler(async (req, res) => {
    await svc.removeSite(req.params.id, req.user);
    return ApiResponse.ok(res, null, 'Site removed from the list');
  }),
};

export default checklistController;
