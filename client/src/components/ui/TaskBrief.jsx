import {
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  HelpCircle,
  MapPin,
  PlayCircle,
  Plus,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useDesignGuidance,
  useSavedDesignGuidance,
} from "../../app/api/aiApi.js";
import { useProject } from "../../app/api/projectsApi.js";
import { useCreateRecord, useStageRecords } from "../../app/api/recordsApi.js";
import { useTemplate } from "../../app/api/templatesApi.js";
import { RecordFormModal } from "../../features/projects/records/RecordFormModal.jsx";
import { getStagePath } from "../../features/projects/stagesConfig.jsx";
import { useEmployees } from "../../hooks/useEmployees.js";
import { fmtDateTime } from "../../lib/format.js";

import { useGuide } from "../../features/guide/GuideContext.jsx";

import {
  buildTaskGuide,
  buildTaskSteps,
  formNameOf,
} from "../../features/guide/taskGuide.js";

/**
 * Phases whose deliverable is a design, where AI layout ideas make sense.
 * Keyed on the stage, not hardcoded per project — a template that adds another
 * design phase only needs its key here.
 */
const DESIGN_STAGES = new Set(["p11"]);

/**
 * Stages whose forms hang off ONE property rather than the project — Site
 * Evaluation's assessments. Their records need a `parentRecordId`, which only
 * the phase page (where a property is picked) can supply, so the brief links
 * there instead of offering to submit in place. Mirrors PER_PROPERTY_STAGES in
 * features/guide/taskGuide.js.
 */
const PER_PROPERTY_FORM_STAGES = new Set(["p2"]);

const LEGACY_TASK_FORM_KEYS = {
  p3: {
    p3_t1: "loi",
    p3_t2: "lease",
    p3_t3: "legal",
    p3_t4: "deposit",
    p3_t5: "nocs",
  },
  p4: {
    p4_t1: "project_creation",
    p4_t2: "project_creation",
    p4_t3: "project_creation",
  },
  p5: {
    p5_t1: "construction",
    p5_t2: "interior",
    p5_t3: "procurement",
    p5_t4: "automation",
    p5_t5: "it",
    p5_t6: "marketing",
    p5_t7: "hr",
    p5_t8: "finance",
    p5_t9: "operations",
    p5_t10: "legal",
  },
};

const TITLE_FORM_HINTS = [
  { stageKey: "p3", formKey: "loi", test: /\b(loi|letter of intent)\b/i },
  { stageKey: "p3", formKey: "lease", test: /\b(lease|agreement)\b/i },
  { stageKey: "p3", formKey: "legal", test: /\b(legal|title|due diligence)\b/i },
  { stageKey: "p3", formKey: "deposit", test: /\b(deposit|payment|token)\b/i },
  { stageKey: "p3", formKey: "nocs", test: /\b(noc|statutory|approvals?)\b/i },
  { stageKey: "p4", formKey: "project_creation", test: /\b(project|budget|opening|manager)\b/i },
];

function stageHasAssessmentForm(stage, formKey) {
  if (!formKey) return false;
  return (stage?.assessmentTypes || []).some((type) => type.key === formKey);
}

function inferFormKey(task, templateStage) {
  if (!task) return null;
  if (stageHasAssessmentForm(templateStage, task.formKey)) return task.formKey;

  const stageMap = LEGACY_TASK_FORM_KEYS[task.stageKey] || {};
  const byTaskKey = stageMap[task.templateTaskKey];
  if (stageHasAssessmentForm(templateStage, byTaskKey)) return byTaskKey;

  const byDepartment = task.stageKey === "p5" ? task.department : null;
  if (stageHasAssessmentForm(templateStage, byDepartment)) return byDepartment;

  const title = task.title || "";
  const hinted = TITLE_FORM_HINTS.find(
    (hint) => hint.stageKey === task.stageKey && hint.test.test(title),
  )?.formKey;
  if (stageHasAssessmentForm(templateStage, hinted)) return hinted;

  return task.formKey || null;
}

function inferredBrief(task, formName) {
  if (!task) return null;
  if (task.brief?.what || task.brief?.who || task.brief?.when || task.brief?.how) {
    return task.brief;
  }
  if (!formName) return null;
  return {
    what: task.title,
    who: task.department ? `${task.department} owner` : "Assigned doer",
    when: task.plannedEnd ? "By the task due date" : undefined,
    how: `Open the ${formName} module, fill the required fields, save a draft if needed, then submit it for review.`,
  };
}

/**
 * A doer's own job description: What / Who / When / How for THIS task, and the
 * button that opens the form the task exists to get filled.
 *
 * The same four questions the phase and the master flow answer, narrowed to one
 * person's assignment — which is the level people actually work at. Somebody
 * opening "Do the Feasibility assessment" from My Tasks should not have to
 * navigate to a phase page and work out which of four forms is theirs.
 *
 * Renders nothing when the task carries no brief. Tasks created before the
 * template began supplying one, or allocated by hand, simply keep the plain
 * description — no placeholder, no invented text.
 */
export function TaskBrief({ task, projectId }) {
  /**
   * The site this project is building out.
   *
   * Without it a task is unworkable for anyone doing physical work: an
   * architect asked to "create the drawings for this property" needs the area,
   * the frontage, the floor, the photographs, the video walkthrough and the
   * floor plan — all of which were captured in Phase 1 and were, until now,
   * three navigations away with no signpost. A doer should never have to know
   * the app's structure to find the facts their own task depends on.
   */
  // No `enabled` override: the hook's own default already skips until
  // `projectId` is a valid id, and forcing it true would fire the request with
  // an undefined project on first render.
  const { data: siteRecords } = useStageRecords(projectId, "p1");
  const sites = siteRecords?.data || siteRecords || [];
  // The chosen site: approved beats shortlisted beats whatever exists, so this
  // still points somewhere useful before the final selection is made.
  const site =
    sites.find((r) => r.status === "approved") ||
    sites.find((r) => r.status === "shortlisted") ||
    sites[0] ||
    null;

  // Where this task's form lives. `formKey` names one of the stage's forms
  // (e.g. 'feasibility'); without it the stage has a single form and the phase
  // page is the right destination.
  // getStagePath owns this decision — a dedicated page where one exists, the
  // generic phase page otherwise. Building the URL by hand here sent people via
  // a redirect hop on the project page instead of straight to the phase.
  // `form` tells the phase page which of its forms is THIS task's, so it can
  // light that one up and grey the rest; `task` lets it offer a way back here
  // — submitting a form does not complete the task, the doer must return.
  /* The form this task exists to get filled, opened in place. */
  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const templateStage = template?.stages?.find((s) => s.key === task?.stageKey);
  const projectStage = project?.stages?.find((s) => s.key === task?.stageKey);
  const effectiveFormKey = inferFormKey(task, templateStage);
  const formName = formNameOf(effectiveFormKey, templateStage);
  const stageForm = stageHasAssessmentForm(templateStage, effectiveFormKey);
  const effectiveBrief = inferredBrief(task, formName);
  const guideTask = task
    ? { ...task, formKey: effectiveFormKey, brief: effectiveBrief }
    : task;
  const stageQuery = new URLSearchParams({
    ...(effectiveFormKey ? { form: effectiveFormKey } : {}),
    ...(task?.code ? { task: task.code } : {}),
  }).toString();
  const stageHref =
    projectId && task?.stageKey
      ? `${getStagePath(projectId, task.stageKey)}${stageQuery ? `?${stageQuery}` : ""}`
      : null;

  /* The doer's own steps, generated from this task's real state — see

     features/guide/taskGuide.js. Shown as a numbered strip so they can be

     read without starting anything, and handed to the tour engine by

     "Walk me through", which spotlights each button in turn. */

  const guide = useGuide();

  const guideCtx = {
    hasForm: canSubmitHere,
    hasStageForm: stageForm,
    recurring,

    noun,

    formName,

    stageName: projectStage?.name || task?.stageName,
  };

  const steps = buildTaskSteps(guideTask, guideCtx);

  const walkThrough = () => guide?.start?.(buildTaskGuide(guideTask, guideCtx));

  // The doer BY NAME — the assigned user, else the roster primary; the brief's
  // role phrase only stands in while nobody owns the task yet.
  const { resolve } = useEmployees();
  const doer =
    resolve(task?.assignee?._id || task?.assignee)?.name ||
    resolve(task?.primaryAssignee)?.name ||
    null;
  const backup = resolve(task?.backupAssignee)?.name || null;

  const [formOpen, setFormOpen] = useState(false);
  const createRecord = useCreateRecord(projectId, task?.stageKey);

  /* AI design help, for phases that produce a design deliverable. */
  const ai = useDesignGuidance();
  const canAskAi = Boolean(site?._id) && DESIGN_STAGES.has(task?.stageKey);
  // Whatever was generated before loads for free — no provider call, no wait,
  // and the same answer the team already discussed rather than a new one.
  const { data: savedIdeas } = useSavedDesignGuidance(
    canAskAi ? site?._id : null,
    "ideas",
  );
  const [fresh, setFresh] = useState(null);
  const [aiError, setAiError] = useState(null);
  const ideas = fresh || savedIdeas || null;

  const askAi = async (force = false) => {
    setAiError(null);
    try {
      setFresh(
        await ai.mutateAsync({
          propertyRecordId: site._id,
          mode: "ideas",
          force,
        }),
      );
    } catch (err) {
      setAiError(
        err?.response?.data?.message || "Could not get ideas right now.",
      );
    }
  };

  /* Bail out only AFTER every hook has run. Placing this above the hooks made
     the component call a different number of them depending on the task, which
     React treats as a fatal error ("Rendered fewer hooks than expected") — so a
     single hand-created task with no brief would have taken down the page.

     The panel renders whenever there is either a brief to read OR a form to
     open. Gating it on the brief alone hid the SUBMIT BUTTON from any task
     created without one — the assignee of "Generate BOQ" had a task page with
     no way to do the task. The action must never depend on the narrative. */
  const hasBrief = Boolean(effectiveBrief?.what || effectiveBrief?.how || effectiveBrief?.who || effectiveBrief?.when);
  if (!hasBrief && !canSubmitHere && !stageForm) return null;

  const v = site?.values || {};
  const siteFacts = [
    v.carpet_area && `${v.carpet_area} sq.ft`,
    v.frontage_ft && `${v.frontage_ft} ft frontage`,
    v.floor && `${v.floor} floor`,
    v.locality,
  ].filter(Boolean);

  return (
    <section
      className="tbrief"
      aria-label="What this task is"
      data-guide="task-brief"
    >
      <header className="tbrief-head">
        <ClipboardList size={14} aria-hidden />
        <span>What you need to do</span>
        {steps.length > 0 && (
          <button
            type="button"
            className="tbrief-walk"
            onClick={walkThrough}
            data-guide="task-help"
          >
            <HelpCircle size={13} aria-hidden /> Walk me through
          </button>
        )}
      </header>

      {/* Fall back to the task's own title so a brief-less task still opens
          with its job named above the Submit button. */}
      {(effectiveBrief?.what || task?.title) && (
        <p className="tbrief-what">{effectiveBrief?.what || task.title}</p>
      )}
      {effectiveBrief?.how && <p className="tbrief-how">{effectiveBrief.how}</p>}

      <dl className="tbrief-facts">
        {(doer || effectiveBrief?.who) && (
          <div>
            <dt>
              <User size={12} aria-hidden /> Who
            </dt>
            <dd>
              {doer || effectiveBrief.who}
              {doer && backup && (
                <span className="muted"> · backup {backup}</span>
              )}
            </dd>
          </div>
        )}
        {effectiveBrief?.when && (
          <div>
            <dt>
              <CalendarClock size={12} aria-hidden /> When
            </dt>
            <dd>{effectiveBrief.when}</dd>
          </div>
        )}
        {task?.stageName && (
          <div>
            <dt>
              <Wrench size={12} aria-hidden /> Phase
            </dt>
            <dd>{task.stageName}</dd>
          </div>
        )}

        {/* Actions sit in the same row as the facts rather than in a block of
            their own — they are one line of text each, and a full-width filled
            button for each was spending a third of the panel on two links. */}
        <div className="tbrief-actions">
          {canSubmitHere && (
            // Opens the form HERE. Navigating to the phase page to find it was
            // a detour: the doer is already on the task that asks for it.
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setFormOpen(true)}
              data-guide="task-action"
            >
              <Plus size={13} aria-hidden /> Submit {noun}
            </button>
          )}
          {/* Always offered alongside the button, not instead of it. Filing an
              entry is one thing; seeing what has already been filed on the
              phase, and who else is working it, is another — and on phases with
              their own fields (drawings, BOQ) the link used to disappear
              entirely, leaving no way through to the phase at all. When there
              is no form to open here, this is the primary action and carries
              the tour anchor. */}
          {stageHref && (
            <Link
              className="tbrief-phase-button"
              to={stageHref}
              data-guide={canSubmitHere ? undefined : "task-action"}
            >
              {stageForm && formName ? `Open ${formName}` : "Open the phase"} <ArrowRight size={12} aria-hidden />
            </Link>
          )}
        </div>
      </dl>

      {/* Your steps — the whole job in order, the current one lit. Plain
          language, buttons named exactly as they appear; each step is
          explained in full by "Walk me through" above. */}
      {steps.length > 0 && (
        <ol className="tbrief-steps" aria-label="Your steps">
          {steps.map((st, i) => (
            <li
              key={st.key}
              className={`tbrief-step${st.done ? " is-done" : ""}${st.current ? " is-current" : ""}`}
            >
              <span className="tbrief-step-num" aria-hidden>
                {st.done ? (
                  <Check size={11} strokeWidth={3} />
                ) : st.current ? (
                  <PlayCircle size={12} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="tbrief-step-title">{st.title}</span>
              {st.current && (
                <span className="tbrief-step-now">you are here</span>
              )}
            </li>
          ))}
        </ol>
      )}

      {/* The site's own facts, and the way through to everything captured about
          it — photos, video walkthrough, floor plan, CAD, owner and broker. */}
      {site && projectId && (
        <div className="tbrief-site">
          <MapPin size={13} aria-hidden />
          <span className="tbrief-site-text">
            <strong>{v.property_name || site.title || "Site"}</strong>
            {siteFacts.length > 0 && (
              <span className="muted"> · {siteFacts.join(" · ")}</span>
            )}
          </span>
          <Link
            className="tbrief-link"
            to={`/projects/${projectId}/property-identification/${site._id}`}
          >
            Photos, video &amp; full details{" "}
            <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      )}

      {canAskAi && (
        <div className="tbrief-ai">
          <div className="tbrief-ai-row">
            <Sparkles size={13} aria-hidden />
            <span className="tbrief-ai-copy">
              Stuck on where to start? AI can suggest a layout from this
              site&rsquo;s area, floor and photos —{" "}
              <strong>ideas to work from, not a design</strong>.
            </span>
            <button
              type="button"
              className="tbrief-link"
              onClick={() => askAi(false)}
              disabled={ai.isPending}
            >
              {ai.isPending
                ? "Thinking…"
                : ideas
                  ? "Show ideas"
                  : "Get design ideas"}
            </button>
          </div>

          {aiError && <p className="tbrief-ai-note is-error">{aiError}</p>}

          {ideas && (
            <div className="tbrief-ai-out">
              {ideas.summary && (
                <p className="tbrief-ai-summary">{ideas.summary}</p>
              )}

              {ideas.gameCapacity?.suggested != null && (
                <p className="tbrief-ai-line">
                  <strong>Roughly {ideas.gameCapacity.suggested} games.</strong>{" "}
                  {ideas.gameCapacity.reasoning}
                </p>
              )}

              {ideas.zoning?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">Possible zoning</h4>
                  <ul className="tbrief-ai-list">
                    {ideas.zoning.map((z) => (
                      <li key={z.zone}>
                        <strong>{z.zone}</strong> — {z.placement}
                        {z.why ? ` (${z.why})` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {ideas.watchOuts?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">Watch out for</h4>
                  <ul className="tbrief-ai-list">
                    {ideas.watchOuts.map((wo) => (
                      <li key={wo}>{wo}</li>
                    ))}
                  </ul>
                </>
              )}

              {ideas.questionsForSite?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">
                    Confirm on site before drawing
                  </h4>
                  <ul className="tbrief-ai-list">
                    {ideas.questionsForSite.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="tbrief-ai-foot">
                <span className="tbrief-ai-note">
                  Suggestions only — you decide the design, and a reviewer
                  approves it.
                  {ideas.savedAt && ` Saved ${fmtDateTime(ideas.savedAt)}.`}
                </span>
                {/* Explicit, and explicitly labelled as costing a new run —
                    otherwise people re-generate reflexively and pay for it. */}
                <button
                  type="button"
                  className="tbrief-link"
                  onClick={() => askAi(true)}
                  disabled={ai.isPending}
                >
                  {ai.isPending ? "Generating…" : "Generate again"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <RecordFormModal
          open
          onClose={() => setFormOpen(false)}
          schema={schema}
          recordNoun={noun}
          /* Same prefill PhasePage gives the Project Plan: the area from the
             chosen property, the opening target and budget from the project —
             known facts the doer should never retype. Scoped to p20 ONLY:
             these keys belong to the plan's schema, and seeding them into any
             other stage's form would submit junk keys into that record. */
          seedValues={
            recurring
              ? { report_date: new Date().toISOString().slice(0, 10) }
              : task?.stageKey === "p20"
              ? {
                  ...(v.carpet_area != null
                    ? { confirmed_area: v.carpet_area }
                    : {}),
                  ...(project?.targetEndDate
                    ? {
                        target_opening: String(project.targetEndDate).slice(
                          0,
                          10,
                        ),
                      }
                    : {}),
                  ...(project?.budget?.planned
                    ? { setup_cost: project.budget.planned }
                    : {}),
                }
              : null
          }
          projectId={projectId}
          saving={createRecord.isPending}
          /* `assessmentType` is what files the record against the right one of
             the stage's forms. Omitted when the stage has a single schema of
             its own — sending a key the stage does not define would mis-file it. */
          onSaveDraft={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: "draft" });
            setFormOpen(false);
          }}
          onSubmit={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: "submitted" });
            setFormOpen(false);
          }}
        />
      )}
    </section>
  );
}

export default TaskBrief;
=========
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, User, CalendarClock, Wrench, ArrowRight, MapPin, Sparkles, Plus, Check, PlayCircle, HelpCircle,
} from 'lucide-react';
import { useStageRecords, useCreateRecord } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useDesignGuidance, useSavedDesignGuidance } from '../../app/api/aiApi.js';
import { getStagePath } from '../../features/projects/stagesConfig.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { RecordFormModal } from '../../features/projects/records/RecordFormModal.jsx';

import { useGuide } from '../../features/guide/GuideContext.jsx';

import { buildTaskSteps, buildTaskGuide, formNameOf } from '../../features/guide/taskGuide.js';

/**
 * Phases whose deliverable is a design, where AI layout ideas make sense.
 * Keyed on the stage, not hardcoded per project — a template that adds another
 * design phase only needs its key here.
 */
const DESIGN_STAGES = new Set(['p11']);

/**
 * A doer's own job description: What / Who / When / How for THIS task, and the
 * button that opens the form the task exists to get filled.
 *
 * The same four questions the phase and the master flow answer, narrowed to one
 * person's assignment — which is the level people actually work at. Somebody
 * opening "Do the Feasibility assessment" from My Tasks should not have to
 * navigate to a phase page and work out which of four forms is theirs.
 *
 * Renders nothing when the task carries no brief. Tasks created before the
 * template began supplying one, or allocated by hand, simply keep the plain
 * description — no placeholder, no invented text.
 */
export function TaskBrief({ task, projectId }) {
  const brief = task?.brief;

  /**
   * The site this project is building out.
   *
   * Without it a task is unworkable for anyone doing physical work: an
   * architect asked to "create the drawings for this property" needs the area,
   * the frontage, the floor, the photographs, the video walkthrough and the
   * floor plan — all of which were captured in Phase 1 and were, until now,
   * three navigations away with no signpost. A doer should never have to know
   * the app's structure to find the facts their own task depends on.
   */
  // No `enabled` override: the hook's own default already skips until
  // `projectId` is a valid id, and forcing it true would fire the request with
  // an undefined project on first render.
  const { data: siteRecords } = useStageRecords(projectId, 'p1');
  const sites = siteRecords?.data || siteRecords || [];
  // The chosen site: approved beats shortlisted beats whatever exists, so this
  // still points somewhere useful before the final selection is made.
  const site = sites.find((r) => r.status === 'approved')
    || sites.find((r) => r.status === 'shortlisted')
    || sites[0]
    || null;

  // Where this task's form lives. `formKey` names one of the stage's forms
  // (e.g. 'feasibility'); without it the stage has a single form and the phase
  // page is the right destination.
  // getStagePath owns this decision — a dedicated page where one exists, the
  // generic phase page otherwise. Building the URL by hand here sent people via
  // a redirect hop on the project page instead of straight to the phase.
  // `form` tells the phase page which of its forms is THIS task's, so it can
  // light that one up and grey the rest; `task` lets it offer a way back here
  // — submitting a form does not complete the task, the doer must return.
  const stageQuery = new URLSearchParams({
    ...(task?.formKey ? { form: task.formKey } : {}),
    ...(task?.code ? { task: task.code } : {}),
  }).toString();
  const stageHref = projectId && task?.stageKey
    ? `${getStagePath(projectId, task.stageKey)}${stageQuery ? `?${stageQuery}` : ''}`
    : null;

  /* The form this task exists to get filled, opened in place. */
  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const templateStage = template?.stages?.find((s) => s.key === task?.stageKey);
  const projectStage = project?.stages?.find((s) => s.key === task?.stageKey);
  // A task that names one of the stage's several forms (`formKey` — the
  // Site Supervisor's Daily Site Report, an assessment) opens THAT form here,
  // not the stage-level one. Without this, p6's empty stage schema meant
  // the daily-report task offered only "Open the phase" and the doer had
  // to find the form themselves.
  const formType = task?.formKey
    ? (templateStage?.assessmentTypes || []).find((a) => a.key === task.formKey) || null
    : null;
  const schema = formType?.masterDataSchema || templateStage?.masterDataSchema || [];
  const noun = formType?.name || projectStage?.recordNoun || 'Entry';
  const canSubmitHere = schema.length > 0 && Boolean(projectId);
  // A form filed again and again for the life of the task, not once.
  const recurring = task?.formKey === 'daily_site_report';



  /* The doer's own steps, generated from this task's real state — see

     features/guide/taskGuide.js. Shown as a numbered strip so they can be

     read without starting anything, and handed to the tour engine by

     "Walk me through", which spotlights each button in turn. */

  const guide = useGuide();

  const guideCtx = {

    hasForm: canSubmitHere,

    recurring,
    noun,

    formName: formNameOf(task?.formKey, templateStage),

    stageName: projectStage?.name || task?.stageName,

  };

  const steps = buildTaskSteps(task, guideCtx);

  const walkThrough = () => guide?.start?.(buildTaskGuide(task, guideCtx));

  // The doer BY NAME — the assigned user, else the roster primary; the brief's
  // role phrase only stands in while nobody owns the task yet.
  const { resolve } = useEmployees();
  const doer = resolve(task?.assignee?._id || task?.assignee)?.name
    || resolve(task?.primaryAssignee)?.name
    || null;
  const backup = resolve(task?.backupAssignee)?.name || null;

  const [formOpen, setFormOpen] = useState(false);
  const createRecord = useCreateRecord(projectId, task?.stageKey);

  /* AI design help, for phases that produce a design deliverable. */
  const ai = useDesignGuidance();
  const canAskAi = Boolean(site?._id) && DESIGN_STAGES.has(task?.stageKey);
  // Whatever was generated before loads for free — no provider call, no wait,
  // and the same answer the team already discussed rather than a new one.
  const { data: savedIdeas } = useSavedDesignGuidance(canAskAi ? site?._id : null, 'ideas');
  const [fresh, setFresh] = useState(null);
  const [aiError, setAiError] = useState(null);
  const ideas = fresh || savedIdeas || null;

  const askAi = async (force = false) => {
    setAiError(null);
    try {
      setFresh(await ai.mutateAsync({ propertyRecordId: site._id, mode: 'ideas', force }));
    } catch (err) {
      setAiError(err?.response?.data?.message || 'Could not get ideas right now.');
    }
  };

  /* Bail out only AFTER every hook has run. Placing this above the hooks made
     the component call a different number of them depending on the task, which
     React treats as a fatal error ("Rendered fewer hooks than expected") — so a
     single hand-created task with no brief would have taken down the page.

     The panel renders whenever there is either a brief to read OR a form to
     open. Gating it on the brief alone hid the SUBMIT BUTTON from any task
     created without one — the assignee of "Generate BOQ" had a task page with
     no way to do the task. The action must never depend on the narrative. */
  const hasBrief = Boolean(brief?.how || brief?.who || brief?.when);
  if (!hasBrief && !canSubmitHere) return null;

  const v = site?.values || {};
  const siteFacts = [
    v.carpet_area && `${v.carpet_area} sq.ft`,
    v.frontage_ft && `${v.frontage_ft} ft frontage`,
    v.floor && `${v.floor} floor`,
    v.locality,
  ].filter(Boolean);

  return (
    <section className="tbrief" aria-label="What this task is" data-guide="task-brief">
      <header className="tbrief-head">
        <ClipboardList size={14} aria-hidden />
        <span>What you need to do</span>
        {steps.length > 0 && (
          <button type="button" className="tbrief-walk" onClick={walkThrough} data-guide="task-help">
            <HelpCircle size={13} aria-hidden /> Walk me through
          </button>
        )}
      </header>

      {/* Fall back to the task's own title so a brief-less task still opens
          with its job named above the Submit button. */}
      {(brief?.what || task?.title) && <p className="tbrief-what">{brief?.what || task.title}</p>}
      {brief?.how && <p className="tbrief-how">{brief.how}</p>}

      <dl className="tbrief-facts">
        {(doer || brief?.who) && (
          <div>
            <dt><User size={12} aria-hidden /> Who</dt>
            <dd>
              {doer || brief.who}
              {doer && backup && <span className="muted"> · backup {backup}</span>}
            </dd>
          </div>
        )}
        {brief?.when && (
          <div>
            <dt><CalendarClock size={12} aria-hidden /> When</dt>
            <dd>{brief.when}</dd>
          </div>
        )}
        {task?.stageName && (
          <div>
            <dt><Wrench size={12} aria-hidden /> Phase</dt>
            <dd>{task.stageName}</dd>
          </div>
        )}

        {/* Actions sit in the same row as the facts rather than in a block of
            their own — they are one line of text each, and a full-width filled
            button for each was spending a third of the panel on two links. */}
        <div className="tbrief-actions">
          {canSubmitHere ? (
            // Opens the form HERE. Navigating to the phase page to find it was
            // a detour: the doer is already on the task that asks for it.
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)} data-guide="task-action">
              <Plus size={13} aria-hidden /> Submit {noun}
            </button>
          ) : stageHref && (
            <Link className="tbrief-link" to={stageHref} data-guide="task-action">
              Open the phase <ArrowRight size={12} aria-hidden />
            </Link>
          )}
        </div>
      </dl>

      {/* Your steps — the whole job in order, the current one lit. Plain
          language, buttons named exactly as they appear; each step is
          explained in full by "Walk me through" above. */}
      {steps.length > 0 && (
        <ol className="tbrief-steps" aria-label="Your steps">
          {steps.map((st, i) => (
            <li key={st.key} className={`tbrief-step${st.done ? ' is-done' : ''}${st.current ? ' is-current' : ''}`}>
              <span className="tbrief-step-num" aria-hidden>
                {st.done ? <Check size={11} strokeWidth={3} /> : st.current ? <PlayCircle size={12} /> : i + 1}
              </span>
              <span className="tbrief-step-title">{st.title}</span>
              {st.current && <span className="tbrief-step-now">you are here</span>}
            </li>
          ))}
        </ol>
      )}

      {/* The site's own facts, and the way through to everything captured about
          it — photos, video walkthrough, floor plan, CAD, owner and broker. */}
      {site && projectId && (
        <div className="tbrief-site">
          <MapPin size={13} aria-hidden />
          <span className="tbrief-site-text">
            <strong>{v.property_name || site.title || 'Site'}</strong>
            {siteFacts.length > 0 && <span className="muted"> · {siteFacts.join(' · ')}</span>}
          </span>
          <Link
            className="tbrief-link"
            to={`/projects/${projectId}/property-identification/${site._id}`}
          >
            Photos, video &amp; full details <ArrowRight size={12} aria-hidden />
          </Link>
        </div>
      )}

      {canAskAi && (
        <div className="tbrief-ai">
          <div className="tbrief-ai-row">
            <Sparkles size={13} aria-hidden />
            <span className="tbrief-ai-copy">
              Stuck on where to start? AI can suggest a layout from this site&rsquo;s area, floor
              and photos — <strong>ideas to work from, not a design</strong>.
            </span>
            <button type="button" className="tbrief-link" onClick={() => askAi(false)} disabled={ai.isPending}>
              {ai.isPending ? 'Thinking…' : ideas ? 'Show ideas' : 'Get design ideas'}
            </button>
          </div>

          {aiError && <p className="tbrief-ai-note is-error">{aiError}</p>}

          {ideas && (
            <div className="tbrief-ai-out">
              {ideas.summary && <p className="tbrief-ai-summary">{ideas.summary}</p>}

              {ideas.gameCapacity?.suggested != null && (
                <p className="tbrief-ai-line">
                  <strong>Roughly {ideas.gameCapacity.suggested} games.</strong>{' '}
                  {ideas.gameCapacity.reasoning}
                </p>
              )}

              {ideas.zoning?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">Possible zoning</h4>
                  <ul className="tbrief-ai-list">
                    {ideas.zoning.map((z) => (
                      <li key={z.zone}><strong>{z.zone}</strong> — {z.placement}{z.why ? ` (${z.why})` : ''}</li>
                    ))}
                  </ul>
                </>
              )}

              {ideas.watchOuts?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">Watch out for</h4>
                  <ul className="tbrief-ai-list">
                    {ideas.watchOuts.map((wo) => <li key={wo}>{wo}</li>)}
                  </ul>
                </>
              )}

              {ideas.questionsForSite?.length > 0 && (
                <>
                  <h4 className="tbrief-ai-h">Confirm on site before drawing</h4>
                  <ul className="tbrief-ai-list">
                    {ideas.questionsForSite.map((q) => <li key={q}>{q}</li>)}
                  </ul>
                </>
              )}

              <div className="tbrief-ai-foot">
                <span className="tbrief-ai-note">
                  Suggestions only — you decide the design, and a reviewer approves it.
                  {ideas.savedAt && ` Saved ${fmtDateTime(ideas.savedAt)}.`}
                </span>
                {/* Explicit, and explicitly labelled as costing a new run —
                    otherwise people re-generate reflexively and pay for it. */}
                <button
                  type="button"
                  className="tbrief-link"
                  onClick={() => askAi(true)}
                  disabled={ai.isPending}
                >
                  {ai.isPending ? 'Generating…' : 'Generate again'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <RecordFormModal
          open
          onClose={() => setFormOpen(false)}
          schema={schema}
          recordNoun={noun}
          /* Same prefill PhasePage gives the Project Plan: the area from the
             chosen property, the opening target and budget from the project —
             known facts the doer should never retype. Scoped to p20 ONLY:
             these keys belong to the plan's schema, and seeding them into any
             other stage's form would submit junk keys into that record. */
          seedValues={recurring ? { report_date: new Date().toISOString().slice(0, 10) } : task?.stageKey === 'p20' ? {
            ...(v.carpet_area != null ? { confirmed_area: v.carpet_area } : {}),
            ...(project?.targetEndDate ? { target_opening: String(project.targetEndDate).slice(0, 10) } : {}),
            ...(project?.budget?.planned ? { setup_cost: project.budget.planned } : {}),
          } : null}
          projectId={projectId}
          saving={createRecord.isPending}
          onSaveDraft={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: 'draft', ...(formType ? { assessmentType: formType.key } : {}) });
            setFormOpen(false);
          }}
          onSubmit={async ({ values }) => {
            await createRecord.mutateAsync({ values, status: 'submitted', ...(formType ? { assessmentType: formType.key } : {}) });
            setFormOpen(false);
          }}
        />
      )}
    </section>
  );
}

export default TaskBrief;
