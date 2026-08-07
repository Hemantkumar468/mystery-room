import { Router } from 'express';
import { recordController } from './record.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { uploadSingle, enforceTypeSizeLimits } from '../../../core/middleware/upload.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE, CAN_CAPTURE } from '../../../core/constants/index.js';
import {
  listRecordsSchema,
  createRecordSchema,
  updateRecordSchema,
  decisionSchema,
  bulkDecisionSchema,
  idParamSchema,
  commentSchema,
} from './record.validation.js';

const router = Router();
const canCapture = authorize(...CAN_CAPTURE);
const canDecide = authorize(...CAN_MANAGE);

router.use(authenticate);

// Unattached media upload — the create form uploads before the record exists,
// then keeps the returned { url, publicId, ... } refs in the record's values.
router.post('/uploads', canCapture, uploadSingle('file'), enforceTypeSizeLimits, recordController.uploadMedia);
router.post('/uploads/destroy', canCapture, recordController.destroyMedia);

router.get('/', validate(listRecordsSchema), recordController.list);
router.get('/:id', validate(idParamSchema), recordController.get);

router.post('/', canCapture, validate(createRecordSchema), recordController.create);
router.patch('/:id', canCapture, validate(updateRecordSchema), recordController.update);

// Activity-only: log that a doer opened a record's dedicated workspace.
router.post('/:id/open', canCapture, validate(idParamSchema), recordController.markOpened);

// Any authenticated project member can leave a note — same permission shape as Task comments.
router.post('/:id/comments', validate(commentSchema), recordController.comment);

// Manager/director decisions and their reversal.
router.post('/:id/decision', canDecide, validate(decisionSchema), recordController.decision);
/* One path segment, so it cannot collide with '/:id/decision' (two segments)
   and there is no POST '/:id' for it to shadow. Same `canDecide` guard as the
   single-record route — bulk is a convenience, never a permission shortcut. */
router.post('/bulk-decision', canDecide, validate(bulkDecisionSchema), recordController.bulkDecision);
router.post('/:id/undo-decision', canDecide, validate(idParamSchema), recordController.undoDecision);

router.delete('/:id', canDecide, validate(idParamSchema), recordController.remove);

export default router;
