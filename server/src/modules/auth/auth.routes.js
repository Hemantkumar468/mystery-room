import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { authLimiter } from '../../core/middleware/rateLimiter.js';
import { ROLES } from '../../core/constants/index.js';
import { registerSchema, loginSchema, listUsersSchema } from './auth.validation.js';

const router = Router();

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

// Only admins can create accounts in the ERP.
router.post(
  '/register',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(registerSchema),
  authController.register,
);

router.get('/me', authenticate, authController.me);
router.get('/users', authenticate, validate(listUsersSchema), authController.listUsers);

export default router;
