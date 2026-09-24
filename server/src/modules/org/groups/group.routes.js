import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { ROLES } from '../../../core/constants/index.js';
import { groupService } from './group.service.js';
import { workLogService } from '../worklog/worklog.service.js';

const router = Router();
const objectId = z.string().length(24);
const notViewer = authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTOR);

const groupBody = {
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  color: z.string().max(20).optional(),
  imageUrl: z.string().max(500).optional(),
  branch: objectId.nullable().optional(),
  members: z.array(objectId).max(300).optional(),
};
const idParam = z.object({ params: z.object({ id: objectId }) });
const createSchema = z.object({ body: z.object(groupBody) });
const updateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ ...groupBody, name: groupBody.name.optional() }),
});

const audit = (req, group, type, description) =>
  workLogService.log({ module: 'org', type, title: group.name, description, actor: req.user.id, refType: 'group', refId: group._id });

router.get(
  '/',
  asyncHandler(async (req, res) => ApiResponse.ok(res, await groupService.list(req.user), 'Groups fetched')),
);

router.get(
  '/:id',
  validate(idParam),
  asyncHandler(async (req, res) => ApiResponse.ok(res, await groupService.getById(req.params.id))),
);

router.post(
  '/',
  notViewer,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const group = await groupService.create(req.body, req.user);
    audit(req, group, 'created', `Group "${group.name}" created`);
    return ApiResponse.created(res, group, 'Group created');
  }),
);

router.patch(
  '/:id',
  notViewer,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const group = await groupService.update(req.params.id, req.body, req.user);
    audit(req, group, 'updated', `Group "${group.name}" updated`);
    return ApiResponse.ok(res, group, 'Group updated');
  }),
);

router.delete(
  '/:id',
  notViewer,
  validate(idParam),
  asyncHandler(async (req, res) => {
    const group = await groupService.remove(req.params.id, req.user);
    audit(req, group, 'deleted', `Group "${group.name}" deleted — its tasks were kept and un-grouped`);
    return ApiResponse.ok(res, null, 'Group deleted');
  }),
);

export default router;
