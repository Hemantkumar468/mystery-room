import { Router } from 'express';
import { misController } from './mis.controller.js';
import { MIS_RANGES } from './mis.service.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { validate } from '../../../core/middleware/validate.js';
import { DEPARTMENT_VALUES } from '../../../core/constants/index.js';
import { z } from 'zod';

const router = Router();
const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });

/* Both dashboard filters. Enum-validated rather than passed through, since
   `dept` reaches a Mongo query directly and `range` becomes a day count. */
const reportQuery = z.object({
  query: z.object({
    range: z.enum(MIS_RANGES).optional(),
    dept: z.enum(['all', ...DEPARTMENT_VALUES]).optional(),
  }),
});

router.use(authenticate);
router.get('/portfolio', validate(reportQuery), misController.portfolio);
router.get('/projects/:id', validate(idParam.merge(reportQuery)), misController.project);

export default router;
