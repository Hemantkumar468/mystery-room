import { Router } from 'express';
import { recordController } from './record.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { ROLES } from '../../../core/constants/index.js';
import {
  createRecordSchema,
  listRecordsSchema,
  updateRecordSchema,
  decisionSchema,
  idParamSchema,
} from './record.validation.js';

const router = Router();

// Doers (executors) capture and edit rows; managers/admins also can.
const canCapture = authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTOR);
// Only managers/admins take shortlist/reject/approve decisions.
const canDecide = authorize(ROLES.ADMIN, ROLES.MANAGER);

router.use(authenticate);

router.get('/', validate(listRecordsSchema), recordController.list);
router.get('/:id', validate(idParamSchema), recordController.get);

router.post('/', canCapture, validate(createRecordSchema), recordController.create);
router.patch('/:id', canCapture, validate(updateRecordSchema), recordController.update);

router.post('/:id/decision', canDecide, validate(decisionSchema), recordController.decide);
router.post('/:id/undo-decision', canDecide, validate(idParamSchema), recordController.undoDecision);

router.delete('/:id', canDecide, validate(idParamSchema), recordController.remove);

export default router;
