import { baseApi } from './baseApi.js';
import { toastPushed } from '../slices/notificationSlice.js';

/**
 * "You submitted the form — the task's checklist is still open."
 *
 * Filing a record is not ticking the checklist, and the doer is usually on a
 * phase page when they file it, far from the task that sent them there. So
 * every record SUBMIT (create or update, from any page) checks: did a task
 * send this person here (`?task=<code>`, see TaskFocusBanner), and does that
 * task still have unticked items? If so, a warning toast names them and links
 * straight back to the task with those items highlighted.
 *
 * Wired as `onQueryStarted` on createRecord / updateRecord, so no page has to
 * remember to call it — fourteen pages submit records, and a reminder that
 * depends on each of them is a reminder that is missing from most of them.
 *
 * Silent when: it was only a draft, the save failed, nobody arrived from a
 * task (the task page itself highlights its own checklist instead), or every
 * item is already ticked.
 */
export async function remindTaskChecklist() {
  // Disabled: do not show checklist reminder toast on record submit
}
