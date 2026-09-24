import { REQUISITION_STATUS } from '../hrms.constants.js';

/**
 * Is the public apply link live right now, and if not, why not?
 *
 * ONE RULE, ONE PLACE. Three callers need this answer and they must never
 * disagree: the public job page (what an applicant sees), the public submit
 * endpoint (what actually gets accepted), and the requisition page HR looks
 * at. A link that renders a form but rejects the submission — or, worse, one
 * HR believes is off while it is still taking applications — is exactly the
 * failure this module exists to make impossible.
 *
 * A requisition can be shut in five different ways and they are NOT the same
 * thing to the person reading the page. "We filled the role" is good news;
 * "applications closed on Tuesday" tells them they were late; "opens on
 * Monday" tells them to come back. Collapsing all of that into one
 * "position closed" screen is what made the old page feel like a dead end,
 * so the reason travels with the answer.
 */
export const APPLY_CLOSED_REASON = Object.freeze({
  /** No such requisition, deleted, or never published. Deliberately one
   *  reason: a draft must not be discoverable by trying ids. */
  NOT_FOUND: 'not_found',
  ON_HOLD: 'on_hold',
  FILLED: 'filled',
  CLOSED: 'closed',
  /** HR pressed "Stop accepting applications". */
  SWITCHED_OFF: 'switched_off',
  /** Scheduled to open later. */
  NOT_YET_OPEN: 'not_yet_open',
  /** The closing date and time has passed. */
  EXPIRED: 'expired',
});

/**
 * @param {object|null} r        a Requisition document or lean object
 * @param {Date}        [now]    injectable so this is testable without waiting
 * @returns {{open: boolean, reason: string|null, opensAt: Date|null, closesAt: Date|null}}
 */
export function applyWindow(r, now = new Date()) {
  const opensAt = r?.applyOpensAt ? new Date(r.applyOpensAt) : null;
  const closesAt = r?.applyClosesAt ? new Date(r.applyClosesAt) : null;
  const shut = (reason) => ({ open: false, reason, opensAt, closesAt });

  if (!r || r.deletedAt) return { open: false, reason: APPLY_CLOSED_REASON.NOT_FOUND, opensAt: null, closesAt: null };

  // A draft is indistinguishable from a wrong id on purpose. Anything else
  // leaks that a role is being planned before anyone is meant to know.
  if (r.status === REQUISITION_STATUS.DRAFT) {
    return { open: false, reason: APPLY_CLOSED_REASON.NOT_FOUND, opensAt: null, closesAt: null };
  }

  // Status first: it is the coarsest statement of intent, and a filled role
  // stays filled no matter what the schedule says.
  if (r.status === REQUISITION_STATUS.FILLED) return shut(APPLY_CLOSED_REASON.FILLED);
  if (r.status === REQUISITION_STATUS.CLOSED) return shut(APPLY_CLOSED_REASON.CLOSED);
  if (r.status === REQUISITION_STATUS.ON_HOLD) return shut(APPLY_CLOSED_REASON.ON_HOLD);

  // The manual switch beats the schedule. Someone pressing "stop now" has
  // more current information than a date they typed last week, and the whole
  // point of that button is that it does not need the schedule edited first.
  if (r.acceptingApplications === false) return shut(APPLY_CLOSED_REASON.SWITCHED_OFF);

  // Invalid dates (a bad string that reached the database) are treated as
  // "no schedule" rather than silently closing a live link.
  if (opensAt && !Number.isNaN(opensAt.getTime()) && now < opensAt) {
    return shut(APPLY_CLOSED_REASON.NOT_YET_OPEN);
  }
  if (closesAt && !Number.isNaN(closesAt.getTime()) && now >= closesAt) {
    return shut(APPLY_CLOSED_REASON.EXPIRED);
  }

  return { open: true, reason: null, opensAt, closesAt };
}

/**
 * What the applicant is told. Kept beside the rule so a new reason cannot be
 * added without someone deciding what it says out loud.
 *
 * `NOT_FOUND` is the only one that does not name the role, because at that
 * point we are not admitting there is one.
 */
export const APPLY_CLOSED_COPY = Object.freeze({
  [APPLY_CLOSED_REASON.NOT_FOUND]: {
    headline: 'This link is not available',
    body: 'The link may be mistyped, or the role may have been withdrawn. Please check the link you were sent.',
  },
  [APPLY_CLOSED_REASON.ON_HOLD]: {
    headline: 'Applications are paused',
    body: 'This role is on hold for the moment. It may reopen — it is worth checking back.',
  },
  [APPLY_CLOSED_REASON.FILLED]: {
    headline: 'This role has been filled',
    body: 'Thank you for your interest in Mystery Rooms. Do look out for our other openings.',
  },
  [APPLY_CLOSED_REASON.CLOSED]: {
    headline: 'This role is closed',
    body: 'We are no longer hiring for this position. Thank you for your interest in Mystery Rooms.',
  },
  [APPLY_CLOSED_REASON.SWITCHED_OFF]: {
    headline: 'Applications are closed',
    body: 'We have enough applications for this role for now. Thank you for your interest in Mystery Rooms.',
  },
  [APPLY_CLOSED_REASON.NOT_YET_OPEN]: {
    headline: 'Applications open soon',
    body: 'This role is not taking applications just yet. Save this link and come back on the date below.',
  },
  [APPLY_CLOSED_REASON.EXPIRED]: {
    headline: 'Applications have closed',
    body: 'The closing date for this role has passed. Thank you for your interest in Mystery Rooms.',
  },
});
