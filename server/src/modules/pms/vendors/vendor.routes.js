import { Router } from 'express';
import { vendorController } from './vendor.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';

/**
 * Three endpoints, one per screen of the vendor drill-down. Read-only:
 * creating and editing a vendor still goes through the records API, so the
 * Phase 4B form and this page can never disagree about what a vendor is.
 */
const router = Router();

router.use(authenticate);

router.get('/projects', vendorController.listProjects);
router.get('/projects/:projectId', vendorController.listForProject);
router.get('/projects/:projectId/vendors/:vendorId', vendorController.getDetail);

export default router;
