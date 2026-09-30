import { Router } from 'express';
import { teamController } from './team.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { requireStep } from '../../../core/middleware/access.js';
import { ACCESS } from '../../../core/constants/access.js';
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

/**
 * TWO GUARDS, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 * `authorize(...)` states a rule of the SOFTWARE and is not negotiable.
 * `requireStep(...)` states a decision of the BUSINESS, taken on Settings →
 * Access Control, and can be narrowed there per role or per person. Both run,
 * so narrowing the step can take a write away from someone the role still
 * allows — and never the other way round.
 *
 * ONLY THE WRITES. The GET stays open to any authenticated account because
 * this is shared plumbing: Delegation's and Checklist's branch switchers and
 * pickers read it, and gating the read breaks those modules for anybody who
 * holds them and not Organisation. The same reasoning, at more length, is in
 * org.routes.js.
 */
const mayEdit = requireStep('org-teams', ACCESS.EDIT);

router.get('/', validate(listTeamsSchema), teamController.list);
router.get('/:id', validate(idParamSchema), teamController.get);

// Creating and deleting teams is an admin job; the service lets a team's own
// manager edit its details and membership.
router.post('/', authorize(...LEADERSHIP), mayEdit, validate(createTeamSchema), teamController.create);
router.patch('/:id', notViewer, mayEdit, validate(updateTeamSchema), teamController.update);
router.post('/:id/members', notViewer, mayEdit, validate(upsertMemberSchema), teamController.upsertMember);
router.delete('/:id/members/:userId', notViewer, mayEdit, validate(memberParamSchema), teamController.removeMember);
router.delete('/:id', authorize(...LEADERSHIP), mayEdit, validate(idParamSchema), teamController.remove);

export default router;
