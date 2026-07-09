import { Router } from 'express';
import { misController } from './mis.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { validate } from '../../../core/middleware/validate.js';
import { z } from 'zod';

const router = Router();
const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });

router.use(authenticate);
router.get('/portfolio', misController.portfolio);
router.get('/projects/:id', validate(idParam), misController.project);

export default router;
