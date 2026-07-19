import { Router } from 'express';
import { taskController } from './task.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { uploadSingle, enforceTypeSizeLimits } from '../../../core/middleware/upload.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { ROLES } from '../../../core/constants/index.js';
import {
  listTasksSchema,
  boardSchema,
  createTaskSchema,
  updateTaskSchema,
  statusSchema,
  commentSchema,
  attachmentParamSchema,
  idParamSchema,
} from './task.validation.js';

const router = Router();
const canManage = authorize(ROLES.ADMIN, ROLES.MANAGER);

router.use(authenticate);

router.get('/', validate(listTasksSchema), taskController.list);
router.get('/board', validate(boardSchema), taskController.board);
router.get('/mine', taskController.myTasks);
router.get('/:id', validate(idParamSchema), taskController.get);

router.post('/', canManage, validate(createTaskSchema), taskController.create);
router.patch('/:id', validate(updateTaskSchema), taskController.update);
// Executors may move their own tasks across the board.
router.patch('/:id/status', validate(statusSchema), taskController.updateStatus);
router.post('/:id/comments', validate(commentSchema), taskController.comment);
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
