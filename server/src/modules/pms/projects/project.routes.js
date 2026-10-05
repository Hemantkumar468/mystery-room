import { Router } from 'express';
import { projectController } from './project.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_ADMINISTER, CAN_MANAGE } from '../../../core/constants/index.js';
import {
  createProjectSchema,
  updateProjectSchema,
  masterDataSchema,
  listProjectsSchema,
  idParamSchema,
  stageKeyParamSchema,
  codeParamSchema,
  archiveProjectSchema,
  closureAuditSchema,
} from './project.validation.js';

const router = Router();
const canManage = authorize(...CAN_MANAGE);

router.use(authenticate);

router.get('/', validate(listProjectsSchema), projectController.list);
// URL-friendly lookup by the human-readable code (e.g. MR-BHO-001) — not yet
// used by any client route (see codeParamSchema for context).
router.get('/by-code/:code', validate(codeParamSchema), projectController.getByCode);
router.get('/:id', validate(idParamSchema), projectController.get);
router.get('/:id/activity', validate(idParamSchema), projectController.activity);
// Phase 10 Project Closure — the six Archive gates, evaluated live. Read-only,
// so any project member can see why archiving is (or isn't) available.
router.get('/:id/closure-readiness', validate(idParamSchema), projectController.closureReadiness);
// Who a phase's work is addressed to, read BEFORE its tasks exist — the Step 2
// routing dialog and the Step 4 approval dialog both name the doers before the
// decision is committed. `?stage=p3` for closure, `p20` for the plan; defaults
// to p2. Read-only, derived entirely from the template and the assignment rules.
router.get('/:id/stage-doers', validate(idParamSchema), projectController.stageDoers);

router.post('/', canManage, validate(createProjectSchema), projectController.create);
router.patch('/:id', canManage, validate(updateProjectSchema), projectController.update);
// Draft -> real project. The one lifecycle transition that isn't a plain
// field patch (it resolves the default template and materializes stages),
// so it gets its own action route rather than overloading PATCH /:id.
router.post('/:id/publish', canManage, validate(idParamSchema), projectController.publishDraft);
router.patch(
  '/:id/master-data',
  canManage,
  validate(masterDataSchema),
  projectController.updateMasterData,
);
/* The tree is the project screen — every phase, every task, one read. */
router.get('/:id/tree', projectController.tree);

/* Opening the store is a decision, not an arithmetic consequence, so it keeps
   its own endpoint and its own permission check (again, inside the service). */
router.post('/:id/launch', canManage, projectController.launchStore);
// Phase 10's Archive Project — the lifecycle's final one-way door, so it's a
// manager/admin action and every gate is re-validated in the service.
router.post('/:id/archive', canManage, validate(archiveProjectSchema), projectController.archive);
// Report/export events raised in the browser, so the closure Audit Log can
// account for them. Open to any project member — it only ever appends one
// whitelisted audit line and mutates no project state.
router.post('/:id/closure-audit', validate(closureAuditSchema), projectController.closureAudit);
router.delete('/:id', authorize(...CAN_ADMINISTER), validate(idParamSchema), projectController.remove);

export default router;
