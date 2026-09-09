/**
 * Which "yes" a phase actually has.
 *
 * Most phases approve a submission. PHASE 1 DOES NOT — a property is captured,
 * then shortlisted or rejected, and the one that eventually wins is marked by a
 * second shortlist after Site Evaluation. There is no such thing as an
 * approved Phase 1 property.
 *
 * That distinction was invisible on the Approvals queue, which offered a plain
 * "Approve" on every submitted record whatever phase it came from. Pressing it
 * on a property did not just mislabel it: `isPropertyApprovedAtP2` on the
 * server requires the status to be `shortlisted`, so an approved property can
 * never be chosen — Site Evaluation cannot resolve it, Commercial Finalization
 * cannot find it, and the project quietly cannot move on, with nothing on any
 * screen saying why. Five real properties on MR-MUM-001 were stranded that way.
 *
 * The server now refuses the wrong decision (STAGE_DECISION_BANS in
 * record.service.js). This is the other half: don't offer it. One rule, read by
 * the Approvals queue and the generic phase page alike, so they cannot drift
 * into labelling the same button two different ways.
 */

/** Phases whose positive decision is Shortlist, not Approve. */
const SHORTLIST_PHASES = new Set(['p1']);

/**
 * The positive decision for a record: what to send, and what to call it.
 *
 * `label` is the button. `done` is how the result reads afterwards, so a
 * confirmation never says "Approved" about something that was shortlisted.
 */
export function positiveDecisionFor(stageKey) {
  if (SHORTLIST_PHASES.has(stageKey)) {
    return { decision: 'shortlist', label: 'Shortlist', done: 'Shortlisted' };
  }
  return { decision: 'approve', label: 'Approve', done: 'Approved' };
}

/**
 * Split a mixed selection by the decision each record actually takes.
 *
 * A queue showing every phase at once will have properties sitting next to
 * drawings and assessments. Approving forty rows should not fail on the three
 * that are properties, nor quietly skip them — each group is simply sent the
 * decision its own phase uses.
 *
 * Returns `[{ decision, label, ids }]`, ordered with the largest group first
 * so the button can name the common case.
 */
export function groupByDecision(records) {
  const groups = new Map();
  for (const r of records) {
    const { decision, label } = positiveDecisionFor(r.stageKey);
    if (!groups.has(decision)) groups.set(decision, { decision, label, ids: [] });
    groups.get(decision).ids.push(r._id);
  }
  return [...groups.values()].sort((a, b) => b.ids.length - a.ids.length);
}

export default { positiveDecisionFor, groupByDecision };
