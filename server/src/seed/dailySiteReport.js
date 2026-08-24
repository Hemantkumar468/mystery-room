/**
 * The Daily Site Report — Phase 7 / Site Execution's highest-frequency screen.
 *
 * One definition, used by both the seed (clientFlowTemplate.js) and the live
 * migration (migrateDailySiteReport.js), so a fresh database and an existing
 * deployment end up with byte-identical forms.
 *
 * Shape follows the client document, Phase 8 "Daily Site Report — Fields":
 * date & shift, manpower by trade (planned vs actual), work completed with a
 * progress figure, materials received / consumed / short, quality
 * observations, mandatory photographs, and blockers with an owner. Designed
 * for a phone and for under two minutes: every count is a numeric keypad,
 * everything optional is collapsed behind a yes/no, and the photographs are
 * the only required upload.
 *
 * Modelled as an assessmentType on the p6 stage rather than a new stage: the
 * record machinery (forms, drafts, photos, soft delete, activity log, the list
 * on the Execution page) already exists for that shape, and a report IS a
 * record of the phase — not a phase of its own.
 */
import { DEPARTMENTS as D, PRIORITY as P, MASTER_DATA_FIELD_TYPES as F } from '../core/constants/index.js';
import { t } from './storeLaunchTemplate.js';

export const DAILY_SITE_REPORT_KEY = 'daily_site_report';

const TRADES = [
  ['masons', 'Masons'],
  ['carpenters', 'Carpenters'],
  ['electricians', 'Electricians'],
  ['painters', 'Painters'],
  ['helpers', 'Helpers'],
];

export const DAILY_SITE_REPORT_TYPE = Object.freeze({
  key: DAILY_SITE_REPORT_KEY,
  name: 'Daily Site Report',
  subtitle: 'Filed by the site supervisor every working day',
  // A diary entry, not a submission: filing it IS the point. No shortlist, no
  // reject, and it never reaches anyone's approvals queue.
  noDecision: true,
  masterDataSchema: [
    // ── When ──
    {
      key: 'report_date', label: 'Report for (date)', type: F.DATE, required: true, section: 'Report', order: 0,
      helpText: 'Today, normally. Filing for an earlier day is allowed — it is marked as a late entry.',
    },
    {
      key: 'shift', label: 'Shift', type: F.SELECT, section: 'Report', order: 1,
      options: ['Day', 'Evening', 'Night'],
    },
    {
      key: 'overall_progress_pct', label: 'Overall site progress (%)', type: F.NUMBER, required: true,
      min: 0, max: 100, section: 'Report', order: 2,
      helpText: 'Your honest estimate of how much of the whole civil + fit-out job is done, 0–100.',
    },
    {
      key: 'work_done', label: 'Work completed today', type: F.TEXTAREA, required: true, aiAssist: true,
      section: 'Report', order: 3,
      helpText: 'Activity-wise — e.g. "Partition framing in rooms 2–3 done, flooring screed in lobby 60%".',
    },

    // ── Manpower ──
    { key: 'planned_workers', label: 'Workers planned today', type: F.NUMBER, min: 0, section: 'Manpower on site', order: 4 },
    ...TRADES.map(([key, label], i) => ({
      key, label, type: F.NUMBER, min: 0, section: 'Manpower on site', order: 5 + i,
    })),

    // ── Materials ──
    { key: 'materials_received', label: 'Materials received today', type: F.TEXTAREA, section: 'Materials', order: 10 },
    { key: 'materials_consumed', label: 'Materials consumed today', type: F.TEXTAREA, section: 'Materials', order: 11 },
    { key: 'material_shortage', label: 'Any material shortage?', type: F.BOOLEAN, section: 'Materials', order: 12 },
    {
      key: 'shortage_details', label: 'What is short, and what it is holding up', type: F.TEXTAREA,
      section: 'Materials', order: 13, showIf: { field: 'material_shortage', in: [true] },
    },

    // ── Quality ──
    {
      key: 'quality_issues', label: 'Quality observations / rework needed', type: F.TEXTAREA,
      section: 'Quality', order: 14, helpText: 'Leave blank if nothing to report.',
    },

    // ── Blockers ──
    { key: 'blocked', label: 'Is anything blocking work?', type: F.BOOLEAN, section: 'Blockers', order: 15 },
    {
      key: 'blocker_details', label: 'What is blocking, and since when', type: F.TEXTAREA, required: true,
      section: 'Blockers', order: 16, showIf: { field: 'blocked', in: [true] },
    },
    {
      key: 'blocker_owner', label: 'Who needs to act on it', type: F.TEXT,
      section: 'Blockers', order: 17, showIf: { field: 'blocked', in: [true] },
      helpText: 'A name or a department — the person whose decision or delivery unblocks the site.',
    },

    // ── Evidence ──
    {
      key: 'site_photos', label: "Today's site photographs", type: F.FILE, multiple: true, required: true,
      accept: 'image/*,video/*', section: 'Photographs', order: 18,
      helpText: 'Mandatory every day. A few wide shots of the work areas plus anything you flagged above.',
    },
    {
      key: 'backdate_reason', label: 'Reason, if filing for an earlier day', type: F.TEXTAREA,
      section: 'Notes', order: 19, helpText: 'Only needed when the report date is not today.',
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 20 },
  ],
});

/**
 * The Site Supervisor's task — the entry point for the form. Assigned to the
 * Construction department, lives the whole execution window, and completes
 * (with PM sign-off) only once the civil work is done.
 *
 * Built on the same `t()` the 10-phase template uses so every field the task
 * model expects (assignees, checklist shape, estimatedDays…) is right.
 */
export const DAILY_SITE_REPORT_TASK = Object.freeze({
  ...t(
    'p6_daily_report',
    'Report from site every working day',
    D.CONSTRUCTION,
    45,
    P.HIGH,
    [
      'A report filed for every working day',
      'Photographs attached to every report',
      'Every blocker raised the same day it appeared',
      'Civil and fit-out works complete as per approved drawings and BOQ',
    ],
    [
      'A report filed for every working day',
      'Civil and fit-out works complete as per approved drawings and BOQ',
    ],
  ),
  brief: {
    what: 'Report from site every working day',
    who: 'Site Supervisor',
    when: 'Every working day, by 6 pm',
    how: 'Open the daily form on your phone: progress, manpower, materials, photos, blockers — under two minutes. The reports build the list the PM and MD watch.',
  },
  formKey: DAILY_SITE_REPORT_KEY,
  approval: { required: true, approver: 'Project Manager' },
});

export default DAILY_SITE_REPORT_TYPE;
