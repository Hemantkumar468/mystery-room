import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { teamService } from './team.service.js';
import { workLogService } from '../worklog/worklog.service.js';

const audit = (req, team, type, description) =>
  workLogService.log({
    module: 'org',
    type,
    title: team.name,
    description,
    actor: req.user.id,
    refType: 'team',
    refId: team._id,
  });

export const teamController = {
  list: asyncHandler(async (req, res) => {
    const q = req.validatedQuery || {};
    const items = await teamService.list({ branch: q.branch, mine: q.mine === 'true', userId: req.user.id });
    return ApiResponse.ok(res, items, 'Teams fetched');
  }),

  get: asyncHandler(async (req, res) => {
    return ApiResponse.ok(res, await teamService.getById(req.params.id));
  }),

  create: asyncHandler(async (req, res) => {
    const team = await teamService.create(req.body, req.user);
    audit(req, team, 'created', `Team "${team.name}" created with ${team.members.length} member(s)`);
    return ApiResponse.created(res, team, 'Team created');
  }),

  update: asyncHandler(async (req, res) => {
    const team = await teamService.update(req.params.id, req.body, req.user);
    audit(req, team, 'updated', `Team "${team.name}" updated`);
    return ApiResponse.ok(res, team, 'Team updated');
  }),

  upsertMember: asyncHandler(async (req, res) => {
    const team = await teamService.upsertMember(req.params.id, req.body, req.user);
    audit(req, team, 'updated', `Team "${team.name}" membership changed`);
    return ApiResponse.ok(res, team, 'Team member saved');
  }),

  removeMember: asyncHandler(async (req, res) => {
    const team = await teamService.removeMember(req.params.id, req.params.userId, req.user);
    audit(req, team, 'updated', `A member was removed from team "${team.name}"`);
    return ApiResponse.ok(res, team, 'Member removed');
  }),

  remove: asyncHandler(async (req, res) => {
    const team = await teamService.remove(req.params.id);
    audit(req, team, 'deleted', `Team "${team.name}" deleted`);
    return ApiResponse.ok(res, null, 'Team deleted');
  }),
};

export default teamController;
