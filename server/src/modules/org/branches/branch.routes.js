import { Router } from 'express';
import { branchController } from './branch.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { LEADERSHIP } from '../../../core/constants/index.js';
import { createBranchSchema, updateBranchSchema, listBranchesSchema } from './branch.validation.js';

const router = Router();

router.get('/', validate(listBranchesSchema), branchController.list);
router.post('/', authorize(...LEADERSHIP), validate(createBranchSchema), branchController.create);
router.patch('/:id', authorize(...LEADERSHIP), validate(updateBranchSchema), branchController.update);

export default router;
