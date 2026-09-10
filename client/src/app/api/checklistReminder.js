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
export async function remindTaskChecklist(arg, { dispatch, queryFulfilled }) {
  if (arg?.status !== 'submitted') return;
  try {
    await queryFulfilled;
  } catch {
    return; // the error toast already said what went wrong
  }
  if (typeof window === 'undefined') return;
  const code = new URLSearchParams(window.location.search).get('task');
  const endpoint = baseApi.endpoints.getTaskByCode;
  if (!code || !endpoint) return;

  const { data: task } = await dispatch(endpoint.initiate(code, { forceRefetch: true, subscribe: false }));
  const open = (task?.checklist || []).filter((c) => !c.done);
  if (!open.length) return;

  const projectId = task.project?._id || task.project || arg.projectId;
  const n = open.length;
  const named = open.slice(0, 2).map((c) => c.label).join(' · ');
  dispatch(toastPushed({
    kind: 'warning',
    message: `Submitted. Task ${code} still has ${n} checklist item${n === 1 ? '' : 's'} to tick.`,
    detail: `Tick off what this covers: ${named}${n > 2 ? ` +${n - 2} more` : ''}`,
    timeout: 12000,
    action: projectId ? { label: 'Tick the checklist', to: `/projects/${projectId}/tasks/${code}?checklist=1` } : null,
  }));
}
