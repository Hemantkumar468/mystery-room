import { Branch } from './branch.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { BRANCH_TYPES } from '../../../core/constants/ops.js';

/** Cache of the default branch id — it changes rarely and is read on every list call. */
let defaultBranchCache = { id: null, at: 0 };
const CACHE_MS = 60_000;

export const branchService = {
  async list({ includeInactive = false } = {}) {
    const filter = includeInactive ? {} : { isActive: true };
    return Branch.find(filter).sort({ isDefault: -1, type: 1, name: 1 });
  },

  async getById(id) {
    const branch = await Branch.findById(id);
    if (!branch) throw ApiError.notFound('Branch not found');
    return branch;
  },

  async create(data, userId) {
    const branch = await Branch.create({ ...data, createdBy: userId });
    if (branch.isDefault) await this.makeDefault(branch._id);
    return branch;
  },

  async update(id, data) {
    const branch = await this.getById(id);
    if (data.isActive === false && branch.isDefault) {
      throw ApiError.badRequest('The default branch cannot be deactivated. Make another branch the default first.');
    }
    Object.assign(branch, data);
    await branch.save();
    if (data.isDefault) await this.makeDefault(branch._id);
    return branch;
  },

  async makeDefault(id) {
    await Branch.updateMany({ _id: { $ne: id }, isDefault: true }, { isDefault: false });
    await Branch.updateOne({ _id: id }, { isDefault: true, isActive: true });
    defaultBranchCache = { id: null, at: 0 };
  },

  /**
   * The fallback branch. Created on first use so a fresh database works
   * without a seed — named neutrally so admins can rename it.
   */
  async defaultBranchId() {
    if (defaultBranchCache.id && Date.now() - defaultBranchCache.at < CACHE_MS) {
      return defaultBranchCache.id;
    }
    let branch = await Branch.findOne({ isDefault: true, isActive: true }).select('_id');
    if (!branch) branch = await Branch.findOne({ isActive: true }).sort({ createdAt: 1 }).select('_id');
    if (!branch) {
      branch = await Branch.create({
        name: 'Head Office',
        code: 'HQ',
        type: BRANCH_TYPES.HEADQUARTERS,
        isDefault: true,
      });
    }
    defaultBranchCache = { id: String(branch._id), at: Date.now() };
    return defaultBranchCache.id;
  },

  /** True when the id is a real, active branch. */
  async exists(id) {
    if (!id) return false;
    return Boolean(await Branch.exists({ _id: id, isActive: true }));
  },
};

export default branchService;
