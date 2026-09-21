import { Router } from 'express';
import { z } from 'zod';
import { ersService, SORT_KEYS, PERIODS } from './ers.service.js';
import { invalidateErsCache } from './ers.client.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';

/**
 * Employee Performance — a read-only window onto ERS 2.0.
 *
 * EVERY ROUTE HERE IS A GET, and that is the whole contract of this module.
 * The ERP displays the review service's ratings and rankings; it does not
 * create, edit, approve or delete a single thing there. If somebody later asks
 * for moderation from our side, it is a new decision with its own review — not
 * a POST quietly added to this file.
 *
 * READING IS OPEN TO ANY SIGNED-IN USER. It is the company's own performance
 * board, the same information the outlets already see on the review service's
 * own screens, and gating it would just push people back to that other tab.
 * The one refresh route is manager-and-above because it reaches out to
 * somebody else's production API on demand.
 */

const scope = {
  period: z.enum(PERIODS).optional(),
  brandId: z.coerce.number().int().optional(),
  outletId: z.coerce.number().int().optional(),
  cityId: z.coerce.number().int().optional(),
  stateId: z.coerce.number().int().optional(),
};

const router = Router();
router.use(authenticate);

/** The dashboard: counts, podium, top ten, outlet roll-up, scoring formula. */
router.get('/overview', validate(z.object({ query: z.object(scope).partial() })), asyncHandler(async (req, res) => {
  const data = await ersService.overview(req.query);
  return ApiResponse.ok(res, data, `Performance overview — ${data.counts.employees} employees ranked`);
}));

/** One page of the full leaderboard. */
router.get('/leaderboard', validate(z.object({
  query: z.object({
    ...scope,
    search: z.string().max(120).optional(),
    status: z.enum(['Perfect', 'Good', 'Needs Improvement', 'No reviews']).optional(),
    sort: z.enum(SORT_KEYS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  }).partial(),
})), asyncHandler(async (req, res) => {
  const data = await ersService.leaderboard(req.query);
  return ApiResponse.ok(res, data, `Leaderboard fetched (page ${data.page} of ${data.totalPages})`);
}));

/** One employee: their metrics, their five ranks, their outlet peers. */
router.get('/employees/:id', validate(z.object({
  params: z.object({ id: z.string().min(1).max(24) }),
  query: z.object(scope).partial(),
})), asyncHandler(async (req, res) => {
  const data = await ersService.employee(req.params.id, req.query);
  if (!data) throw ApiError.notFound('That employee is not in the current ranking.');
  return ApiResponse.ok(res, data, data.employee.name);
}));

/** Outlet comparison — the same people grouped by where they work. */
router.get('/outlets', validate(z.object({ query: z.object(scope).partial() })), asyncHandler(async (req, res) => {
  const b = await ersService.board(req.query);
  const outlets = ersService.byOutlet(b.rows);
  return ApiResponse.ok(res, { outlets, period: b.period, lastUpdated: b.lastUpdated }, `${outlets.length} outlets`);
}));

/**
 * Drop the cached upstream response so the next read goes out fresh.
 *
 * Exists because the cache is deliberately a minute long (see ers.client.js)
 * and somebody watching a rating land wants a way to say "no, now". It clears
 * OUR copy and nothing else — there is nothing to write upstream.
 */
router.post('/refresh', asyncHandler(async (_req, res) => {
  invalidateErsCache();
  return ApiResponse.ok(res, { refreshed: true }, 'Pulling fresh figures from the review service');
}));

export default router;
