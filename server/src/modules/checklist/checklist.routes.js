import { Router } from 'express';
import { checklistController as c } from './checklist.controller.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireModule, requireStep } from '../../core/middleware/access.js';
import { ACCESS } from '../../core/constants/access.js';
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
// Settings → Access Control can hide this module per role or person.
router.use(requireModule('checklist'));

/**
 * The four views, gated where gating is honest.
 *
 * WHICH READS ARE GATED — only the two that are DESTINATIONS, reached from
 * their own view and nowhere else: the routines list and the department
 * report. Everything else under here is read across views and must stay
 * open, or holding one step breaks another:
 *
 *   /summary, /departments  the KPI strip and a filter dropdown, on every view
 *   /sites                  the Tasks filter reads it, and so does the routine form
 *   /routines/:id           the "Open routine" chip on a task drawer
 *   /tasks, /tasks/:id      the Routines view drills into its own occurrences
 *
 * That is the shared-plumbing rule org.routes.js spells out: gate the
 * destination, leave the lookups alone, because a picker that 403s reads as a
 * broken page rather than as a permission. The task rows a read returns are
 * already scoped to the caller by the service.
 *
 * WHICH WRITES ARE GATED — all of them, by the step that owns the action.
 * Completing an occurrence is Tasks work wherever you reached it from, so a
 * Routines holder who drills into occurrences may look and not tick.
 *
 * `POST /sites` is the one write left open: the routine form adds a site
 * inline and always could, so locking it would take a working button away
 * from everybody who writes routines. Renaming and removing one belong to the
 * Sites manager, which is where `chk-sites` applies.
 */
const tasksEdit = requireStep('chk-tasks', ACCESS.EDIT);
const routinesEdit = requireStep('chk-routines', ACCESS.EDIT);
const sitesEdit = requireStep('chk-sites', ACCESS.EDIT);

router.get('/summary', validate(v.summarySchema), c.summary);
router.get('/departments', validate(v.branchOnlySchema), c.departments);
router.get('/report/departments', requireStep('chk-report'), validate(v.reportSchema), c.report);

router.get('/sites', validate(v.branchOnlySchema), c.listSites);
router.post('/sites', validate(v.addSiteSchema), c.addSite);
router.patch('/sites/:id', sitesEdit, validate(v.renameSiteSchema), c.renameSite);
router.delete('/sites/:id', sitesEdit, validate(v.idSchema), c.removeSite);

router.get('/routines', requireStep('chk-routines'), validate(v.listMastersSchema), c.listMasters);
router.post('/routines', routinesEdit, validate(v.createMasterSchema), c.createMaster);
router.get('/routines/:id', validate(v.idSchema), c.getMaster);
router.patch('/routines/:id', routinesEdit, validate(v.updateMasterSchema), c.updateMaster);
router.delete('/routines/:id', routinesEdit, validate(v.idSchema), c.stopMaster);

router.get('/tasks', validate(v.listTasksSchema), c.listTasks);
router.post('/tasks/remarks', tasksEdit, validate(v.remarksSchema), c.remarks);
router.get('/tasks/:id', validate(v.idSchema), c.getTask);
router.post('/tasks/:id/complete', tasksEdit, validate(v.completeSchema), c.complete);
router.post('/tasks/:id/non-functional', tasksEdit, validate(v.nonFunctionalSchema), c.nonFunctional);
router.post('/tasks/:id/reassign', tasksEdit, validate(v.reassignSchema), c.reassign);
router.post('/tasks/:id/reopen', tasksEdit, validate(v.reopenSchema), c.reopen);

export default router;
