/**
 * The app's single configured dayjs instance — plugins are extended once here so
 * callers never have to track which ones are loaded. `isoWeek` in particular is
 * required by the calendar grid, which lays weeks out Monday-first.
 */
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';

dayjs.extend(isoWeek);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);
dayjs.extend(relativeTime);

export default dayjs;
