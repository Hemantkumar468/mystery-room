import { Router } from 'express';
import { teamController } from './team.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { CAN_CAPTURE, LEADERSHIP } from '../../../core/constants/index.js';
import {
  listTeamsSchema,
  createTeamSchema,
  updateTeamSchema,
  upsertMemberSchema,
  memberParamSchema,
  idParamSchema,
} from './team.validation.js';

const router = Router();
const notViewer = authorize(...CAN_CAPTURE);

router.get('/', validate(listTeamsSchema), teamController.list);
router.get('/:id', validate(idParamSchema), teamController.get);

// Creating and deleting teams is an admin job; the service lets a team's own
// manager edit its details and membership.
router.post('/', authorize(...LEADERSHIP), validate(createTeamSchema), teamController.create);
router.patch('/:id', notViewer, validate(updateTeamSchema), teamController.update);
router.post('/:id/members', notViewer, validate(upsertMemberSchema), teamController.upsertMember);
router.delete('/:id/members/:userId', notViewer, validate(memberParamSchema), teamController.removeMember);
router.delete('/:id', authorize(...LEADERSHIP), validate(idParamSchema), teamController.remove);

export default router;
