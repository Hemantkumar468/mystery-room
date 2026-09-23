import { Router } from 'express';
import { z } from 'zod';
import { accessService } from './access.service.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireAccess } from '../../core/middleware/access.js';
import { ACCESS, ACCESS_VALUES, INHERIT } from '../../core/constants/access.js';
import { ROLE_VALUES } from '../../core/constants/index.js';
import { JOB_ROLE_KEYS, jobRole } from '../../core/constants/jobRoles.js';
import { User } from '../auth/auth.model.js';

/**
 * Access Control - who may see and do what, and the screen that decides it.
 *
 * WHO MAY CHANGE IT. The screen itself is a surface in the catalogue
 * (`module:access`, Managing Director and Executive Assistant by default),
 * so this module is gated by the same mechanism it administers rather than
 * by a role list written here. One consequence worth stating: the company can
 * hand permission administration to a Manager from the screen, without a
 * deploy - and the resolver refuses to let the MD's own control of it be
 * revoked, because there is no way back from that inside the app.
 *
 * WHAT `/me` IS FOR, and why it is open to everyone. The browser has to know
 * what to draw. A doer with no rights to this screen still needs their own
 * effective map, or the sidebar cannot hide the modules they were never given
 * - and it tells them nothing they could not learn by clicking every link in
 * the app and counting the refusals.
 */

const router = Router();
router.use(authenticate);

const levelEnum = z.enum(ACCESS_VALUES);
const grantEnum = z.enum([...ACCESS_VALUES, INHERIT]);
/* Surface keys come from the catalogue, and unknown ones are dropped by the
   service rather than rejected here - see sanitise() for why. The shape check
   is all that is worth doing at the edge. */
const grantMap = (schema) => z.record(z.string().max(120), schema);

/** Everything the Settings screen draws: the registry and the role defaults. */
router.get('/catalog', requireAccess('module:access'), asyncHandler(async (_req, res) => {
  const data = accessService.catalog();
  return ApiResponse.ok(res, data, `${data.surfaces.length} surfaces across ${data.sections.length} sections`);
}));

/**
 * The signed-in person's own effective map. The one endpoint the whole client
 * gates itself from - see client/src/lib/access.js.
 */
router.get('/me', asyncHandler(async (req, res) => {
  const {
    levels, role, jobRoles, hasOverrides,
  } = await accessService.forUser(req.user);
  return ApiResponse.ok(res, {
    role,
    /* The seats themselves ride along so the client can say WHY somebody
       sees what they see - "you are here as Civil Head" - rather than only
       what they can reach. */
    jobRoles: jobRoles ?? [],
    jobRoleTitles: (jobRoles ?? []).map((k) => jobRole(k)?.title).filter(Boolean),
    levels,
    hasOverrides,
  }, 'Effective access');
}));

/** The five role layers, plus everybody who has a personal override. */
router.get('/policy', requireAccess('module:access'), asyncHandler(async (_req, res) => {
  const data = await accessService.policies();
  return ApiResponse.ok(res, data, `${data.people.length} people with their own overrides`);
}));

/**
 * Save one of the company's own roles - Civil Head, Feasibility Expert,
 * Cluster / Branch Manager. Where essentially every decision is made.
 */
router.put(
  '/policy/jobrole/:key',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({
    params: z.object({ key: z.enum(JOB_ROLE_KEYS) }),
    body: z.object({ grants: grantMap(levelEnum) }),
  })),
  asyncHandler(async (req, res) => {
    const data = await accessService.saveJobRole(req.params.key, req.body.grants, req.user);
    return ApiResponse.ok(res, data, `${data.title} access saved`);
  }),
);

/** Put one of the company's roles back to what its security tier grants. */
router.post(
  '/policy/jobrole/:key/reset',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({ params: z.object({ key: z.enum(JOB_ROLE_KEYS) }) })),
  asyncHandler(async (req, res) => {
    const data = await accessService.resetJobRole(req.params.key);
    return ApiResponse.ok(res, data, `${data.title} reset to defaults`);
  }),
);

/** Save one SECURITY TIER's layer. Only reaches accounts holding no seat. */
router.put(
  '/policy/role/:role',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({
    params: z.object({ role: z.enum(ROLE_VALUES) }),
    body: z.object({ grants: grantMap(levelEnum) }),
  })),
  asyncHandler(async (req, res) => {
    const data = await accessService.saveRole(req.params.role, req.body.grants, req.user);
    return ApiResponse.ok(res, data, `${req.params.role} access saved`);
  }),
);

/** Put a role back to the shipped defaults. */
router.post(
  '/policy/role/:role/reset',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({ params: z.object({ role: z.enum(ROLE_VALUES) }) })),
  asyncHandler(async (req, res) => {
    const data = await accessService.resetRole(req.params.role);
    return ApiResponse.ok(res, data, `${req.params.role} reset to defaults`);
  }),
);

/** Save one person's override - the named-doer half of the feature. */
router.put(
  '/policy/user/:userId',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({
    params: z.object({ userId: z.string().length(24) }),
    body: z.object({ grants: grantMap(grantEnum), note: z.string().max(400).optional() }),
  })),
  asyncHandler(async (req, res) => {
    const data = await accessService.saveUser(req.params.userId, req.body.grants, req.user, req.body.note);
    return ApiResponse.ok(res, data, `${data.name}'s access saved`);
  }),
);

/** Drop an override - the person follows their role again. */
router.delete(
  '/policy/user/:userId',
  requireAccess('module:access', ACCESS.MANAGE),
  validate(z.object({ params: z.object({ userId: z.string().length(24) }) })),
  asyncHandler(async (req, res) => {
    const data = await accessService.clearUser(req.params.userId);
    return ApiResponse.ok(res, data, 'Override removed - this person follows their role again');
  }),
);

/**
 * What one person actually sees, and WHY each answer is what it is.
 *
 * The reason column is the difference between a screen somebody trusts and
 * one they second-guess: "Hidden" alone starts an argument about whether it
 * was the role, the person or the module above it.
 */
router.get(
  '/preview/:userId',
  requireAccess('module:access'),
  validate(z.object({ params: z.object({ userId: z.string().length(24) }) })),
  asyncHandler(async (req, res) => {
    const data = await accessService.explain(req.params.userId);
    return ApiResponse.ok(res, data, `What ${data.user.name} can reach`);
  }),
);

/**
 * The people picker on the screen.
 *
 * Its own endpoint rather than the general user directory because it answers
 * a different question: it is searched by name, capped, and it says whether
 * each person already carries an override so the picker can mark them.
 */
router.get(
  '/people',
  requireAccess('module:access'),
  validate(z.object({
    query: z.object({
      search: z.string().max(120).optional(),
      role: z.enum(ROLE_VALUES).optional(),
      jobRole: z.enum(JOB_ROLE_KEYS).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).partial(),
  })),
  asyncHandler(async (req, res) => {
    const {
      search, role, jobRole: seat, limit = 40,
    } = req.validatedQuery ?? {};
    const filter = {};
    if (role) filter.role = role;
    if (seat) filter.jobRoles = seat;
    if (search) {
      const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { title: rx }, { employeeId: rx }];
    }

    const users = await User.find(filter)
      .select('name email role title employeeId avatarColor jobRoles isActive')
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    const { people } = await accessService.policies();
    const overridden = new Set(people.map((p) => String(p.userId)));

    return ApiResponse.ok(
      res,
      users.map((u) => ({
        id: String(u._id),
        name: u.name,
        email: u.email,
        role: u.role,
        jobRoles: u.jobRoles ?? [],
        jobRoleTitles: (u.jobRoles ?? []).map((k) => jobRole(k)?.title).filter(Boolean),
        active: u.isActive !== false,
        title: u.title ?? '',
        employeeId: u.employeeId ?? '',
        avatarColor: u.avatarColor,
        hasOverrides: overridden.has(String(u._id)),
      })),
      `${users.length} people`,
    );
  }),
);

export default router;
