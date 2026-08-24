/**
 * HRMS vocabulary — hiring for a new centre, from "we need people" to "hired".
 *
 * Deliberately small. The client document scopes HR as a module that follows
 * PMS, and the first thing it has to do is the thing PMS needs: when a centre
 * is being opened, raise the roles, publish the job, collect applications,
 * move candidates through a pipeline, and record who was hired. Payroll,
 * leave and attendance are not here.
 */

export const REQUISITION_STATUS = Object.freeze({
  DRAFT: 'draft',
  OPEN: 'open',
  ON_HOLD: 'on_hold',
  FILLED: 'filled',
  CLOSED: 'closed',
});
export const REQUISITION_STATUS_VALUES = Object.values(REQUISITION_STATUS);

export const EMPLOYMENT_TYPE = Object.freeze({
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  CONTRACT: 'contract',
  INTERN: 'intern',
});
export const EMPLOYMENT_TYPE_VALUES = Object.values(EMPLOYMENT_TYPE);

/**
 * The pipeline, in order. A candidate is in exactly one stage; moving them
 * appends to `stageHistory`, so "how long did screening take" is answerable
 * later without a second collection.
 */
export const CANDIDATE_STAGE = Object.freeze({
  APPLIED: 'applied',
  SCREENING: 'screening',
  INTERVIEW: 'interview',
  OFFER: 'offer',
  HIRED: 'hired',
  REJECTED: 'rejected',
});
export const CANDIDATE_STAGE_VALUES = Object.values(CANDIDATE_STAGE);

/** The stages a candidate moves THROUGH, left to right on the board. */
export const PIPELINE_ORDER = Object.freeze([
  CANDIDATE_STAGE.APPLIED,
  CANDIDATE_STAGE.SCREENING,
  CANDIDATE_STAGE.INTERVIEW,
  CANDIDATE_STAGE.OFFER,
  CANDIDATE_STAGE.HIRED,
]);

export const CANDIDATE_SOURCE = Object.freeze({
  WEBSITE: 'website',
  REFERRAL: 'referral',
  JOB_PORTAL: 'job_portal',
  WALK_IN: 'walk_in',
  AGENCY: 'agency',
  OTHER: 'other',
});
export const CANDIDATE_SOURCE_VALUES = Object.values(CANDIDATE_SOURCE);

/**
 * The roles a Mystery Rooms centre typically opens with. Offered as quick
 * picks when raising a requisition — every one is editable, and a free-text
 * title is always allowed.
 */
export const CENTRE_ROLE_PRESETS = Object.freeze([
  { title: 'Game Master', department: 'operations', headcount: 4 },
  { title: 'Centre Manager', department: 'operations', headcount: 1 },
  { title: 'Front Desk Executive', department: 'operations', headcount: 2 },
  { title: 'Housekeeping Staff', department: 'operations', headcount: 2 },
  { title: 'Marketing Executive', department: 'marketing', headcount: 1 },
  { title: 'Maintenance Technician', department: 'automation', headcount: 1 },
]);
