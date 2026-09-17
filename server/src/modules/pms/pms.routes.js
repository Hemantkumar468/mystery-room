import { Router } from 'express';
import templateRoutes from './templates/template.routes.js';
import projectRoutes from './projects/project.routes.js';
import taskRoutes from './tasks/task.routes.js';
import recordRoutes from './records/record.routes.js';
import vendorRoutes from './vendors/vendor.routes.js';
import vendorMasterRoutes from './vendorMaster/vendorMaster.routes.js';
import inventoryRoutes from './inventory/inventory.routes.js';
import propertyCaptureRoutes from './propertyCapture/propertyCapture.routes.js';
import flowRoutes from './flow/flow.routes.js';
import approvalRoutes from './approvals/approval.routes.js';
import gameRoutes from './games/game.routes.js';
import misRoutes from './mis/mis.routes.js';
import ganttRoutes from './gantt/gantt.routes.js';
import dashboardRoutes from './dashboard/dashboard.routes.js';
import calendarRoutes from './calendar/calendar.routes.js';
import notificationRoutes from './notifications/notification.routes.js';
// WHATSAPP OFF. The integration is switched off for now.
//
// This import is what crashed the deploy: it reaches whatsapp.service.js,
// which imports a named export from core/services/whatsapp.service.js —
// a file that is commented out end to end and therefore exports nothing.
// Uncomment this line and the router.use below to turn it back on.
// import whatsappRoutes from './whatsapp/whatsapp.routes.js';
import outsourceRoutes from './outsource/outsource.routes.js';

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
/* The standing supply list — who we buy each kind of item from. A company
   master like /games, not project data: mounted separately from /vendors
   above, which is the read model over vendors ENGAGED on a project. */
router.use('/vendor-master', vendorMasterRoutes);
/* The inventory master — every SKU the company stocks, and the categories it
   is filed under. A company master like /games and /vendor-master, migrated
   from the BoxHero export in SHEET/. It is a CATALOGUE, not a stock ledger:
   see inventoryItem.model.js for why there is no quantity on it. */
router.use('/inventory', inventoryRoutes);
/* Property capture — every property in front of the business, whichever door
   it came in through, and the assess/skip decision on each. A read model over
   p1 records and undecided enquiries; it owns no data of its own. */
router.use('/property-capture', propertyCaptureRoutes);
/* The client flow's gates and rollups — the drawing checklist, the seven BOQs,
   the contracts and what may actually be ordered. Read-only for the same
   reason as /vendors: every write still goes through /records, so a phase form
   and the board can never disagree. See flow.service.js. */
router.use('/flow', flowRoutes);
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
// The WhatsApp channel's settings: templates, event mapping and delivery logs.
// Sending itself is core/services/whatsapp.service.js.
// router.use('/whatsapp', whatsappRoutes);
// Inviting an outside designer to do a phase's work. The link they open is
// UNAUTHENTICATED and mounted separately, at /pms/public — see routes/index.js.
router.use('/outsource', outsourceRoutes);

export default router;
