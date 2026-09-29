import { ChecklistMaster, ChecklistTask } from './checklist.model.js';
import { checklistService } from './checklist.service.js';
import { ORG_EVENTS, onOrgEvent } from '../org/org.events.js';

/** Keep checklist data consistent with org-level changes. */

// Declaring a holiday clears it: daily occurrences drop, others move to the next free day.
onOrgEvent(ORG_EVENTS.HOLIDAYS_ADDED, (keys) => checklistService.adjustForHolidays(keys));

// Deleting a group keeps its routines and history — they're just un-grouped.
onOrgEvent(ORG_EVENTS.GROUP_DELETED, async (groupId) => {
  await Promise.all([
    ChecklistMaster.updateMany({ group: groupId }, { $unset: { group: 1 } }),
    ChecklistTask.updateMany({ group: groupId }, { $unset: { group: 1 } }),
  ]);
});
