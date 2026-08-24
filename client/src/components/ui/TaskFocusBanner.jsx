import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Target, ArrowLeft } from 'lucide-react';
import { InfoPanel } from './primitives.jsx';

/**
 * "I am on this page because a task sent me here."
 *
 * TaskBrief links a doer from their task to the phase that holds the form,
 * carrying `?form=<key>&task=<code>` (see components/ui/TaskBrief.jsx). Every
 * phase page reads that the same way through this hook rather than parsing the
 * query string itself — Phase 3 grew its own copy first, and a second copy on
 * PhasePage is how the two drift apart.
 *
 * @returns {{form: string, taskCode: string}} empty strings when the doer
 *   arrived on their own, which every caller treats as "no focus".
 */
export function useTaskFocus() {
  const { search } = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      form: params.get('form') || '',
      taskCode: params.get('task') || '',
    };
  }, [search]);
}

/**
 * The banner a doer sees on arriving from their task.
 *
 * It exists to answer the one question the phase page cannot: filing this form
 * is not the same as finishing the task. Saving a record leaves the task exactly
 * where it was, so the way back has to be on screen — not in the browser's back
 * button, which a non-technical doer will not think of as part of the job.
 *
 * `formName` is omitted on phases that hold a single form (Phase 4's drawings,
 * Phase 5's BOQ): there is nothing to disambiguate, so naming it would only add
 * a word. Renders nothing without a task code — a doer who navigated here
 * themselves is not being sent back anywhere.
 */
export function TaskFocusBanner({ projectId, taskCode, formName }) {
  if (!taskCode || !projectId) return null;
  return (
    <InfoPanel
      icon={Target}
      tone="info"
      title={formName ? `Your task: ${formName}` : 'You were sent here by a task'}
    >
      <div className="col gap-2">
        <span>
          {formName
            ? `Fill ${formName} below — the other modules on this page belong to other people and are greyed out.`
            : 'Fill in your entry below.'}
          {' '}
          Saving it does <strong>not</strong> tick the task off; come back and mark it done.
        </span>
        <Link className="row gap-1" style={{ alignItems: 'center', width: 'fit-content' }} to={`/projects/${projectId}/tasks/${taskCode}`}>
          <ArrowLeft size={13} aria-hidden /> Back to task {taskCode}
        </Link>
      </div>
    </InfoPanel>
  );
}

export default TaskFocusBanner;
