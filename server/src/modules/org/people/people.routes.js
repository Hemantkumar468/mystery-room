import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { LEADERSHIP, ROLE_VALUES, DEPARTMENT_VALUES } from '../../../core/constants/index.js';
import { peopleService } from './people.service.js';
import { workLogService } from '../worklog/worklog.service.js';

const router = Router();
const objectId = z.string().length(24);

const listSchema = z.object({
  query: z.object({
    role: z.enum(ROLE_VALUES).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    branch: objectId.optional(),
    team: objectId.optional(),
    group: objectId.optional(),
    search: z.string().max(80).optional(),
    includeInactive: z.enum(['true', 'false']).optional(),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      branch: objectId.nullable().optional(),
      reportingManager: objectId.nullable().optional(),
      department: z.enum(DEPARTMENT_VALUES).nullable().optional(),
      title: z.string().trim().max(120).optional(),
      opsFlags: z
        .object({ coordinator: z.boolean().optional(), director: z.boolean().optional() })
        .optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
});

router.get(
  '/',
  validate(listSchema),
  asyncHandler(async (req, res) => ApiResponse.ok(res, await peopleService.list(req.validatedQuery || {}))),
);

router.patch(
  '/:id',
  authorize(...LEADERSHIP),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const person = await peopleService.updateOpsProfile(req.params.id, req.body);
    workLogService.log({
      module: 'org',
      type: 'updated',
      title: person.name,
      description: `Work profile of ${person.name} updated (branch / reporting line / roles)`,
      actor: req.user.id,
      refType: 'user',
      refId: person._id,
    });
    return ApiResponse.ok(res, person, 'Profile updated');
  }),
);

export default router;
