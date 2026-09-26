import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { config } from '../../config/index.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Calendar-day helpers for the ops modules.
 *
 * "Which day is this due?" must not depend on where the server runs. A checklist
 * occurrence planned for 15 Mar is 15 Mar in the business timezone even on a UTC
 * host, so every day boundary here is computed in `config.ops.timezone`.
 */
export const OPS_TZ = config.ops.timezone;

/** Business-timezone dayjs for a date (or now). */
export const tz = (d) => (d === undefined ? dayjs().tz(OPS_TZ) : dayjs(d).tz(OPS_TZ));

/** 'YYYY-MM-DD' of the business day a date falls on. */
export const dateKey = (d = new Date()) => tz(d).format('YYYY-MM-DD');

/** Instant of 00:00 business time on a 'YYYY-MM-DD' key or date. */
export const startOfDay = (keyOrDate) => {
  const key = typeof keyOrDate === 'string' && keyOrDate.length === 10 ? keyOrDate : dateKey(keyOrDate);
  return dayjs.tz(key, OPS_TZ).startOf('day').toDate();
};

/** Instant of 23:59:59.999 business time on that day. */
export const endOfDay = (keyOrDate) => {
  const key = typeof keyOrDate === 'string' && keyOrDate.length === 10 ? keyOrDate : dateKey(keyOrDate);
  return dayjs.tz(key, OPS_TZ).endOf('day').toDate();
};

/** Monday-based week start key of a date — "this week" as the business reads it. */
export const weekKey = (d) => {
  const t = tz(d).startOf('day');
  const back = (t.day() + 6) % 7; // Monday = 0
  return t.subtract(back, 'day').format('YYYY-MM-DD');
};

/** True when both dates fall in the same Monday-based business week. */
export const isSameWeek = (a, b) => Boolean(a && b) && weekKey(a) === weekKey(b);

/** Whole days from a to b in business days-of-calendar (negative when b < a). */
export const daysBetween = (a, b) => tz(b).startOf('day').diff(tz(a).startOf('day'), 'day');

/** dd/MM/yyyy HH:mm stamp used on every append-only remark line. */
export const stamp = (d = new Date()) => tz(d).format('DD/MM/YYYY HH:mm');

/**
 * Append a timestamped line to an append-only remark channel, keeping every
 * earlier line intact.
 */
export const appendRemarkLine = (existing, text, now = new Date()) => {
  const line = `${stamp(now)} - ${text}`;
  const prev = existing ? String(existing).trim() : '';
  return prev ? `${prev}\n${line}` : line;
};

/** Human date for notification copy, e.g. "15 Mar 2026". */
export const fmtDay = (d) => (d ? tz(d).format('DD MMM YYYY') : 'No date');

export default { tz, dateKey, startOfDay, endOfDay, weekKey, isSameWeek, daysBetween, stamp, appendRemarkLine, fmtDay };
