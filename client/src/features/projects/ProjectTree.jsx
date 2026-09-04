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
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { phaseCounts, isPastDue, TASK_STATE } from './phaseProgress.js';
import { launchClock } from './taskClock.js';
import { JourneyMap } from './JourneyMapPage.jsx';
import { fmtDate, fmtDateTimeLong, fmtCurrency } from '../../lib/format.js';
import { moduleStatusKey } from './records/recordUi.js';




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


/* ── one task card ─────────────────────────────────────────────────────── */

/* ── one assessment card ───────────────────────────────────────────────── */

/* ── one phase, with its tasks branching beneath ───────────────────────── */

/* ── the tree ──────────────────────────────────────────────────────────── */

/**
 * `project` and `tasks` are the full records the overview already holds. They
 * are passed in rather than re-fetched, and they are what the journey map
 * needs: a phase's `parallelGroup` and `slaDays` live on the project's own
 * stage snapshot, not on the lighter tree projection.
 */
export function ProjectTree({ tree, project, tasks = [] }) {
  /* The banner counts finished phases off this list, so it stays even though
     the card strip that also used it is gone. */
  const phases = tree?.phases || [];

  /* One clock, for the launch banner's countdown. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

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

      {/* THE JOURNEY, NOT A ROW OF CARDS.
          What stood here was a horizontally scrolling strip of phase cards —
          fifteen boxes you had to drag through, each repeating the same six
          facts, and none of them able to show the one thing a strip cannot:
          which phases run side by side, and which of them being late actually
          moves the opening date. The map answers both, and it is the same
          component the full-page /journey view renders, so the two can never
          disagree about one project. */}
      <JourneyMap project={project} tasks={tasks} template={tree?.template} />
    </div>
  );
}

export default ProjectTree;
