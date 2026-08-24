import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import crmRoutes from '../modules/crm/crm.routes.js';
import crmPublicRoutes from '../modules/crm/crm.public.routes.js';
import hrmsRoutes from '../modules/hrms/hrms.routes.js';
import hrmsPublicRoutes from '../modules/hrms/hrms.public.routes.js';
import filesRoutes from './files.routes.js';
import commsRoutes from '../modules/comms/comms.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth    → authentication & user directory
 *   /pms     → Module 1: Project Management System
 *   /ai      → AI services (property & location intelligence)
 *   /crm     → Module 2: CRM — sales, support & intelligence
 *   /crm/public → UNAUTHENTICATED: web forms and provider webhooks
 *   /files   → stable redirects to private S3 objects (see files.routes.js)
 *   …future: /hrms, /bookings
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
    modules: ['auth', 'pms', 'ai', 'crm', 'hrms', 'files', 'comms'],
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/pms', pmsRoutes);
apiRouter.use('/ai', aiRoutes);

/**
 * MOUNT ORDER MATTERS. `/crm/public` is declared BEFORE `/crm`, because the
 * latter applies `authenticate` to everything under it — mounted the other way
 * round, every web form submission and every Meta webhook would be answered
 * with a 401, and the failure would look like a provider problem rather than a
 * routing one.
 */
apiRouter.use('/crm/public', crmPublicRoutes);
apiRouter.use('/crm', crmRoutes);

// Same public-before-authenticated ordering as CRM, for the same reason: the
// job page and its apply form are reachable by applicants with no account.
apiRouter.use('/hrms/public', hrmsPublicRoutes);
apiRouter.use('/hrms', hrmsRoutes);

apiRouter.use('/files', filesRoutes);
// Outbound comms (email now, WhatsApp when DoubleTick creds land) — see modules/comms.
apiRouter.use('/comms', commsRoutes);

export default apiRouter;
