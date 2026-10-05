import { ASSESSMENTS } from '../../app/api/propertyCaptureApi.js';

/**
 * ONE ROW PER (PROPERTY × ASSESSMENT THAT WAS ACTUALLY ASKED FOR.)
 *
 * Steps 3 and 4 used to be one row per LOCATION, with the four assessments
 * spread across twenty-odd columns — Feasibility's five, then Financial's
 * five, and so on — and the properties of that city stacked inside each cell.
 * Two things were wrong with it. Comparing a property's own four meant
 * reading across 2,000px, and a property routed to ONE assessment still paid
 * for all four: three empty bands scrolled past on every row.
 *
 * So these steps now read the way Steps 5 and 6 already do. A property owns a
 * BLOCK of rows, its name printed once at the top, and each row inside the
 * block is one assessment: its score, its form, who owns it, when it is due,
 * who filed it. A property sent for two assessments is two rows. That is the
 * shape the client asked for, and it is the same shape the six commercial
 * documents and the project-creation plans already use.
 *
 * THE DIFFERENCE FROM STEP 5, and it matters: a property owes all six
 * commercial documents whether or not anybody has started them, so Step 5
 * always draws six rows. Assessments are CHOSEN — the MD picks which of the
 * four a site needs — so drawing four would re-state as outstanding work the
 * three that were deliberately not asked for.
 */

/**
 * WAS THIS ASSESSMENT ASKED FOR? Defined once, here, because it was defined
 * twice before and the two definitions disagreed.
 *
 * The queue's "#" column counted `state !== 'not_routed'`. The report modal
 * counted `entry || assignedTo || planDate`. They differ on a real case: a
 * task raised, assigned and dated, whose p2 record does not exist yet reads
 * `not_routed` — the slot's `state` describes the RECORD, not the decision.
 * So the count said 0/1 while the report showed a block assigned to a named
 * person, and both were drawing from the same payload.
 *
 * The decision was made if EITHER signal is present: a record exists, or a
 * task was raised for it. Nothing else is a decision.
 */
export function wasAskedFor(slot, entry) {
  if (entry) return true;
  if (!slot) return false;
  return slot.state !== 'not_routed' || Boolean(slot.assignedTo) || Boolean(slot.planDate);
}

/** The slot and the filed record for one assessment of one property. */
export function assessmentPartsOf(property, key) {
  const slot = (property?.assessmentSlots || []).find((s) => s.type === key) || null;
  const entry = (property?.assessments || []).find((a) => a.type === key) || null;
  return { slot, entry };
}

/**
 * The assessments one property was actually sent for, in the catalogue's
 * order so two properties never list the same two in a different sequence.
 */
export function askedAssessments(property) {
  return ASSESSMENTS
    .map(({ key, label }) => ({ key, label, ...assessmentPartsOf(property, key) }))
    .filter(({ slot, entry }) => wasAskedFor(slot, entry));
}

/** The ones nobody asked for — named, so their absence reads as a decision. */
export function skippedAssessments(property) {
  const asked = new Set(askedAssessments(property).map((a) => a.key));
  return ASSESSMENTS.filter(({ key }) => !asked.has(key));
}

/**
 * The flat row list the table renders.
 *
 * A PROPERTY WITH NO DECISION YET STILL GETS A ROW. It is in this step's
 * queue, so leaving it out would make it unreachable from the one screen that
 * is about it — the row carries the property and says the decision is
 * outstanding, which is itself the work. `type` is null on that row and every
 * assessment cell reads as empty, which is honest: there is nothing to show
 * until somebody chooses.
 */
export function assessmentRows(properties) {
  const out = [];
  for (const property of properties || []) {
    const asked = askedAssessments(property);
    const span = Math.max(1, asked.length);

    if (!asked.length) {
      out.push({
        id: `${property.id}:none`,
        property,
        type: null,
        label: null,
        slot: null,
        entry: null,
        span,
        isFirst: true,
        isLast: true,
        pending: true,
      });
      continue;
    }

    asked.forEach((a, i) => {
      out.push({
        id: `${property.id}:${a.key}`,
        property,
        type: a.key,
        label: a.label,
        slot: a.slot,
        entry: a.entry,
        span,
        /* The name is printed on the first row of the block and the block is
           ruled off from the next — repeating it on every row is what the eye
           reads as several properties. */
        isFirst: i === 0,
        isLast: i === asked.length - 1,
        pending: false,
      });
    });
  }
  return out;
}

/**
 * Flatten the queue's location rows back into properties.
 *
 * The server groups a city's sites into one row with `siblings`, which is
 * what the old location-per-row layout wanted. This layout wants the sites
 * themselves. `demand` rows are a standing ask for a city rather than a real
 * address, and an untitled sibling is a placeholder — neither is a property
 * anybody can assess, so neither becomes a row.
 */
export function propertiesOf(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const sites = (row.siblings || []).length ? row.siblings : [row];
    for (const s of sites) {
      if (s.stage === 'demand' || !s.title) continue;
      const id = String(s.id ?? s.recordId ?? '');
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      /* The sibling carries the site; the city and the queue-level fields
         live on the row it was folded into. */
      out.push({ ...row, ...s, id: s.id ?? row.id, siblings: row.siblings });
    }
  }
  return out;
}

export default assessmentRows;
