import { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Loader2 } from 'lucide-react';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useTasks, useUpdateTaskStatusMutation } from '../../app/api/tasksApi.js';
import { SelectMenu } from '../../components/ops/SelectMenu.jsx';

/**
 * "I have finished filing properties for this store."
 *
 * ── Why this step exists at all ──────────────────────────────────────
 * Filing a property does NOT finish the job. A store is hunted by walking
 * several shops and writing each one down, and the person doing it decides
 * when they have enough — so the capture task deliberately stays open when a
 * property is saved (record.service.js#completeTaskForForm bails unless the
 * record is an assessment). Nothing closed it either: the doer filed three
 * sites and the task sat open for ever, because the only way to end it was
 * to go and find it in My Tasks, away from the work.
 *
 * So the form ends on this: what was filed, and the two things that can
 * happen next.
 *
 * ── Which task, and why this is not a one-liner ──────────────────────
 * "The capture task" is not a fixed thing. Phase 1 is whatever the project's
 * TEMPLATE says it is, and the two in use here disagree:
 *
 *   clientFlowTemplate  p1_capture   "Capture the properties on site"    (0)
 *                       p1_shortlist "Review the captured properties…"   (1)
 *
 *   storeLaunchTemplate p1_t1 "Search & source candidate properties"     (0)
 *                       p1_t2 "Capture property details"                 (1)
 *                       p1_t3 "Upload documents & photographs"           (2)
 *                       p1_t4 "Shortlist or reject decision"             (3)
 *
 * So "the lowest open p1 task" is the capture on one template and the
 * SEARCH on the other — and once the earlier ones close it would land on
 * "Shortlist or reject decision", which belongs to the MD. Picking by title
 * is no better; templates are data and can say anything.
 *
 * Three rules instead, in order:
 *   1. a decision step is never offered — that is somebody else's answer;
 *   2. one candidate is used, named on the button so it can be checked;
 *   3. several, and the doer says which. A guess that closes the wrong task
 *      is worse than one short question.
 */

/* Steps that END the phase rather than doing its work. Matched on the
   template key AND the title, because a template can supply either. */
const DECIDES = /shortlist|reject|decision|review|approve|sign.?off/i;

export function CaptureTaskDone({ project, filedThisSession, lastTitle, onAnother, onClose }) {
  const me = useAppSelector(selectCurrentUser);
  const myId = me?._id || me?.id || null;
  const [chosenId, setChosenId] = useState('');

  /* Only this store's Phase 1 — a handful of tasks, so no paging to think
     about, and skipped entirely until there is a store to ask about. */
  const { data: resp, isFetching } = useTasks(
    { project: project?._id, stageKey: 'p1', limit: 20 },
    { skip: !project?._id },
  );
  const [updateStatus, { isLoading: finishing }] = useUpdateTaskStatusMutation();

  const candidates = useMemo(() => {
    const rows = resp?.data;
    const list = Array.isArray(rows) ? rows : (rows?.items || rows?.rows || []);
    return list
      .filter((t) => t.status !== 'complete')
      /* Theirs. Capturing on somebody else's behalf does not close their
         work for them — those people get the plain Close. */
      .filter((t) => myId && String(t.assignee?._id || t.assignee || '') === String(myId))
      .filter((t) => !DECIDES.test(`${t.templateTaskKey || ''} ${t.title || ''}`))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [resp, myId]);

  /* The one that actually says capture wins; otherwise the earliest. */
  const preferred = useMemo(() => (
    candidates.find((t) => /captur/i.test(`${t.templateTaskKey || ''} ${t.title || ''}`))
    || candidates[0]
    || null
  ), [candidates]);

  const task = candidates.find((t) => t._id === chosenId) || preferred;

  const finish = async () => {
    if (!task) return;
    try {
      await updateStatus({ id: task._id, status: 'complete', projectId: project?._id }).unwrap();
      onClose?.({ finished: true, task });
    } catch {
      /* The properties are filed either way — a failed task update must not
         read as a failed save. */
      onClose?.({ finished: false, failed: true });
    }
  };

  return (
    <div className="cap-done">
      <div className="cap-done-head">
        <CheckCircle2 size={18} />
        <div>
          <b>{lastTitle ? `${lastTitle} filed` : 'Property filed'}</b>
          <span className="tiny muted">
            {project?.name ? `on ${project.name}` : 'on this store'}
            {filedThisSession > 1 ? ` · ${filedThisSession} filed in this sitting` : ''}
          </span>
        </div>
      </div>

      <p className="sm cap-done-ask">Anything else for this store?</p>

      {/* Asked only when it is a real question. One task is named on the
          button below; none means there is nothing of theirs to finish. */}
      {candidates.length > 1 && (
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="label">Which of your tasks have you finished?</span>
          <SelectMenu
            value={task?._id || ''}
            onChange={setChosenId}
            aria-label="Which task"
            options={candidates.map((t) => ({
              value: t._id,
              label: t.code ? `${t.title} · ${t.code}` : t.title,
            }))}
          />
        </label>
      )}

      <div className="cap-done-acts">
        <button type="button" className="btn btn-ghost" onClick={onAnother}>
          <Plus size={14} /> Capture another property
        </button>

        {isFetching ? (
          <button type="button" className="btn btn-primary" disabled>
            <Loader2 size={14} /> Checking your tasks…
          </button>
        ) : task ? (
          <button type="button" className="btn btn-primary" disabled={finishing} onClick={finish}>
            <CheckCircle2 size={14} />
            {finishing ? 'Finishing…' : 'I have finished — mark my task done'}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => onClose?.({ finished: false })}>
            Close
          </button>
        )}
      </div>

      {task && (
        <p className="tiny muted cap-done-note">
          This closes <b>{task.title}</b>{task.code ? ` (${task.code})` : ''}. The properties stay
          in the queue for MD Review &amp; Decision — finishing here says you have stopped looking,
          not that anything has been approved.
        </p>
      )}
    </div>
  );
}

export default CaptureTaskDone;
