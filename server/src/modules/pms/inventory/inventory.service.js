import { InventoryItem, uniqueSku } from './inventoryItem.model.js';
import { InventoryCategory, categoryCode } from './inventoryCategory.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * The inventory master's reads and its one bulk write.
 *
 * PAGINATED, SORTED AND FILTERED AT THE DATABASE, not in the browser. The
 * migrated master is 1,322 rows on day one and only grows; shipping all of it
 * so the page can show twenty-five is the transfer and the render both spent
 * on work nobody sees, and it gets slower every month. The counts ride along
 * in the same response so the strip above the table stays correct on every
 * page without a second round trip.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Columns the table may sort by. An open sort key is an index scan waiting to happen. */
export const SORT_KEYS = ['name', 'sku', 'category', 'unit', 'vendorName', 'visibility', 'price', 'createdAt', 'updatedAt'];

export const VISIBILITIES = ['Listed', 'Unlisted'];

/**
 * Sort and match the way a person reads, not the way bytes compare.
 *
 * Mongo's default ordering is binary, which puts every capitalised name before
 * every lower-case one: the migrated master holds "Wireless Clock Sensor" and
 * "laser gun sensor chellenge room" side by side, and sorted by bytes the
 * second lands after ALL of the first's neighbours rather than under L. On an
 * alphabetical list of 1,322 items that reads as a bug, because it is one.
 *
 * Strength 2 is case-insensitive but accent-sensitive — the conventional
 * choice for English, and it also makes the category and vendor filters match
 * regardless of how the value was capitalised when it was typed.
 *
 * THE COST, stated plainly: a collated sort cannot use an index built without
 * the same collation, so this sorts in memory. At a few thousand documents
 * that is microseconds and well inside Mongo's 32MB sort budget. If this
 * master ever reaches the hundreds of thousands, the fix is a collated index
 * on { name: 1 }, not reverting to byte order.
 */
const COLLATION = { locale: 'en', strength: 2 };

/** Anchored, case-insensitive, and with the user's own regex characters defanged. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clean = (v) => (v == null ? '' : String(v).trim());

/** Far above what this master holds — a guard against a pathological request,
    not a limit anybody legitimately meets. */
const EXPORT_CAP = 50_000;

/**
 * One CSV cell.
 *
 * Quoted whenever it contains a comma, a quote or a newline, with inner quotes
 * doubled — RFC 4180, and the reason a vendor called "Sharma, Bros" does not
 * shunt every later column one place left.
 *
 * The leading apostrophe on a cell starting with = + - @ is NOT cosmetic: those
 * are how a spreadsheet is told a cell is a formula, and a CSV built from
 * user-typed names is exactly the path a malicious one travels. An item called
 * `=cmd|...` would otherwise execute when somebody opens the export.
 */
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The filter every read of the master goes through.
 *
 * `search` deliberately matches the name, the SKU and the vendor in one box
 * rather than offering three. Somebody looking for a thing types what they
 * know about it — half a name, a code off a bin, or the shop it came from —
 * and should not first have to say which of the three they typed.
 */
function buildFilter({
  search, category, visibility, unit, vendor, uncategorised, includeArchived,
}) {
  const filter = {};
  if (!includeArchived) filter.active = { $ne: false };

  const q = clean(search);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { vendorName: rx }, { category: rx }];
  }

  /* An exact match, not a prefix: the value came from the dropdown, which was
     built from the data, so "Electronics" must not also drag in the 15 rows
     filed as "Electronics , Game Elements" — those are their own bucket and
     the person filtering can pick it. */
  if (clean(category)) filter.category = clean(category);
  if (clean(visibility)) filter.visibility = clean(visibility);
  if (clean(unit)) filter.unit = clean(unit);
  if (clean(vendor)) filter.vendorName = clean(vendor);

  /* The one question a spreadsheet cannot answer about itself, and the one
     that keeps a master trustworthy: which rows nobody has filed yet. 51 rows
     arrived that way from the export. */
  if (uncategorised) filter.category = { $in: ['', null] };

  return filter;
}

export const inventoryService = {
  /**
   * One page of the master, plus the totals the strip above it shows.
   *
   * The counts are computed over the SAME filter as the rows, minus the
   * paging — so "412 items · 88 listed" describes what is being looked at
   * rather than the whole collection, which is the only reading that makes
   * sense when a filter is on.
   */
  async list(params = {}) {
    const {
      search, category, visibility, unit, vendor, uncategorised, includeArchived,
      sort = 'name', dir = 'asc', page = 1, limit = DEFAULT_LIMIT,
    } = params;

    const filter = buildFilter({
      search, category, visibility, unit, vendor, uncategorised, includeArchived,
    });

    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const sortKey = SORT_KEYS.includes(sort) ? sort : 'name';
    const sortDir = dir === 'desc' ? -1 : 1;
    /* `_id` breaks every tie. Without it Mongo is free to order equal keys
       differently between two calls, and the same row then appears on page 1
       and again on page 2 while another is never shown at all. */
    const sortSpec = { [sortKey]: sortDir, _id: 1 };

    const total = await InventoryItem.countDocuments(filter).collation(COLLATION);
    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);

    const rows = await InventoryItem.find(filter)
      .collation(COLLATION)
      .sort(sortSpec)
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean();

    const counts = await this.counts(filter);

    return { rows, page: safePage, limit: safeLimit, total, totalPages, counts };
  },

  /** The four figures above the table, over whatever is currently filtered. */
  async counts(filter = { active: { $ne: false } }) {
    const [agg] = await InventoryItem.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          items: { $sum: 1 },
          listed: { $sum: { $cond: [{ $eq: ['$visibility', 'Listed'] }, 1, 0] } },
          archived: { $sum: { $cond: [{ $eq: ['$active', false] }, 1, 0] } },
          uncategorised: { $sum: { $cond: [{ $in: ['$category', ['', null]] }, 1, 0] } },
          categories: { $addToSet: '$category' },
          vendors: { $addToSet: '$vendorName' },
        },
      },
    ]).collation(COLLATION);

    if (!agg) return { items: 0, listed: 0, unlisted: 0, archived: 0, uncategorised: 0, categories: 0, vendors: 0 };
    const real = (set) => set.filter((v) => clean(v)).length;
    return {
      items: agg.items,
      listed: agg.listed,
      unlisted: agg.items - agg.listed,
      archived: agg.archived,
      uncategorised: agg.uncategorised,
      categories: real(agg.categories),
      vendors: real(agg.vendors),
    };
  },

  /**
   * Everything the page's dropdowns and the Add form's suggestions need.
   *
   * Categories are the UNION of the curated master and the spellings actually
   * present on items, each tagged with where it came from. Offering only the
   * curated list would hide the four compound spellings the export brought in
   * offering only the derived list would hide a category set up for items that
   * have not been added yet — so the page shows both and says which is which.
   */
  async meta() {
    const [curated, used, units, vendors] = await Promise.all([
      InventoryCategory.find({ active: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).lean(),
      InventoryItem.aggregate([
        { $match: { active: { $ne: false }, category: { $nin: ['', null] } } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      InventoryItem.distinct('unit', { active: { $ne: false }, unit: { $nin: ['', null] } }),
      InventoryItem.distinct('vendorName', { active: { $ne: false }, vendorName: { $nin: ['', null] } }),
    ]);

    const countByName = new Map(used.map((u) => [u._id, u.count]));
    const categories = curated.map((c) => ({
      _id: String(c._id),
      name: c.name,
      code: c.code,
      description: c.description || '',
      sortOrder: c.sortOrder,
      count: countByName.get(c.name) || 0,
      curated: true,
    }));

    /* A spelling on an item that no curated category matches. Shown so it can
       be filtered on and, more usefully, adopted into the master with one
       click rather than retyped. */
    const known = new Set(curated.map((c) => c.name));
    for (const u of used) {
      if (!known.has(u._id)) {
        categories.push({ _id: null, name: u._id, code: categoryCode(u._id), description: '', sortOrder: 9999, count: u.count, curated: false });
      }
    }

    const byName = (a, b) => a.localeCompare(b);
    return {
      categories,
      units: units.map(clean).filter(Boolean).sort(byName),
      vendors: vendors.map(clean).filter(Boolean).sort(byName),
      visibilities: VISIBILITIES,
    };
  },

  /**
   * The current view as CSV text, plus a filename that says what it holds.
   *
   * NOT PAGED — an export is the one read that genuinely wants everything
   * matching, which is what makes it different from the grid beside it. It is
   * capped all the same: a request that would serialise a hundred thousand
   * rows into one string is a memory spike with no legitimate caller, and the
   * cap is far above the 1,322 this master actually holds.
   *
   * The column order is the Add form's and the BoxHero export's, so a file
   * that goes out of here can come back in through the paste box without
   * anybody rearranging it.
   */
  async exportCsv(params = {}) {
    const filter = buildFilter(params);
    const rows = await InventoryItem.find(filter)
      .collation(COLLATION)
      .sort({ [SORT_KEYS.includes(params.sort) ? params.sort : 'name']: params.dir === 'desc' ? -1 : 1, _id: 1 })
      .limit(EXPORT_CAP)
      .lean();

    const header = ['SKU', 'Name', 'Category', 'Unit', 'Visibility', 'Vendor Name', 'Vendor Details', 'Price', 'Image URL', 'Notes', 'Status'];
    const body = rows.map((r) => [
      r.sku, r.name, r.category, r.unit, r.visibility, r.vendorName, r.vendorDetails,
      r.price ?? '', r.imageUrl, r.notes, r.active === false ? 'Archived' : 'Active',
    ]);

    const stamp = new Date().toISOString().slice(0, 10);
    const scope = clean(params.category) || (params.uncategorised ? 'unfiled' : '') || 'all';
    return {
      rows: [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n'),
      filename: `inventory_${scope.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}_${stamp}.csv`,
      count: rows.length,
    };
  },

  /* ── writes ──────────────────────────────────────────────────────────── */

  /**
   * Add one item. A blank SKU is minted rather than refused — the stores team
   * adds things they have just unpacked, and "what code shall I give it?" is a
   * question the system can answer better than they can.
   */
  async create(body, userId) {
    const sku = clean(body.sku).toUpperCase() || await uniqueSku();
    if (await InventoryItem.exists({ sku })) {
      throw ApiError.badRequest(`${sku} is already in the master.`, { code: 'SKU_EXISTS' });
    }
    return InventoryItem.create({
      ...body,
      sku,
      source: 'manual',
      createdBy: userId,
      updatedBy: userId,
    });
  },

  /**
   * Add many at once — the paste-from-a-spreadsheet path, and the reason the
   * Add form has a second tab.
   *
   * PARTIAL SUCCESS IS THE POINT. Somebody pasting forty lines out of Excel
   * will have two that clash with a code already in the master, and refusing
   * all forty over those two means they must find the two by hand and paste
   * again. So every row is attempted, and the response says exactly which were
   * added, which were skipped and why — the page then shows the skipped ones
   * still in the form, ready to be fixed.
   *
   * Rows are validated against EACH OTHER as well as against the database:
   * two lines of one paste carrying the same SKU is the common typo, and
   * without this check the second would silently overwrite the first.
   */
  async bulkCreate(rows, userId) {
    const minted = new Set();
    const created = [];
    const skipped = [];
    const seenSku = new Map();
    const seenName = new Map();

    /* Every SKU and name already in the master, fetched once. One `exists`
       query per row would be 200 round trips for a paste of 200 lines. */
    const existing = await InventoryItem.find({}, { sku: 1, name: 1 }).lean();
    const takenSku = new Set(existing.map((e) => e.sku));
    const takenName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.sku]));

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = clean(row.name);
      if (!name) { skipped.push({ index: i, row, reason: 'No item name.' }); continue; }

      const nameKey = name.toLowerCase();
      if (seenName.has(nameKey)) {
        skipped.push({ index: i, row, reason: `"${name}" appears twice in this batch (line ${seenName.get(nameKey) + 1}).` });
        continue;
      }
      /* A duplicate NAME is a warning, not a refusal — the master genuinely
         holds two "Wall Fan" rows under different codes, because they are two
         different fans. It is reported so somebody can look, and the row is
         still added. */
      const clashesWith = takenName.get(nameKey);

      let sku = clean(row.sku).toUpperCase();
      if (sku) {
        if (takenSku.has(sku)) { skipped.push({ index: i, row, reason: `${sku} is already in the master.` }); continue; }
        if (seenSku.has(sku)) { skipped.push({ index: i, row, reason: `${sku} appears twice in this batch (line ${seenSku.get(sku) + 1}).` }); continue; }
      } else {
        // eslint-disable-next-line no-await-in-loop
        sku = await uniqueSku(minted);
      }

      seenSku.set(sku, i);
      seenName.set(nameKey, i);
      takenSku.add(sku);

      created.push({
        sku,
        name,
        category: clean(row.category),
        visibility: VISIBILITIES.includes(clean(row.visibility)) ? clean(row.visibility) : 'Unlisted',
        unit: clean(row.unit),
        vendorName: clean(row.vendorName),
        vendorDetails: clean(row.vendorDetails),
        /* A blank price stays null rather than becoming 0 — see the note on
           `InventoryItem.price`: "unpriced" and "free" are different answers. */
        price: row.price === '' || row.price == null ? null : Number(row.price),
        imageUrl: clean(row.imageUrl),
        notes: clean(row.notes),
        source: 'manual',
        createdBy: userId,
        updatedBy: userId,
        _warning: clashesWith ? `Another item is already called "${name}" (${clashesWith}).` : undefined,
      });
    }

    const warnings = created
      .filter((c) => c._warning)
      .map((c) => ({ sku: c.sku, name: c.name, warning: c._warning }));
    const docs = created.map(({ _warning, ...rest }) => rest);

    /* `ordered: false` so one row that trips the unique index at the last
       moment — a second tab adding the same code between the read above and
       this write — does not abandon the rest of the batch. */
    const inserted = docs.length ? await InventoryItem.insertMany(docs, { ordered: false }) : [];

    /* Any category named in the paste that the master does not have yet is
       adopted, so "add multiple items with a new category" is one action
       rather than two. */
    const newCategories = await this.ensureCategories(docs.map((d) => d.category), userId);

    return {
      created: inserted.length,
      items: inserted,
      skipped,
      warnings,
      newCategories,
    };
  },

  /**
   * Make sure every named category exists in the curated master.
   *
   * Used by the bulk add and by the migration. Returns only the ones it had to
   * create, because that is what the caller reports back to the user.
   */
  async ensureCategories(names, userId) {
    const wanted = [...new Set(names.map(clean).filter(Boolean))];
    if (!wanted.length) return [];

    const codes = wanted.map(categoryCode);
    const have = new Set((await InventoryCategory.find({ code: { $in: codes } }, { code: 1 }).lean()).map((c) => c.code));

    const missing = wanted.filter((n) => !have.has(categoryCode(n)));
    if (!missing.length) return [];

    const last = await InventoryCategory.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    let order = last?.sortOrder ?? 0;

    const docs = missing.map((name) => {
      order += 10;
      return {
        code: categoryCode(name), name, sortOrder: order, createdBy: userId, updatedBy: userId,
      };
    });
    await InventoryCategory.insertMany(docs, { ordered: false });
    return docs.map((d) => d.name);
  },

  /**
   * Rename a category everywhere at once — the whole reason the curated list
   * is a collection rather than a distinct-values query.
   *
   * Items filed under the OLD spelling are rewritten in the same call. Doing
   * it the other way round (rename here, fix the items later) leaves the list
   * and the items disagreeing for exactly as long as somebody forgets, and the
   * items are what every filter and every report reads.
   */
  async renameCategory(id, nextName, userId) {
    const category = await InventoryCategory.findById(id);
    if (!category) throw ApiError.notFound('Category not found');

    const name = clean(nextName);
    if (!name) throw ApiError.badRequest('A category needs a name.');
    if (name === category.name) return { category, itemsUpdated: 0 };

    const code = categoryCode(name);
    const clash = await InventoryCategory.findOne({ code, _id: { $ne: category._id } });
    /* Renaming onto an existing category is a MERGE, and merging silently is
       how a list loses a category nobody meant to lose. Refused, with the name
       of the thing in the way — the person can archive one of them first if
       that really is what they meant. */
    if (clash) {
      throw ApiError.badRequest(
        `"${clash.name}" already exists. Archive one of them first if you meant to merge them.`,
        { code: 'CATEGORY_EXISTS' },
      );
    }

    const previous = category.name;
    category.name = name;
    category.code = code;
    category.updatedBy = userId;
    await category.save();

    const { modifiedCount } = await InventoryItem.updateMany(
      { category: previous },
      { $set: { category: name, updatedBy: userId } },
    );

    return { category, itemsUpdated: modifiedCount };
  },
};

export default inventoryService;
