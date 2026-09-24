import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
import orgRoutes from '../modules/org/org.routes.js';
import delegationRoutes from '../modules/delegation/delegation.routes.js';
import checklistRoutes from '../modules/checklist/checklist.routes.js';
import performanceRoutes from '../modules/performance/performance.routes.js';
import fileRoutes from '../modules/files/files.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth         → authentication & user directory
 *   /pms          → Project Management System
 *   /org          → branches, teams, groups, categories, holidays, notifications
 *   /delegation   → delegated tasks, lifecycle, repeat rules, templates
 *   /checklist    → recurring routines & their dated occurrences
 *   /performance  → KRA report and scoreboard
 *   /files        → evidence / proof / reference uploads
 *   …future: /crm, /hrms, /bookings, /finance
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
    modules: ['auth', 'pms', 'org', 'delegation', 'checklist', 'performance', 'files'],
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/pms', pmsRoutes);
apiRouter.use('/org', orgRoutes);
apiRouter.use('/delegation', delegationRoutes);
apiRouter.use('/checklist', checklistRoutes);
apiRouter.use('/performance', performanceRoutes);
apiRouter.use('/files', fileRoutes);

export default apiRouter;
