import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { branchService } from './branch.service.js';
import { workLogService } from '../worklog/worklog.service.js';

export const branchController = {
  list: asyncHandler(async (req, res) => {
    const includeInactive = req.validatedQuery?.includeInactive === 'true';
    const [items, defaultId] = await Promise.all([
      branchService.list({ includeInactive }),
      branchService.defaultBranchId(),
    ]);
    return ApiResponse.ok(res, items, 'Branches fetched', { defaultBranchId: defaultId });
  }),

  create: asyncHandler(async (req, res) => {
    const branch = await branchService.create(req.body, req.user.id);
    workLogService.log({
      module: 'org',
      type: 'created',
      title: branch.name,
      description: `Branch "${branch.name}" (${branch.code}) added`,
      actor: req.user.id,
      refType: 'branch',
      refId: branch._id,
    });
    return ApiResponse.created(res, branch, 'Branch created');
  }),

  update: asyncHandler(async (req, res) => {
    const branch = await branchService.update(req.params.id, req.body);
    workLogService.log({
      module: 'org',
      type: 'updated',
      title: branch.name,
      description: `Branch "${branch.name}" updated`,
      actor: req.user.id,
      refType: 'branch',
      refId: branch._id,
    });
    return ApiResponse.ok(res, branch, 'Branch updated');
  }),
};

export default branchController;
