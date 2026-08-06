import { Router } from 'express';
import { taskController } from './task.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import {
  uploadSingle, enforceTypeSizeLimits, uploadMultiple, enforceTypeSizeLimitsMulti,
} from '../../../core/middleware/upload.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';
import {
  listTasksSchema,
  boardSchema,
  createTaskSchema,
  updateTaskSchema,
  statusSchema,
  commentSchema,
  decisionSchema,
  attachmentParamSchema,
  idParamSchema,
  codeParamSchema,
} from './task.validation.js';

const router = Router();
const canManage = authorize(...CAN_MANAGE);

router.use(authenticate);

router.get('/', validate(listTasksSchema), taskController.list);
router.get('/board', validate(boardSchema), taskController.board);
router.get('/mine', taskController.myTasks);
// URL-friendly lookup by the human-readable code (e.g. MR-BHO-001-T052) —
// backs /projects/:id/tasks/:code so no raw Mongo id appears in the URL.
router.get('/by-code/:code', validate(codeParamSchema), taskController.getByCode);
router.get('/:id', validate(idParamSchema), taskController.get);

router.post('/', canManage, validate(createTaskSchema), taskController.create);
router.patch('/:id', validate(updateTaskSchema), taskController.update);
// Executors may move their own tasks across the board.
router.patch('/:id/status', validate(statusSchema), taskController.updateStatus);
router.post('/:id/comments', validate(commentSchema), taskController.comment);
// Assignee hands a Completed task off for approval.
router.post('/:id/submit-approval', validate(idParamSchema), taskController.submitApproval);
// Department manager (or Admin) approves/rejects — see task.service.js's canApprove().
router.post('/:id/decision', validate(decisionSchema), taskController.decide);
// Progress "update" — text + up to 4 photos ("photos" field), multipart.
router.post(
  '/:id/updates',
  validate(idParamSchema),
  uploadMultiple('photos', 4),
  enforceTypeSizeLimitsMulti,
  taskController.addUpdate,
);
// File uploads — sent to Cloudinary; the field name is "file".
router.post(
  '/:id/attachments',
  validate(idParamSchema),
  uploadSingle('file'),
  enforceTypeSizeLimits,
  taskController.uploadAttachment,
);
router.delete(
  '/:id/attachments/:attachmentId',
  validate(attachmentParamSchema),
  taskController.deleteAttachment,
);
router.delete('/:id', canManage, validate(idParamSchema), taskController.remove);

export default router;
