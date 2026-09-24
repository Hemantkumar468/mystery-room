import { Activity } from './activity.model.js';
import { logger } from '../../../config/logger.js';

export const activityService = {
  /** Fire-and-forget audit write — never blocks or breaks the main flow. */
  async log(entry) {
    try {
      await Activity.create(entry);
    } catch (err) {
      logger.warn('Failed to write activity log', { error: err.message });
    }
  },

  // `department` is selected so activity tables can attribute a row to the
  // team behind it (Phase 10's Recent Activity / Audit Log) without a second
  // lookup. Every other consumer simply ignores the extra field.
  async listForProject(projectId, limit = 20) {
    return Activity.find({ project: projectId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor', 'name role avatarColor department');
  },

  async recent(limit = 15) {
    return Activity.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor', 'name role avatarColor')
      .populate('project', 'name code city');
  },

  async exists(query) {
    return Activity.exists(query);
  },
};

export default activityService;
