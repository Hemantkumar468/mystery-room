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

/* Sign-off states that mean the work has left the doer's hands. These are
   `approvalState` values: status holds only pending | processing | complete. */
const WAITING_APPROVALS = new Set(["waiting_department", "waiting_management"]);

/** Stages whose form is one of several per property (Site Evaluation). */
const PER_PROPERTY_STAGES = new Set(["p2"]);

/** "feasibility" → "Feasibility". The formKey is a machine key; people read a name. */
export function formNameOf(formKey, templateStage) {
  if (!formKey) return null;

  const named = templateStage?.assessmentTypes?.find(
    (t) => t.key === formKey,
  )?.name;

  if (named) return named;

  return (
    formKey.charAt(0).toUpperCase() + formKey.slice(1).replace(/[_-]+/g, " ")
  );
}

/**
 * @param task          the task document (status, formKey, stageKey, checklist, approval, code)
 * @param ctx.hasForm   the brief can open a form right here (stage has a schema)
 * @param ctx.hasStageForm the brief opens one focused module on the phase page
 * @param ctx.noun      what that form creates ("BOQ Item", "Property")
 * @param ctx.formName  human name of the specific form this task owns ("Feasibility")
 * @param ctx.stageName the phase's display name
 */
export function buildTaskSteps(task, ctx = {}) {
  if (!task) return [];

  const status = task.status || "pending";
  const approval = task.approvalState || "none";
  /* Sent back for changes: the work reopens, so nothing after "read" counts as
     done until it is resumed. */
  const rework = approval === "rejected";
  /* Has anyone ever started it. A pending task has not — the old test
     (`status !== "todo"`) matched every pending task, which is why the strip
     said "Start Work — Completed" on work nobody had begun. */
  const everStarted = status === "processing" || status === "complete";
  const started = everStarted && !rework;
  const waiting = WAITING_APPROVALS.has(approval);
  const approved = approval === "approved";
  const finished = (status === "complete" && !rework) || waiting || approved;

  const checklist = task.checklist || [];
  const open = checklist.filter((c) => !c.done);
  const requiredOpen = open.filter((c) => c.required);

  const needsApproval = task.approval?.required !== false;

  const perProperty =
    PER_PROPERTY_STAGES.has(task.stageKey) && Boolean(task.formKey);

  const formName = ctx.formName || formNameOf(task.formKey) || null;
  const phase = ctx.stageName || task.stageName || "the phase";

  const steps = [];

  if (rework) {
    steps.push({
      key: "rejected",
      title: "Changes were requested",
      short: "Changes Requested",
      body: 'A reviewer sent this back. Their reason is shown on the task — read it first, then click "Resume Work" and make the change they asked for. After that the steps are the same as before.',
      selector: '[data-guide="task-resume"]',
      done: false,
    });
  }

  steps.push({
    key: "read",
    title: "Read what is being asked",
    short: "Read Instructions",
    body: 'The box at the top — "What you need to do" — is your job description: what the task is, who does it, by when, and how. Everything else on this page is detail. Read this box first.',
    selector: '[data-guide="task-brief"]',
    done: everStarted,
  });

  steps.push({
    key: "start",
    title: rework ? 'Click "Resume Work"' : 'Click "Start Task"',
    short: rework ? 'Click "Resume Work"' : 'Click "Start Task"',
    body:
      rework
        ? 'The task was paused. "Resume Work" (top right) tells everyone you are on it again.'
        : 'At the top of the instructions (and top right of the page). This only starts the task — it does not submit or finish anything — it simply tells your manager and the reports that you have begun. The task turns to "In Progress". Do this before you start the real work, not after.',
    selector:
      rework
        ? '[data-guide="task-resume"]'
        : '[data-guide="task-start"]',
    done: started || finished,
  });

  if (perProperty) {
    /* A task for ONE property (task.subjectRecord) opens that property
       directly, so there is nothing to pick. */
    const direct = Boolean(task.subjectRecord);
    const propertyName =
      task.subjectRecord?.values?.property_name || task.subjectRecord?.title || "the property";
    steps.push({
      key: "open-phase",
      title: direct
        ? `Click "Do the ${formName ? `${formName} ` : ""}assessment"`
        : 'Click "Open the phase"',
      short: direct ? `Open ${propertyName}` : "Open the Phase",
      body: direct
        ? `In the instructions card. It opens ${propertyName} — the property this task is for — with your assessment card lit and the others greyed out.`
        : `In the job-description box. It takes you to ${phase}, where the properties being evaluated are listed.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });

    if (!direct) steps.push({
      key: "pick-property",
      title: "Pick the property",
      short: "Pick the Property",
      body: 'You will see a list of shortlisted properties. Click "Begin Assessment" (or "Continue Assessment") on the one you are evaluating. If there is only one, that is the one.',
      done: finished,
    });

    steps.push({
      key: "fill-form",
      title: `Fill ONLY the ${formName || "assigned"} assessment`,
      short: `Fill ${formName || "the"} Assessment`,
      body: `On the property page you will see several assessment cards, but only the ${
        formName || "one assigned to you"
      } is lit up — the others are greyed out because they belong to someone else. Click "Start Assessment" on the lit card, fill it in, and press Submit. You can "Save Draft" and come back later if you need to.`,
      done: finished,
    });

    steps.push({
      key: "come-back",
      title: "Come back to this task",
      short: "Come Back Here",
      body: 'Use the "Back to my task" button at the top of the property page (or your browser’s back button). Submitting the form does not close the task by itself — the next step does.',
      done: finished,
    });
  } else if (ctx.hasForm && ctx.recurring) {
    steps.push({
      key: "fill-form",
      title: `Every working day: click "Submit ${ctx.noun || "Entry"}"`,
      short: `Daily ${ctx.noun || "Entry"}`,
      body: "This task runs for the whole build. Each working day, click the orange button in the job-description box, fill in progress, manpower, materials and today's photos — under two minutes on a phone — and press Submit. Missed a day? File it the next morning; it is simply marked as a late entry. The reports build the list your PM and MD watch on the Execution page.",
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  } else if (ctx.hasForm) {
    steps.push({
      key: "fill-form",
      title: `Click "Submit ${ctx.noun || "Entry"}" and fill the form`,
      short: `Submit ${ctx.noun || "Entry"}`,
      body: 'The orange button in the job-description box opens the form right here. Fields the system already knows are filled in for you; look for the ✨ buttons where AI can draft text that you then edit. Press Submit when it is complete, or "Save Draft" to finish later.',
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  } else if (task.stageKey === "p15") {
    steps.push({
      key: "open-phase",
      title: 'Click "Open the phase" — it opens the order sheet',
      short: "Open the Order Sheet",
      body: 'One row per purchase order, already filled from the Phase 5 BOQ. "Send order" sends a PO by WhatsApp or email; the Status dropdown tracks it (Ordered → Dispatched → Received); "Update" records the challan, the quantity received and the GRN. Do your part there, then come back here to finish this task.',
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  } else if (ctx.hasStageForm && task.formKey) {
    steps.push({
      key: "open-form",
      title: `Click "Open ${formName || "the form"}"`,
      short: `Open ${formName || "the Form"}`,
      body: `The link in the job-description box opens ${phase} with the ${
        formName || "assigned"
      } module highlighted. Fill that module, save a draft if you need to, then submit it and return to this task.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  } else if (task.stageKey) {
    steps.push({
      key: "open-phase",
      title: 'Click "Open the phase" and do the work there',
      short: "Open the Phase",
      body: `The link in the job-description box opens ${phase}. Do what the task describes on that page, then come back here — this task is how you tell the system it is finished.`,
      selector: '[data-guide="task-action"]',
      done: finished,
    });
  }

  if (checklist.length > 0) {
    steps.push({
      key: "checklist",
      title: "Tick the checklist",
      short: "Tick the Checklist",
      body: open.length
        ? `Further down this page. ${open.length} item${
            open.length === 1 ? " is" : "s are"
          } still open${
            requiredOpen.length
              ? `, ${requiredOpen.length} of them marked with a red *`
              : ""
          }. Tick off what you have done — if you complete the task with items still open, it warns you first and they stay on the task as pending.`
        : "Further down this page. Every item is already ticked — nothing left to do here.",
      selector: '[data-guide="task-checklist"]',
      done:
        finished ||
        (requiredOpen.length === 0 && checklist.some((c) => c.done)),
    });
  }

  steps.push({
    key: "complete",
    title: 'Click "Mark as Complete"',
    short: "Mark as Complete",
    body: ctx.recurring
      ? "Only at the very END — when the civil and fit-out work on site is finished, not after each day's report. Then it goes to your Project Manager to sign off."
      : needsApproval
        ? 'Top right, once the work is done. Your part ends here: the task goes to the named approver by itself, and the status tells you who ("Waiting for approval by …"). You do not need to message anyone.'
        : "Top right, once the work is done. That finishes the task — no approval is needed for this one.",
    selector: '[data-guide="task-complete"]',
    done: finished,
  });

  if (needsApproval) {
    steps.push({
      key: "approval",
      title: approved ? "Approved — all done" : "Wait for approval",
      short: approved ? "Approved" : "Wait for Approval",
      body:
        approved
          ? "The reviewer approved this task. Nothing more to do."
          : 'Nothing to do while you wait. If the reviewer wants changes they must give a reason, and the task comes back to you as "Changes requested" with that reason on it. One approval finishes it.',
      selector: '[data-guide="task-status"]',
      done: approved,
    });
  }

  // The current step is the first one not yet done; everything after is "next".
  const firstOpen = steps.findIndex((s) => !s.done);

  return steps.map((s, i) => ({
    ...s,
    current: i === firstOpen,

    // A waiting task has done everything it can — its current step is the wait.
    ...(waiting && s.key === "approval"
      ? { current: true }
      : {}),
  }));
}

/** The same steps, shaped for the tour engine (GuideContext#start). */
export function buildTaskGuide(task, ctx = {}) {
  const steps = buildTaskSteps(task, ctx);

  return {
    key: `task-${task?.code || task?._id || "current"}`,
    title: "How to do this task",
    description: task?.title || "",
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
