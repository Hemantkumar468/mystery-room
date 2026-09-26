/**
 * Hook registry for org-level changes that other modules must follow — a group
 * deleted, a category renamed, a holiday declared. Delegation and checklist
 * register handlers here, so the org module never imports their internals.
 *
 *   ORG_EVENTS.GROUP_DELETED     (groupId)
 *   ORG_EVENTS.CATEGORY_RENAMED  (oldName, newName)
 *   ORG_EVENTS.HOLIDAYS_ADDED    (dateKeys[])  → returns a summary object
 */
export const ORG_EVENTS = Object.freeze({
  GROUP_DELETED: 'group.deleted',
  CATEGORY_RENAMED: 'category.renamed',
  HOLIDAYS_ADDED: 'holidays.added',
});

const handlers = new Map();

export const onOrgEvent = (name, fn) => {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
};

/** Run every handler in order; returns their results. */
export const emitOrgEvent = async (name, ...args) => {
  const results = [];
  for (const fn of handlers.get(name) || []) {
    results.push(await fn(...args));
  }
  return results;
};
