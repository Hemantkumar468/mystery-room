import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import { CHECKLIST_FREQUENCIES as F, CHECKLIST_FREQUENCY_VALUES } from '../../core/constants/ops.js';

dayjs.extend(utc);

/**
 * Checklist occurrence engine.
 *
 * Creating a routine materialises every occurrence up front, through its end
 * date. Rules:
 *   • weekly / fortnightly land on the anchor weekday (default Saturday)
 *   • monthly lands on the anchor day (default the 28th — every month has one),
 *     clamped to short months; quarterly keeps the start's day-of-month
 *   • chosen weekly-off days are skipped (e.g. Sunday at head office; outlets
 *     that trade seven days a week skip nothing)
 *   • an occurrence that lands on a holiday or weekly-off rolls forward to the
 *     next working day — but the cadence continues from its own track, so one
 *     holiday can never drift "every Saturday" onto Sundays forever
 *
 * All arithmetic is on 'YYYY-MM-DD' keys in UTC: no DST, no host-timezone drift.
 */

export const DEFAULT_WEEKLY_ANCHOR = 6; // Saturday
export const DEFAULT_MONTHLY_ANCHOR = 28;
const MAX_OCCURRENCES = 2000;

const k = (x) => x.format('YYYY-MM-DD');
const d = (key) => dayjs.utc(key);

const addMonthsAnchored = (x, n, anchor) => {
  const m = x.date(1).add(n, 'month');
  return m.date(Math.min(anchor, m.daysInMonth()));
};

export function firstOccurrence(startKey, frequency, { anchorWeekday = DEFAULT_WEEKLY_ANCHOR, anchorDay = DEFAULT_MONTHLY_ANCHOR } = {}) {
  const start = d(startKey);
  if (frequency === F.WEEKLY || frequency === F.FORTNIGHTLY) {
    return start.add((anchorWeekday - start.day() + 7) % 7, 'day');
  }
  if (frequency === F.MONTHLY) {
    const sameMonth = start.date(Math.min(anchorDay, start.daysInMonth()));
    return sameMonth.isBefore(start, 'day') ? addMonthsAnchored(start, 1, anchorDay) : sameMonth;
  }
  return start;
}

function nextCursor(cur, frequency, anchorDay, quarterDay) {
  switch (frequency) {
    case F.DAILY:
      return cur.add(1, 'day');
    case F.WEEKLY:
      return cur.add(7, 'day');
    case F.FORTNIGHTLY:
      return cur.add(14, 'day');
    case F.MONTHLY:
      return addMonthsAnchored(cur, 1, anchorDay);
    case F.QUARTERLY:
      return addMonthsAnchored(cur, 3, quarterDay);
    case F.YEARLY:
      return cur.add(1, 'year');
    default:
      return null;
  }
}

/** 31 Dec of the start year — the default generation horizon. */
export const defaultEndKey = (startKey) => `${startKey.slice(0, 4)}-12-31`;

/**
 * Every occurrence day for a routine.
 * @returns {string[]} ascending, de-duplicated 'YYYY-MM-DD' keys
 */
export function generateOccurrences({
  startDate,
  endDate,
  frequency,
  holidays = [],
  weeklyOffs = [],
  anchorWeekday,
  anchorDay,
}) {
  if (!CHECKLIST_FREQUENCY_VALUES.includes(frequency)) throw new Error(`Unsupported frequency: ${frequency}`);
  const horizon = endDate || defaultEndKey(startDate);
  const blockedDays = new Set(holidays);
  const blockedDow = new Set(weeklyOffs);
  const isBlocked = (x) => blockedDow.has(x.day()) || blockedDays.has(k(x));

  // A blocked day rolls forward to the next working day; give up after a fortnight.
  const rollForward = (x) => {
    let c = x;
    for (let i = 0; i < 14; i += 1) {
      if (!isBlocked(c)) return c;
      c = c.add(1, 'day');
    }
    return null;
  };

  const anchorDayResolved = anchorDay || DEFAULT_MONTHLY_ANCHOR;
  let cursor = firstOccurrence(startDate, frequency, { anchorWeekday: anchorWeekday ?? DEFAULT_WEEKLY_ANCHOR, anchorDay: anchorDayResolved });
  const quarterDay = cursor.date();
  const out = [];
  const seen = new Set();

  for (let guard = 0; guard < MAX_OCCURRENCES && k(cursor) <= horizon; guard += 1) {
    const slot = isBlocked(cursor) ? rollForward(cursor) : cursor;
    if (slot && k(slot) <= horizon && !seen.has(k(slot))) {
      seen.add(k(slot));
      out.push(k(slot));
    }
    const next = nextCursor(cursor, frequency, anchorDayResolved, quarterDay);
    if (!next || !next.isAfter(cursor)) break;
    cursor = next; // advance from the ORIGINAL cursor, never the rolled date
  }
  return out;
}

export default { generateOccurrences, firstOccurrence, defaultEndKey };
