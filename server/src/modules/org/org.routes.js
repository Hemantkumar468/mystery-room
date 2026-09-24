import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth.js';
import branchRoutes from './branches/branch.routes.js';
import teamRoutes from './teams/team.routes.js';
import groupRoutes from './groups/group.routes.js';
import catalogRoutes from './catalog/catalog.routes.js';
import holidayRoutes from './holidays/holiday.routes.js';
import peopleRoutes from './people/people.routes.js';
import notificationRoutes from './notifications/notification.routes.js';
import workLogRoutes from './worklog/worklog.routes.js';

/**
 * Organisation layer shared by the Delegation and Checklist modules:
 * branches (head office / regional / outlets), teams, groups, categories & tags,
 * holidays, the people directory, in-app notifications and the ops audit log.
 */
const router = Router();

router.use(authenticate);

router.use('/branches', branchRoutes);
router.use('/teams', teamRoutes);
router.use('/groups', groupRoutes);
router.use('/holidays', holidayRoutes);
router.use('/people', peopleRoutes);
router.use('/notifications', notificationRoutes);
router.use('/activity', workLogRoutes);
router.use('/', catalogRoutes); // /categories, /tags

export default router;
