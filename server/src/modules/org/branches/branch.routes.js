import { Router } from 'express';
import { branchController } from './branch.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authorize } from '../../../core/middleware/auth.js';
import { requireStep } from '../../../core/middleware/access.js';
import { ACCESS } from '../../../core/constants/access.js';
import { LEADERSHIP } from '../../../core/constants/index.js';
import { createBranchSchema, updateBranchSchema, listBranchesSchema } from './branch.validation.js';

const router = Router();

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
const mayEdit = requireStep('org-branches', ACCESS.EDIT);

router.get('/', validate(listBranchesSchema), branchController.list);
router.post('/', authorize(...LEADERSHIP), mayEdit, validate(createBranchSchema), branchController.create);
router.patch('/:id', authorize(...LEADERSHIP), mayEdit, validate(updateBranchSchema), branchController.update);

export default router;
