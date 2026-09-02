import { Router } from 'express';
import templateRoutes from './templates/template.routes.js';
import projectRoutes from './projects/project.routes.js';
import taskRoutes from './tasks/task.routes.js';
import recordRoutes from './records/record.routes.js';
import vendorRoutes from './vendors/vendor.routes.js';
import approvalRoutes from './approvals/approval.routes.js';
import gameRoutes from './games/game.routes.js';
import misRoutes from './mis/mis.routes.js';
import ganttRoutes from './gantt/gantt.routes.js';
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
// Read model over the p12 records — the vendor drill-down. Writes stay on /records.
router.use('/vendors', vendorRoutes);
// Read model for approval review — what was asked, what came back, what the
// numbers say. Deciding stays on /tasks.
router.use('/approvals', approvalRoutes);
// The game catalogue — a company master, not project data.
router.use('/games', gameRoutes);
router.use('/mis', misRoutes);
router.use('/gantt', ganttRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/calendar', calendarRoutes);
router.use('/notifications', notificationRoutes);

export default router;
