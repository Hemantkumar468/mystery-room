/**
 * The PMS template catalogue — the drafts that must exist on SmartWhap.
 *
 * WHY THIS FILE EXISTS. The bodies lived only in docs/WHATSAPP_SETTINGS_SPEC.md,
 * so "are they approved yet?" could only be answered by a human comparing prose
 * against the provider dashboard. Holding them here lets a script answer it —
 * see scripts/whatsappTemplates.mjs.
 *
 * THIS IS NOT THE SOURCE OF TRUTH FOR SENDING. WhatsappTemplate (the mirror
 * filled by syncTemplates) is. A template listed here but not approved upstream
 * cannot be sent, and nothing in this file changes that. It is the submission
 * list and the checklist, nothing more.
 *
 * Every one is UTILITY / en. The task link is {{6}} rather than a URL button so
 * the ERP domain can change without a re-approval round.
 */

/** Matches WHATSAPP_EVENTS in whatsapp.model.js — one template per event. */
export const PMS_TEMPLATES = Object.freeze([
  {
    event: 'TASK_ASSIGNED',
    name: 'pms_task_assigned',
    category: 'UTILITY',
    language: 'en',
    footer: 'Mystery Rooms PMS',
    recipient: 'assignee',
    body: `Hi {{1}}, a new task has been assigned to you.

Phase: {{2}}
Task: {{3}}
Property: {{4}}
Due date: {{5}}

Open the task here: {{6}}

Please update the status in ERP once completed.`,
    samples: [
      'Vikram',
      'Phase 2 - Site Evaluation',
      'Vendor Identification',
      'Wave One, Sector 18 Noida',
      '05 Sep 2026',
      'https://erp.mysteryrooms.in/task/1042',
    ],
    bindings: [
      'recipient.name',
      'task.phase',
      'task.title',
      'task.property',
      'task.dueDate',
      'task.url',
    ],
  },
  {
    event: 'TASK_REMINDER',
    name: 'pms_task_reminder',
    category: 'UTILITY',
    language: 'en',
    footer: 'Mystery Rooms PMS',
    recipient: 'assignee',
    // {{5}} carries the lead time, so one template covers every reminder run.
    body: `Hi {{1}}, this is a reminder for your pending task.

Task: {{2}}
Property: {{3}}
Due date: {{4}}
Time left: {{5}}

Open the task here: {{6}}

Please complete it before the due date.`,
    samples: [
      'Vikram',
      'Vendor Identification',
      'Wave One, Sector 18 Noida',
      '05 Sep 2026',
      '2 days',
      'https://erp.mysteryrooms.in/task/1042',
    ],
    bindings: [
      'recipient.name',
      'task.title',
      'task.property',
      'task.dueDate',
      'alert.text',
      'task.url',
    ],
  },
  {
    event: 'TASK_OVERDUE',
    name: 'pms_task_overdue',
    category: 'UTILITY',
    language: 'en',
    footer: 'Mystery Rooms PMS',
    recipient: 'assignee',
    body: `Hi {{1}}, your assigned task is overdue.

Task: {{2}}
Property: {{3}}
Due date was: {{4}}
Overdue by: {{5}}

Open the task here: {{6}}

Please update the status in ERP immediately.`,
    samples: [
      'Vikram',
      'Vendor Identification',
      'Wave One, Sector 18 Noida',
      '05 Sep 2026',
      '3 days',
      'https://erp.mysteryrooms.in/task/1042',
    ],
    bindings: [
      'recipient.name',
      'task.title',
      'task.property',
      'task.dueDate',
      'alert.text',
      'task.url',
    ],
  },
  {
    event: 'TASK_COMPLETED',
    name: 'pms_task_completed',
    category: 'UTILITY',
    language: 'en',
    footer: 'Mystery Rooms PMS',
    // Goes to the manager / MD, not the doer.
    recipient: 'manager',
    body: `Hi {{1}}, a task has been marked as completed.

Task: {{2}}
Property: {{3}}
Completed by: {{4}}
Completed on: {{5}}

Review the task here: {{6}}

Please verify and approve it in ERP.`,
    samples: [
      'Rahul',
      'Vendor Identification',
      'Wave One, Sector 18 Noida',
      'Vikram',
      '04 Sep 2026',
      'https://erp.mysteryrooms.in/task/1042',
    ],
    bindings: [
      'recipient.name',
      'task.title',
      'task.property',
      'task.completedBy',
      'task.completedOn',
      'task.url',
    ],
  },
]);

/** Count of {{n}} in a body — the same rule the provider mirror uses. */
export const countVariables = (body) => (String(body).match(/\{\{\s*\d+\s*\}\}/g) || []).length;

export default PMS_TEMPLATES;
