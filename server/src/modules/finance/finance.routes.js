import { Router } from 'express';
import branchRoutes from './branches/branch.routes.js';

/**
 * EMS module surface. Everything expense-management lives under /finance, a
 * sibling top-level namespace to /pms — EMS is a cross-cutting module, not a
 * PMS phase. See docs/EMS-ARCHITECTURE.md for the full design.
 */
const router = Router();

router.use('/branches', branchRoutes);

export default router;
