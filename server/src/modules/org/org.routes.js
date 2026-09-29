import { Router } from 'express';
import { authenticate } from '../../core/middleware/auth.js';
import { requireStep } from '../../core/middleware/access.js';
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
/**
 * THE AUDIT LOG IS THE ONE THING HERE THAT IS PURELY ORGANISATION'S.
 *
 * Everything else under /org is shared PLUMBING: Delegation's person picker
 * reads /people, its group picker /groups, its tag picker /categories, and
 * both modules read /branches, /teams, /holidays and /notifications. Gating
 * the whole router behind `module:organisation` would have quietly broken
 * Delegation and Checklist for anybody who holds them and not Organisation
 * — a picker that returns 403 looks like an empty company.
 *
 * So the gate goes on the one route that is a DESTINATION rather than a
 * lookup: "who changed what", which is an audit trail and not daily work.
 * The shared reads stay open to any authenticated account, and the write
 * paths keep their own per-router authorisation.
 */
router.use('/activity', requireStep('org-activity'), workLogRoutes);
router.use('/', catalogRoutes); // /categories, /tags

export default router;
