/**
 * The project as a TREE: phases across the top, their tasks branching beneath.
 *
 * WHAT THIS REPLACED. The page opened on a horizontal strip of numbered
 * circles — thirteen of them, each reading "Not Started" — above a "Stage Plan"
 * list that said the same thing again in rows. Neither showed a task, an owner,
 * a date or a reason. The only way to learn anything was to click a circle,
 * read one phase, come back, and click the next.
 *
 * NOTHING HERE IS DISABLED. No card is locked, no phase waits for the phase
 * before it, no task waits for a dependency. That is the rule the screen was
 * rebuilt around, not an oversight.
 *
 * THE FIRST TWO PHASES DRAW NO BRANCHES. Their tasks are opened from inside the
 * phase, not from the tree. Chosen by POSITION — the first two phases in the
 * project's own order — rather than by hardcoding `p1` and `p2`: the phase list
 * is the template's, and a template that inserts or reorders a phase would send
 * a key-based rule to the wrong cards while still looking correct. Every other
 * phase branches exactly as before, four assessments and all.
 *
 * A CARD IS A LINK, NOT A DRAWER. Clicking a phase opens that phase's own page
 * at its own URL; clicking a task opens the same page focused on that task, via
 * `?form=&task=` — the pair useTaskFocus already reads. The drawer that briefly
 * lived here gave a working screen no address: it could not be shared, the back
 * button did not close it, and it duplicated a phase page that had never gone
 * away. The URL is the feature.
 *
 * THE CLOCK IS THE ONLY THING THAT GOES RED, and it goes red on a DATE, never
 * on a state. A card can read `Pending` with a red clock; that is the most
 * useful card on the screen, because it says both what slipped and where it
 * stalled. Collapsing those into a fourth "overdue" state would lose the second
 * half every time.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { phaseCounts, isPastDue, TASK_STATE } from './phaseProgress.js';
import { clockFor, fractionOf, launchClock, startOf, endOf, windowText } from './taskClock.js';
import { fmtDate, fmtDateTimeLong, fmtCurrency } from '../../lib/format.js';
import { deptMeta } from '../../lib/ui.js';
import { getStagePath, getTaskPath, getRecordReportPath } from './stagesConfig.jsx';
import { moduleStatusKey, latestRecordOf, MODULE_STATUS_META } from './records/recordUi.js';

const LABEL = {
  [TASK_STATE.PENDING]: 'Pending',
  [TASK_STATE.PROCESSING]: 'Processing',
  [TASK_STATE.COMPLETE]: 'Complete',
};

/** How many phases, from the start, are drawn without their task branches. */
const PHASES_WITHOUT_BRANCHES = 2;

/** Bar fill per module status — the same five keys MODULE_STATUS_META uses. */
const MODULE_PCT = { pending: 0, in_progress: 30, in_review: 65, approved: 100, rejected: 45 };

/** `on_track` -> `On track`. CSS alone cannot do this. */
const humanise = (v) => String(v || '').replace(/_/g, ' ');

/* ── the launch countdown ──────────────────────────────────────────────── */

/**
 * The one date the whole build is aimed at, counted down live.
 *
 * THE TEMPLATE CHOOSES THE DATE, NOT THIS COMPONENT. The server finds the
 * template's own `datetime` field — "Launch Date & Time" on Phase 12 in the
 * default template — and falls back to the project's target opening date. So
 * `launch.label` is the template's wording, printed as written; editing the
 * template renames what this banner says without anybody touching this file.
 *
 * WHEN THERE IS NO DATE IT SAYS SO. An empty banner, or one quietly hidden,
 * reads as "no launch is planned" — when what is actually true is "nobody has
 * filled the launch form in yet", and that is the thing worth prompting.
 */
function LaunchBanner({ launch, now, projectName, phases, project, tpl }) {
  const c = launchClock(launch?.at, now);

  /* Everything the strip above used to repeat, counted once, here. */
  const roll = useMemo(() => {
    const tasks = phases.flatMap((p) => p.tasks);
    const prog = phases.map((p) => phaseCounts(p.tasks).progress);
    const mods = phases.flatMap((p) => (p.assessments || []).map((m) => ({
      m, records: p.records || [], parentId: p.records?.[0]?.parentRecordId,
    })));
    const modState = mods.map(({ m, records, parentId }) => moduleStatusKey(m, records, parentId));
    return {
      phases: {
        total: phases.length,
        complete: prog.filter((x) => x === TASK_STATE.COMPLETE).length,
        running: prog.filter((x) => x === TASK_STATE.PROCESSING).length,
      },
      tasks: {
        total: tasks.length,
        complete: tasks.filter((t) => t.status === TASK_STATE.COMPLETE).length,
        running: tasks.filter((t) => t.status === TASK_STATE.PROCESSING).length,
        late: tasks.filter((t) => isPastDue(t, now)).length,
      },
      mods: {
        total: mods.length,
        approved: modState.filter((x) => x === 'approved').length,
        waiting: modState.filter((x) => x === 'in_review').length,
        untouched: modState.filter((x) => x === 'pending').length,
      },
    };
  }, [phases, now]);

  const late = Boolean(c?.past);
  const pct = Math.max(0, Math.min(100, Math.round(project?.progress ?? 0)));

  /**
   * One cell of the stat band.
   *
   * These used to be six stacked rows with a label column 104px wide, which
   * made the card tall and left most of its width empty on a wide screen. Side
   * by side they read in one sweep and the card is a third the height.
   */
  const Cell = ({ label, value, sub, tone }) => (
    <div className={`pt-ov-cell${tone ? ` t-${tone}` : ''}`}>
      <span className="pt-ov-k">{label}</span>
      <span className="pt-ov-v">{value}</span>
      {sub && <span className="pt-ov-s">{sub}</span>}
    </div>
  );

  return (
    <section className={`pt-ov${late ? ' is-late' : ''}`} aria-label="Project overview">
      <header className="pt-ov-head">
        {/* The progress ring, the badges and the location all lived in a
            separate header card above this one, alongside a Stages / Opening /
            Budget strip. Two summary blocks stacked on top of each other said
            overlapping things in different shapes; this is the one summary. */}
        <div className="pt-ov-ring" style={{ '--pct': pct }} aria-hidden>
          <span>{pct}%</span>
        </div>
        <div className="pt-ov-id">
          <div className="pt-ov-titles">
            <h2 className="pt-ov-name">{projectName}</h2>
            {project?.code && <span className="pt-ov-code">{project.code}</span>}
          </div>
          <div className="pt-ov-tags">
            {/* The stored values are snake_case (`on_track`, `at_risk`), and CSS
                `text-transform: capitalize` leaves the underscore sitting in
                the middle of the word — "On_track". The class keeps the raw
                key; only the label is humanised. */}
            {project?.status && (
              <span className={`pt-tag s-${project.status}`}>{humanise(project.status)}</span>
            )}
            {project?.health && (
              <span className={`pt-tag h-${project.health}`}>{humanise(project.health)}</span>
            )}
            {project?.city && <span className="pt-tag plain">{project.city}</span>}
          </div>
        </div>
      </header>

      <div className="pt-ov-band">
        {/* THE COUNTDOWN LEADS. It is the one number on this screen a person
            walks up to the desk to read, so it gets its own panel, the largest
            type on the page, and — when the date has gone — the danger tint.
            The rest of the figures are context beside it, not peers of it. */}
        <div className={`pt-ov-hero${late ? ' is-late' : ''}${c ? '' : ' is-none'}`}>
          <span className="pt-ov-k">{c ? (late ? 'Overdue by' : 'Goes live in') : 'Timeline'}</span>
          {c ? (
            <>
              <span className="pt-ov-big">
                <b>{c.days}</b>
                <i>{c.days === 1 ? 'day' : 'days'}</i>
              </span>
              <span className="pt-ov-clock">{c.clock}</span>
              <span className="pt-ov-s">{fmtDateTimeLong(c.target)} · {launch.label}</span>
            </>
          ) : (
            <>
              <span className="pt-ov-big"><b>—</b></span>
              <span className="pt-ov-s">
                No launch date yet. Fill in Launch Date &amp; Time on the launch phase.
              </span>
            </>
          )}
        </div>

        <div className="pt-ov-cells">
          <Cell
            label="Phases"
            value={`${roll.phases.complete} / ${roll.phases.total}`}
            sub={roll.phases.running ? `${roll.phases.running} in progress` : 'none in progress'}
          />
          <Cell
            label="Tasks"
            value={`${roll.tasks.complete} / ${roll.tasks.total}`}
            sub={[
              roll.tasks.running ? `${roll.tasks.running} running` : null,
              roll.tasks.late ? `${roll.tasks.late} past its date` : null,
            ].filter(Boolean).join(' · ') || 'nothing running'}
            tone={roll.tasks.late ? 'late' : null}
          />
          <Cell
            label="Assessments"
            value={roll.mods.total ? `${roll.mods.approved} / ${roll.mods.total}` : '—'}
            sub={roll.mods.total
              ? [
                roll.mods.waiting ? `${roll.mods.waiting} awaiting review` : null,
                roll.mods.untouched ? `${roll.mods.untouched} not started` : null,
              ].filter(Boolean).join(' · ') || 'all filed'
              : 'none in this template'}
          />
          <Cell
            label="Budget"
            value={project?.budget?.planned ? fmtCurrency(project.budget.planned) : 'not set'}
            sub={project?.budget?.planned
              ? `${project.budgetUtilization ?? 0}% used · ${fmtCurrency(project.budget.actual || 0)} spent`
              : 'no planned budget'}
          />
          <Cell
            label="Opening"
            value={project?.plannedStartDate ? fmtDate(project.plannedStartDate) : 'not set'}
            sub={`${phases.length} phase${phases.length === 1 ? '' : 's'} planned`}
          />
          {/* WHAT THE TEMPLATE ASKED FOR, end to end. The sum of every phase's
              slaDays, and the date that plan runs out from the project's
              planned start — the schedule the phase cards are now measured
              against, stated once so the two can be compared. */}
          {tpl?.totalDays > 0 && (
            <Cell
              label="Template plan"
              value={`${tpl.totalDays} days`}
              sub={tpl.plannedEndsOn ? `ends ${fmtDate(tpl.plannedEndsOn)}` : 'no planned start set'}
            />
          )}
        </div>
      </div>

      {/* The audit door — every entry of every phase, as data. It sat under the
          old header card and would otherwise have gone with it. */}
      <Link className="pt-ov-link" to={`/data-explorer?project=${project?._id}`}>
        Data Explorer — every entry, phase by phase →
      </Link>
    </section>
  );
}

/* ── the hover detail ──────────────────────────────────────────────────── */

/**
 * What a card cannot fit, shown on hover.
 *
 * ONE popover for the whole tree, positioned `fixed` against the hovered card's
 * rectangle — not one per card. The tree scrolls sideways inside a container
 * with `overflow-x: auto`, so a popover rendered inside a card is clipped by
 * that container the moment it extends past the card's edge, which is always.
 * Fixed positioning escapes the clip; a single instance keeps 60-odd cards from
 * each carrying a hidden panel in the DOM.
 *
 * It FLIPS rather than overflows: near the right edge it opens to the left, and
 * near the bottom it rises. A detail panel that runs off screen is worse than
 * none, because the thing you wanted is the part that got cut.
 */
function CardPopover({ hover }) {
  if (!hover) return null;
  const { rect, title, eyebrow, tone, rows, note } = hover;

  const W = 268;
  const GAP = 10;
  const flipX = rect.right + GAP + W > window.innerWidth;
  const left = flipX ? Math.max(8, rect.left - GAP - W) : rect.right + GAP;
  const top = Math.min(
    Math.max(8, rect.top),
    Math.max(8, window.innerHeight - 8 - Math.min(340, 90 + rows.length * 26)),
  );

  return (
    <div className="pt-pop" style={{ left, top, width: W }} role="tooltip">
      {eyebrow && <div className="pt-pop-eyebrow">{eyebrow}</div>}
      <div className="pt-pop-title">{title}</div>
      {tone && <span className={`pt-pop-tone t-${tone.key}`}>{tone.label}</span>}
      <dl className="pt-pop-rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="pt-pop-note">{note}</p>}
    </div>
  );
}

/** Wires one card up to the shared popover without repeating four handlers. */
const hoverProps = (onHover, build) => ({
  onMouseEnter: (e) => onHover({ ...build(), rect: e.currentTarget.getBoundingClientRect() }),
  onMouseLeave: () => onHover(null),
  /* Keyboard users get it too — these cards are links, so they take focus. */
  onFocus: (e) => onHover({ ...build(), rect: e.currentTarget.getBoundingClientRect() }),
  onBlur: () => onHover(null),
});

/* ── one task card ─────────────────────────────────────────────────────── */

function TaskCard({ task, now, projectId, onHover }) {
  const s = task.status || TASK_STATE.PENDING;
  const start = startOf(task);
  const end = endOf(task);
  const c = clockFor(s, start, end, now);
  const frac = fractionOf(s, start, end, now);

  return (
    <div className="pt-kid">
      {/* A real <Link>: middle-click and "open in new tab" work, and the address
          bar shows where you are. A <button> that called navigate() would look
          identical and do neither. */}
      <Link
        className={`pt-c tcard is-${s}`}
        to={getTaskPath(projectId, task.stageKey, { formKey: task.formKey, code: task.code })}
        {...hoverProps(onHover, () => ({
          eyebrow: task.code,
          title: task.title,
          tone: { key: s, label: LABEL[s] },
          rows: [
            ['Owner', task.assignee?.name || 'Unassigned'],
            ['Starts', start ? fmtDateTimeLong(start) : 'No start date'],
            ['Due', end ? fmtDateTimeLong(end) : 'No due date'],
            ['Clock', c.text],
            ...(task.department ? [['Department', deptMeta(task.department).label]] : []),
            ...(task.startedAt ? [['Started', fmtDateTimeLong(task.startedAt)]] : []),
            ...(task.completedAt ? [['Completed', fmtDateTimeLong(task.completedAt)]] : []),
          ],
          note: 'Opens this task on its phase page.',
        }))}
      >
        <span className="pt-name">{task.title}</span>
        <span className="pt-meta">{task.assignee?.name || 'Unassigned'}</span>
        <span className="pt-meta">{windowText(start, end)}</span>
        <span className="pt-bar">
          <i
            className={s === TASK_STATE.COMPLETE ? 'd' : 'p'}
            style={{
              width: `${Math.round(frac * 100)}%`,
              ...(s === TASK_STATE.PENDING ? { background: 'var(--border-strong)' } : null),
            }}
          />
        </span>
        <span className={`pt-cd t-${c.tone}`}>{c.text}</span>
        <span className="pt-bot">
          <span className={`pt-chip ${s}`}>{LABEL[s]}</span>
          <span className="pt-caret">Open →</span>
        </span>
      </Link>
    </div>
  );
}

/* ── one assessment card ───────────────────────────────────────────────── */

/**
 * One module of a phase — LOI, Lease Agreement, Legal Verification — as a
 * branch of its own.
 *
 * WHY MODULES AND NOT TASKS. Commercial Closure has SIX modules and five
 * tasks, and no task names a module: `formKey` is filled in on Phase 2's tasks
 * and almost nowhere else. So a task branch cannot open "the LOI form", because
 * no task means LOI. The module is the thing with a form, a record, a submitter
 * and a report — so the module is the branch.
 *
 * WHERE THE CARD GOES depends on whether anything has been filed:
 *   nothing yet → the FORM, focused on this module;
 *   filed       → the record's REPORT, which carries who filed it, when, for
 *                 which property, and the Download PDF button.
 * A phase whose report page does not exist yet keeps pointing at the form —
 * better than a finished-looking card that lands on a 404.
 */
function AssessmentCardBranch({ module: mod, records, parentId, projectId, stageKey, onHover }) {
  const statusKey = moduleStatusKey(mod, records, parentId);
  const record = latestRecordOf(mod, records, parentId);
  const meta = MODULE_STATUS_META[statusKey] || MODULE_STATUS_META.pending;
  const report = record ? getRecordReportPath(projectId, stageKey, record) : null;
  const to = report || getTaskPath(projectId, stageKey, { formKey: mod.key });

  const who = record?.approvedBy?.name || record?.submittedBy?.name;
  const when = record?.submittedAt || record?.createdAt;
  const filings = (records || []).filter(
    (r) => String(r.parentRecordId) === String(parentId) && r.assessmentType === mod.key,
  ).length;

  return (
    <div className="pt-kid">
      <Link
        className={`pt-c tcard is-mod-${statusKey}`}
        to={to}
        {...hoverProps(onHover, () => ({
          eyebrow: 'Assessment',
          title: mod.name,
          tone: { key: statusKey, label: meta.label },
          rows: [
            ...(mod.subtitle ? [['About', mod.subtitle]] : []),
            ['Submitted by', record?.submittedBy?.name || '—'],
            ['Submitted on', record?.submittedAt ? fmtDateTimeLong(record.submittedAt) : '—'],
            ['Approved by', record?.approvedBy?.name || '—'],
            ['Filings', filings ? `${filings} submission${filings === 1 ? '' : 's'}` : 'none yet'],
          ],
          note: report
            ? 'Opens the filed report — who filed it, when, and the Download PDF button.'
            : 'Opens this form on the phase page.',
        }))}
      >
        <span className="pt-name">{mod.name}</span>
        <span className="pt-meta">{who ? `Filed by ${who}` : 'Not filed yet'}</span>
        <span className="pt-meta">{when ? fmtDateTimeLong(when) : mod.subtitle || '—'}</span>
        <span className="pt-bar">
          <i style={{ width: `${MODULE_PCT[statusKey] ?? 0}%`, background: meta.color }} />
        </span>
        <span className="pt-cd t-pending">
          {report ? 'Report ready' : record ? 'Open the form' : 'Nothing filed yet'}
        </span>
        <span className="pt-bot">
          <span className="pt-chip" style={{ background: meta.soft, color: meta.color, borderColor: meta.color }}>
            {meta.label}
          </span>
          <span className="pt-caret">{report ? 'View PDF →' : 'Open →'}</span>
        </span>
      </Link>
    </div>
  );
}

/* ── one phase, with its tasks branching beneath ───────────────────────── */

function PhaseBranch({ phase, now, open, onToggle, projectId, filter, branches, onHover }) {
  const modules = phase.assessments || [];

  /* EVERY ASSESSMENT HANGS OFF A PROPERTY, so a module's records can only be
     read against one. The server sorts records newest-first, so the first one
     names the property currently being worked — the same one the phase page
     lands on. With no records at all this is undefined, and every module
     correctly reads "nothing filed yet". */
  const parentId = phase.records?.[0]?.parentRecordId;
  const { progress, counts, total } = useMemo(() => phaseCounts(phase.tasks), [phase.tasks]);
  const dept = phase.department ? deptMeta(phase.department).label : null;

  /**
   * THE TEMPLATE'S DATES WIN.
   *
   * The template says how long each phase should take — "Phase 1: 10 days" —
   * and the server lays those durations end to end from the project's planned
   * start, so every phase has a window the plan actually asked for. This card
   * used to derive its window from the min and max of its TASKS' dates, which
   * is a different question: what somebody scheduled, not what was planned.
   * The two drifted apart and the card showed "planned 15d" next to a window
   * that was nothing of the sort.
   *
   * Task dates remain the fallback for a phase the template gave no slaDays,
   * or a project with no planned start — the card then has no template window
   * to show and says so on its own line. */
  const planned = Boolean(phase.plan?.startsOn && phase.plan?.endsOn);
  const start = useMemo(() => {
    if (phase.plan?.startsOn) return new Date(phase.plan.startsOn);
    const starts = phase.tasks.map(startOf).filter(Boolean);
    return starts.length ? new Date(Math.min(...starts)) : null;
  }, [phase.plan, phase.tasks]);
  const end = useMemo(() => {
    if (phase.plan?.endsOn) return new Date(phase.plan.endsOn);
    const ends = phase.tasks.map(endOf).filter(Boolean);
    return ends.length ? new Date(Math.max(...ends)) : null;
  }, [phase.plan, phase.tasks]);
  const c = clockFor(progress, start, end, now);

  const visible = phase.tasks.filter((t) => {
    if (filter === 'all') return true;
    if (filter === 'late') return isPastDue(t, now);
    return (t.status || TASK_STATE.PENDING) === filter;
  });

  return (
    <div className="pt-kid">
      {/* The CARD opens the phase page; the caret at its foot only shows or
          hides the branch. Those were one control before, so there was no way to
          reach a phase page from the tree at all — the click was spent on the
          accordion. They are separate now, and the caret stops the click from
          reaching the link it sits inside. A phase drawn without branches has
          nothing to toggle, so its caret says what the card does instead. */}
      <Link
        className={`pt-c pcard is-${progress}`}
        to={getStagePath(projectId, phase.key)}
        {...hoverProps(onHover, () => ({
          eyebrow: dept ? `${dept} · phase` : 'Phase',
          title: phase.name,
          tone: { key: progress, label: LABEL[progress] },
          rows: [
            modules.length
              ? ['Assessments', `${modules.length} module${modules.length === 1 ? '' : 's'}`]
              : ['Tasks', `${counts.complete} done · ${counts.processing} running · ${total - counts.complete - counts.processing} pending`],
            ...(modules.length ? [['Tasks', `${total}`]] : []),
            ['Window', start && end ? `${fmtDateTimeLong(start)} → ${fmtDateTimeLong(end)}` : 'No dates set'],
            ['Clock', c.text],
            ...(phase.plan?.slaDays != null ? [['Planned', `${phase.plan.slaDays} days`]] : []),
            ...(phase.plan?.estimatedDays ? [['Blueprint effort', `${phase.plan.estimatedDays} days`]] : []),
          ],
          note: phase.plan?.unmet?.length
            ? `Off the template plan: ${phase.plan.unmet.join(', ')}`
            : 'Opens this phase, with its forms, records and approvals.',
        }))}
      >
        {/* The strip is always here, empty when the phase is not active, so every
            card starts its title at the same height. */}
        <span className="pt-top">
          {progress === TASK_STATE.PROCESSING && <span className="pt-now">Active</span>}
        </span>
        <span className="pt-name">{phase.name}</span>
        <span className="pt-meta">
          {dept ? `${dept} · ` : ''}
          {modules.length
            ? `${modules.length} assessment${modules.length === 1 ? '' : 's'}`
            : `${total} task${total === 1 ? '' : 's'}`}
          {/* WHAT THE TEMPLATE PLANNED, beside what is actually here. Only the
              SLA is printed — the blueprint task count is already the number to
              its left whenever the two agree, and repeating it would put the
              same figure on the card twice. */}
          {phase.plan?.slaDays != null && ` · planned ${phase.plan.slaDays}d`}
        </span>
        {/* THE DATES, IN FULL. A phase card showed none — its clock line said
            "Window opens 10 Sep", which named one date and left the other two
            facts (when it ends, how long is left) unsaid. */}
        <span className="pt-meta">
          {windowText(start, end)}
          {planned && <span className="pt-src"> per template</span>}
        </span>
        {phase.plan?.unmet?.length > 0 && (
          <span className="pt-drift" title={phase.plan.unmet.join('\n')}>
            {phase.plan.unmet.length} of {phase.plan.blueprintTasks} planned task
            {phase.plan.blueprintTasks === 1 ? '' : 's'} not found by name
          </span>
        )}
        <span className="pt-bar">
          <i className="d" style={{ width: `${total ? Math.round(counts.complete / total * 100) : 0}%` }} />
          <i className="p" style={{ width: `${total ? Math.round(counts.processing / total * 100) : 0}%` }} />
        </span>
        <span className={`pt-cd t-${c.tone}`}>{c.text}</span>
        <span className="pt-bot">
          <span className={`pt-chip ${progress}`}>{LABEL[progress]}</span>
          {branches ? (
            <span
              className="pt-caret pt-toggle"
              role="button"
              tabIndex={0}
              aria-expanded={open}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(phase.key); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); e.stopPropagation(); onToggle(phase.key);
              }}
            >
              {open ? 'Hide' : 'Show'} {modules.length ? 'assessments' : 'tasks'}
            </span>
          ) : (
            <span className="pt-caret">Open →</span>
          )}
        </span>
      </Link>

      {branches && open && (
        <>
          <div className="pt-stem" />
          <div className="pt-kids">
            {/* MODULES WIN WHERE A PHASE HAS THEM. Otherwise the tasks branch,
                which is still right for a phase like Design & Drawings that has
                one task and no modules at all. */}
            {modules.length > 0 ? (
              modules.map((m) => (
                <AssessmentCardBranch
                  key={m.key}
                  module={m}
                  records={phase.records || []}
                  parentId={parentId}
                  projectId={projectId}
                  stageKey={phase.key}
                  onHover={onHover}
                />
              ))
            ) : visible.length === 0 ? (
              <div className="pt-kid">
                <span className="pt-empty">
                  {total === 0 ? 'No tasks in this phase yet.' : 'No task here matches the filter.'}
                </span>
              </div>
            ) : visible.map((t) => (
              <TaskCard key={t._id} task={t} now={now} projectId={projectId} onHover={onHover} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── the tree ──────────────────────────────────────────────────────────── */

export function ProjectTree({ tree }) {
  const projectId = tree?.project?._id;
  const phases = tree?.phases || [];

  /* Only the phases that actually have a branch can be open, so "Expand all"
     cannot leave the first two in a state their card has no control for. */
  const branchKeys = useMemo(
    () => phases.slice(PHASES_WITHOUT_BRANCHES).map((p) => p.key),
    [phases],
  );
  const [openKeys, setOpenKeys] = useState(() => new Set(branchKeys));
  const [filter, setFilter] = useState('all');
  /* Which card the pointer is on, and where it sits on screen. */
  const [hover, setHover] = useState(null);

  /* One clock for the whole tree. Every card reads this tick, so nothing can
     show a different second from the card beside it. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* The tree scrolls sideways and a hard cut hides that it does. */
  const scroller = useRef(null);
  const [edges, setEdges] = useState({ l: false, r: false });
  /**
   * WRITES ONLY WHEN THE ANSWER CHANGED.
   *
   * The first version called `setEdges({ l, r })` unconditionally from an effect
   * with no dependency array. A fresh object is never `Object.is`-equal to the
   * last one, so every render scheduled another render: React caught it as
   * "Maximum update depth exceeded" and the tree re-rendered in a tight loop
   * behind an otherwise normal-looking screen.
   */
  const measure = () => {
    /* Any scroll invalidates the popover's anchor rect — it is positioned
       `fixed`, so it would sit over empty space while the card slid away. */
    setHover(null);
    const el = scroller.current;
    if (!el) return;
    const l = el.scrollLeft > 4;
    const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdges((prev) => (prev.l === l && prev.r === r ? prev : { l, r }));
  };
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    /* Re-measured when the phase set or what is expanded changes — those are
       the only things that alter the scroll width. */
  }, [phases.length, openKeys, filter]);

  const all = phases.flatMap((p) => p.tasks);
  const done = all.filter((t) => t.status === TASK_STATE.COMPLETE).length;
  const running = all.filter((t) => t.status === TASK_STATE.PROCESSING).length;
  const pending = all.length - done - running;
  const late = all.filter((t) => isPastDue(t, now)).length;

  const toggle = (key) => setOpenKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /* "Where is the work?" — the first phase that is not finished. */
  const jumpToWork = () => {
    const i = phases.findIndex((p) => phaseCounts(p.tasks).progress !== TASK_STATE.COMPLETE);
    const el = scroller.current?.querySelectorAll('.pt-kids > .pt-kid')[Math.max(0, i)];
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <div>
      <LaunchBanner
        launch={tree?.launch}
        now={now}
        projectName={tree?.project?.name || 'This store'}
        project={tree?.project}
        tpl={tree?.template}
        phases={phases}
      />

      {/* WHICH TEMPLATE THIS SCREEN IS BASED ON — said out loud, because every
          phase, task and form below is the template's and nothing on the page
          otherwise reveals which one. A project with no template gets a warning
          rather than a blank plan, since that is a real state: the one draft in
          this database has no template attached and its tree is empty. */}
      {tree?.template ? (
        <p className="pt-tplline">
          Built from <b>{tree.template.name}</b>
          {tree.template.isDefault && <span className="pt-tplbadge">default</span>}
          <span className="mono"> {tree.template.code}</span>
        </p>
      ) : (
        <p className="pt-tplline is-none">
          This project has <b>no template attached</b>, so there is no plan to compare it against and no phases
          to draw. Attaching one will fill this in.
        </p>
      )}

      <div className="pt-bar-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={jumpToWork}>
          Go to unfinished work
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpenKeys(new Set(branchKeys))}>
          Expand all
        </button>
        <button type="button" className="btn btn-subtle btn-sm" onClick={() => setOpenKeys(new Set())}>
          Collapse all
        </button>
        <select className="select" style={{ width: 168 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Every task</option>
          <option value="pending">Pending only</option>
          <option value="processing">Processing only</option>
          <option value="complete">Complete only</option>
          <option value="late">Past its date only</option>
        </select>
        <span style={{ flex: 1 }} />
        <span className="pt-count">
          {done} complete · {running} processing · {pending} pending{late ? ` · ${late} past its date` : ''}
        </span>
      </div>

      <div className="pt-wrap">
        <div className="pt-card" ref={scroller} onScroll={measure}>
          {/* THE PHASES ARE THE TOP ROW. There used to be a project card above
              them with the name and a "5 of 59 tasks complete" line, joined to
              the phases by a stem. Everything on it was already on the screen:
              the name is in the page header, the counts are in the row above
              this one, and the launch banner carries the phase tally.

              `is-top` suppresses the connectors on this row only — its rails
              would hang from that removed card. The task rows below keep theirs,
              because they really do branch off their phase. */}
          <div className="pt-tr">
            <div className="pt-kids is-top">
              {phases.map((p, i) => (
                <PhaseBranch
                  key={p.key}
                  phase={p}
                  now={now}
                  projectId={projectId}
                  open={openKeys.has(p.key)}
                  onToggle={toggle}
                  filter={filter}
                  branches={i >= PHASES_WITHOUT_BRANCHES}
                  onHover={setHover}
                />
              ))}
            </div>
          </div>
        </div>
        <div className={`pt-fade l${edges.l ? ' on' : ''}`} />
        <div className={`pt-fade r${edges.r ? ' on' : ''}`} />
      </div>

      <CardPopover hover={hover} />

      <div className="pt-legend">
        <span className="pt-lg"><i /> Pending</span>
        <span className="pt-lg"><i className="processing" /> Processing</span>
        <span className="pt-lg"><i className="complete" /> Complete</span>
        <span className="pt-lg"><span className="red">red clock</span> past its date</span>
      </div>
    </div>
  );
}

export default ProjectTree;
