import { Branch } from './branch.model.js';
import { User } from '../../auth/auth.model.js';
import { Project } from '../../pms/projects/project.model.js';
import { activityService } from '../../pms/activity/activity.service.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { getPagination, buildMeta, parseSort } from '../../../core/utils/pagination.js';

const KIND_PREFIX = { hq: 'HQ', warehouse: 'WH', other: 'OTH' };

const MAX_CODE_RETRIES = 5;

/** Mirrors project.service.js's generateProjectCode() exactly in shape
 * (PREFIX-SEGMENT-###), with Branch's own "BR" prefix so a Branch code is
 * never confused with the Project code it might softly link to. Segment is
 * city-derived when a city is set (same letters-only/pad-to-3 logic as
 * Project), else falls back to a kind-based segment for HQ/Warehouse/Other
 * branches that may have no city. Sequence is per-segment, via the same
 * countDocuments+1 approach used for projects — NOT atomic under concurrent
 * creates for the same brand-new segment, same as the existing Project
 * pattern. Unlike Project, `create()` below retries on the resulting
 * duplicate-key error instead of just accepting it: verified live during
 * Step 2.1 QA that two concurrent creates for the same new city do collide
 * in practice, and a requester shouldn't see "duplicate code" for what is,
 * from their point of view, an ordinary create. */
async function generateBranchCode(city, kind) {
  const segment = city
    ? city.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X')
    : (KIND_PREFIX[kind] || 'GEN');
  const filter = city ? { city } : { city: { $exists: false } };
  const count = await Branch.countDocuments(filter);
  return `BR-${segment}-${String(count + 1).padStart(3, '0')}`;
}

function buildFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.kind) filter.kind = query.kind;
  if (query.city) filter.city = new RegExp(query.city.trim(), 'i');
  if (query.search) {
    const re = new RegExp(query.search.trim(), 'i');
    filter.$or = [{ name: re }, { code: re }];
  }
  return filter;
}

async function assertReferencesExist({ manager, project }) {
  if (manager) {
    const exists = await User.exists({ _id: manager });
    if (!exists) throw ApiError.badRequest('Selected manager does not exist');
  }
  if (project) {
    const exists = await Project.exists({ _id: project });
    if (!exists) throw ApiError.badRequest('Selected project does not exist');
  }
}

const POPULATE_MANAGER = 'name email department employeeId avatarColor';
const POPULATE_PROJECT = 'name code city';

export const branchService = {
  async list(query = {}) {
    const { page, limit, skip } = getPagination(query);
    const filter = buildFilter(query);
    const [items, total] = await Promise.all([
      Branch.find(filter)
        .sort(parseSort(query.sort, { createdAt: -1 }))
        .skip(skip)
        .limit(limit)
        .populate('manager', POPULATE_MANAGER)
        .populate('project', POPULATE_PROJECT)
        .populate('createdBy', 'name avatarColor'),
      Branch.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  /** Org-wide counts for the page's KPI strip — deliberately independent of
   * the current filter/pagination so the KPIs always read as ground truth,
   * not "truth for whatever page you're looking at". */
  async summary() {
    const [total, active, inactive, store, hq, warehouse, other] = await Promise.all([
      Branch.countDocuments({}),
      Branch.countDocuments({ status: 'active' }),
      Branch.countDocuments({ status: 'inactive' }),
      Branch.countDocuments({ kind: 'store' }),
      Branch.countDocuments({ kind: 'hq' }),
      Branch.countDocuments({ kind: 'warehouse' }),
      Branch.countDocuments({ kind: 'other' }),
    ]);
    return { total, active, inactive, byKind: { store, hq, warehouse, other } };
  },

  async getById(id) {
    const branch = await Branch.findById(id)
      .populate('manager', POPULATE_MANAGER)
      .populate('project', POPULATE_PROJECT)
      .populate('createdBy', 'name avatarColor');
    if (!branch) throw ApiError.notFound('Branch not found');
    return branch;
  },

  async create(data, actorId) {
    await assertReferencesExist(data);
    let branch;
    for (let attempt = 1; attempt <= MAX_CODE_RETRIES; attempt += 1) {
      const code = await generateBranchCode(data.city, data.kind || 'store');
      try {
        branch = await Branch.create({ ...data, code, createdBy: actorId });
        break;
      } catch (err) {
        const isCodeCollision = err?.code === 11000 && Boolean(err?.keyPattern?.code);
        if (!isCodeCollision || attempt === MAX_CODE_RETRIES) throw err;
        // Two concurrent creates raced for the same generated code (both
        // read the same countDocuments() before either had written) —
        // regenerate against the now-updated count and retry.
      }
    }
    await activityService.log({
      entityType: 'branch',
      entityId: branch._id,
      action: 'created',
      actor: actorId,
      message: `Branch "${branch.name}" (${branch.code}) created`,
    });
    return branchService.getById(branch._id);
  },

  async update(id, data, actorId) {
    const branch = await Branch.findById(id);
    if (!branch) throw ApiError.notFound('Branch not found');
    await assertReferencesExist(data);
    Object.assign(branch, data);
    await branch.save();
    await activityService.log({
      entityType: 'branch',
      entityId: branch._id,
      action: 'updated',
      actor: actorId,
      message: `Branch "${branch.name}" (${branch.code}) updated`,
    });
    return branchService.getById(branch._id);
  },
};

export default branchService;
