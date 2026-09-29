import { Delegation } from './delegation.model.js';
import { DelegationRecurrence } from './recurrence.model.js';
import { DelegationTemplate } from './template.model.js';
import { ORG_EVENTS, onOrgEvent } from '../org/org.events.js';

/**
 * Keep delegation data consistent with org-level changes. Registered once,
 * when the delegation router is loaded.
 */

// A deleted group never takes its tasks with it — they're simply un-grouped.
onOrgEvent(ORG_EVENTS.GROUP_DELETED, async (groupId) => {
  await Promise.all([
    Delegation.updateMany({ group: groupId }, { $unset: { group: 1 } }),
    DelegationRecurrence.updateMany({ 'blueprint.group': groupId }, { $unset: { 'blueprint.group': 1 } }),
  ]);
});

// Tasks store the category name, so a rename is written through to them.
onOrgEvent(ORG_EVENTS.CATEGORY_RENAMED, async (oldName, newName) => {
  const [tasks] = await Promise.all([
    Delegation.updateMany({ category: oldName }, { category: newName }),
    DelegationRecurrence.updateMany({ 'blueprint.category': oldName }, { 'blueprint.category': newName }),
    DelegationTemplate.updateMany({ category: oldName }, { category: newName }),
  ]);
  return tasks.modifiedCount || 0;
});
