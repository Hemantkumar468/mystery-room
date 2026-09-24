import { Router } from 'express';
import { flowController } from './flow.controller.js';
import { authenticate } from '../../../core/middleware/auth.js';

/**
 * The client flow's read model — PMS_UI_SPEC_00.
 *
 * `/:projectId` answers the whole board in one call, because the screens that
 * need it need all of it at once: the drawing gate decides whether the BOQ can
 * start, the panel decides whether it can be priced, and the contracts decide
 * whether any of it can be ordered. Fetching those separately would let the
 * page render three answers taken at three different moments.
 *
 * The per-phase endpoints exist for the pages that only need their own slice.
 */
const router = Router();

router.use(authenticate);

router.get('/:projectId', flowController.getFlow);
router.get('/:projectId/drawings', flowController.getDrawings);
router.get('/:projectId/panel', flowController.getPanel);
/* The panel BOARD — one row per BOQ, with its category, assigned vendor and
   rate-card state. Separate from /panel, which is the gate summary the BOQ
   workspace reads: the board carries per-row detail no other screen needs. */
router.get('/:projectId/panel-board', flowController.getPanelBoard);
router.get('/:projectId/panel/:vendorId/rate-card', flowController.getRateCard);
router.get('/:projectId/boq', flowController.getBoq);
router.get('/:projectId/contracts', flowController.getContracts);
router.get('/:projectId/phase-counts', flowController.getPhaseCounts);
router.get('/:projectId/deposit', flowController.getDeposit);
router.get('/:projectId/orderability', flowController.getOrderability);

export default router;
