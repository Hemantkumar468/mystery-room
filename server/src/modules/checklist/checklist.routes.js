import { Router } from 'express';
import { checklistController as c } from './checklist.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import * as v from './checklist.validation.js';
import './checklist.hooks.js';

/**
 * Checklist module — recurring routines (daily opening checks, weekly prop
 * audits, monthly fire-safety…) materialised into dated occurrences that a
 * doer ticks off, with proof, non-functional closures, reassignment and a
 * department compliance scoreboard. Role/branch scoping lives in the service.
 */
const router = Router();
router.use(authenticate);

router.get('/summary', validate(v.summarySchema), c.summary);
router.get('/departments', validate(v.branchOnlySchema), c.departments);
router.get('/report/departments', validate(v.reportSchema), c.report);

router.get('/sites', validate(v.branchOnlySchema), c.listSites);
router.post('/sites', validate(v.addSiteSchema), c.addSite);
router.patch('/sites/:id', validate(v.renameSiteSchema), c.renameSite);
router.delete('/sites/:id', validate(v.idSchema), c.removeSite);

router.get('/routines', validate(v.listMastersSchema), c.listMasters);
router.post('/routines', validate(v.createMasterSchema), c.createMaster);
router.get('/routines/:id', validate(v.idSchema), c.getMaster);
router.patch('/routines/:id', validate(v.updateMasterSchema), c.updateMaster);
router.delete('/routines/:id', validate(v.idSchema), c.stopMaster);

router.get('/tasks', validate(v.listTasksSchema), c.listTasks);
router.post('/tasks/remarks', validate(v.remarksSchema), c.remarks);
router.get('/tasks/:id', validate(v.idSchema), c.getTask);
router.post('/tasks/:id/complete', validate(v.completeSchema), c.complete);
router.post('/tasks/:id/non-functional', validate(v.nonFunctionalSchema), c.nonFunctional);
router.post('/tasks/:id/reassign', validate(v.reassignSchema), c.reassign);
router.post('/tasks/:id/reopen', validate(v.reopenSchema), c.reopen);

export default router;
