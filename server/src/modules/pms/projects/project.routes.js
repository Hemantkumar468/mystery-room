import { Router } from 'express';
import { projectController } from './project.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { ROLES } from '../../../core/constants/index.js';
import {
  createProjectSchema,
  updateProjectSchema,
  masterDataSchema,
  listProjectsSchema,
  idParamSchema,
  stageKeyParamSchema,
  codeParamSchema,
} from './project.validation.js';

const router = Router();
const canManage = authorize(ROLES.ADMIN, ROLES.MANAGER);

router.use(authenticate);

router.get('/', validate(listProjectsSchema), projectController.list);
// URL-friendly lookup by the human-readable code (e.g. MR-BHO-001) — not yet
// used by any client route (see codeParamSchema for context).
router.get('/by-code/:code', validate(codeParamSchema), projectController.getByCode);
router.get('/:id', validate(idParamSchema), projectController.get);
router.get('/:id/activity', validate(idParamSchema), projectController.activity);

router.post('/', canManage, validate(createProjectSchema), projectController.create);
router.patch('/:id', canManage, validate(updateProjectSchema), projectController.update);
router.patch(
  '/:id/master-data',
  canManage,
  validate(masterDataSchema),
  projectController.updateMasterData,
);
// "Mark Done" is open to any project member (the doer completes their own
// stage); reopening an already-completed stage is a manager/admin action.
router.post(
  '/:id/stages/:stageKey/complete',
  validate(stageKeyParamSchema),
  projectController.completeStage,
);
router.post(
  '/:id/stages/:stageKey/reopen',
  canManage,
  validate(stageKeyParamSchema),
  projectController.reopenStage,
);
router.delete('/:id', authorize(ROLES.ADMIN), validate(idParamSchema), projectController.remove);

export default router;
