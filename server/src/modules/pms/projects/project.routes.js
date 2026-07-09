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
} from './project.validation.js';

const router = Router();
const canManage = authorize(ROLES.ADMIN, ROLES.MANAGER);

router.use(authenticate);

router.get('/', validate(listProjectsSchema), projectController.list);
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
router.delete('/:id', authorize(ROLES.ADMIN), validate(idParamSchema), projectController.remove);

export default router;
