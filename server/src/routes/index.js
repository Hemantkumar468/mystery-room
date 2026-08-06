import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
<<<<<<< HEAD
=======
import aiRoutes from '../modules/ai/ai.routes.js';
>>>>>>> a1caf634ab4c80c65b650baeac4421b36a7f5479
import financeRoutes from '../modules/finance/finance.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth    → authentication & user directory
 *   /pms     → Module 1: Project Management System
<<<<<<< HEAD
 *   /finance → Module 2: Expense Management System (EMS) — see docs/EMS-ARCHITECTURE.md
=======
 *   /ai      → AI services (property & location intelligence)
 *   /finance → Expense Management System (EMS) — see docs/EMS-ARCHITECTURE.md
>>>>>>> a1caf634ab4c80c65b650baeac4421b36a7f5479
 *   …future: /crm, /hrms, /bookings
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
<<<<<<< HEAD
    modules: ['auth', 'pms', 'finance'],
=======
    modules: ['auth', 'pms', 'ai', 'finance'],
>>>>>>> a1caf634ab4c80c65b650baeac4421b36a7f5479
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/pms', pmsRoutes);
<<<<<<< HEAD
=======
apiRouter.use('/ai', aiRoutes);
>>>>>>> a1caf634ab4c80c65b650baeac4421b36a7f5479
apiRouter.use('/finance', financeRoutes);

export default apiRouter;
