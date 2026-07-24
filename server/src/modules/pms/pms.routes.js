import { Router } from 'express';
import templateRoutes from './templates/template.routes.js';
import projectRoutes from './projects/project.routes.js';
import taskRoutes from './tasks/task.routes.js';
import recordRoutes from './records/record.routes.js';
import misRoutes from './mis/mis.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import calendarRoutes from './calendar/calendar.routes.js';
import notificationRoutes from './notifications/notification.routes.js';

/**
 * PMS module surface. Everything project-management lives under /pms so future
 * ERP modules (crm, hrms…) get their own top-level namespace beside it.
 */
const router = Router();

router.use('/templates', templateRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/records', recordRoutes);
router.use('/mis', misRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/calendar', calendarRoutes);
router.use('/notifications', notificationRoutes);

export default router;
