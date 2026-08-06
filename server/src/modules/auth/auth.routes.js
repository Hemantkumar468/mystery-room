import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { authLimiter } from '../../core/middleware/rateLimiter.js';
import { CAN_ADMINISTER } from '../../core/constants/index.js';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  setUserStatusSchema,
  userIdSchema,
  loginSchema,
  listUsersSchema,
} from './auth.validation.js';

const router = Router();
const isAdmin = authorize(...CAN_ADMINISTER);

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);

/* ── Employee directory ───────────────────────────────────────────────────
   Anyone signed in can read the directory (assignee pickers need it); only
   admins may create, edit, deactivate or delete accounts.
──────────────────────────────────────────────────────────────────────────── */
router.get('/users', authenticate, validate(listUsersSchema), authController.listUsers);

router.post('/users', authenticate, isAdmin, validate(createUserSchema), authController.createUser);
router.patch('/users/:id', authenticate, isAdmin, validate(updateUserSchema), authController.updateUser);
router.post('/users/:id/password', authenticate, isAdmin, validate(resetPasswordSchema), authController.resetPassword);
router.patch('/users/:id/status', authenticate, isAdmin, validate(setUserStatusSchema), authController.setUserStatus);
router.delete('/users/:id', authenticate, isAdmin, validate(userIdSchema), authController.removeUser);

export default router;
