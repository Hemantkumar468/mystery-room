/**
 * The guide for ONE task — generated from the task itself, not written once.
 *
 * The guide centre's "doer-flow" tour explains the general shape of doing a
 * task. That is the wrong altitude for someone standing in front of "Do the
 * Feasibility assessment" at 9am: they want *their* steps, in order, with the
 * one they are on lit up. So this reads the task's real state — status,
 * whether it opens a form or a phase, whether it has a checklist, whether it
 * needs approval — and produces the exact sequence, marking each step done,
 * current or still to come.
 *
 * Two consumers share the output:
 *   - TaskBrief renders it as an always-visible numbered strip, so the steps
 *     are readable at a glance without starting anything.
 *   - "Walk me through" hands the same steps to the tour engine
 *     (GuideContext), which spotlights the real buttons one at a time. The
 *     selectors below are `data-guide` anchors on TaskDetailPage/TaskBrief.
 *
 * Written for someone who has never used a project tool. Buttons are named
 * exactly as they appear; no status codes, no jargon.
 */

const DONE_STATUSES = new Set(['done', 'waiting_approval', 'waiting_management_approval', 'approved']);
const WAITING_STATUSES = new Set(['waiting_approval', 'waiting_management_approval']);

/** Stages whose form is one of several per property (Site Evaluation). */
const PER_PROPERTY_STAGES = new Set(['p2']);

/** "feasibility" → "Feasibility". The formKey is a machine key; people read a name. */
export function formNameOf(formKey, templateStage) {
  if (!formKey) return null;
  const named = templateStage?.assessmentTypes?.find((t) => t.key === formKey)?.name;
  if (named) return named;
  return formKey.charAt(0).toUpperCase() + formKey.slice(1).replace(/[_-]+/g, ' ');
}

/**
 * @param task          the task document (status, formKey, stageKey, checklist, approval, code)
 * @param ctx.hasForm   the brief can open a form right here (stage has a schema)
 * @param ctx.noun      what that form creates ("BOQ Item", "Property")
 * @param ctx.formName  human name of the specific form this task owns ("Feasibility")
 * @param ctx.stageName the phase's display name
 */
export function buildTaskSteps(task, ctx = {}) {
  if (!task) return [];
  const status = task.status || 'todo';
  const started = status !== 'todo' && status !== 'blocked';
  const finished = DONE_STATUSES.has(status);
  const checklist = task.checklist || [];
  const requiredOpen = checklist.filter((c) => c.required && !c.done);
  const needsApproval = task.approval?.required !== false;
  const perProperty = PER_PROPERTY_STAGES.has(task.stageKey) && Boolean(task.formKey);
  const formName = ctx.formName || formNameOf(task.formKey) || null;
  const phase = ctx.stageName || task.stageName || 'the phase';

  const steps = [];

  if (status === 'rejected') {
    steps.push({
      key: 'rejected',
      title: 'Changes were requested',
      body: 'A reviewer sent this back. Their reason is shown on the task — read it first, then click "Resume Work" and make the change they asked for. After that the steps are the same as before.',
      selector: '[data-guide="task-resume"]',
      done: false,
    });
  }

  steps.push({
    key: 'read',
    title: 'Read what is being asked',
    body: 'The box at the top — "What you need to do" — is your job description: what the task is, who does it, by when, and how. Everything else on this page is detail. Read this box first.',
    selector: '[data-guide="task-brief"]',
    done: status !== 'todo',
  });

  steps.push({
    key: 'start',
    title: status === 'blocked' ? 'Click "Resume Work"' : 'Click "Start Work"',
    body: status === 'blocked'
      ? 'The task was paused. "Resume Work" (top right) tells everyone you are on it again.'
      : 'Top right of this page. This does not finish anything — it simply tells your manager and the reports that you have begun. The task turns to "In Progress". Do this before you start the real work, not after.',
    selector: status === 'blocked' ? '[data-guide="task-resume"]' : '[data-guide="task-start"]',
    done: started || finished,
  });

  if (perProperty) {
    steps.push({
      key: 'open-phase',
      title: `Click "Open the phase"`,
      body: `In the job-description box. It takes you to ${phase}, where the properties being evaluated are listed.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });
    steps.push({
      key: 'pick-property',
      title: 'Pick the property',
      body: 'You will see a list of shortlisted properties. Click "Begin Assessment" (or "Continue Assessment") on the one you are evaluating. If there is only one, that is the one.',
      done: finished,
    });
    steps.push({
      key: 'fill-form',
      title: `Fill ONLY the ${formName || 'assigned'} assessment`,
      body: `On the property page you will see several assessment cards, but only the ${formName || 'one assigned to you'} is lit up — the others are greyed out because they belong to someone else. Click "Start Assessment" on the lit card, fill it in, and press Submit. You can "Save Draft" and come back later if you need to.`,
      done: finished,
    });
    steps.push({
      key: 'come-back',
      title: 'Come back to this task',
      body: 'Use the "Back to my task" button at the top of the property page (or your browser’s back button). Submitting the form does not close the task by itself — the next step does.',
      done: finished,
    });
  } else if (ctx.hasForm) {
    steps.push({
      key: 'fill-form',
      title: `Click "Submit ${ctx.noun || 'Entry'}" and fill the form`,
      body: `The orange button in the job-description box opens the form right here. Fields the system already knows are filled in for you; look for the ✨ buttons where AI can draft text that you then edit. Press Submit when it is complete, or "Save Draft" to finish later.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  } else if (task.stageKey) {
    steps.push({
      key: 'open-phase',
      title: 'Click "Open the phase" and do the work there',
      body: `The link in the job-description box opens ${phase}. Do what the task describes on that page, then come back here — this task is how you tell the system it is finished.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  }

  if (checklist.length > 0) {
    steps.push({
      key: 'checklist',
      title: 'Tick the checklist',
      body: requiredOpen.length
        ? `Further down this page. Items marked with a red * must be ticked before the task can be completed — ${requiredOpen.length} still ${requiredOpen.length === 1 ? 'is' : 'are'} open. If you forget, "Mark as Complete" will scroll you here and show exactly which ones.`
        : 'Further down this page. Every required item is already ticked — nothing left to do here.',
      selector: '[data-guide="task-checklist"]',
      done: finished || requiredOpen.length === 0 && checklist.some((c) => c.done),
    });
  }

  steps.push({
    key: 'complete',
    title: 'Click "Mark as Complete"',
    body: needsApproval
      ? 'Top right, once the work is done. Your part ends here: the task goes to the named approver by itself, and the status tells you who ("Waiting for approval by …"). You do not need to message anyone.'
      : 'Top right, once the work is done. That finishes the task — no approval is needed for this one.',
    selector: '[data-guide="task-complete"]',
    done: finished,
  });

  if (needsApproval) {
    steps.push({
      key: 'approval',
      title: status === 'approved' ? 'Approved — all done' : 'Wait for approval',
      body: status === 'approved'
        ? 'The reviewer approved this task. Nothing more to do.'
        : 'Nothing to do while you wait. If the reviewer wants changes they must give a reason, and the task comes back to you as "Changes requested" with that reason on it. One approval finishes it.',
      selector: '[data-guide="task-status"]',
      done: status === 'approved',
    });
  }

  // The current step is the first one not yet done; everything after is "next".
  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({
    ...s,
    current: i === firstOpen,
    // A waiting task has done everything it can — its current step is the wait.
    ...(WAITING_STATUSES.has(status) && s.key === 'approval' ? { current: true } : {}),
  }));
}

/** The same steps, shaped for the tour engine (GuideContext#start). */
export function buildTaskGuide(task, ctx = {}) {
  const steps = buildTaskSteps(task, ctx);
  return {
    key: `task-${task?.code || task?._id || 'current'}`,
    title: 'How to do this task',
    description: task?.title || '',
    roles: null,
    autoAdvanceMs: 12000,
    steps: steps.map(({ title, body, selector, done, current }) => ({
      title: done ? `${title} ✓` : current ? `▶ ${title}` : title,
      body,
      selector,
    })),
  };
}

export default buildTaskSteps;
