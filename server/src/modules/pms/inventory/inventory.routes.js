import { Router } from 'express';
import { z } from 'zod';
import { InventoryItem } from './inventoryItem.model.js';
import { InventoryCategory, categoryCode } from './inventoryCategory.model.js';
import {
  inventoryService, SORT_KEYS, VISIBILITIES, DEFAULT_LIMIT, MAX_LIMIT,
} from './inventory.service.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';

/**
 * The inventory master — every SKU the company stocks, and the categories it
 * is filed under.
 *
 * READING is open to any signed-in user: a coordinator raising an indent needs
 * to know the code and the unit, and they are ordinary doers. WRITING is
 * manager-and-above, like every other master in the system — one careless
 * bulk paste here changes what every future order can be placed against.
 *
 * ARCHIVE, NOT DELETE. See the note on `InventoryItem.active`: a SKU is
 * printed on a bin and written onto past paperwork, so the code has to stay
 * readable and reserved. `DELETE /:id` archives; `POST /:id/restore` puts it
 * back. There is no hard delete, deliberately.
 */

const MAX_BULK = 500;

const itemBody = z.object({
  /* Optional on the way in — a blank one is minted server-side, because "what
     code shall I give it?" is a question the system answers better than the
     person unpacking the box. */
  sku: z.string().max(40).optional(),
  name: z.string().min(1).max(240),
  category: z.string().max(160).nullable().optional(),
  visibility: z.enum(VISIBILITIES).optional(),
  unit: z.string().max(60).nullable().optional(),
  vendorName: z.string().max(200).nullable().optional(),
  vendorDetails: z.string().max(200).nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  imageUrl: z.string().max(600).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });

const listQuery = z.object({
  query: z.object({
    search: z.string().max(200).optional(),
    category: z.string().max(160).optional(),
    visibility: z.enum(VISIBILITIES).optional(),
    unit: z.string().max(60).optional(),
    vendor: z.string().max(200).optional(),
    uncategorised: z.coerce.boolean().optional(),
    includeArchived: z.coerce.boolean().optional(),
    sort: z.enum(SORT_KEYS).optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  }).partial(),
});

const bulkSchema = z.object({
  body: z.object({
    items: z.array(itemBody.extend({ name: z.string().max(240) })).min(1).max(MAX_BULK),
  }),
});

const categoryBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(600).nullable().optional(),
  sortOrder: z.number().optional(),
  active: z.boolean().optional(),
});

const router = Router();
const canManage = authorize(...CAN_MANAGE);
router.use(authenticate);

/* ── items ───────────────────────────────────────────────────────────────── */

/**
 * One page of the master.
 *
 * Paginated at the service. The master is 1,322 rows on day one — see the note
 * at the top of inventory.service.js for why none of that filtering happens in
 * the browser.
 */
router.get('/', validate(listQuery), asyncHandler(async (req, res) => {
  const result = await inventoryService.list({
    search: req.query.search,
    category: req.query.category,
    visibility: req.query.visibility,
    unit: req.query.unit,
    vendor: req.query.vendor,
    uncategorised: req.query.uncategorised,
    includeArchived: req.query.includeArchived,
    sort: req.query.sort,
    dir: req.query.dir,
    page: req.query.page,
    limit: req.query.limit || DEFAULT_LIMIT,
  });
  return ApiResponse.ok(res, result, `Inventory fetched (page ${result.page} of ${result.totalPages})`);
}));

/** What the dropdowns offer: categories, units, vendors, visibilities. */
router.get('/meta', asyncHandler(async (_req, res) => (
  ApiResponse.ok(res, await inventoryService.meta(), 'Inventory meta fetched')
)));

/**
 * The current view, as a CSV file.
 *
 * TAKES THE SAME FILTERS AS THE LIST, deliberately — "export" on a filtered
 * table means "give me what I am looking at", and an export that silently
 * hands back all 1,322 rows when the screen shows 80 is worse than none: the
 * person carries it into a meeting believing it is the filtered set.
 *
 * Streamed as a real download rather than JSON the browser assembles, so the
 * whole matching set comes back in one request without the page holding it in
 * memory to convert it.
 */
router.get('/export', validate(listQuery), asyncHandler(async (req, res) => {
  const { rows, filename } = await inventoryService.exportCsv(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  /* A BOM, because Excel on Windows reads a UTF-8 CSV as Latin-1 without one
     and every rupee sign and every name with an accent arrives as mojibake. */
  return res.send(`﻿${rows}`);
}));

router.post('/', canManage, validate(z.object({ body: itemBody })), asyncHandler(async (req, res) => {
  const item = await inventoryService.create(req.body, req.user.id);
  /* A category typed on the form joins the curated list, so the next person
     picks it rather than retyping it slightly differently. */
  await inventoryService.ensureCategories([req.body.category], req.user.id);
  return ApiResponse.created(res, item, `${item.name} added — ${item.sku}`);
}));

/**
 * Add many at once. Partial success by design — see the note on
 * `inventoryService.bulkCreate`.
 */
router.post('/bulk', canManage, validate(bulkSchema), asyncHandler(async (req, res) => {
  const result = await inventoryService.bulkCreate(req.body.items, req.user.id);
  const parts = [`${result.created} item${result.created === 1 ? '' : 's'} added`];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
  if (result.newCategories.length) parts.push(`${result.newCategories.length} new categor${result.newCategories.length === 1 ? 'y' : 'ies'}`);
  return ApiResponse.created(res, result, parts.join(' · '));
}));

router.patch('/:id', canManage, validate(z.object({
  params: z.object({ id: z.string().length(24) }),
  body: itemBody.partial().extend({ active: z.boolean().optional() }),
})), asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Item not found');

  /* Correcting a SKU is allowed — the export has a handful somebody typed by
     hand — but it must not collide with another row's, because the code is the
     identity every re-import and every bin label matches on. */
  if (req.body.sku != null) {
    const sku = String(req.body.sku).trim().toUpperCase();
    if (!sku) throw ApiError.badRequest('An item cannot have a blank SKU.');
    if (await InventoryItem.exists({ sku, _id: { $ne: item._id } })) {
      throw ApiError.badRequest(`${sku} belongs to another item.`, { code: 'SKU_EXISTS' });
    }
    req.body.sku = sku;
  }

  Object.assign(item, req.body, { updatedBy: req.user.id });
  await item.save();
  if (req.body.category) await inventoryService.ensureCategories([req.body.category], req.user.id);
  return ApiResponse.ok(res, item, 'Item updated');
}));

/** Archives it. The code stays reserved and every past document still reads. */
router.delete('/:id', canManage, validate(idParam), asyncHandler(async (req, res) => {
  const item = await InventoryItem.findByIdAndUpdate(
    req.params.id,
    { $set: { active: false, updatedBy: req.user.id } },
    { new: true },
  );
  if (!item) throw ApiError.notFound('Item not found');
  return ApiResponse.ok(res, item, `${item.name} archived — ${item.sku} stays reserved`);
}));

router.post('/:id/restore', canManage, validate(idParam), asyncHandler(async (req, res) => {
  const item = await InventoryItem.findByIdAndUpdate(
    req.params.id,
    { $set: { active: true, updatedBy: req.user.id } },
    { new: true },
  );
  if (!item) throw ApiError.notFound('Item not found');
  return ApiResponse.ok(res, item, `${item.name} is back in the master`);
}));

/* ── categories ──────────────────────────────────────────────────────────── */

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await InventoryCategory.find().sort({ sortOrder: 1, name: 1 }).lean();
  return ApiResponse.ok(res, categories, 'Categories fetched');
}));

/**
 * Add one or several categories in a single call.
 *
 * The array form is what the "add categories" box on the page posts: somebody
 * setting up a section of the master types six names at once, and six requests
 * for six names is six chances for the fourth to fail and leave the list half
 * built.
 */
router.post('/categories', canManage, validate(z.object({
  body: z.union([
    categoryBody,
    z.object({ names: z.array(z.string().min(1).max(160)).min(1).max(100) }),
  ]),
})), asyncHandler(async (req, res) => {
  if (Array.isArray(req.body.names)) {
    const added = await inventoryService.ensureCategories(req.body.names, req.user.id);
    const already = req.body.names.length - added.length;
    return ApiResponse.created(res, { added }, added.length
      ? `${added.length} categor${added.length === 1 ? 'y' : 'ies'} added${already ? `, ${already} already there` : ''}`
      : 'Every one of those was already in the list');
  }

  const code = categoryCode(req.body.name);
  if (await InventoryCategory.findOne({ code })) {
    throw ApiError.badRequest(`"${req.body.name}" is already a category.`, { code: 'CATEGORY_EXISTS' });
  }
  const last = await InventoryCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  const category = await InventoryCategory.create({
    ...req.body,
    code,
    sortOrder: req.body.sortOrder ?? (last?.sortOrder ?? 0) + 10,
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });
  return ApiResponse.created(res, category, `"${category.name}" added`);
}));

/**
 * Edit a category. A changed `name` rewrites every item filed under the old
 * spelling in the same call — see `inventoryService.renameCategory`.
 */
router.patch('/categories/:id', canManage, validate(z.object({
  params: z.object({ id: z.string().length(24) }),
  body: categoryBody.partial(),
})), asyncHandler(async (req, res) => {
  const { name, ...rest } = req.body;

  let itemsUpdated = 0;
  if (name != null) {
    ({ itemsUpdated } = await inventoryService.renameCategory(req.params.id, name, req.user.id));
  }

  const category = await InventoryCategory.findByIdAndUpdate(
    req.params.id,
    { $set: { ...rest, updatedBy: req.user.id } },
    { new: true },
  );
  if (!category) throw ApiError.notFound('Category not found');

  return ApiResponse.ok(res, category, itemsUpdated
    ? `Renamed — ${itemsUpdated} item${itemsUpdated === 1 ? '' : 's'} moved with it`
    : 'Category updated');
}));

/**
 * Archives the category. Items already filed under it keep their spelling and
 * keep reading; it simply stops being offered on the form.
 */
router.delete('/categories/:id', canManage, validate(idParam), asyncHandler(async (req, res) => {
  const category = await InventoryCategory.findByIdAndUpdate(
    req.params.id,
    { $set: { active: false, updatedBy: req.user.id } },
    { new: true },
  );
  if (!category) throw ApiError.notFound('Category not found');
  const inUse = await InventoryItem.countDocuments({ category: category.name, active: { $ne: false } });
  return ApiResponse.ok(res, category, inUse
    ? `"${category.name}" retired — ${inUse} item${inUse === 1 ? '' : 's'} keep it`
    : `"${category.name}" retired`);
}));

export default router;
