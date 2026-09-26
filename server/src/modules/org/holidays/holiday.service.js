import { Holiday } from './holiday.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { ORG_EVENTS, emitOrgEvent } from '../org.events.js';

export const holidayService = {
  async list({ year } = {}) {
    const filter = year ? { date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {};
    return Holiday.find(filter).sort({ date: 1 }).populate('createdBy', 'name');
  },

  /** All holiday date keys — used by checklist generation. */
  async keys() {
    const rows = await Holiday.find().select('date').lean();
    return rows.map((r) => r.date);
  },

  /**
   * Declare one or more holidays. Checklist occurrences already scheduled on
   * those days are moved off them (daily ones dropped) by the checklist module.
   */
  async create(entries, userId) {
    const existing = new Set((await Holiday.find({ date: { $in: entries.map((e) => e.date) } }).lean()).map((h) => h.date));
    const fresh = entries.filter((e) => !existing.has(e.date));
    if (!fresh.length) throw ApiError.conflict('Those dates are already holidays');

    const created = await Holiday.insertMany(fresh.map((e) => ({ ...e, createdBy: userId })));

    let adjusted = { removedDaily: 0, shifted: 0 };
    try {
      const results = await emitOrgEvent(ORG_EVENTS.HOLIDAYS_ADDED, created.map((h) => h.date));
      for (const r of results) {
        adjusted.removedDaily += r?.removedDaily || 0;
        adjusted.shifted += r?.shifted || 0;
      }
    } catch (err) {
      logger.error('Holiday saved but checklist adjustment failed', { error: err.message });
      adjusted = null;
    }
    return { created, skipped: entries.length - fresh.length, adjusted };
  },

  async remove(id) {
    const h = await Holiday.findByIdAndDelete(id);
    if (!h) throw ApiError.notFound('Holiday not found');
    return h;
  },
};

export default holidayService;
