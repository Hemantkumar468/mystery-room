import { Router } from 'express';
import { branchController } from './branch.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';
import {
  createBranchSchema,
  updateBranchSchema,
  listBranchesSchema,
  idParamSchema,
} from './branch.validation.js';

const router = Router();
const canManage = authorize(...CAN_MANAGE);

router.use(authenticate);

router.get('/', validate(listBranchesSchema), branchController.list);
// Must precede `/:id` — that route validates a 24-char ObjectId and would
// otherwise swallow "summary" as an id param (same reasoning as
// template.routes.js's `/default` before `/:id`).
router.get('/summary', branchController.summary);
router.get('/:id', validate(idParamSchema), branchController.get);

router.post('/', canManage, validate(createBranchSchema), branchController.create);
router.patch('/:id', canManage, validate(updateBranchSchema), branchController.update);

export default router;
