import { Link } from 'react-router-dom';
import {
  CalendarDays, UserPlus, Users, MapPin, ArrowRight, CheckCircle2, Eye, Flame,
} from 'lucide-react';
import { Badge } from '../../components/ui/primitives.jsx';
import { TASK_STATUS_META, TASK_APPROVAL_META, PRIORITY_META } from '../../lib/ui.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { timeLeft } from './MyTasksPage.jsx';
import dayjs from '../../lib/dayjs.js';

/**
 * A TASK, AS THE PERSON DOING IT NEEDS IT — and nothing else.
 *
 * The task page had grown into a working file: a status stepper, a legal-moves
 * control, a checklist card, a progress rail, attachments, links, comments, an
 * activity log, an approval pipeline and six buttons, several of which went to
 * the same place. All of it is real, and almost none of it is what somebody
 * opening their own job at nine in the morning came for. They came to find out
 * four things — what is being asked, by whom, by when, and where to do it —
 * and then to do it.
 *
 * So those four things are the page now, in that order, and the rest is folded
 * away behind "More details" underneath. Nothing has been deleted; it has been
 * put in the order of the questions people actually ask.
 *
 * ── ONE BUTTON, AND IT IS THE NEXT THING TO DO ────────────────────────────
 *
 * A form-linked task has exactly one: open the form. Filing it completes the
 * task on the server (record.service.js#completeTaskForForm), so there is no
 * second "and now mark it done" step to forget — which is what the old page
 * required, and why tasks sat finished-but-open for days.
 *
 * A task with no form has exactly one too: mark it complete. Straight from
 * pending, with no "Start Task" in between. Starting is not a decision anybody
 * makes, it is a click people learn to make twice, and a two-step path to
 * "done" is how a list stops reflecting reality.
 *
 * SUBMIT FOR APPROVAL IS GONE FROM HERE, deliberately and by request. The
 * pipeline still exists on the server and approvers still have their queue;
 * what a doer is shown is finish the job. Handing them a second button whose
 * meaning is "now ask permission to have finished" put the last step of every
 * task in the hands of somebody who was not looking.
 */

/**
 * WHERE THIS TASK HAS GOT TO, as the four things that actually happen to it.
 *
 * The card said "Pending" in a badge and stopped there, which answers what
 * the task IS and not what has HAPPENED to it — and those are different
 * questions. "Has my assessment gone in?" and "is anybody looking at it yet?"
 * were unanswerable on the page that exists to answer them: the submission
 * time was in the activity log behind a fold, and the review state was a word
 * in a badge that most people read as the work state.
 *
 * Four steps, because a task only ever has four:
 *
 *   Assigned   — always. Who put it on the desk and when.
 *   Submitted  — the form filed, or the task marked complete by hand.
 *   In review  — only when somebody actually has to sign it off. A task with
 *                no approver skips this rather than showing a step that will
 *                never light, which would make every finished task look
 *                unfinished.
 *   Completed  — approved, or done where nothing needed approving.
 *
 * Every date comes off a field the server already writes, so nothing here can
 * claim something the record does not say.
 */
function buildTimeline(task) {
  const approval = task.approvalState || 'none';
  const waiting = approval === 'waiting_department' || approval === 'waiting_management';
  const approved = approval === 'approved';
  const rejected = approval === 'rejected';
  const submittedAt = task.completedAt || task.actualEnd || null;
  const isDone = task.status === 'complete' || approved;

  const steps = [
    {
      key: 'assigned',
      label: 'Assigned',
      at: task.createdAt,
      who: (task.createdBy && typeof task.createdBy === 'object' ? task.createdBy.name : null),
      state: 'done',
    },
    {
      key: 'submitted',
      label: task.appPath ? 'Form submitted' : 'Marked complete',
      at: submittedAt,
      who: task.completedBy?.name || null,
      state: isDone ? 'done' : 'todo',
    },
  ];

  /* Only when a signature is genuinely part of this task's life. A task that
     has never been sent for review and is not waiting on one has no review
     step — inventing one would leave every completed task showing an unlit
     circle, which reads as work still outstanding. */
  if (waiting || approved || rejected || task.submittedForApprovalAt) {
    steps.push({
      key: 'review',
      label: rejected ? 'Sent back' : 'In review',
      at: task.submittedForApprovalAt,
      who: task.submittedForApprovalBy?.name || null,
      state: rejected ? 'bad' : (approved ? 'done' : waiting ? 'now' : 'todo'),
      note: waiting
        ? (approval === 'waiting_management' ? 'With management' : 'With the department manager')
        : null,
    });
    steps.push({
      key: 'approved',
      label: 'Approved',
      at: task.approvedAt || task.managementApprovedAt,
      who: task.approvedBy?.name || task.managementApprovedBy?.name || null,
      state: approved ? 'done' : 'todo',
    });
  } else {
    steps.push({
      key: 'closed',
      label: 'Completed',
      at: isDone ? submittedAt : null,
      who: null,
      state: isDone ? 'done' : 'todo',
      /* Said out loud, because "am I waiting on somebody?" is the question
         this whole strip exists to answer and silence reads as "yes". */
      note: isDone ? 'Nothing further needed' : null,
    });
  }

  return steps;
}

/** One of the four facts, with its own icon and a second line of detail. */
function Fact({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className="tf-fact">
      <span className="tf-fact-ic" aria-hidden><Icon size={14} /></span>
      <span className="tf-fact-body">
        <span className="tf-fact-label">{label}</span>
        <span className="tf-fact-value">{value || '—'}</span>
        {sub && <span className="tf-fact-sub" style={tone ? { color: tone } : undefined}>{sub}</span>}
      </span>
    </div>
  );
}

/**
 * What this task is asking for, in one sentence.
 *
 * Written from the task rather than stored, because the useful sentence is
 * different for the two kinds of job and neither template carries it. A form
 * task says which form and that filing it finishes the job — the single fact
 * people got wrong most often. Anything else falls back to the task's own
 * description, and then to a plain statement rather than an empty panel.
 */
function whatToDo(task, formLabel) {
  if (task.appPath) {
    return `Fill in and submit the ${formLabel}. This task is marked complete automatically once you submit.`;
  }
  if (task.description) return task.description;
  return 'Do the work this task describes, then mark it complete below.';
}

/**
 * The form's name with a noun on the end.
 *
 * `formName` arrives as the label the template gives — "LOI", "Operational
 * assessment", "BOQ". On its own the short ones make no sentence: "Open LOI"
 * and "submit the LOI" both read as a missing word. The ones that already
 * carry a noun are left exactly as they are, because "Operational assessment
 * form" is worse than either.
 */
const withNoun = (formName) => {
  const n = String(formName || '').trim();
  if (!n) return 'the form';
  return /\b(form|assessment|checklist|plan|report)\b/i.test(n) ? n : `${n} form`;
};

export function TaskFocusCard({
  task, formName, projectName, onComplete, completing, canWork, submission,
}) {
  const formLabel = withNoun(formName);
  /**
   * THE BADGE SAYS WHERE IT STANDS, not which work-state field it is in.
   *
   * It printed `task.status`, so a task the doer had finished and sent for
   * sign-off read "Complete" — to that doer, indistinguishable from signed,
   * filed and finished. The two are very different things to be told at nine
   * in the morning. Approval wins whenever it has something to say; the plain
   * work state shows only while the task is still on the desk. Same rule as
   * the Status column on My Tasks (JourneyBadge), so one task cannot be
   * described two ways on two screens.
   */
  const approval = task.approvalState || 'none';
  const st = (approval !== 'none' && TASK_APPROVAL_META[approval])
    ? TASK_APPROVAL_META[approval]
    : (TASK_STATUS_META[task.status] || { label: task.status, color: 'var(--text-subtle)' });
  const pr = PRIORITY_META[task.priority] || {};
  const left = timeLeft(task.plannedEnd, dayjs());

  /* Every doer, not just the first. A shared task names all of them, because
     "assigned to Sana Sheikh" on a job three people can close is wrong twice. */
  const doers = task.assigneeRefs?.length ? task.assigneeRefs : (task.assignee ? [task.assignee] : []);
  const doerNames = doers.map((d) => d.name).filter(Boolean).join(', ');
  const doerSub = doers.length > 1
    ? `${doers.length} doers — whoever finishes first closes it`
    : (doers[0]?.title || doers[0]?.role || null);

  const assigner = task.createdBy && typeof task.createdBy === 'object' ? task.createdBy : null;
  const isForm = Boolean(task.appPath);
  const done = task.status === 'complete' || approval === 'approved';

  /* Red inside two days, amber for the rest of the week. Same thresholds and
     same words as the Time left column on My Tasks — a countdown that says one
     thing on the list and another on the page is worse than no countdown. */
  const dueTone = left?.tone === 'over' || left?.tone === 'soon'
    ? 'var(--danger)'
    : left?.tone === 'near' ? 'var(--warning)' : 'var(--text-subtle)';

  return (
    <section className="tf-card">
      <div className="tf-badges">
        <Badge color={st.color} soft={st.soft} dot>{st.label || task.status}</Badge>
        {pr.label && (
          <Badge color={pr.color} soft={pr.soft}>
            <Flame size={11} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden />
            {pr.label} priority
          </Badge>
        )}
      </div>

      <h1 className="tf-title">{task.title}</h1>
      <p className="tf-sub">
        {[task.code, task.stageName].filter(Boolean).join(' · ')}
      </p>

      <div className="tf-facts">
        <Fact
          icon={CalendarDays}
          label="Due date"
          value={task.plannedEnd ? fmtDate(task.plannedEnd) : 'No deadline'}
          sub={done ? null : left?.text}
          tone={dueTone}
        />
        <Fact
          icon={UserPlus}
          label="Assigned by"
          /* "The flow" rather than a dash: the tasks a project opens on its
             own genuinely have nobody behind them, and a dash reads as a name
             that failed to load. */
          value={assigner?.name || 'The flow'}
          sub={task.createdAt ? `on ${fmtDate(task.createdAt)}` : null}
        />
        <Fact
          icon={Users}
          label="Assigned to"
          value={doerNames || 'Nobody yet'}
          sub={doerSub}
        />
        <Fact
          icon={MapPin}
          label="Project"
          value={task.project?.code || projectName || '—'}
          sub={task.project?.city || task.project?.name}
        />
      </div>

      <ol className="tf-track">
        {buildTimeline(task).map((step) => (
          <li key={step.key} className={`tf-step is-${step.state}`}>
            <span className="tf-step-dot" aria-hidden />
            <span className="tf-step-body">
              <span className="tf-step-label">{step.label}</span>
              <span className="tf-step-when">
                {step.at
                  ? fmtDateTime(step.at)
                  : step.state === 'now' ? 'Now' : 'Not yet'}
                {step.who ? ` · ${step.who}` : ''}
              </span>
              {step.note && <span className="tf-step-note">{step.note}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="tf-do">
        <h2 className="tf-do-head">What you need to do</h2>
        <p className="tf-do-text">{whatToDo(task, formLabel)}</p>
      </div>

      {/*
        * PROOF IT LANDED, with a way to read it back.
        *
        * Submitting the form used to return somebody to a page that looked
        * exactly as it had before — same button, same wording — so the only
        * way to find out whether the work had saved was to open the form
        * again and look. This is the receipt: what was filed, when, and a
        * link to read it without touching it.
        */}
      {submission?.at && (
        <div className="tf-receipt">
          <CheckCircle2 size={15} aria-hidden />
          <span className="tf-receipt-text">
            Submitted <b>{fmtDateTime(submission.at)}</b>
            {submission.by ? <> by <b>{submission.by}</b></> : null}
          </span>
          {submission.href && (
            <Link className="tf-receipt-link" to={submission.href}>
              <Eye size={13} aria-hidden /> Preview
            </Link>
          )}
        </div>
      )}

      <div className="tf-cta">
        {isForm ? (
          <Link className="tf-btn" to={task.appPath}>
            Open {formLabel} <ArrowRight size={16} aria-hidden />
          </Link>
        ) : !done ? (
          <button
            type="button"
            className="tf-btn"
            onClick={onComplete}
            disabled={completing || !canWork}
            title={canWork ? 'Mark this task complete' : 'Only the assigned doer or a manager can complete this'}
          >
            <CheckCircle2 size={16} aria-hidden />
            {completing ? 'Completing…' : 'Mark as complete'}
          </button>
        ) : (
          <span className="tf-done-note">
            <CheckCircle2 size={15} aria-hidden /> This task is complete.
          </span>
        )}
      </div>

      {isForm && !done && (
        <p className="tf-hint">Saved a draft earlier? Open the form again to continue where you left off.</p>
      )}
    </section>
  );
}

export default TaskFocusCard;
