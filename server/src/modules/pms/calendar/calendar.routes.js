import { Router } from 'express';
import { z } from 'zod';
import { calendarController } from './calendar.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';
import { validate } from '../../../core/middleware/validate.js';

const router = Router();

const eventsSchema = z.object({
  query: z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    project: z.string().length(24).optional(),
  }),
});

router.use(authenticate);
router.get('/events', validate(eventsSchema), calendarController.events);

export default router;
