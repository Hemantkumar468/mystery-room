import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import financeRoutes from '../modules/finance/finance.routes.js';
import filesRoutes from './files.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth    → authentication & user directory
 *   /pms     → Module 1: Project Management System
 *   /ai      → AI services (property & location intelligence)
 *   /finance → Expense Management System (EMS) — see docs/EMS-ARCHITECTURE.md
 *   /files   → stable redirects to private S3 objects (see files.routes.js)
 *   …future: /crm, /hrms, /bookings
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
    modules: ['auth', 'pms', 'ai', 'finance', 'files'],
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/pms', pmsRoutes);
apiRouter.use('/ai', aiRoutes);
apiRouter.use('/finance', financeRoutes);
apiRouter.use('/files', filesRoutes);

export default apiRouter;
