/**
 * What a task's clock says, and what tone to paint it.
 *
 * PULLED OUT OF ProjectTree SO THE DRAWER CANNOT DISAGREE WITH THE CARD. The
 * card and the drawer show the same task at the same moment; if each did its
 * own date arithmetic, the two would eventually round a boundary differently
 * and the screen would contradict itself while a person was reading it.
 *
 * The tone is only ever a task state or `late`. It NEVER invents a fourth
 * status, and callers must not use it to colour anything except the clock —
 * "Pending with a red clock" is the single most useful thing this screen can
 * say, and merging those two facts into one badge throws half of it away.
 */
import { TASK_STATE } from './phaseProgress.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

export const pad = (n) => String(n).padStart(2, '0');
export const fmt = (d) => `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
export const daysOf = (ms) => Math.max(1, Math.ceil(ms / DAY));

/** d 00:00:00 — a live countdown, not a rounded "in 3 days". */
export function hms(ms) {
  let r = ms;
  const d = Math.floor(r / DAY); r -= d * DAY;
  const h = Math.floor(r / 3600000); r -= h * 3600000;
  const m = Math.floor(r / 60000); r -= m * 60000;
  return `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(Math.floor(r / 1000))}`;
}

export const startOf = (t) => (t?.plannedStart ? new Date(t.plannedStart) : null);
export const endOf = (t) => (t?.dueAt || t?.plannedEnd ? new Date(t.dueAt || t.plannedEnd) : null);

/**
 * IT ONLY EVER SAYS HOW LONG IS LEFT.
 *
 * It used to have a fifth answer — "Window opens 10 Sep" — for a task whose
 * start date had not arrived. That told you a date without telling you the one
 * thing the line exists for, and it read as a different kind of fact from the
 * "11d before its date" on the card beside it. Both are now "5 days left", and
 * the dates themselves are printed in full on their own line above.
 *
 * A running task keeps the live clock, because a countdown that ticks is worth
 * more than a rounded day on the thing somebody is doing right now.
 */
export function clockFor(state, start, end, now) {
  if (!end) return { text: 'No dates set', tone: state };
  if (state === TASK_STATE.COMPLETE) return { text: `Completed ${fmt(end)}`, tone: 'complete' };
  const left = end - now;
  if (left <= 0) {
    const over = daysOf(-left);
    return { text: `${over} ${over === 1 ? 'day' : 'days'} over`, tone: 'late' };
  }
  if (state === TASK_STATE.PROCESSING) return { text: `${hms(left)} left`, tone: 'processing' };
  const days = daysOf(left);
  return { text: `${days} ${days === 1 ? 'day' : 'days'} left`, tone: 'pending' };
}

/** `10 Sep → 20 Sep`, or as much of it as there is. */
export function windowText(start, end) {
  if (start && end) return `${fmt(start)} → ${fmt(end)}`;
  if (end) return `Due ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return 'No dates';
}

/**
 * The launch countdown, broken into parts the banner can lay out separately.
 *
 * Separate from `hms` because this one is READ AT A GLANCE from across a room,
 * not scanned in a list: the days want to be big and the clock beside them, and
 * a single formatted string cannot be styled in two sizes.
 *
 * The past is not folded into the future. Once the launch date has gone by this
 * counts UP and says so — a countdown that quietly restarts, or freezes at
 * zero, is how a slipped launch stops being visible.
 */
export function launchClock(at, now) {
  if (!at) return null;
  const target = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(target.getTime())) return null;

  const diff = target - now;
  const past = diff < 0;
  let r = Math.abs(diff);
  const days = Math.floor(r / DAY); r -= days * DAY;
  const h = Math.floor(r / 3600000); r -= h * 3600000;
  const m = Math.floor(r / 60000); r -= m * 60000;
  return {
    past,
    days,
    clock: `${pad(h)}:${pad(m)}:${pad(Math.floor(r / 1000))}`,
    target,
  };
}

/** How far through its own window a task is — 0..1, and 1 once complete. */
export function fractionOf(state, start, end, now) {
  if (state === TASK_STATE.COMPLETE) return 1;
  if (!start || !end || end <= start) return 0;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}
