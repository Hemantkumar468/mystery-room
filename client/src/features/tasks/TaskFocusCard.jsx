import { Link } from 'react-router-dom';
import {
  CalendarDays, UserPlus, Users, MapPin, ArrowRight, CheckCircle2, Eye, Flame, Timer,
  Building2,
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
  /**
   * LOWER CASE MID-SENTENCE, unless the word is an acronym.
   *
   * The template capitalises its labels because they head a card — "Project
   * plan", "Vendor panel". Dropped into "Fill the …" they read as "Fill the
   * Project plan": a capital letter in the middle of a sentence, which looks
   * like a bug. Acronyms keep their case — "Fill the LOI" is right.
   */
  const cased = /^[A-Z]{2,}/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1);
  return /\b(form|assessment|checklist|plan|report|panel)\b/i.test(cased) ? cased : `${cased} form`;
};

/** The Purchase FMS steps, by the form key their task carries (clientFlowTemplate p13/p15). */
const PURCHASE_STEP_ACTION = {
  'boq-build': 'Fill BOQ',
  'boq-check': 'Check BOQ',
  'po-vendor': 'Select vendor',
  'po-raise': 'Raise the PO',
  'po-tracking': 'Update tracking',
  'po-grn': 'Book the GRN',
};

export function TaskFocusCard({
  task, formName, projectName, onComplete, completing, canWork, submission,
  isCapture, onCapture, multiFill,
  /* How many properties have been filed against this store so far. The
     capture task's finish button waits for the first one — a hunt nobody
     has started has nothing to declare finished. */
  capturedCount = 0,
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
  /**
   * EVERY DOER, AND THE NAMED ONE FIRST.
   *
   * This read `assigneeRefs` and fell back to `assignee` only when the list
   * was empty — so a task whose two fields disagreed showed the list and
   * hid the person actually assigned. That is not hypothetical: naming the
   * property hunter on the create form wrote `assignee` alone (fixed in
   * project.service.js), and every capture task made before that fix still
   * carries the mismatch. POOJA opened her own task and read "Assigned to
   * Vikram Rao, Manoj Parihar".
   *
   * The union, deduplicated by id, with `assignee` leading: whoever the task
   * names cannot be left off the card by a stale second field.
   */
  const doers = (() => {
    const refs = task.assigneeRefs || [];
    const primary = task.assignee;
    if (!primary) return refs;
    const idOf = (u) => String(u?._id || u);
    const rest = refs.filter((u) => idOf(u) !== idOf(primary));
    return [primary, ...rest];
  })();
  const doerNames = doers.map((d) => d.name).filter(Boolean).join(', ');
  const doerSub = doers.length > 1
    ? `${doers.length} doers — whoever finishes first closes it`
    : (doers[0]?.title || doers[0]?.role || null);

  const assigner = task.createdBy && typeof task.createdBy === 'object' ? task.createdBy : null;
  const isForm = Boolean(task.appPath);
  const done = task.status === 'complete' || approval === 'approved';
  const stepAction = PURCHASE_STEP_ACTION[task.formKey] || null;

  /* Red inside two days, amber for the rest of the week. Same thresholds and
     same words as the Time left column on My Tasks — a countdown that says one
     thing on the list and another on the page is worse than no countdown. */
  const dueTone = left?.tone === 'over' || left?.tone === 'soon'
    ? 'var(--danger)'
    : left?.tone === 'near' ? 'var(--warning)' : 'var(--text-subtle)';

  /* Filed means the FORM came back or the task is marked complete. */
  const filed = Boolean(
    submission?.at ||
    task.completedAt ||
    task.actualEnd ||
    task.status === 'complete' ||
    (task.records && task.records.length > 0) ||
    task.submittedAt ||
    task.formSubmitted
  );

  /**
   * WHEN IT CAME BACK — and `submission` is not the only thing that knows.
   *
   * `filed` above accepts seven different signs, and only the first of them
   * is the submission. `submission` itself is built by TaskDetailPage and is
   * NULL for any task without an `appPath` — every plain task that has no
   * form to file. So a plain task marked complete made `filed` true with
   * `submission` still null, and the receipt line below read `submission.at`
   * off it and took the whole page down with the error boundary. It was
   * guaranteed on exactly the tasks somebody had just finished.
   *
   * The stamp is taken from whichever source actually has one, in the same
   * order `filed` trusts them, and the line is simply not drawn when none
   * does — a receipt with no date on it says nothing worth a row.
   */
  const filedAt = submission?.at || task.completedAt || task.actualEnd || task.submittedAt || null;
  const filedBy = submission?.by || task.completedBy?.name || null;

  return (
    <section className="tf-card">
      <div className="tf-card-header">
        <div className="tf-card-header-left">
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
        </div>

        {/* NO SECOND COMPLETE BUTTON UP HERE.
            A capture task carried one in the header AND one in the action
            row below, both wired to the same `onComplete` — two controls,
            one action, a few inches apart, with different words on them
            ("Complete Task" above, "Task completed" below). That is not a
            choice, it is a thing to work out. The action row is where every
            other task keeps its button, so that is the one that stays. */}
      </div>

      <div className="tf-facts">
        <Fact
          icon={CalendarDays}
          label="Due date"
          value={task.plannedEnd ? fmtDate(task.plannedEnd) : 'No deadline'}
        />
        {/* ITS OWN COLUMN, not a grey sub-line under the due date. How long
            is left is the fact a doer opens this page for, and it was the
            smallest text on the card, sharing a slot with the date it is
            derived from. */}
        <Fact
          icon={Timer}
          label="Time left"
          value={done ? 'Completed' : (left?.text || (task.plannedEnd ? '—' : 'No deadline'))}
          tone={done ? null : dueTone}
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
          /* THE NAME, with the code underneath — it was the other way
             round, so the card led with "MR-TES-002" and buried the one
             thing anybody recognises. A code is a reference you quote, not
             a name you read. */
          value={projectName || task.project?.name || task.project?.code || '—'}
          sub={[task.project?.code, task.project?.city].filter(Boolean).join(' · ') || null}
        />
      </div>

      {/*
        * THE RAIL AND THE BRIEF ARE GONE, by request.
        *
        * A three-dot progress rail (Assigned / Form submitted / Completed)
        * over a "What you need to do" paragraph over a button that says the
        * same thing. Three ways of telling somebody to fill in a form, on a
        * page they opened to fill in a form. The badge says where the task
        * is and the button says what to do with it; everything between was
        * restating those two in longer words.
        */}

      {/*
        * ONE BUTTON, AND IT CHANGES WHEN THE WORK LANDS.
        *
        * Before the form is filled it says fill it. After, it says view it -
        * which is the client's own instruction and also the fix for the
        * thing that made this page confusing: submitting returned somebody
        * to a page that looked exactly as it had before, same button, same
        * wording, so the only way to know it had saved was to open the form
        * again and look. The button IS the receipt now, with when and by
        * whom beneath it.
        */}
      <div className="tf-cta">
        {isForm && filed ? (
          /**
           * NOTHING TO PRESS. THE WORK IS DONE.
           *
           * This was a full-width call to action reading "Completed
           * assessment" — a button offering the one thing there is no longer
           * anything to do about. Filing the form completes the task on the
           * server (record.service.js#completeTaskForForm), so by the time
           * this renders the job is finished, the badge above says Complete,
           * and a button is an invitation to act where no action is left.
           *
           * The receipt below says when and by whom, and links to what was
           * sent — which is the only thing anybody actually wanted from this
           * button.
           */
          <span className="tf-done-note">
            <CheckCircle2 size={15} aria-hidden /> This task is complete.
          </span>
        ) : isForm && stepAction ? (
          /**
           * A PURCHASE STEP SAYS WHAT TO DO, NOT WHICH FORM.
           *
           * Its form key names a step ('boq-build', 'po-vendor'), not a form
           * with a title, so the generic wording read "Fill the boq build
           * form" — a form nobody has ever seen. The link opens that step of
           * the Purchase FMS, and the task closes itself once the step is
           * finished for every line (record.service.js#settlePurchaseTasks),
           * so there is no Complete button to press, and none to press early.
           */
          <Link className="tf-btn" to={task.appPath}>
            {stepAction} <ArrowRight size={16} aria-hidden />
          </Link>
        ) : isForm && multiFill ? (
          /**
           * A FORM FILED MANY TIMES DOES NOT FINISH ITSELF.
           *
           * The vendor panel is one form per vendor, and only the person
           * building it knows when the panel is complete — exactly like a
           * property hunt. So it gets the form button AND a finished button,
           * where a single-form task gets only the form: closing that one on
           * submit is right because there is only ever one submission, and
           * closing this one on the first vendor would call a panel of one
           * finished.
           */
          <>
            <Link className="tf-btn" to={task.appPath}>
              Fill the {formLabel} <ArrowRight size={16} aria-hidden />
            </Link>
            {!done && (
              <button
                type="button"
                className="tf-btn tf-btn-complete"
                onClick={onComplete}
                disabled={completing || !canWork}
                title="You have filed everything this task needs — this closes it"
              >
                <CheckCircle2 size={16} aria-hidden />
                {completing ? 'Completing\u2026' : 'Complete Task'}
              </button>
            )}
          </>
        ) : isForm ? (
          <Link className="tf-btn" to={task.appPath}>
            Fill the {formLabel} <ArrowRight size={16} aria-hidden />
          </Link>
        ) : isCapture ? (
          /**
           * CAPTURE IS THE ONE JOB THAT DOES NOT END WITH A FORM.
           *
           * Every other task here finishes when its form is submitted. A
           * property hunt does not: the doer walks several shops and files
           * each one, and only they know when they have enough. So this is
           * the one place a "finished" button belongs — and it appears only
           * once something has actually been filed, because a hunt nobody
           * has started has nothing to declare finished.
           */
          <>
            <button
              type="button"
              className="tf-btn"
              onClick={onCapture}
              disabled={!canWork}
              title={canWork ? 'Open the property capture form' : 'Only the assigned doer or a manager can capture properties'}
            >
              <Building2 size={16} aria-hidden />
              Property Capture
            </button>
            {!done && capturedCount > 0 && (
              <button
                type="button"
                className="tf-btn tf-btn-complete"
                onClick={onComplete}
                disabled={completing || !canWork}
                title="You have stopped looking — this closes your capture task"
              >
                <CheckCircle2 size={16} aria-hidden />
                {/* "Complete Task", not "Task completed": a button is named
                    for what it does. The past tense reads as a status, and
                    people waited for something that had already happened. */}
                {completing ? 'Completing…' : 'Complete Task'}
              </button>
            )}
          </>
        ) : !done ? (
          <button
            type="button"
            className="tf-btn"
            onClick={onComplete}
            disabled={completing || !canWork}
            title={canWork ? 'Mark this task complete' : 'Only the assigned doer or a manager can complete this'}
          >
            <CheckCircle2 size={16} aria-hidden />
            {completing ? 'Completing\u2026' : 'Complete Task'}
          </button>
        ) : (
          <span className="tf-done-note">
            <CheckCircle2 size={15} aria-hidden /> This task is complete.
          </span>
        )}
      </div>

      {filed && filedAt && (
        <p className="tf-hint">
          Submitted {fmtDateTime(filedAt)}{filedBy ? ` by ${filedBy}` : ''}.
        </p>
      )}

    </section>
  );
}

export default TaskFocusCard;
