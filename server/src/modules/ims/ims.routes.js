import { Router } from 'express';
import { z } from 'zod';
import { imsService, STOCK_SORT_KEYS, DEFAULT_LIMIT, MAX_LIMIT } from './ims.service.js';
import { InventoryLocation } from './inventoryLocation.model.js';
import { StockLevel } from './stockLevel.model.js';
import { MOVEMENT_TYPES, MOVEMENT_REASONS } from './stockMovement.model.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { requireModule, requireStep } from '../../core/middleware/access.js';
import { ACCESS } from '../../core/constants/access.js';
import { CAN_MANAGE } from '../../core/constants/index.js';

/**
 * The inventory management system — stock, movements and the places stock sits.
 *
 * WHO MAY DO WHAT, and why it is drawn here rather than at the master next
 * door. Reading is open to any signed-in user, like every other read in the
 * app. MOVING STOCK IS OPEN TO ANY SIGNED-IN USER TOO, which is deliberately
 * looser than the item master: the person who takes six bulbs off a shelf at
 * eleven at night is a technician, not a manager, and a system that will not
 * let them record it is a system that gets a WhatsApp message instead and a
 * count nobody can trust. Every movement carries who did it and is
 * append-only, so the control is the audit trail, not a gate.
 *
 * WHAT IS STILL MANAGER-AND-ABOVE: creating or closing a LOCATION, and
 * setting SAFETY STOCK. Both are policy rather than fact — they change what
 * the system asks of everybody else — and neither is urgent at eleven at
 * night.
 */

const id = z.string().length(24);
const idParam = z.object({ params: z.object({ id }) });

const router = Router();
const canManage = authorize(...CAN_MANAGE);
router.use(authenticate);
/* The IMS module grant gates the whole count. The per-route authorize()
   checks below stay exactly as they were: they state what the SOFTWARE
   requires, while this states what the company decided. */
router.use(requireModule('ims'));

/* ── meta ────────────────────────────────────────────────────────────── */

/** The movement types and their reasons — served so the drawers cannot drift. */
router.get('/meta', asyncHandler(async (_req, res) => (
  ApiResponse.ok(res, { types: MOVEMENT_TYPES, reasons: MOVEMENT_REASONS }, 'IMS meta fetched')
)));

/* ── locations ───────────────────────────────────────────────────────── */

const locationBody = z.object({
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(20),
  type: z.enum(['warehouse', 'outlet', 'franchise']).optional(),
  city: z.string().max(120).nullable().optional(),
  address: z.string().max(400).nullable().optional(),
  managers: z.array(id).max(20).optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional(),
});

router.get('/locations', requireStep('ims-locations'), validate(z.object({
  query: z.object({ includeInactive: z.coerce.boolean().optional() }).partial(),
})), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await imsService.locations({ includeInactive: req.query.includeInactive }), 'Locations fetched')
)));

router.post('/locations', canManage, requireStep('ims-locations', ACCESS.MANAGE), validate(z.object({ body: locationBody })), asyncHandler(async (req, res) => {
  const location = await imsService.createLocation(req.body, req.user.id);
  return ApiResponse.created(res, location, `${location.name} added`);
}));

router.patch('/locations/:id', canManage, requireStep('ims-locations', ACCESS.MANAGE), validate(z.object({
  params: z.object({ id }), body: locationBody.partial(),
})), asyncHandler(async (req, res) => {
  if (req.body.code) {
    const code = String(req.body.code).toUpperCase();
    if (await InventoryLocation.exists({ code, _id: { $ne: req.params.id } })) {
      throw ApiError.badRequest(`${code} belongs to another location.`, { code: 'LOCATION_EXISTS' });
    }
    req.body.code = code;
  }
  const location = await InventoryLocation.findByIdAndUpdate(
    req.params.id,
    { $set: { ...req.body, updatedBy: req.user.id } },
    { new: true },
  );
  if (!location) throw ApiError.notFound('Location not found');
  return ApiResponse.ok(res, location, 'Location updated');
}));

/**
 * Closes it. Never deletes — a centre that shut last year still has to answer
 * "what did we send it", and its stock rows and ledger are that answer.
 */
router.delete('/locations/:id', canManage, requireStep('ims-locations', ACCESS.MANAGE), validate(idParam), asyncHandler(async (req, res) => {
  const location = await InventoryLocation.findByIdAndUpdate(
    req.params.id,
    { $set: { active: false, updatedBy: req.user.id } },
    { new: true },
  );
  if (!location) throw ApiError.notFound('Location not found');
  const held = await StockLevel.countDocuments({ location: location._id, onHand: { $gt: 0 } });
  return ApiResponse.ok(res, location, held
    ? `${location.name} closed — it still holds ${held} item${held === 1 ? '' : 's'}, which stay on its books`
    : `${location.name} closed`);
}));

/* ── the stock grid ──────────────────────────────────────────────────── */

router.get('/stock', requireStep('ims-stock'), validate(z.object({
  query: z.object({
    location: id.optional(),
    item: id.optional(),
    search: z.string().max(200).optional(),
    category: z.string().max(160).optional(),
    vendor: z.string().max(200).optional(),
    status: z.enum(['out', 'critical', 'low', 'ok', 'unset', 'empty']).optional(),
    onlyLow: z.coerce.boolean().optional(),
    sort: z.enum([...STOCK_SORT_KEYS, 'status']).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  }).partial(),
})), asyncHandler(async (req, res) => {
  const result = await imsService.stock({ ...req.query, limit: req.query.limit || DEFAULT_LIMIT });
  return ApiResponse.ok(res, result, `Stock fetched (page ${result.page} of ${result.totalPages})`);
}));

router.get('/overview', requireStep('ims-overview'), validate(z.object({
  query: z.object({ location: id.optional() }).partial(),
})), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await imsService.overview({ location: req.query.location }), 'Overview fetched')
)));

/* ── movements: the one write path ───────────────────────────────────── */

const line = z.object({
  item: id,
  qty: z.number().positive().max(1_000_000).optional(),
  countedQty: z.number().min(0).max(1_000_000).optional(),
  reason: z.string().max(60).optional(),
  note: z.string().max(1000).optional(),
});

const movePayload = z.object({
  body: z.object({
    location: id,
    type: z.enum(['in', 'out', 'adjust']),
    reference: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
    at: z.string().optional(),
    lines: z.array(line).min(1).max(200),
  }),
});

/**
 * Receive, issue or count — whichever the drawer was. One endpoint for all
 * three because they are the same operation with a different sign, and three
 * near-identical routes is three places for the balance rule to be written
 * slightly differently.
 */
router.post('/movements', requireStep('ims-movements', ACCESS.EDIT), validate(movePayload), asyncHandler(async (req, res) => {
  const { location, type, reference, note, at, lines } = req.body;
  const result = await imsService.moveMany(
    lines.map((l) => ({
      ...l,
      location,
      type,
      reference,
      note: l.note || note,
      at,
    })),
    req.user.id,
  );

  const verb = type === 'in' ? 'received' : type === 'out' ? 'issued' : 'counted';
  return ApiResponse.created(res, result, `${result.applied} line${result.applied === 1 ? '' : 's'} ${verb}`);
}));

router.post('/transfers', requireStep('ims-movements', ACCESS.EDIT), validate(z.object({
  body: z.object({
    from: id,
    to: id,
    reference: z.string().max(120).optional(),
    note: z.string().max(1000).optional(),
    at: z.string().optional(),
    lines: z.array(z.object({ item: id, qty: z.number().positive().max(1_000_000) })).min(1).max(200),
  }),
})), asyncHandler(async (req, res) => {
  const result = await imsService.transfer(req.body, req.user.id);
  return ApiResponse.created(res, result, `Transfer ${result.transferRef} — ${result.applied / 2} line(s) moved`);
}));

router.get('/movements', requireStep('ims-movements'), validate(z.object({
  query: z.object({
    location: id.optional(),
    item: id.optional(),
    type: z.enum(MOVEMENT_TYPES).optional(),
    search: z.string().max(200).optional(),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  }).partial(),
})), asyncHandler(async (req, res) => {
  const result = await imsService.movements(req.query);
  return ApiResponse.ok(res, result, `Movements fetched (page ${result.page} of ${result.totalPages})`);
}));

router.get('/history/:itemId', requireStep('ims-movements'), validate(z.object({
  params: z.object({ itemId: id }),
  query: z.object({ location: id.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).partial(),
})), asyncHandler(async (req, res) => (
  ApiResponse.ok(
    res,
    await imsService.itemHistory(req.params.itemId, req.query.location, req.query.limit),
    'History fetched',
  )
)));

/* ── safety stock: policy, not fact ──────────────────────────────────── */

/**
 * Manager-and-above, unlike the movements above. This changes what the system
 * asks of everybody else — the low-stock list, the reorder suggestion and the
 * dashboard's headline all read it — so it is a different kind of decision
 * from recording what came off a shelf.
 */
router.patch('/safety', canManage, validate(z.object({
  body: z.object({
    item: id,
    location: id,
    safetyStock: z.number().min(0).max(1_000_000).optional(),
    reorderQty: z.number().min(0).max(1_000_000).optional(),
    bin: z.string().max(80).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
  }),
})), asyncHandler(async (req, res) => {
  const level = await imsService.setSafety(req.body, req.user.id);
  return ApiResponse.ok(res, level, `Safety level set to ${level.safetyStock}`);
}));

/**
 * Set the same floor across many rows at once.
 *
 * The bulk form of the above, and the one people actually use: a location
 * opens and somebody sets a sensible floor on forty consumables in one go.
 */
router.patch('/safety/bulk', canManage, validate(z.object({
  body: z.object({
    location: id,
    items: z.array(id).min(1).max(500),
    safetyStock: z.number().min(0).max(1_000_000).optional(),
    reorderQty: z.number().min(0).max(1_000_000).optional(),
  }),
})), asyncHandler(async (req, res) => {
  const { location, items, safetyStock, reorderQty } = req.body;
  let updated = 0;
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await imsService.setSafety({ item, location, safetyStock, reorderQty }, req.user.id);
    updated += 1;
  }
  return ApiResponse.ok(res, { updated }, `Safety level set on ${updated} item${updated === 1 ? '' : 's'}`);
}));

/**
 * Rebuild cached balances from the ledger. Manager-and-above, and not linked
 * from anywhere casual — it exists so "the count looks wrong" has an answer
 * other than typing a new number in. See imsService.recount.
 */
router.post('/recount', canManage, validate(z.object({
  body: z.object({ location: id.optional(), item: id.optional() }).partial(),
})), asyncHandler(async (req, res) => {
  const result = await imsService.recount(req.body);
  return ApiResponse.ok(res, result, result.fixed
    ? `${result.fixed} of ${result.checked} balances corrected from the ledger`
    : `All ${result.checked} balances agree with the ledger`);
}));

export default router;
