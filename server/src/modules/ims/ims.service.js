import mongoose from 'mongoose';
import { customAlphabet } from 'nanoid';
import { InventoryLocation } from './inventoryLocation.model.js';
import { StockLevel } from './stockLevel.model.js';
import { StockMovement, MOVEMENT_SIGN } from './stockMovement.model.js';
import { InventoryItem } from '../pms/inventory/inventoryItem.model.js';
import { ApiError } from '../../core/utils/ApiError.js';

/**
 * The inventory management system's reads and, more importantly, its ONE
 * write path.
 *
 * Every change to every count in this module goes through `move()`. Nothing
 * else assigns `onHand`, anywhere. That is the whole design: the ledger and
 * the balance are written together or not at all, so they cannot drift, and
 * the ledger can rebuild the balance at any time if they somehow do
 * (`recount`). A second place that adjusts a count "just this once" is how a
 * stock system quietly starts lying, and the lie is undetectable from inside.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const STOCK_SORT_KEYS = ['name', 'sku', 'category', 'onHand', 'safetyStock', 'value', 'lastMovementAt'];

/** Sort and match the way a person reads — see the same note in inventory.service.js. */
const COLLATION = { locale: 'en', strength: 2 };

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (v) => (v == null ? '' : String(v).trim());
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Transfer references, in an alphabet a person can read out over a phone.
 *
 * nanoid's default includes `-` and `_`, which survive an `toUpperCase()` and
 * turn "TRF-BBH_BAUOGT" into something nobody can dictate to a driver. I and O
 * are dropped as well, for the same reason no courier uses them: against 1 and
 * 0 they are a transcription error waiting to happen.
 */
const transferId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

/**
 * Where a row sits against its own floor. One function, because this rule is
 * read in five places — the grid's badge, the KPI counts, the low-stock page,
 * the reorder suggestion and the dashboard — and five copies of it is five
 * chances for the page and the alert to disagree about what "low" means.
 *
 *   out      — nothing there at all, and somebody set a floor, so it matters.
 *   critical — at or under half the floor: past warning, into reorder-now.
 *   low      — at or under the floor.
 *   ok       — above it.
 *   unset    — no floor set. NOT "ok": it is "nobody has said what good looks
 *              like here", which is a different thing and worth counting
 *              separately, because that count is the module's own to-do list.
 */
export function stockStatus(onHand, safetyStock) {
  if (!safetyStock || safetyStock <= 0) return onHand > 0 ? 'unset' : 'empty';
  if (onHand <= 0) return 'out';
  if (onHand <= safetyStock / 2) return 'critical';
  if (onHand <= safetyStock) return 'low';
  return 'ok';
}

/* The same rule expressed for Mongo, so the grid can FILTER and SORT by status
   server-side instead of fetching everything and deciding in the browser. It
   has to stay in step with stockStatus() above; they are together in this file
   for exactly that reason. */
const STATUS_EXPR = {
  $switch: {
    branches: [
      { case: { $lte: [{ $ifNull: ['$safetyStock', 0] }, 0] }, then: { $cond: [{ $gt: ['$onHand', 0] }, 'unset', 'empty'] } },
      { case: { $lte: ['$onHand', 0] }, then: 'out' },
      { case: { $lte: ['$onHand', { $divide: ['$safetyStock', 2] }] }, then: 'critical' },
      { case: { $lte: ['$onHand', '$safetyStock'] }, then: 'low' },
    ],
    default: 'ok',
  },
};

/** Sort order for the status badge — worst first, which is the order somebody
    working a stock list actually wants when they sort by it. */
const STATUS_RANK = {
  $switch: {
    branches: [
      { case: { $eq: ['$status', 'out'] }, then: 0 },
      { case: { $eq: ['$status', 'critical'] }, then: 1 },
      { case: { $eq: ['$status', 'low'] }, then: 2 },
      { case: { $eq: ['$status', 'empty'] }, then: 3 },
      { case: { $eq: ['$status', 'unset'] }, then: 4 },
    ],
    default: 5,
  },
};

export const imsService = {
  /* ── locations ─────────────────────────────────────────────────────── */

  async locations({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { active: { $ne: false } };
    const rows = await InventoryLocation.find(filter)
      .sort({ sortOrder: 1, name: 1 })
      .populate('managers', 'name email employeeId')
      .lean();

    /* Each location's own headline, in one grouped pass rather than a query
       per row — a dozen locations is a dozen round trips otherwise, and the
       page that reads this shows all of them at once. */
    const stats = await StockLevel.aggregate([
      { $addFields: { status: STATUS_EXPR } },
      {
        $group: {
          _id: '$location',
          skus: { $sum: 1 },
          units: { $sum: '$onHand' },
          low: { $sum: { $cond: [{ $in: ['$status', ['low', 'critical', 'out']] }, 1, 0] } },
          out: { $sum: { $cond: [{ $eq: ['$status', 'out'] }, 1, 0] } },
        },
      },
    ]);
    const byId = new Map(stats.map((s) => [String(s._id), s]));

    return rows.map((l) => {
      const s = byId.get(String(l._id));
      return {
        ...l,
        skus: s?.skus || 0,
        units: s?.units || 0,
        lowCount: s?.low || 0,
        outCount: s?.out || 0,
      };
    });
  },

  async createLocation(body, userId) {
    const code = clean(body.code).toUpperCase();
    if (await InventoryLocation.findOne({ code })) {
      throw ApiError.badRequest(`${code} is already a location code.`, { code: 'LOCATION_EXISTS' });
    }
    const last = await InventoryLocation.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    return InventoryLocation.create({
      ...body,
      code,
      sortOrder: body.sortOrder ?? (last?.sortOrder ?? 0) + 10,
      createdBy: userId,
      updatedBy: userId,
    });
  },

  /* ── the stock grid ────────────────────────────────────────────────── */

  /**
   * One page of item × location rows, with everything the grid shows.
   *
   * Built as an aggregation rather than a populate, because the page filters
   * and sorts on fields from BOTH sides — the item's name and category, this
   * row's on-hand and status — and a populate can only sort by the side it
   * started on. Doing it in the browser instead would mean shipping every one
   * of the 1,322 rows to show fifty, which is the thing this module is
   * explicitly built not to do.
   */
  async stock(params = {}) {
    const {
      location, item, search, category, status, vendor, onlyLow,
      sort = 'name', dir = 'asc', page = 1, limit = DEFAULT_LIMIT,
    } = params;

    const match = {};
    if (location) match.location = oid(location);
    /* One item across every location — what the master page's drawer asks, so
       "where are the rest of them?" is answered without a second endpoint. */
    if (item) match.item = oid(item);

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'inventoryitems', localField: 'item', foreignField: '_id', as: 'itemDoc',
        },
      },
      { $unwind: '$itemDoc' },
      /* An archived SKU keeps its stock row and its history — the code stays
         reserved — but it has no business in the working grid. */
      { $match: { 'itemDoc.active': { $ne: false } } },
      {
        $lookup: {
          from: 'inventorylocations', localField: 'location', foreignField: '_id', as: 'locationDoc',
        },
      },
      { $unwind: '$locationDoc' },
      {
        $addFields: {
          sku: '$itemDoc.sku',
          name: '$itemDoc.name',
          category: '$itemDoc.category',
          unit: '$itemDoc.unit',
          vendorName: '$itemDoc.vendorName',
          imageUrl: '$itemDoc.imageUrl',
          price: '$itemDoc.price',
          locationName: '$locationDoc.name',
          locationCode: '$locationDoc.code',
          locationType: '$locationDoc.type',
          city: '$locationDoc.city',
          /* Null price × a count is not zero value, it is unknown value. The
             totals below count it as zero because there is nothing else they
             can do, but the row keeps the null so the page can say so. */
          value: { $multiply: ['$onHand', { $ifNull: ['$itemDoc.price', 0] }] },
          status: STATUS_EXPR,
        },
      },
    ];

    const post = {};
    if (clean(search)) {
      const rx = new RegExp(escapeRegex(clean(search)), 'i');
      post.$or = [{ name: rx }, { sku: rx }, { vendorName: rx }, { bin: rx }];
    }
    if (clean(category)) post.category = clean(category);
    if (clean(vendor)) post.vendorName = clean(vendor);
    if (clean(status)) post.status = clean(status);
    /* The one-click "show me what needs ordering" — the three states that mean
       somebody has to do something, as one filter rather than three clicks. */
    if (onlyLow) post.status = { $in: ['out', 'critical', 'low'] };
    if (Object.keys(post).length) pipeline.push({ $match: post });

    pipeline.push({ $addFields: { statusRank: STATUS_RANK } });

    const sortKey = STOCK_SORT_KEYS.includes(sort) ? sort : 'name';
    const sortDir = dir === 'desc' ? -1 : 1;
    /* `_id` breaks every tie — without it Mongo may order equal keys
       differently between two calls, and a row then shows on page 1 and again
       on page 2 while another is never shown at all. */
    const sortSpec = sort === 'status'
      ? { statusRank: sortDir, name: 1, _id: 1 }
      : { [sortKey]: sortDir, _id: 1 };

    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    /* Rows, totals and the status breakdown in ONE trip through the pipeline.
       Three separate calls would each redo the two lookups over the whole
       collection, which is most of the cost of the query. */
    const [faceted] = await StockLevel.aggregate([
      ...pipeline,
      {
        $facet: {
          meta: [{
            $group: {
              _id: null,
              total: { $sum: 1 },
              units: { $sum: '$onHand' },
              value: { $sum: '$value' },
              out: { $sum: { $cond: [{ $eq: ['$status', 'out'] }, 1, 0] } },
              critical: { $sum: { $cond: [{ $eq: ['$status', 'critical'] }, 1, 0] } },
              low: { $sum: { $cond: [{ $eq: ['$status', 'low'] }, 1, 0] } },
              unset: { $sum: { $cond: [{ $eq: ['$status', 'unset'] }, 1, 0] } },
              empty: { $sum: { $cond: [{ $eq: ['$status', 'empty'] }, 1, 0] } },
              ok: { $sum: { $cond: [{ $eq: ['$status', 'ok'] }, 1, 0] } },
            },
          }],
          rows: [
            { $sort: sortSpec },
            { $skip: (Math.max(Number(page) || 1, 1) - 1) * safeLimit },
            { $limit: safeLimit },
            { $project: { itemDoc: 0, locationDoc: 0 } },
          ],
        },
      },
    ]).collation(COLLATION);

    const m = faceted?.meta?.[0] || {};
    const total = m.total || 0;
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);

    /* The page asked for may not exist once a filter narrows the result; rather
       than answer with an empty table, re-run the window at the last real page. */
    let rows = faceted?.rows || [];
    if (safePage !== (Number(page) || 1)) {
      rows = await StockLevel.aggregate([
        ...pipeline,
        { $sort: sortSpec },
        { $skip: (safePage - 1) * safeLimit },
        { $limit: safeLimit },
        { $project: { itemDoc: 0, locationDoc: 0 } },
      ]).collation(COLLATION);
    }

    return {
      rows,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      counts: {
        skus: total,
        units: m.units || 0,
        value: m.value || 0,
        out: m.out || 0,
        critical: m.critical || 0,
        low: m.low || 0,
        unset: m.unset || 0,
        empty: m.empty || 0,
        ok: m.ok || 0,
        needsAction: (m.out || 0) + (m.critical || 0) + (m.low || 0),
      },
    };
  },

  /* ── the one write path ────────────────────────────────────────────── */

  /**
   * Apply one movement: append the ledger row and move the balance with it.
   *
   * @param {object} m
   * @param {string} m.item       item id
   * @param {string} m.location   location id
   * @param {'in'|'out'|'adjust'|'transfer_in'|'transfer_out'} m.type
   * @param {number} m.qty        always positive; `type` carries the direction
   * @param {number} [m.countedQty] for `adjust` — what was actually on the shelf
   * @param {string} userId
   *
   * REFUSES AN ISSUE IT CANNOT COVER, naming what is actually there. Letting a
   * count go negative would turn one bad entry into a number that every later
   * reading quietly inherits, and the person who could have spotted it is the
   * one being told "done" right now.
   *
   * The stock row is created on first touch (`upsert`), so an item that has
   * never been at this location before does not have to be "added" in a
   * separate step before it can be received.
   */
  async move(m, userId, { session } = {}) {
    const type = m.type;
    if (!MOVEMENT_SIGN[type] && MOVEMENT_SIGN[type] !== 0) {
      throw ApiError.badRequest(`"${type}" is not a kind of movement.`);
    }

    const [item, location] = await Promise.all([
      InventoryItem.findById(m.item).select('sku name price unit active').lean(),
      InventoryLocation.findById(m.location).select('name code active').lean(),
    ]);
    if (!item) throw ApiError.notFound('That item is not in the master.');
    if (!location) throw ApiError.notFound('That location does not exist.');
    if (location.active === false) {
      throw ApiError.badRequest(`${location.name} is closed — reopen it before moving stock through it.`, { code: 'LOCATION_CLOSED' });
    }

    const opts = session ? { session } : {};
    const level = await StockLevel.findOneAndUpdate(
      { item: item._id, location: location._id },
      { $setOnInsert: { item: item._id, location: location._id, onHand: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, ...opts },
    );

    const before = level.onHand || 0;

    /* An `adjust` is stated as "the shelf actually holds N", not as a delta.
       Asking somebody counting a shelf to work out the difference themselves
       is asking them to make the arithmetic mistake the count exists to catch. */
    let delta;
    let qty;
    if (type === 'adjust') {
      const counted = Number(m.countedQty);
      if (!Number.isFinite(counted) || counted < 0) {
        throw ApiError.badRequest('A stock count needs the number actually on the shelf.');
      }
      delta = counted - before;
      qty = Math.abs(delta);
    } else {
      qty = Number(m.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw ApiError.badRequest('The quantity must be more than zero.');
      delta = MOVEMENT_SIGN[type] * qty;
    }

    const after = before + delta;
    if (after < 0) {
      throw ApiError.badRequest(
        `${location.name} has only ${before} × ${item.name} — you cannot issue ${qty}.`,
        { code: 'INSUFFICIENT_STOCK', details: { onHand: before, requested: qty, sku: item.sku } },
      );
    }

    /* Nothing happened, so nothing is recorded. A stocktake that confirms the
       count is a real event, but writing a zero-delta row for it would bury
       the movements that DID change something under rows that did not. */
    if (delta === 0 && type !== 'adjust') return { level, movement: null };

    const at = m.at ? new Date(m.at) : new Date();

    const [movement] = await StockMovement.create([{
      item: item._id,
      location: location._id,
      type,
      reason: clean(m.reason),
      qty,
      delta,
      balanceBefore: before,
      balanceAfter: after,
      unitPrice: item.price ?? null,
      counterparty: m.counterparty || null,
      transferRef: m.transferRef || null,
      reference: clean(m.reference),
      note: clean(m.note),
      by: userId,
      at,
    }], opts);

    level.onHand = after;
    level.lastMovementAt = at;
    if (type === 'adjust') level.lastCountedAt = at;
    level.updatedBy = userId;
    await level.save(opts);

    return { level, movement, item, location };
  },

  /**
   * Several movements as one action — what both drawers actually post.
   *
   * ALL OR NOTHING where the deployment can do it. Somebody issuing eleven
   * things to a build means one event; leaving four of them applied because
   * the fifth was short gives a count nobody can reconcile against the paper.
   * A transaction needs a replica set, which Atlas gives us; where it is not
   * available (a standalone dev mongod) this falls back to applying in order
   * and reporting exactly where it stopped, which is worse but honest.
   */
  async moveMany(lines, userId) {
    const session = await mongoose.startSession();
    try {
      let results;
      await session.withTransaction(async () => {
        results = [];
        for (const line of lines) {
          // eslint-disable-next-line no-await-in-loop
          results.push(await this.move(line, userId, { session }));
        }
      });
      return { applied: results.filter((r) => r.movement).length, results };
    } catch (err) {
      /* Not a replica set — no transactions available. Say so rather than
         failing the whole action for a reason nobody can act on. */
      if (err?.code === 20 || /Transaction numbers|replica set|sessions are not supported/i.test(err?.message || '')) {
        const results = [];
        for (const line of lines) {
          // eslint-disable-next-line no-await-in-loop
          results.push(await this.move(line, userId));
        }
        return { applied: results.filter((r) => r.movement).length, results, atomic: false };
      }
      throw err;
    } finally {
      await session.endSession();
    }
  },

  /**
   * Move stock between two locations, as one action.
   *
   * Written as a PAIR of rows sharing a `transferRef` — see the note on the
   * movement model for why one row would leave the receiving location's own
   * history with a hole in it. The out leg goes first, so a transfer the
   * sender cannot cover fails before anything is credited anywhere.
   */
  async transfer({ from, to, lines, reference, note, at }, userId) {
    if (String(from) === String(to)) throw ApiError.badRequest('A transfer needs two different locations.');
    const transferRef = `TRF-${transferId()}`;

    const legs = [];
    for (const line of lines) {
      legs.push({
        item: line.item, location: from, type: 'transfer_out', qty: line.qty,
        reason: 'transfer', counterparty: to, transferRef, reference, note, at,
      });
      legs.push({
        item: line.item, location: to, type: 'transfer_in', qty: line.qty,
        reason: 'transfer', counterparty: from, transferRef, reference, note, at,
      });
    }

    const res = await this.moveMany(legs, userId);
    return { ...res, transferRef };
  },

  /** Set the floor and the reorder quantity. Not a movement — it changes what
      "enough" means, not how much there is, and conflating the two would put
      policy changes in the ledger where receipts belong. */
  async setSafety({ item, location, safetyStock, reorderQty, bin, notes }, userId) {
    const level = await StockLevel.findOneAndUpdate(
      { item: oid(item), location: oid(location) },
      {
        $set: {
          ...(safetyStock != null ? { safetyStock: Math.max(0, Number(safetyStock)) } : {}),
          ...(reorderQty != null ? { reorderQty: Math.max(0, Number(reorderQty)) } : {}),
          ...(bin != null ? { bin: clean(bin) } : {}),
          ...(notes != null ? { notes: clean(notes) } : {}),
          updatedBy: userId,
        },
        $setOnInsert: { item: oid(item), location: oid(location), onHand: 0 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return level;
  },

  /* ── reads over the ledger ─────────────────────────────────────────── */

  async movements(params = {}) {
    const {
      location, item, type, search, from, to, page = 1, limit = DEFAULT_LIMIT,
    } = params;

    const match = {};
    if (location) match.location = oid(location);
    if (item) match.item = oid(item);
    if (type) match.type = type;
    if (from || to) {
      match.at = {};
      if (from) match.at.$gte = new Date(from);
      if (to) match.at.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const pipeline = [
      { $match: match },
      { $sort: { at: -1, _id: -1 } },
      { $lookup: { from: 'inventoryitems', localField: 'item', foreignField: '_id', as: 'itemDoc' } },
      { $unwind: '$itemDoc' },
      { $lookup: { from: 'inventorylocations', localField: 'location', foreignField: '_id', as: 'locationDoc' } },
      { $unwind: '$locationDoc' },
      { $lookup: { from: 'users', localField: 'by', foreignField: '_id', as: 'byDoc' } },
      {
        $addFields: {
          sku: '$itemDoc.sku',
          name: '$itemDoc.name',
          unit: '$itemDoc.unit',
          category: '$itemDoc.category',
          locationName: '$locationDoc.name',
          locationCode: '$locationDoc.code',
          byName: { $ifNull: [{ $arrayElemAt: ['$byDoc.name', 0] }, 'System'] },
        },
      },
    ];

    if (clean(search)) {
      const rx = new RegExp(escapeRegex(clean(search)), 'i');
      pipeline.push({ $match: { $or: [{ name: rx }, { sku: rx }, { reference: rx }, { note: rx }] } });
    }

    const [faceted] = await StockMovement.aggregate([
      ...pipeline,
      {
        $facet: {
          meta: [{
            $group: {
              _id: null,
              total: { $sum: 1 },
              inUnits: { $sum: { $cond: [{ $gt: ['$delta', 0] }, '$delta', 0] } },
              outUnits: { $sum: { $cond: [{ $lt: ['$delta', 0] }, { $abs: '$delta' }, 0] } },
            },
          }],
          rows: [
            { $skip: (Math.max(Number(page) || 1, 1) - 1) * safeLimit },
            { $limit: safeLimit },
            { $project: { itemDoc: 0, locationDoc: 0, byDoc: 0 } },
          ],
        },
      },
    ]).collation(COLLATION);

    const m = faceted?.meta?.[0] || {};
    const total = m.total || 0;
    return {
      rows: faceted?.rows || [],
      page: Math.max(Number(page) || 1, 1),
      limit: safeLimit,
      total,
      totalPages: Math.max(Math.ceil(total / safeLimit), 1),
      counts: { total, inUnits: m.inUnits || 0, outUnits: m.outUnits || 0 },
    };
  },

  /** One item's whole story at one location — the drill-down behind a row. */
  async itemHistory(itemId, locationId, limit = 50) {
    return StockMovement.find({
      item: oid(itemId),
      ...(locationId ? { location: oid(locationId) } : {}),
    })
      .sort({ at: -1, _id: -1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .populate('by', 'name')
      .populate('location', 'name code')
      .populate('counterparty', 'name code')
      .lean();
  },

  /**
   * The module's front page: what needs doing, and where.
   *
   * Deliberately NOT "total stock value" as the headline. The figure somebody
   * opens this module for is what is about to run out, and a large number at
   * the top that never changes teaches people to stop looking at the top.
   */
  async overview({ location } = {}) {
    const match = location ? { location: oid(location) } : {};

    const [totals] = await StockLevel.aggregate([
      { $match: match },
      { $lookup: { from: 'inventoryitems', localField: 'item', foreignField: '_id', as: 'i' } },
      { $unwind: '$i' },
      { $match: { 'i.active': { $ne: false } } },
      { $addFields: { status: STATUS_EXPR, value: { $multiply: ['$onHand', { $ifNull: ['$i.price', 0] }] } } },
      {
        $group: {
          _id: null,
          skus: { $sum: 1 },
          units: { $sum: '$onHand' },
          value: { $sum: '$value' },
          out: { $sum: { $cond: [{ $eq: ['$status', 'out'] }, 1, 0] } },
          critical: { $sum: { $cond: [{ $eq: ['$status', 'critical'] }, 1, 0] } },
          low: { $sum: { $cond: [{ $eq: ['$status', 'low'] }, 1, 0] } },
          unset: { $sum: { $cond: [{ $eq: ['$status', 'unset'] }, 1, 0] } },
          priced: { $sum: { $cond: [{ $gt: [{ $ifNull: ['$i.price', 0] }, 0] }, 1, 0] } },
        },
      },
    ]);

    const lowRows = await StockLevel.aggregate([
      { $match: match },
      { $lookup: { from: 'inventoryitems', localField: 'item', foreignField: '_id', as: 'i' } },
      { $unwind: '$i' },
      { $match: { 'i.active': { $ne: false } } },
      { $lookup: { from: 'inventorylocations', localField: 'location', foreignField: '_id', as: 'l' } },
      { $unwind: '$l' },
      { $addFields: { status: STATUS_EXPR } },
      { $match: { status: { $in: ['out', 'critical', 'low'] } } },
      { $addFields: { statusRank: STATUS_RANK, shortBy: { $subtract: ['$safetyStock', '$onHand'] } } },
      { $sort: { statusRank: 1, shortBy: -1 } },
      { $limit: 12 },
      {
        $project: {
          onHand: 1,
          safetyStock: 1,
          reorderQty: 1,
          status: 1,
          shortBy: 1,
          sku: '$i.sku',
          name: '$i.name',
          unit: '$i.unit',
          vendorName: '$i.vendorName',
          imageUrl: '$i.imageUrl',
          item: '$i._id',
          location: '$l._id',
          locationName: '$l.name',
          locationCode: '$l.code',
        },
      },
    ]);

    const recent = await this.movements({ ...(location ? { location } : {}), limit: 8 });
    const locations = await this.locations();

    const t = totals || {};
    return {
      counts: {
        skus: t.skus || 0,
        units: t.units || 0,
        value: t.value || 0,
        out: t.out || 0,
        critical: t.critical || 0,
        low: t.low || 0,
        unset: t.unset || 0,
        priced: t.priced || 0,
        needsAction: (t.out || 0) + (t.critical || 0) + (t.low || 0),
        locations: locations.length,
      },
      lowStock: lowRows,
      recent: recent.rows,
      locations,
    };
  },

  /**
   * Rebuild a cached balance from the ledger.
   *
   * The safety net that makes storing `onHand` defensible at all. It is not on
   * a schedule and not on a route anybody visits casually — it exists so that
   * "the count looks wrong" has an answer other than typing a new one in.
   */
  async recount({ location, item } = {}) {
    const match = {};
    if (location) match.location = oid(location);
    if (item) match.item = oid(item);

    const sums = await StockMovement.aggregate([
      { $match: match },
      { $group: { _id: { item: '$item', location: '$location' }, onHand: { $sum: '$delta' }, last: { $max: '$at' } } },
    ]);

    let fixed = 0;
    const drift = [];
    for (const s of sums) {
      // eslint-disable-next-line no-await-in-loop
      const level = await StockLevel.findOne({ item: s._id.item, location: s._id.location });
      if (!level) continue;
      if (level.onHand !== s.onHand) {
        drift.push({ item: String(s._id.item), location: String(s._id.location), was: level.onHand, is: s.onHand });
        level.onHand = Math.max(0, s.onHand);
        level.lastMovementAt = s.last;
        // eslint-disable-next-line no-await-in-loop
        await level.save();
        fixed += 1;
      }
    }
    return { checked: sums.length, fixed, drift };
  },
};

export default imsService;
