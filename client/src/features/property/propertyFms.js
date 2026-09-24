/**
 * The four FMS pillars for each Property step — What, Who, When, How.
 *
 * WHAT / WHO / WHEN ARE NOT WRITTEN HERE. They are already written, once, in
 * the template's `whatWhoWhenHow` for the stage each step works on — the
 * client's own functional flow document, seeded in clientFlowTemplate.js. A
 * second copy in the client would be a second set of role names and turnaround
 * times to keep in step with the first, and it would lose the argument the day
 * somebody edited the template. So each step names the STAGE it reads from and
 * the rows come off that.
 *
 * HOW IS THE ONE THIS ADDS. The template states the method in prose — "Mobile
 * form with live GPS", "Comparison view" — which tells you the kind of thing to
 * do but not where it is. The pillar is that an executor must not have to guess
 * how to perform the step, so every step also carries the real destination in
 * THIS app: the button that opens the form, and where it is. That is knowledge
 * the template cannot hold, because it is about this UI rather than the
 * process.
 *
 * STEP 2 OWNS ITS ROWS. Deciding the road is not a template stage — it is the
 * decision Phase 1 records as "Review & shortlist properties" and the fork the
 * client's diagram draws after capture. Its row is written out rather than
 * read, and it deliberately reuses Phase 1's own owner and turnaround so the
 * two cannot disagree about who decides or how long they have.
 */

export const PROPERTY_FMS = {
  'property-capture': {
    stageKey: 'p1',
    /* Said in the deliverable's terms, not the activity's — "Talk to the
       landlord" is not a milestone, a filed record is. */
    deliverable: 'Every candidate site filed as a Phase 1 property record — area, floor, commercial terms, owner/broker contact, photos and live GPS.',
    how: {
      label: 'Capture a property',
      hint: 'The Phase 1 property form, on this page. Franchisee and referral links feed the same queue.',
    },
  },

  'property-md-review': {
    /* No stage of its own: the decision is taken ON the p1 record, which is
       why this step files nothing. */
    stageKey: null,
    rows: [
      {
        what: 'A road decided for every filed property, and the forms for that road opened on it',
        who: 'MD',
        when: 'Within 2 days of the property being filed',
        how: 'Shortlist — assessment, commercial, or straight to project',
      },
      {
        what: 'A rejected property recorded with the reason it was a no',
        who: 'MD',
        when: 'Same sitting',
        how: 'Reject, with a reason',
      },
    ],
    deliverable: 'Every captured property sent down exactly one road with its forms already open, or turned down with a reason on the record.',
    how: {
      label: 'Shortlist or Reject on the row',
      hint: 'Shortlist asks which road and opens the forms for it. Reject needs a reason — it is what the expansion map is built from.',
    },
  },

  'property-assessment': {
    stageKey: 'p2',
    deliverable: 'Four independent assessments filed against the property, and a signed shortlist-or-reject decision on it.',
    how: {
      label: 'Open a form from its cell',
      hint: 'Each assessment is a cell on the row — Feasibility, Financial, Technical, Operational. Decide once they are in.',
    },
  },

  'property-selection': {
    /* The gate belongs to Phase 2, so its rows come from p2 — the same six
       the assessment step shows, because choosing is the last of them
       ("Approve / Reject property", MD, within 2 days). */
    stageKey: 'p2',
    deliverable: 'Exactly one site per project taken forward, with its six commercial documents opened, and the others decided rather than left hanging.',
    how: {
      label: 'Take this one forward',
      hint: 'Candidates for one project sit side by side with their four scores. Taking one forward opens its closure documents.',
    },
  },

  'property-commercial': {
    stageKey: 'p3',
    deliverable: 'Six executed documents on the property — LOI, lease, legal check, deposit, NOCs and approvals — each uploaded, not just agreed.',
    how: {
      label: 'Open a document from its cell',
      hint: 'One column per document. The cell opens that document’s own form; the column fills as it is filed.',
    },
  },

  'property-planning': {
    stageKey: 'p20',
    deliverable: 'Games chosen, opening and trial dates fixed, and the project created against the signed site.',
    how: {
      label: 'Plan the games and dates',
      hint: 'On the row. The LOI is shown as a fact, not a lock — planning does not wait on a slow landlord.',
    },
  },
};

/**
 * The rows to show for a step: the template stage's own, or the step's if it
 * owns them.
 *
 * Returns `[]` rather than invented content when the template carries nothing —
 * an empty four-column table reads as missing data, and `PhaseBrief` already
 * renders nothing for an empty list.
 */
export function fmsRowsFor(key, template) {
  const entry = PROPERTY_FMS[key];
  if (!entry) return [];
  if (entry.rows) return entry.rows;
  if (!entry.stageKey || !template) return [];
  return template.stages?.find((s) => s.key === entry.stageKey)?.whatWhoWhenHow || [];
}

export default PROPERTY_FMS;
