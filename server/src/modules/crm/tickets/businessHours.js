/**
 * Business-hours arithmetic, for SLA clocks.
 *
 * WHY NOT WALL-CLOCK. A ticket raised at 18:40 on Friday with a "4 hour first
 * response" target is not late at 22:40 on Friday, and it is not late at 18:40
 * on Saturday either — the office is shut. Measured on the wall clock, every
 * ticket that arrives near the end of a day or before a weekend breaches
 * before anyone could possibly have answered it. The cost is not the wrong
 * number on a report: it is that people learn SLA alerts are noise and stop
 * reading them, and then the alert that mattered is ignored too.
 *
 * So every SLA duration in this module is measured in WORKING minutes, and the
 * Friday-evening ticket above is due at 13:00 on Monday.
 *
 * TIME ZONE. Business hours are local hours — "we open at ten" means ten in
 * Kolkata regardless of where the server runs. All arithmetic is therefore
 * done on the calendar's zone via Intl, not on the process's, so moving the
 * deployment cannot silently shift everyone's deadlines by five and a half
 * hours.
 *
 * NO DEPENDENCY. Intl is in Node; a date library would be ~70KB to answer
 * "what is the local hour there", which is the only question asked here.
 */

/** The working week, if nobody has configured one. */
export const DEFAULT_CALENDAR = Object.freeze({
  timezone: 'Asia/Kolkata',
  /** 0 = Sunday. Monday–Saturday: this is a franchise business, and Saturday
   *  is when a prospective franchisee who has a weekday job actually calls. */
  workDays: [1, 2, 3, 4, 5, 6],
  startMinute: 10 * 60, // 10:00
  endMinute: 19 * 60, // 19:00
  /** ISO dates (YYYY-MM-DD) in the calendar's own zone. */
  holidays: [],
});

const MINUTE = 60_000;
const WEEKDAY_INDEX = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** Cached because a single SLA sweep formats thousands of dates. */
const formatterCache = new Map();
function formatterFor(timeZone) {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** An instant, as it reads on a wall clock in `timeZone`. */
export function zonedParts(date, timeZone) {
  const parts = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  // "24" appears at midnight in some ICU versions with hour12:false.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday],
    minuteOfDay: hour * 60 + Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * A local wall-clock time in `timeZone` → the UTC instant it names.
 *
 * Done by measuring the zone's offset at roughly the right moment and then
 * once more at the corrected moment. The second pass matters only where the
 * clocks change; India has no DST, but a hard-coded single pass would be a
 * bug waiting for the first office outside it.
 */
export function zonedTimeToUtc({
  year, month, day, minuteOfDay,
}, timeZone) {
  const naive = Date.UTC(year, month - 1, day, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  const offsetAt = (instant) => {
    const p = zonedParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
  };
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return new Date(guess);
}

const isoOf = ({ year, month, day }) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Is this a day the office is open at all? */
function isWorkingDay(parts, calendar) {
  if (!calendar.workDays.includes(parts.weekday)) return false;
  return !calendar.holidays?.includes(isoOf(parts));
}

/** The same calendar date, one day later, at a given minute of the day. */
function nextDayAt(parts, minuteOfDay, timeZone) {
  const noonNext = Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12);
  const p = zonedParts(new Date(noonNext), timeZone);
  return zonedTimeToUtc({ ...p, minuteOfDay }, timeZone);
}

/** Fill in anything a stored policy left out. */
export function normaliseCalendar(calendar) {
  const c = { ...DEFAULT_CALENDAR, ...(calendar || {}) };
  if (!Array.isArray(c.workDays) || !c.workDays.length) c.workDays = DEFAULT_CALENDAR.workDays;
  if (!Array.isArray(c.holidays)) c.holidays = [];
  return c;
}

/** True when the office is open at that instant. */
export function isWithinBusinessHours(date, calendar) {
  const c = normaliseCalendar(calendar);
  const p = zonedParts(date, c.timezone);
  if (!isWorkingDay(p, c)) return false;
  return p.minuteOfDay >= c.startMinute && p.minuteOfDay < c.endMinute;
}

/**
 * `from` plus `minutes` of OPEN time.
 *
 * A start outside business hours rolls forward to the next opening — the clock
 * on a ticket that arrives at 03:00 starts when the office does, not at 03:00.
 *
 * The loop is bounded rather than `while (true)`: a calendar with no working
 * days at all (every day a holiday, or workDays emptied by a bad edit) would
 * otherwise spin forever inside a request. Two years of days is far past any
 * real SLA, so hitting the bound means the calendar is wrong, and it says so.
 */
export function addBusinessMinutes(from, minutes, calendar) {
  const c = normaliseCalendar(calendar);
  const target = Math.max(0, Math.round(minutes));

  let cursor = new Date(from);
  let remaining = target;

  for (let guard = 0; guard < 800; guard += 1) {
    const p = zonedParts(cursor, c.timezone);

    if (!isWorkingDay(p, c)) {
      cursor = nextDayAt(p, c.startMinute, c.timezone);
      continue;
    }
    if (p.minuteOfDay < c.startMinute) {
      cursor = zonedTimeToUtc({ ...p, minuteOfDay: c.startMinute }, c.timezone);
      continue;
    }
    if (p.minuteOfDay >= c.endMinute) {
      cursor = nextDayAt(p, c.startMinute, c.timezone);
      continue;
    }

    // Zero minutes, inside hours: due immediately.
    if (remaining === 0) return cursor;

    const leftToday = c.endMinute - p.minuteOfDay;
    if (remaining <= leftToday) return new Date(cursor.getTime() + remaining * MINUTE);

    remaining -= leftToday;
    cursor = nextDayAt(p, c.startMinute, c.timezone);
  }

  throw new Error(
    'addBusinessMinutes could not find enough working time in two years. '
    + 'The business calendar has no usable working days — check workDays and holidays.',
  );
}

/**
 * How many OPEN minutes elapsed between two instants.
 *
 * This is what "responded in 20 minutes" should mean on a report. Counted by
 * walking whole days rather than minute by minute, so a six-month-old ticket
 * costs the same as a six-minute one.
 */
export function businessMinutesBetween(from, to, calendar) {
  const c = normaliseCalendar(calendar);
  if (!from || !to) return 0;
  const start = new Date(from);
  const end = new Date(to);
  if (end <= start) return 0;

  let total = 0;
  let cursor = start;

  for (let guard = 0; guard < 800; guard += 1) {
    const p = zonedParts(cursor, c.timezone);

    if (!isWorkingDay(p, c)) {
      cursor = nextDayAt(p, c.startMinute, c.timezone);
      if (cursor >= end) break;
      continue;
    }

    const dayOpen = zonedTimeToUtc({ ...p, minuteOfDay: c.startMinute }, c.timezone);
    const dayClose = zonedTimeToUtc({ ...p, minuteOfDay: c.endMinute }, c.timezone);

    const segmentStart = cursor > dayOpen ? cursor : dayOpen;
    const segmentEnd = end < dayClose ? end : dayClose;
    if (segmentEnd > segmentStart) total += (segmentEnd - segmentStart) / MINUTE;

    if (end <= dayClose) break;
    cursor = nextDayAt(p, c.startMinute, c.timezone);
    if (cursor >= end) break;
  }

  return Math.round(total);
}

export default {
  DEFAULT_CALENDAR,
  addBusinessMinutes,
  businessMinutesBetween,
  isWithinBusinessHours,
  normaliseCalendar,
  zonedParts,
};
