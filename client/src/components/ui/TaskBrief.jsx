import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleCheck,
  ClipboardList,
  FileText,
  Flame,
  HelpCircle,
  ListChecks,
  MapPin,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  useDesignGuidance,
  useSavedDesignGuidance,
} from "../../app/api/aiApi.js";
import { useProject } from "../../app/api/projectsApi.js";
import { useCreateRecord, useStageRecords } from "../../app/api/recordsApi.js";
import { useTemplate } from "../../app/api/templatesApi.js";
import { columnsFor, groupsFor, seedFor } from "../../lib/recordGroups.js";
import { RecordFormModal } from "../../features/projects/records/RecordFormModal.jsx";
import { getTaskPath } from "../../features/projects/stagesConfig.jsx";
import { useEmployees } from "../../hooks/useEmployees.js";
import { ClampText } from "./ClampText.jsx";
import { fmtDate, fmtDateTime, taskTitleText } from "../../lib/format.js";
import { useAppSelector } from "../../app/hooks.js";
import { selectCurrentUser } from "../../app/slices/authSlice.js";
import { can } from "../../lib/roles.js";
import { OutsourcePanel } from "../../features/projects/OutsourcePanel.jsx";
import { fileEntries, formatFieldValue } from "../../features/projects/records/recordUi.js";
import { Badge } from "./primitives.jsx";

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

/** A filed entry's state, in the words the phase page uses. Theme tokens only. */
const UPLOAD_TONE = {
  draft: { label: "Draft", soft: "var(--surface-2)" },
  submitted: { label: "Submitted", color: "var(--info)", soft: "color-mix(in srgb, var(--info) 14%, var(--surface))" },
  approved: { label: "Approved", color: "var(--success)", soft: "var(--success-soft)" },
  rejected: { label: "Sent back", color: "var(--danger)", soft: "color-mix(in srgb, var(--danger) 12%, var(--surface))" },
};

/** How many form fields the instructions card names before summarising the rest. */
const CAPTURE_SHOWN = 6;

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
 * The first photograph captured for a site, if there is one.
 *
 * Photos are not a fixed field. On the property form they arrive through the
 * file fields (Documents, Audio), and older records carry them as attachments —
 * so this looks at every file-shaped value rather than at one named key, and
 * takes the first entry that is actually an image. A PDF of the lease is a
 * document, not a thumbnail.
 */
function firstImageOf(site) {
  if (!site) return null;
  const isImage = (e) => e && typeof e === "object" && e.url && (
    (e.mimetype || "").startsWith("image/")
    || e.resourceType === "image"
    || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(e.url)
  );
  const pools = [
    ...Object.values(site.values || {}).filter(Array.isArray),
    site.attachments || [],
  ];
  for (const pool of pools) {
    const hit = pool.find(isImage);
    if (hit) return hit.url;
  }
  return null;
}

/**
 * A task, laid out the way the doer reads it: where they are, what to do, and
 * the facts and the checklist beside it.
 *
 *   Task Progress      — the whole job as steps, the current one lit
 *   Task Instructions  — what is asked, what the form will want, and the button
 *   Task Details       — due, priority, who, where, and the site itself
 *   Task Checklist     — passed in by the page, which owns ticking
 *
 * EVERY LIST ON THIS CARD IS READ, NOT WRITTEN. "Information to capture" is the
 * real form's own fields, in the form's own words — not a list typed here that
 * would drift the first time somebody edits the template. The steps come from
 * the task's real state (features/guide/taskGuide.js).
 *
 * `details` and `checklist` come from TaskDetailPage because the page already
 * owns them: the due-date arithmetic, the priority colour, and the checklist's
 * tick handler, its nudge and its approval lock. Re-deriving any of that here
 * would give the page two answers to "is this overdue".
 */
export function TaskBrief({ task, projectId, details = null, checklist = null, onSubmitted = null, cta = null, statusActions = null }) {
  // No `enabled` override: the hook's own default already skips until
  // `projectId` is a valid id, and forcing it true would fire the request with
  // an undefined project on first render.
  const { data: siteRecords } = useStageRecords(projectId, "p1");
  const sites = siteRecords?.data || siteRecords || [];
  /* A per-property task (a Phase 2 assessment for one shortlisted property)
     is about THAT property — its facts and photo are the ones shown. */
  const subjectId = task?.subjectRecord?._id || task?.subjectRecord || null;
  // Otherwise the chosen site: approved beats shortlisted beats whatever
  // exists, so this still points somewhere useful before the final selection.
  const site =
    (subjectId && sites.find((r) => String(r._id) === String(subjectId))) ||
    sites.find((r) => r.status === "approved") ||
    sites.find((r) => r.status === "shortlisted") ||
    sites[0] ||
    null;

  const { data: project } = useProject(projectId);
  /* Everything filed in this task's phase — cut down below to what THIS task
     filed, so the doer can see their uploads without leaving the task. */
  const { data: stageRecordsResp } = useStageRecords(projectId, task?.stageKey);
  const user = useAppSelector(selectCurrentUser);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const templateStage = template?.stages?.find((s) => s.key === task?.stageKey);
  const projectStage = project?.stages?.find((s) => s.key === task?.stageKey);
  const effectiveFormKey = inferFormKey(task, templateStage);
  const formName = formNameOf(effectiveFormKey, templateStage);
  const stageForm = stageHasAssessmentForm(templateStage, effectiveFormKey);
  // The Daily Site Report is filed HERE, in place, every working day — sending
  // the supervisor through the phase page for a two-minute phone form was a
  // detour. Every other stage form keeps the focus-mode phase link below.
  const recurring = effectiveFormKey === "daily_site_report";
  const inlineForm = recurring
    ? (templateStage?.assessmentTypes || []).find(
        (a) => a.key === effectiveFormKey,
      ) || null
    : null;
  const schema = inlineForm?.masterDataSchema || templateStage?.masterDataSchema || [];
  const noun = inlineForm?.name || projectStage?.recordNoun || "Entry";
  /* A phase whose register is split into named lists (see recordGroups) knows
     which list THIS task files into, so the doer is never asked to classify
     their own work. Null on every phase that keeps one undivided list. */
  const groupSeed = seedFor(
    (templateStage?.recordGroups || []).find(
      (g) => g.taskKey === task?.templateTaskKey,
    ),
  );
  // True while the pieces the buttons are made from are still arriving
  // (project, then its template). Rendered as a visible "preparing" state:
  // the button popping in after a silent gap read as a bug, and was one.
  const formLoading = Boolean(projectId) && (!project || (Boolean(templateId) && !template));
  const canSubmitHere = schema.length > 0 && Boolean(projectId) && task?.openPhaseOnly !== true && !task?.appPath;
  const effectiveBrief = inferredBrief(task, formName);
  const guideTask = task
    ? { ...task, formKey: effectiveFormKey, brief: effectiveBrief }
    : task;
  const stageHref =
    projectId && task?.stageKey
      ? getTaskPath(projectId, task.stageKey, { formKey: effectiveFormKey, code: task?.code, subjectRecord: subjectId })
      : null;

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

  /* Every hook above has run, whatever this task is — the instructions card
     is what is conditional, never the hooks. A task with no brief and no form
     still gets its progress, its details and its checklist: the action must
     never depend on the narrative, and neither must the facts. */
  const hasBrief = Boolean(effectiveBrief?.what || effectiveBrief?.how || effectiveBrief?.who || effectiveBrief?.when);
  const showInstructions = hasBrief || canSubmitHere || stageForm || Boolean(task?.appPath) || formLoading;

  const v = site?.values || {};
  const siteName = v.property_name || site?.title || "Site";
  const siteFacts = [
    v.carpet_area && `${v.carpet_area} sq.ft`,
    v.frontage_ft && `${v.frontage_ft} ft frontage`,
    v.floor && `${v.floor} floor`,
    v.locality,
  ].filter(Boolean);
  const siteImage = firstImageOf(site);
  const [thumbFailed, setThumbFailed] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [viewingRow, setViewingRow] = useState(null);
  const [inviteNonce, setInviteNonce] = useState(0);

  /* ── What this task has filed ──────────────────────────────────────────
     A designer who uploads a front design option must be able to SEE it —
     and the next one, and the outside architect's — on the task itself, not
     only on the phase page. A phase split into named lists (Phase 4's design
     options / drawing sets) knows exactly which lists are this task's; any
     other phase counts the entries stamped with this task. */
  const stageRows = stageRecordsResp?.data || stageRecordsResp || [];
  const taskGroups = (groupsFor(templateStage, stageRows) || [])
    .filter(({ group }) => group.taskKey && group.taskKey === task?.templateTaskKey);
  const filedRows = taskGroups.length
    ? taskGroups.flatMap(({ rows }) => rows)
    : stageRows.filter((r) => task?._id && String(r.task?._id || r.task || "") === String(task._id));
  const showUploads = Boolean(task?._id) && (taskGroups.length > 0 || filedRows.length > 0);
  const canCapture = can.capture(user?.role) && !project?.isArchived;
  /* Sending the work to an outside architect belongs to the phases that are
     split into named lists — the design phase — exactly where the phase page
     offers it. */
  const canOutsource = taskGroups.length > 0 && canCapture;

  /* The checklist sits under whichever card is SHORTER, so it fills the gap
     instead of leaving one. A short brief ("Open Feasibility") puts it on the
     left under the instructions; a long capture list keeps it on the right
     under the details. Only the two cards are measured, never the columns —
     moving the checklist cannot change the heights that decided where it
     goes, so it never flips back and forth. One column: always under the
     instructions, because the checklist is the work. */
  const instrRef = useRef(null);
  const detailsRef = useRef(null);
  const [checklistSide, setChecklistSide] = useState("main");

  /* What the form will ask for, from the form itself. Conditional fields
     (the rent that only appears for a rental) are left out: listing them as
     things to capture at EVERY property would be wrong for most properties.
     Required fields first, because those are the ones a submit refuses. */
  const captureFields = (canSubmitHere ? schema : [])
    .filter((f) => f && f.label && !f.showIf && f.type !== "section");
  const captureOrdered = [
    ...captureFields.filter((f) => f.required),
    ...captureFields.filter((f) => !f.required),
  ];
  const captureMore = Math.max(0, captureOrdered.length - CAPTURE_SHOWN);
  const captureShown = captureOpen ? captureOrdered : captureOrdered.slice(0, CAPTURE_SHOWN);
  const perRecord = (projectStage?.captureMode || templateStage?.captureMode) === "collection";

  useLayoutEffect(() => {
    const instr = instrRef.current;
    const facts = detailsRef.current;
    if (!instr || !facts) {
      setChecklistSide(instr ? "main" : "side");
      return undefined;
    }
    const oneColumn = window.matchMedia("(max-width: 1100px)");
    const decide = () => setChecklistSide(
      oneColumn.matches || instr.offsetHeight <= facts.offsetHeight ? "main" : "side",
    );
    decide();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(decide);
    ro?.observe(instr);
    ro?.observe(facts);
    oneColumn.addEventListener?.("change", decide);
    return () => {
      ro?.disconnect();
      oneColumn.removeEventListener?.("change", decide);
    };
  }, [showInstructions]);

  const stateOf = (st) => (st.done ? "Completed" : st.current ? "You are here" : "Pending");

  return (
    <section className="tv" aria-label="This task" data-guide="task-brief">
      {/* ── Task Progress ─────────────────────────────────────────────── */}
      {steps.length > 0 && (
        <div className="tv-card tv-progress">
          <div className="tv-card-head">
            <span className="tv-card-ic" aria-hidden><ListChecks size={15} /></span>
            <h3 className="tv-card-title">Task Progress</h3>
            {/* Kept: the header's Help button opens the tour by clicking this
                anchor, so removing it would leave Help doing nothing. */}
            <button
              type="button"
              className="tv-walk"
              onClick={walkThrough}
              data-guide="task-help"
            >
              <HelpCircle size={13} aria-hidden /> Walk me through
            </button>
          </div>
          <ol
            className="tv-steps"
            aria-label="Your steps"
            style={{ "--tv-n": steps.length }}
          >
            {steps.map((st, i) => (
              <li
                key={st.key}
                className={`tv-step${st.done ? " is-done" : ""}${st.current ? " is-current" : ""}`}
                aria-current={st.current ? "step" : undefined}
              >
                <span className="tv-step-dot" aria-hidden>
                  {st.done ? <Check size={15} strokeWidth={3} /> : i + 1}
                </span>
                <span className="tv-step-no" aria-hidden>Step {i + 1}</span>
                <span className="tv-step-title">{st.short || st.title}</span>
                <span className="tv-step-state">{stateOf(st)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* No instructions card to carry them — the task's buttons still show. */}
      {!showInstructions && (cta || statusActions) && (
        <div className="tv-actions is-top tv-actions-bare">
          {cta && (
            <button
              type="button"
              className="btn btn-primary tv-btn"
              data-guide={cta.guide}
              onClick={cta.onClick}
              disabled={cta.disabled}
            >
              {cta.icon}
              {cta.label}
            </button>
          )}
          {statusActions && <div className="tv-status-actions">{statusActions}</div>}
        </div>
      )}

      <div className={`tv-grid${showInstructions ? "" : " is-single"}`}>
        {/* ── Task Instructions ───────────────────────────────────────── */}
        {showInstructions && (
          <div className="tv-main">
            <div className="tv-card tv-instr" ref={instrRef}>
              <div className="tv-card-head">
                <span className="tv-card-ic" aria-hidden><ClipboardList size={15} /></span>
                <h3 className="tv-card-title">Task Instructions</h3>
              </div>

              {/* The buttons FIRST. Someone opening their task is looking for the
                  thing to press; it used to sit under the whole brief and the
                  field list, below the fold on a design task. */}
              <div className="tv-actions is-top">
                {formLoading && !canSubmitHere && (
                  <button type="button" className="btn btn-primary" disabled aria-busy="true">
                    <span className="spinner" style={{ marginRight: 6 }} /> Preparing the form…
                  </button>
                )}
                {cta && (
                  <button
                    type="button"
                    className="btn btn-primary tv-btn"
                    data-guide={cta.guide}
                    onClick={cta.onClick}
                    disabled={cta.disabled}
                  >
                    {cta.icon}
                    {cta.label}
                  </button>
                )}
                {canSubmitHere && (
                  <button
                    type="button"
                    className="btn btn-primary tv-btn"
                    onClick={() => setFormOpen(true)}
                    data-guide="task-action"
                  >
                    <Plus size={15} aria-hidden /> Submit {noun}
                  </button>
                )}
                {task?.appPath && (
                  <Link
                    className="btn btn-primary tv-btn"
                    to={task.appPath}
                    data-guide={canSubmitHere ? undefined : "task-action"}
                  >
                    Open {task.appPath.startsWith("/hrms") ? "HRMS" : "the module"} <ArrowRight size={14} aria-hidden />
                  </Link>
                )}
                {stageHref && (
                  <Link
                    /* A per-property task's link IS the work — straight to its
                       property with its assessment card live — so it is the
                       primary button, not a secondary "open the phase". */
                    className={subjectId && stageForm ? "btn btn-primary tv-btn" : "tv-btn-outline"}
                    to={stageHref}
                    data-guide={canSubmitHere || task?.appPath ? undefined : "task-action"}
                  >
                    {subjectId && stageForm && formName
                      ? `Do the ${formName} assessment`
                      : stageForm && formName
                      ? `Open ${formName}`
                      : task?.openPhaseOnly
                        ? `Open the ${(noun || "record").toLowerCase()} list`
                        : "Open the Phase"}
                    <ArrowRight size={14} aria-hidden />
                  </Link>
                )}
                {canOutsource && (
                  <button
                    type="button"
                    className="tv-btn-outline"
                    onClick={() => {
                      setInviteNonce((n) => n + 1);
                      setTimeout(() => document.getElementById("tv-uploads")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }}
                  >
                    <Send size={14} aria-hidden /> Send to an outside designer
                  </button>
                )}
                {statusActions && <div className="tv-status-actions">{statusActions}</div>}
              </div>

              {(effectiveBrief?.what || task?.title) && (
                <h4 className="tv-instr-title">{taskTitleText(effectiveBrief?.what || task.title)}</h4>
              )}
              {/* Long briefs fold after four lines behind "View more". */}
              {effectiveBrief?.how && (
                <ClampText as="p" lines={4} className="tv-instr-how">{effectiveBrief.how}</ClampText>
              )}

              {/* When and which phase have no home in the details grid, so they
                  ride here as one quiet line rather than being dropped. */}
              {(effectiveBrief?.when || task?.stageName) && (
                <p className="tv-instr-meta">
                  {effectiveBrief?.when && <span><b>When</b> {effectiveBrief.when}</span>}
                  {task?.stageName && <span><b>Phase</b> {task.stageName}</span>}
                </p>
              )}

              {captureShown.length > 0 && (
                <div className="tv-capture">
                  <p className="tv-capture-head">
                    <FileText size={14} aria-hidden />
                    {perRecord
                      ? `Information to capture for each ${noun.toLowerCase()}`
                      : `Information this ${noun.toLowerCase()} asks for`}
                  </p>
                  <ul className="tv-capture-list">
                    {captureShown.map((f) => (
                      <li key={f.key}>
                        <CircleCheck size={15} aria-hidden />
                        <span>
                          {f.label}
                          {f.required && <span className="tv-req" title="Required"> *</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {captureMore > 0 && (
                    <button
                      type="button"
                      className="tv-capture-more"
                      aria-expanded={captureOpen}
                      onClick={() => setCaptureOpen((open) => !open)}
                    >
                      {captureOpen
                        ? "Show less"
                        : `View more — ${captureMore} more field${captureMore === 1 ? "" : "s"}`}
                    </button>
                  )}
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
                      {ai.isPending ? "Thinking…" : ideas ? "Show ideas" : "Get design ideas"}
                    </button>
                  </div>

                  {aiError && <p className="tbrief-ai-note is-error">{aiError}</p>}

                  {ideas && (
                    <div className="tbrief-ai-out">
                      {ideas.summary && <p className="tbrief-ai-summary">{ideas.summary}</p>}
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
            </div>
            {checklistSide === "main" && checklist}
          </div>
        )}

        <div className="tv-side">
          {/* ── Task Details ──────────────────────────────────────────── */}
          <div className="tv-card tv-details" ref={detailsRef}>
            <div className="tv-card-head">
              <span className="tv-card-ic" aria-hidden><FileText size={15} /></span>
              <h3 className="tv-card-title">Task Details</h3>
            </div>

            <div className="tv-facts">
              {details && (
                <div className="tv-fact">
                  <span className="tv-fact-ic is-due" aria-hidden><CalendarDays size={16} /></span>
                  <div className="tv-fact-body">
                    <span className="tv-fact-k">Due Date</span>
                    <b className={`tv-fact-v${details.overdue ? " is-bad" : ""}`}>{details.due || "—"}</b>
                    {details.dueSub && (
                      <span className="tv-fact-sub" style={{ color: details.dueTone }}>{details.dueSub}</span>
                    )}
                  </div>
                </div>
              )}
              {details && (
                <div className="tv-fact">
                  <span className="tv-fact-ic is-priority" aria-hidden><Flame size={16} /></span>
                  <div className="tv-fact-body">
                    <span className="tv-fact-k">Priority</span>
                    <b className="tv-fact-v" style={{ color: details.priorityColor }}>{details.priority || "—"}</b>
                    {details.prioritySub && <span className="tv-fact-sub">{details.prioritySub}</span>}
                  </div>
                </div>
              )}
              <div className="tv-fact">
                <span className="tv-fact-ic is-person" aria-hidden><User size={16} /></span>
                <div className="tv-fact-body">
                  <span className="tv-fact-k">Assigned To</span>
                  <b className="tv-fact-v">{doer || effectiveBrief?.who || "Unassigned"}</b>
                  {doer && backup && <span className="tv-fact-sub">backup {backup}</span>}
                </div>
              </div>
              <div className="tv-fact">
                <span className="tv-fact-ic is-place" aria-hidden><MapPin size={16} /></span>
                <div className="tv-fact-body">
                  <span className="tv-fact-k">Location</span>
                  <b className="tv-fact-v">{project?.city || project?.address || "—"}</b>
                  {site && <span className="tv-fact-sub">{siteName}{v.locality ? ` · ${v.locality}` : ""}</span>}
                </div>
              </div>
            </div>

            {/* The site's own facts, and the way through to everything captured
                about it — photos, video walkthrough, floor plan, owner, broker. */}
            {site && projectId && (
              <div className="tv-site">
                <span className="tv-site-thumb">
                  {siteImage && thumbFailed !== siteImage
                    ? <img src={siteImage} alt="" loading="lazy" onError={() => setThumbFailed(siteImage)} />
                    : <MapPin size={20} aria-hidden />}
                </span>
                <span className="tv-site-text">
                  <b>{siteName}</b>
                  {siteFacts.length > 0 && <span>{siteFacts.join(" · ")}</span>}
                </span>
                <Link
                  className="tv-site-link"
                  to={`/projects/${projectId}/property-identification/${site._id}`}
                >
                  View Details <ArrowRight size={13} aria-hidden />
                </Link>
              </div>
            )}
          </div>

          {/* ── Task Checklist — owned by the page; here when this is the
              shorter side (see checklistSide) ─────────────────────────── */}
          {(checklistSide === "side" || !showInstructions) && checklist}
        </div>
      </div>

      {/* ── Uploaded by this task ─────────────────────────────────────── */}
      {showUploads && (
        <div className="tv-card tv-uploads" id="tv-uploads">
          <div className="tv-card-head">
            <span className="tv-card-ic" aria-hidden><Paperclip size={15} /></span>
            <h3 className="tv-card-title">
              Uploaded {noun}s <span className="tv-count">{filedRows.length}</span>
            </h3>
            {canSubmitHere && (
              <button type="button" className="btn btn-primary btn-sm tv-uploads-add" onClick={() => setFormOpen(true)}>
                <Plus size={14} aria-hidden /> {filedRows.length ? `Upload another ${noun.toLowerCase()}` : `Submit ${noun}`}
              </button>
            )}
          </div>

          {/* Who outside the company is doing this work, and the link that lets
              them upload straight into this list with no login. */}
          {taskGroups.length > 0 && projectId && (
            <OutsourcePanel
              projectId={projectId}
              projectName={project?.name}
              stageKey={task.stageKey}
              group={taskGroups[0].group}
              task={task}
              canInvite={canCapture}
              openInvite={inviteNonce}
            />
          )}

          {filedRows.length === 0 ? (
            <p className="tv-uploads-empty">
              Nothing uploaded yet. {canSubmitHere ? `Use “Submit ${noun}” — each one you file appears here.` : ""}
            </p>
          ) : (
            (taskGroups.length > 1 ? taskGroups : [{ group: taskGroups[0]?.group || null, rows: filedRows }])
              .filter(({ rows }) => rows.length > 0)
              .map(({ group, rows }) => {
                const cols = columnsFor(group, schema).filter((f) => f.type !== "file");
                const fileFields = schema.filter((f) => f.type === "file");
                return (
                  <div key={group?.key || "all"} className="tv-up-group">
                    {taskGroups.length > 1 && <p className="tv-up-group-title">{group.label}</p>}
                    <ul className="tv-up-list">
                      {rows.map((r, i) => {
                        const files = fileFields.flatMap((f) => fileEntries(r.values?.[f.key]));
                        const image = files.find((f) => (f.mimetype || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(f.url || ""));
                        const [first, ...rest] = cols;
                        const name = (first && r.values?.[first.key]) || r.title || `${noun} ${i + 1}`;
                        const facts = rest
                          .map((f) => (r.values?.[f.key] == null || r.values?.[f.key] === "" ? null : formatFieldValue(f, r.values[f.key])))
                          .filter(Boolean);
                        const when = r.submittedAt || r.updatedAt || r.createdAt;
                        const tone = UPLOAD_TONE[r.status] || UPLOAD_TONE.draft;
                        return (
                          <li key={r._id} className="tv-up-row">
                            <span className="tv-up-thumb">
                              {image ? <img src={image.url} alt="" loading="lazy" /> : <FileText size={18} aria-hidden />}
                            </span>
                            <span className="tv-up-main">
                              <b>{String(name)}</b>
                              <span className="tv-up-sub">
                                {[...facts, when ? fmtDate(when) : null].filter(Boolean).join(" · ")}
                              </span>
                              {files.length > 0 && (
                                <span className="tv-up-files">
                                  {files.map((f) => (
                                    <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="tv-up-file">
                                      <Paperclip size={11} aria-hidden /> {f.name}
                                    </a>
                                  ))}
                                </span>
                              )}
                            </span>
                            <Badge color={tone.color} soft={tone.soft}>{tone.label}</Badge>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewingRow(r)}>Open</button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
          )}
        </div>
      )}

      {viewingRow && (
        <RecordFormModal
          open
          readOnly
          onClose={() => setViewingRow(null)}
          schema={schema}
          recordNoun={noun}
          initialValues={viewingRow.values}
          projectId={projectId}
        />
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
             these keys belong to the plan's schema. */
          seedValues={
            recurring
              ? { report_date: new Date().toISOString().slice(0, 10) }
              : groupSeed
              ? groupSeed
              : task?.stageKey === "p20"
              ? {
                  ...(v.carpet_area != null ? { confirmed_area: v.carpet_area } : {}),
                  ...(project?.targetEndDate
                    ? { target_opening: String(project.targetEndDate).slice(0, 10) }
                    : {}),
                  ...(project?.budget?.planned ? { setup_cost: project.budget.planned } : {}),
                }
              : null
          }
          projectId={projectId}
          saving={createRecord.isPending}
          onSaveDraft={async ({ values }) => {
            await createRecord.mutateAsync({
              values,
              status: "draft",
              ...(task?._id ? { taskId: task._id } : {}),
              ...(inlineForm ? { assessmentType: inlineForm.key } : {}),
            });
            setFormOpen(false);
          }}
          onSubmit={async ({ values }) => {
            await createRecord.mutateAsync({
              values,
              status: "submitted",
              ...(task?._id ? { taskId: task._id } : {}),
              ...(inlineForm ? { assessmentType: inlineForm.key } : {}),
            });
            setFormOpen(false);
            // Submitting is not ticking: the page points at what is still open.
            onSubmitted?.();
          }}
        />
      )}
    </section>
  );
}

export default TaskBrief;
