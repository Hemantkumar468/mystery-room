import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
import financeRoutes from '../modules/finance/finance.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth    → authentication & user directory
 *   /pms     → Module 1: Project Management System
 *   /finance → Module 2: Expense Management System (EMS) — see docs/EMS-ARCHITECTURE.md
 *   …future: /crm, /hrms, /bookings
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
    modules: ['auth', 'pms', 'finance'],
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/pms', pmsRoutes);
apiRouter.use('/finance', financeRoutes);

export default apiRouter;
