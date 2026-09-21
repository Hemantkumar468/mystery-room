import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import pmsRoutes from '../modules/pms/pms.routes.js';
import pmsPublicRoutes from '../modules/pms/outsource/outsource.public.routes.js';
import aiRoutes from '../modules/ai/ai.routes.js';
import crmRoutes from '../modules/crm/crm.routes.js';
import crmPublicRoutes from '../modules/crm/crm.public.routes.js';
import hrmsRoutes from '../modules/hrms/hrms.routes.js';
import imsRoutes from '../modules/ims/ims.routes.js';
import ersRoutes from '../modules/ers/ers.routes.js';
import franchisePublicRoutes from '../modules/pms/franchise/franchise.public.routes.js';
import franchiseRoutes from '../modules/pms/franchise/franchise.routes.js';
import hrmsPublicRoutes from '../modules/hrms/hrms.public.routes.js';
import filesRoutes from './files.routes.js';
import commsRoutes from '../modules/comms/comms.routes.js';
import accessRoutes from '../modules/access/access.routes.js';

/**
 * Versioned API surface. Register each ERP module here — the single place that
 * knows the full route map.
 *
 *   /auth    → authentication & user directory
 *   /pms     → Module 1: Project Management System
 *   /pms/public/design → UNAUTHENTICATED: the brief an outside designer opens
 *   /ai      → AI services (property & location intelligence)
 *   /crm     → Module 2: CRM — sales, support & intelligence
 *   /crm/public → UNAUTHENTICATED: web forms and provider webhooks
 *   /ims     → Module 3: Inventory Management — stock, movements, locations.
 *              The item CATALOGUE lives at /pms/inventory; this is the count.
 *   /access  → who may see and do what: the catalogue, the saved policy,
 *              and every caller's own effective map
 *   /files   → stable redirects to private S3 objects (see files.routes.js)
 *   …future: /hrms, /bookings
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) =>
  res.json({
    success: true,
    name: 'Mystery Rooms ERP API',
    version: 'v1',
    modules: ['auth', 'access', 'pms', 'ai', 'crm', 'hrms', 'ims', 'ers', 'files', 'comms'],
    docs: '/docs/ARCHITECTURE.md',
  }),
);

apiRouter.use('/auth', authRoutes);

/* Access control — the catalogue of everything that can be granted, the saved
   role and per-person policy, and `/access/me`, which is the map the browser
   draws itself from. Mounted immediately after /auth because it is the same
   kind of thing: who somebody is, then what that makes them able to reach.
   The routes gate themselves on `module:access` rather than on a role list,
   so the company can move permission administration without a deploy. */
apiRouter.use('/access', accessRoutes);
/* Public BEFORE authenticated, the same ordering as /crm and /hrms below and
   for the same reason: an outside designer opening their brief has no session,
   and mounting this second would answer every one of them with a 401. */
apiRouter.use('/pms/public/design', pmsPublicRoutes);
apiRouter.use('/pms', pmsRoutes);
apiRouter.use('/ai', aiRoutes);

/* Inventory Management — how much of each catalogue item is at each location,
   and every movement that put it there. Its own top-level namespace rather
   than another page under /pms, because stock is not project data: it outlives
   the build that created a centre and most of it never belonged to one. The
   two halves meet at the SKU — see modules/ims/ims.service.js. */
apiRouter.use('/ims', imsRoutes);

/* Employee Performance — a READ-ONLY window onto ERS 2.0
   (feedback.mysteryrooms.co.in), the customer-feedback service that rates the
   staff member who served each guest. It is proxied rather than called from
   the browser because their API sends no CORS headers and the endpoints we
   will need next want an API key. See modules/ers/ers.client.js. */
apiRouter.use('/ers', ersRoutes);

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
apiRouter.use('/franchise/public', franchisePublicRoutes);
apiRouter.use('/hrms/public', hrmsPublicRoutes);
apiRouter.use('/hrms', hrmsRoutes);
apiRouter.use('/franchise', franchiseRoutes);

apiRouter.use('/files', filesRoutes);
// Outbound comms (email now, WhatsApp when DoubleTick creds land) — see modules/comms.
apiRouter.use('/comms', commsRoutes);

export default apiRouter;
