/**
 * Splitting one phase's register into the named lists people actually think in.
 *
 * A phase has ONE form, but sometimes two jobs. Phase 4 is the case: the
 * architect files a spread of front design options, and the same architect
 * files the working drawings. Both are "Drawings", both go through the same
 * form, and until this existed both landed in one table where the only thing
 * separating them was a value in a column — so "show me the design options"
 * meant knowing which of eleven drawing types meant that.
 *
 * The template says how to carve it up (`stage.recordGroups`, see
 * recordGroupSchema on the server). This file is the one place that reads
 * those rules, so the phase page and Data Explorer cannot drift into showing
 * the same records two different ways.
 *
 * A phase with no groups is left alone — `groupsFor` returns null and every
 * caller falls back to the single list it has always rendered.
 */

/** Does this record belong in this group? */
function belongs(group, record) {
  const value = record?.values?.[group.field];
  const has = value !== undefined && value !== null && value !== '';

  // A claiming group takes exactly the values it names.
  if (group.values?.length) return has && group.values.includes(String(value));

  // The catch-all takes everything else — including rows filed before the
  // split existed, which have no opinion about which list they belong to.
  if (group.excludeValues?.length) return !has || !group.excludeValues.includes(String(value));

  return true;
}

/**
 * The stage's groups, each with its own rows, or null if it declares none.
 *
 * Every record lands in exactly one list: the first group that claims it. A
 * record no group claims would vanish from the page entirely, so anything left
 * over is appended to the last group rather than dropped — a wrong list is
 * recoverable, an invisible record is not.
 */
export function groupsFor(templateStage, rows = []) {
  const groups = templateStage?.recordGroups;
  if (!groups?.length) return null;

  const claimed = new Set();
  const split = groups.map((group) => {
    const mine = rows.filter((r) => !claimed.has(r._id) && belongs(group, r));
    mine.forEach((r) => claimed.add(r._id));
    return { group, rows: mine };
  });

  const orphans = rows.filter((r) => !claimed.has(r._id));
  if (orphans.length) split[split.length - 1].rows.push(...orphans);
  return split;
}

/**
 * What a new entry in this list already knows about itself.
 *
 * Opening the form from "Initial front design options" should not then ask
 * which kind of drawing this is — the list answered that. Only a group that
 * claims a SINGLE value can seed one; a catch-all has nothing to say.
 */
export function seedFor(group) {
  if (group?.values?.length === 1) return { [group.field]: group.values[0] };
  return null;
}

/** The columns for this list — the group's own, else the form's first three. */
export function columnsFor(group, schema = []) {
  if (!group?.columns?.length) return schema.slice(0, 3);
  return group.columns
    .map((key) => schema.find((f) => f.key === key))
    .filter(Boolean);
}

/** The phase task this list belongs to, so an entry filed here is stamped with it. */
export function taskFor(group, tasks = []) {
  if (!group?.taskKey) return null;
  return tasks.find((t) => t.templateTaskKey === group.taskKey) || null;
}

export default { groupsFor, seedFor, columnsFor, taskFor };
