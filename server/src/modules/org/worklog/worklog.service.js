import { WorkLog } from './worklog.model.js';
import { logger } from '../../../config/logger.js';
import { containsRegex } from '../../../core/utils/regex.js';
import { getPagination, buildMeta } from '../../../core/utils/pagination.js';
import { startOfDay, endOfDay } from '../../../core/utils/opsTime.js';

export const workLogService = {
  /** Fire-and-forget audit write — never blocks or breaks the main flow. */
  log(entry) {
    WorkLog.create(entry).catch((err) =>
      logger.warn('Failed to write ops activity log', { error: err.message }),
    );
  },

  async list(query = {}) {
    const { page, limit, skip } = getPagination({ ...query, limit: query.limit || 50 });
    const filter = {};
    if (query.module) filter.module = query.module;
    if (query.actor) filter.actor = query.actor;
    if (query.refId) filter.refId = query.refId;
    if (query.from || query.to) {
      filter.createdAt = {};
      if (query.from) filter.createdAt.$gte = startOfDay(query.from);
      if (query.to) filter.createdAt.$lte = endOfDay(query.to);
    }
    if (query.search) {
      const rx = containsRegex(query.search);
      filter.$or = [{ title: rx }, { description: rx }];
    }
    const [items, total] = await Promise.all([
      WorkLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor', 'name title avatarColor'),
      WorkLog.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  async forRef(refId, limit = 40) {
    return WorkLog.find({ refId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor', 'name title avatarColor');
  },
};

export default workLogService;
