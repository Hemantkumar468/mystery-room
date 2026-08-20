import { Router } from 'express';
import { z } from 'zod';
import { ganttController } from './gantt.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { validate } from '../../../core/middleware/validate.js';
import {
  DEPARTMENT_VALUES,
  PRIORITY_VALUES,
  TASK_STATUS_VALUES,
  PROJECT_STATUS,
} from '../../../core/constants/index.js';

const router = Router();
const objectId = z.string().length(24);

/* Every filter is enum- or id-validated rather than passed through: each one
   reaches a Mongo query directly, and `search` is the only free-text field
   (it is wrapped in RegExp server-side, never used as an operator). */
const timelineQuery = z.object({
  query: z.object({
    project: objectId.optional(),
    level: z.enum(['phase', 'task']).optional(),
    city: z.string().max(80).optional(),
    status: z.enum(Object.values(PROJECT_STATUS)).optional(),
    health: z.enum(['on_track', 'at_risk', 'delayed']).optional(),
    department: z.enum(DEPARTMENT_VALUES).optional(),
    owner: objectId.optional(),
    priority: z.enum(PRIORITY_VALUES).optional(),
    stageKey: z.string().max(24).optional(),
    taskStatus: z.enum(TASK_STATUS_VALUES).optional(),
    search: z.string().max(120).optional(),
  }),
});

router.use(authenticate);
router.get('/', validate(timelineQuery), ganttController.timeline);

export default router;
