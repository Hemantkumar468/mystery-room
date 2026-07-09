import { Router } from 'express';
import { dashboardController } from './dashboard.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';

const router = Router();

router.use(authenticate);
router.get('/summary', dashboardController.summary);

export default router;
