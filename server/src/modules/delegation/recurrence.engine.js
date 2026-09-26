import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { DELEGATION_FREQUENCIES as F } from '../../core/constants/ops.js';

dayjs.extend(utc);

/**
 * Does a recurring-delegation rule fire on a given calendar day?
 *
 * Pure calendar arithmetic on 'YYYY-MM-DD' keys (in UTC so there is no DST or
 * host-timezone drift). Mirrors the original nightly generator:
 *
 *   daily         every day
 *   weekly        on the chosen weekdays
 *   monthly       on the chosen dates; 'last' = last day of the month
 *   yearly        on the start date's day + month
 *   periodically  every N days counted from the start date
 *   custom        every N weeks on chosen weekdays, or every N months on chosen dates
 */
const d = (key) => dayjs.utc(key); // ISO 'YYYY-MM-DD' parses natively

const mondayOf = (x) => x.subtract((x.day() + 6) % 7, 'day');

export function firesOn(rule, key) {
  if (!rule?.frequency || !rule.startDate) return false;
  if (key < rule.startDate) return false;
  if (rule.endDate && key > rule.endDate) return false;

  const day = d(key);
  const start = d(rule.startDate);
  const isLastDay = day.date() === day.daysInMonth();
  const dateMatches = (dates = []) =>
    dates.includes(String(day.date())) || (isLastDay && dates.map(String).map((s) => s.toLowerCase()).includes('last'));

  switch (rule.frequency) {
    case F.DAILY:
      return true;
    case F.WEEKLY:
      return (rule.weeklyDays || []).includes(day.day());
    case F.MONTHLY:
      return dateMatches(rule.monthDates);
    case F.YEARLY:
      return day.date() === start.date() && day.month() === start.month();
    case F.PERIODICALLY: {
      const every = Math.max(1, rule.intervalDays || 1);
      return day.diff(start, 'day') % every === 0;
    }
    case F.CUSTOM: {
      const c = rule.custom || {};
      const every = Math.max(1, c.value || 1);
      if (c.every === 'week') {
        const weeks = Math.floor(mondayOf(day).diff(mondayOf(start), 'day') / 7);
        return weeks % every === 0 && (c.weekdays || []).includes(day.day());
      }
      if (c.every === 'month') {
        const months = (day.year() - start.year()) * 12 + (day.month() - start.month());
        return months % every === 0 && dateMatches(c.dates);
      }
      return false;
    }
    default:
      return false;
  }
}

/** Next `count` firing days from `fromKey` (inclusive) — used to preview a rule in the UI. */
export function previewDates(rule, fromKey, count = 5, horizonDays = 800) {
  const out = [];
  let cur = d(fromKey);
  for (let i = 0; i < horizonDays && out.length < count; i += 1) {
    const key = cur.format('YYYY-MM-DD');
    if (rule.endDate && key > rule.endDate) break;
    if (firesOn(rule, key)) out.push(key);
    cur = cur.add(1, 'day');
  }
  return out;
}

export default { firesOn, previewDates };
