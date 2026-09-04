import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Square, Maximize2, Eraser, Route, Sun, Scan } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BackButton } from '../../components/layout/BackButton.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { getStagePath } from './stagesConfig.jsx';
import { fmtDate } from '../../lib/format.js';
import { buildJourney, chainThrough, downstream } from '../../lib/journeyPlan.js';

/**
 * FROM EMPTY SHOP TO OPENING DAY — the whole launch as one picture.
 *
 * Route: /projects/:id/journey
 *
 * Every circle is one phase, laid left to right in template order — one
 * column per phase, so the steps across the top always count to the number of
 * phases the template has. Phases that run at the same time sit slightly high
 * and low of the line and share a day range. The thick
 * dark line is the MAIN ROAD — the longest route from day 0 to opening, where
 * no phase has a spare day and any day lost is a day added to the opening.
 * Thin lines are routes with slack in them.
 *
 * WHY THIS EXISTS ALONGSIDE PLAN VS ACTUAL. That page answers "what happened,
 * and was it on time" — a phase at a time, in rows. This one answers the
 * question rows cannot: "if this slips, what else moves?" Only a graph shows
 * that, and only a critical path separates the slips that cost the opening
 * date from the slips that cost nothing.
 *
 * NOTHING HERE IS A LOCK. The arrows are the plan's intended order, drawn so
 * the picture reads at a glance. No phase gates another — any phase can be
 * worked on at any time, which is a deliberate product decision (see
 * stagesConfig#getStageAccess).
 *
 * Every number is computed from the project's own snapshot by
 * lib/journeyPlan.js. Nothing on this page is hand-written per template.
 */

/* Geometry. Generous, because this is a picture meant to be shown on a screen
   in a meeting, not a dense table. */
const R = 38;
const COLW = 198;
const ROWH = 206;
const PADX = 64;
const PADY = 118;

/** Wrap a phase name to two lines at most, ellipsing the overflow — an SVG
 *  <text> does not wrap on its own. */
function wrapName(s, max = 17) {
  const words = String(s || '').split(' ');
  const out = [];
  let cur = '';
  words.forEach((w) => {
    if (`${cur} ${w}`.trim().length <= max) cur = `${cur} ${w}`.trim();
    else { if (cur) out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  if (out.length > 2) return [out[0], `${out.slice(1).join(' ').slice(0, max - 1)}…`];
  return out;
}

/* ── The walkthrough. Every step is DERIVED, and every one degrades: a
      template with no parallel streams and no slack still gets true
      sentences, not a step about a phase that does not exist. ── */
function buildSteps(j, plural) {
  const steps = [];
  steps.push({
    title: `${j.bands.length} stages, ${j.nodes.length} phases`,
    body: `${j.bands.map((b) => b.name).join(', ')}. Every circle is one phase, and its colour says which stage it belongs to. Follow the line left to right and you are walking the whole opening.`,
    set: () => null,
    focus: j.nodes[0]?.key,
  });

  const front = [...j.done, ...j.running];
  steps.push({
    title: 'Where we are today',
    body: j.running.length
      ? `${j.done.length} ${plural(j.done.length, 'phase')} finished — filled circles with a tick. ${j.running.map((n) => n.name).join(' and ')} ${j.running.length === 1 ? 'is' : 'are'} happening now, marked TODAY. Everything else has not started.`
      : j.done.length
        ? `${j.done.length} ${plural(j.done.length, 'phase')} finished. Nothing is running today — the next phase is ${j.nodes.find((n) => n.status === 'pending')?.name || 'not set'}.`
        : 'Nothing has started yet. Every circle is still open, and the plan below is what it commits to.',
    set: () => new Set(front.map((n) => n.key)),
    focus: (j.running[0] || j.done[j.done.length - 1] || j.nodes[0])?.key,
  });

  steps.push({
    title: 'The main road',
    body: `The thick dark line is the route that sets the opening date. ${j.critical.length} of the ${j.nodes.length} phases sit on it, and not one has a spare day. The whole plan is ${j.days} days.`,
    set: () => new Set(j.critical.map((n) => n.key)),
    focus: j.critical[Math.floor(j.critical.length / 2)]?.key,
  });

  if (j.slack.length) {
    const s = j.slack[0];
    steps.push({
      title: 'Where there is breathing room',
      body: `${s.name} has ${s.float} spare ${plural(s.float, 'day')} — the most of any phase. It can run late by that much without moving the opening, because what comes after it is waiting on something else too.`,
      set: () => new Set([s.key]),
      focus: s.key,
    });
  } else {
    steps.push({
      title: 'There is no breathing room',
      body: `Every one of the ${j.nodes.length} phases is on the main road with zero spare days. That means any phase running late moves the opening date — there is nowhere in this plan to absorb a delay.`,
      set: () => new Set(j.critical.map((n) => n.key)),
      focus: j.nodes[Math.floor(j.nodes.length / 2)]?.key,
    });
  }

  const longest = [...j.critical].sort((a, b) => b.sla - a.sla)[0] || j.nodes[0];
  if (longest) {
    const behind = downstream(j, longest.key).size;
    steps.push({
      title: 'Where the real risk sits',
      body: `${longest.name} takes ${longest.sla} days with no spare time, and ${behind} ${plural(behind, 'phase')} ${behind === 1 ? 'sits' : 'sit'} behind it. A week lost there is a week lost on the opening.`,
      set: () => chainThrough(j, longest.key),
      focus: longest.key,
    });
  }

  // Only where the template actually declares a parallel stream.
  const pair = j.nodes.filter((n) => j.nodes.some((o) => o !== n && o.level === n.level));
  if (pair.length >= 2) {
    const [a, b] = pair;
    steps.push({
      title: 'Two phases run side by side',
      body: `${a.name} and ${b.name} sit high and low of the line because the plan runs them at the same time — neither waits for the other, and both show the same day range. ${a.sla === b.sla ? `Both take ${a.sla} days, so both are on the main road — shorten one and the other sets the date.` : `The longer of the two (${a.sla >= b.sla ? a.name : b.name}) is what the next phase actually waits for.`}`,
      set: () => new Set(pair.map((n) => n.key)),
      focus: a.key,
    });
  }

  return steps;
}

/**
 * The map itself, taking its data as props so the SAME picture renders on the
 * project overview (in place of the phase-card strip it replaced) and on its
 * own full page. One component, so the two can never drift into two different
 * pictures of one project.
 *
 * `showHero` is the only difference between them: the overview already has
 * the project's name, its launch banner and its template line above this, so
 * repeating them there would be three headings for one thing.
 */
export function JourneyMap({ project, tasks = [], template = null, showHero = false }) {
  const id = project?._id;
  const navigate = useNavigate();
  const scroller = useRef(null);

  const j = useMemo(() => buildJourney(project, tasks, template), [project, tasks, template]);

  const plural = useCallback((n, word) => `${word}${n === 1 ? '' : 's'}`, []);

  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState(null); // 'road' | null
  const [present, setPresent] = useState(false);
  /* FIT IS THE DEFAULT, and it is not a cosmetic preference.
     Fifteen phases at a readable circle size is ~2,700px of picture in a
     ~1,200px column, so two thirds of the launch sat off the right edge with
     nothing on screen saying so — which reads as "phases are missing from the
     template", not as "scroll right". Fit scales the whole journey into the
     column so the shape is always complete; Full size restores the readable
     scale for anyone reading one phase rather than the whole plan. */
  const [fit, setFit] = useState(true);
  const [tourAt, setTourAt] = useState(-1);
  const [hover, setHover] = useState(null);

  const steps = useMemo(() => (j ? buildSteps(j, plural) : []), [j, plural]);
  const touring = tourAt >= 0;

  const focusOn = useCallback((key) => {
    const n = j?.byKey.get(key);
    // Nothing to scroll to when the whole journey is already on screen.
    if (!n || !scroller.current || fit) return;
    scroller.current.scrollTo({
      left: Math.max(0, n.cx - scroller.current.clientWidth / 2),
      behavior: 'smooth',
    });
  }, [j, fit]);

  /* Which phases are lit. One expression, so the toolbar, the tour, a click
     and a hover cannot each invent their own idea of "highlighted". */
  const lit = useMemo(() => {
    if (!j) return null;
    if (touring) return steps[tourAt]?.set() || null;
    if (mode === 'road') return new Set(j.critical.map((n) => n.key));
    if (selected) return chainThrough(j, selected);
    if (hover) return chainThrough(j, hover);
    return null;
  }, [j, touring, steps, tourAt, mode, selected, hover]);

  useEffect(() => {
    if (touring && steps[tourAt]?.focus) focusOn(steps[tourAt].focus);
  }, [touring, tourAt, steps, focusOn]);

  useEffect(() => {
    if (!touring) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && tourAt < steps.length - 1) setTourAt(tourAt + 1);
      if (e.key === 'ArrowLeft' && tourAt > 0) setTourAt(tourAt - 1);
      if (e.key === 'Escape') setTourAt(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [touring, tourAt, steps.length]);

  if (!project) return <SkDetail />;
  if (!j) {
    return (
      <EmptyState
        icon={Route}
        title="This project has no phases yet"
        hint="A project created from a template gets its phases, their order and their parallel streams — and this picture draws itself from them."
      />
    );
  }

  /* ── Lay the graph out. Same column per level, centred vertically. ── */
  /* ONE COLUMN PER PHASE — fifteen phases, fifteen steps.
     Phases that run together used to SHARE a column, stacked. That is
     textbook for a network diagram and it was wrong here: counting the steps
     across the top gave 13 for a template everyone knows has 15, so it read
     as two phases missing from the plan.

     They now each get their own column, in template order, and keep the
     vertical stagger — which is what still says "these two run together",
     along with the identical day range printed under both and the edges
     fanning out of the phase before them. The GRAPH is untouched: the
     dependencies, the critical path and every day number still come from the
     levels, so nothing here invents a sequence the template does not have.
     Only where the circles sit on screen changed. */
  const byLevel = new Map();
  j.nodes.forEach((n) => {
    if (!byLevel.has(n.level)) byLevel.set(n.level, []);
    byLevel.get(n.level).push(n);
  });
  byLevel.forEach((arr) => {
    const off = (j.rows - arr.length) / 2;
    arr.forEach((n, i) => {
      n.cx = PADX + j.nodes.indexOf(n) * COLW;
      n.cy = PADY + R + (i + off) * ROWH;
    });
  });
  const W = PADX * 2 + (j.nodes.length - 1) * COLW + 190;
  const H = PADY + j.rows * ROWH - 24;

  const bandBox = (b) => {
    const xs = b.nodes.map((n) => n.cx);
    return { x1: Math.min(...xs) - R - 30, x2: Math.max(...xs) + R + 30 };
  };

  const edges = j.nodes.flatMap((n) => n.after.map((from) => ({ from, to: n.key })));

  /* Hover wins over the last selection: the pointer is the more recent
     intent, and it is what makes the panel readable without clicking through
     to a phase. */
  const detail = j.byKey.get(hover || selected) || null;
  // Anchored to the last COLUMN, which is now the last phase, not the last level.
  const lastX = PADX + (j.nodes.length - 1) * COLW;
  const midY = PADY + R + ((j.rows - 1) / 2) * ROWH;

  const clear = () => { setSelected(null); setMode(null); setTourAt(-1); };
  const pickNode = (key) => {
    setMode(null); setTourAt(-1);
    setSelected((cur) => (cur === key ? null : key));
  };

  return (
    <div className={`jm-page${present ? ' is-present' : ''}`}>
      {showHero && (
        /* ── The headline: where we are, and what the plan costs ── */
        <header className="jm-hero">
          <div>
            <p className="jm-eyebrow">
              {project?.city ? `Branch opening · ${project.city}` : 'Branch opening'}
            </p>
            <h1>From empty shop to opening day</h1>
            <p className="jm-built">
              Built from {project?.template?.name || 'its template'}
              {/* The code is on the POPULATED template ref, never on
                  `project.template`, which snapshots only ref/name/version. */}
              {(template?.code || project?.template?.ref?.code)
                ? <b>{template?.code || project.template.ref.code}</b> : null}
            </p>
          </div>
          <div className="jm-big">
            <div className="jm-n">
              {j.done.length}
              <small>of {j.nodes.length} phases done</small>
            </div>
            <div className="jm-c">
              {j.days} day plan ·{' '}
              {j.running.length ? `${j.running[0].name} is on today` : 'nothing running today'}
            </div>
          </div>
        </header>
      )}

        {/* ── The journey strip: the whole plan as one bar ── */}
        <div className="jm-strip" role="img" aria-label={`${j.done.length} of ${j.nodes.length} phases done`}>
          {j.nodes.map((n) => (
            <i
              key={n.key}
              className={`is-${n.status} jm-tone-${j.bands[n.band]?.tone || 1}`}
              title={`${n.fullName} — ${n.status === 'complete' ? 'done' : n.status === 'processing' ? 'happening today' : 'not started'}`}
            />
          ))}
        </div>
        <div className="jm-striplab">
          <span>Day 0 — we start here</span>
          <span>{j.running.length ? `we are here — ${j.running[0].name}` : ''}</span>
          <span>Day {j.days} — doors open</span>
        </div>

        <p className="jm-lede">
          <b>{j.nodes.length} phases</b> · {j.bands.length} stages · {j.days}-day plan. The glowing
          circle is <b>happening today</b>. The lines are the <b>planned order, not a lock</b> —
          every phase can be started today, in any order, whatever else has or has not finished.
        </p>

        {/* ── Toolbar ── */}
        <div className="jm-bar">
          <button
            type="button"
            className={`jm-btn is-primary${touring ? ' is-on' : ''}`}
            onClick={() => setTourAt(touring ? -1 : 0)}
          >
            {touring ? <Square size={13} /> : <Play size={13} />}
            {touring ? 'Stop' : 'Walk me through it'}
          </button>
          <button
            type="button"
            className={`jm-btn${mode === 'road' ? ' is-on' : ''}`}
            onClick={() => { setTourAt(-1); setSelected(null); setMode(mode === 'road' ? null : 'road'); }}
          >
            <Route size={13} /> Show the main road
          </button>
          <button
            type="button"
            className="jm-btn"
            disabled={!j.running.length}
            onClick={() => { setTourAt(-1); setMode(null); setSelected(j.running[0].key); focusOn(j.running[0].key); }}
          >
            <Sun size={13} /> What&rsquo;s happening today
          </button>
          <button type="button" className="jm-btn" onClick={clear}><Eraser size={13} /> Clear</button>
          <button
            type="button"
            className={`jm-btn${!fit ? ' is-on' : ''}`}
            onClick={() => setFit((v) => !v)}
            title={fit
              ? `All ${j.nodes.length} phases, scaled to fit. Switch to full size to read one.`
              : 'Full size — scroll sideways for the rest'}
          >
            <Scan size={13} /> {fit ? 'Full size' : 'Fit all phases'}
          </button>
          <button type="button" className="jm-btn" onClick={() => setPresent((p) => !p)}>
            <Maximize2 size={13} /> {present ? 'Exit present' : 'Present'}
          </button>
          <span className="jm-hint">Hover for detail · click to open the phase · none of them is locked</span>
        </div>

        {/* ── The map ── */}
        <div className="jm-stage">
          <div className={`jm-scroller${fit ? ' is-fit' : ''}`} ref={scroller}>
            <svg
              width={fit ? '100%' : W}
              height={fit ? undefined : H}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label={`Journey map — ${j.nodes.length} phases`}
            >
              <defs>
                <marker id="jmMain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                  <path d="M1 1L9 5L1 9" fill="none" stroke="var(--jm-ink)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
                <marker id="jmSide" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M1 1L9 5L1 9" fill="none" stroke="var(--jm-line)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              </defs>

              {/* Stage bands, behind everything */}
              {j.bands.map((b, i) => {
                const { x1, x2 } = bandBox(b);
                const done = b.nodes.filter((n) => n.status === 'complete').length;
                return (
                  <g key={b.name} className={`jm-band jm-tone-${b.tone}`}>
                    <rect x={x1} y={22} width={x2 - x1} height={H - 40} rx={14} />
                    <text x={x1 + 20} y={52} className="jm-bandsub">{b.sub}</text>
                    <text x={x1 + 20} y={74} className="jm-bandttl">{b.name}</text>
                    <text x={x2 - 20} y={74} textAnchor="end" className="jm-bandcnt">
                      {done} of {b.nodes.length} done
                    </text>
                    {i === 0 ? null : null}
                  </g>
                );
              })}

              {/* Edges */}
              <g>
                {edges.map(({ from, to }) => {
                  const s = j.byKey.get(from);
                  const t = j.byKey.get(to);
                  const x1 = s.cx + R + 4;
                  const x2 = t.cx - R - 11;
                  const main = s.critical && t.critical;
                  const on = !lit || (lit.has(from) && lit.has(to));
                  return (
                    <path
                      key={`${from}-${to}`}
                      /* A straight line, not an S-curve. Nothing else about
                         the edge changes — same endpoints, same arrowhead,
                         same main-road weight. */
                      d={`M${x1} ${s.cy} L${x2} ${t.cy}`}
                      className={`jm-edge${main ? ' is-main' : ''}${lit && on ? ' is-lit' : ''}`}
                      markerEnd={`url(#${main ? 'jmMain' : 'jmSide'})`}
                    />
                  );
                })}
              </g>

              {/* Nodes */}
              <g>
                {j.nodes.map((n) => {
                  const solid = n.status !== 'pending';
                  const lines = wrapName(n.name);
                  const my = n.cy + R + 24 + lines.length * 15 + 5;
                  return (
                    <g
                      key={n.key}
                      className={`jm-node jm-tone-${j.bands[n.band]?.tone || 1}${lit && lit.has(n.key) ? ' is-lit' : ''}${solid ? ' is-solid' : ''}`}
                      tabIndex={0}
                      role="link"
                      aria-label={`Open ${n.fullName} — ${n.status}`}
                      /* A CIRCLE IS A LINK, NOT A SELECTOR. Clicking one opens
                         that phase's own page, the same rule every other card
                         in this app follows. It used to only highlight the
                         chain and fill a panel below the fold, so a click
                         looked like it did nothing. The chain and the panel
                         are on HOVER now, which is where a preview belongs. */
                      onClick={() => navigate(getStagePath(id, n.key))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(getStagePath(id, n.key));
                        }
                      }}
                      onMouseEnter={() => { if (!mode && !touring) setHover(n.key); }}
                      onMouseLeave={() => setHover(null)}
                    >
                      <title>{`Open ${n.fullName}`}</title>
                      {n.status === 'processing' && (
                        <>
                          <circle cx={n.cx} cy={n.cy} r={R} className="jm-halo" fill="none">
                            <animate attributeName="r" values={`${R};${R + 20}`} dur="2s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
                          </circle>
                          <text x={n.cx} y={n.cy - R - 18} textAnchor="middle" className="jm-nowtag">TODAY</text>
                        </>
                      )}
                      <circle cx={n.cx} cy={n.cy} r={R} className="jm-disc" />
                      <text
                        x={n.cx}
                        y={n.cy - 4}
                        textAnchor="middle"
                        dominantBaseline="central"
                        className="jm-num"
                        style={{ fontSize: n.badge.length > 1 ? 15 : 20 }}
                      >
                        {n.badge}
                      </text>
                      {n.status === 'complete'
                        ? <text x={n.cx} y={n.cy + 17} textAnchor="middle" className="jm-tick">✓</text>
                        : <text x={n.cx} y={n.cy + 17} textAnchor="middle" className="jm-dur">{n.sla}d</text>}
                      {lines.map((t, i) => (
                        <text key={t} x={n.cx} y={n.cy + R + 24 + i * 15} textAnchor="middle" className="jm-nm">{t}</text>
                      ))}
                      <text x={n.cx} y={my} textAnchor="middle" className="jm-meta">day {n.es}→{n.ef}</text>
                      <text
                        x={n.cx}
                        y={my + 14}
                        textAnchor="middle"
                        className={`jm-meta${n.critical ? ' is-crit' : ''}`}
                      >
                        {n.critical ? 'main road' : `${n.float} spare ${plural(n.float, 'day')}`}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* Opening day */}
              <g className="jm-open">
                <rect x={lastX + 56} y={midY - 30} width={118} height={60} rx={13} />
                <text x={lastX + 115} y={midY - 5} textAnchor="middle" className="jm-opent">Doors open</text>
                <text x={lastX + 115} y={midY + 15} textAnchor="middle" className="jm-opend">day {j.days}</text>
              </g>
            </svg>
          </div>

          {/* ── The walkthrough, over the map ── */}
          {touring && steps[tourAt] && (
            <div className="jm-tour">
              <p className="jm-tstep">Step {tourAt + 1} of {steps.length}</p>
              <h3>{steps[tourAt].title}</h3>
              <p>{steps[tourAt].body}</p>
              <div className="jm-tnav">
                <span className="jm-dots">
                  {steps.map((s, i) => <i key={s.title} className={i === tourAt ? 'is-on' : undefined} />)}
                </span>
                <button type="button" disabled={tourAt === 0} onClick={() => setTourAt(tourAt - 1)}>Back</button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => (tourAt === steps.length - 1 ? setTourAt(-1) : setTourAt(tourAt + 1))}
                >
                  {tourAt === steps.length - 1 ? 'Finish' : 'Next'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── What the selection means ── */}
        <div className={`jm-info${detail ? ` jm-tone-${j.bands[detail.band]?.tone || 1}` : ''}`}>
          {mode === 'road' ? (
            <>
              <div className="jm-itop"><h2>The main road</h2></div>
              <p className="jm-isub">
                {j.critical.length} of the {j.nodes.length} phases · {j.days} days from day 0 to opening
              </p>
              <div className="jm-kv">
                <span>every phase here has <b>no spare days</b></span>
                <span>a day lost on any of them is <b>a day added to the opening</b></span>
              </div>
              <div className="jm-chips">
                {j.critical.map((n) => <span key={n.key} className="jm-chip">{n.name} ({n.sla}d)</span>)}
              </div>
            </>
          ) : detail ? (
            <>
              <div className="jm-itop">
                <div>
                  <h2>{detail.fullName}</h2>
                  <p className="jm-isub">
                    {j.bands[detail.band]?.name}
                    {detail.dept ? ` · ${detail.dept} team` : ''} · {detail.sla} days ·{' '}
                    {detail.taskCount} {plural(detail.taskCount, 'task')}
                    {detail.taskCount ? ` (${detail.doneCount} done)` : ''}
                  </p>
                </div>
                <span className="jm-step-nav">
                  {/* STEP TO THE NEXT PHASE FROM HERE. Reading Phase 3 and
                      wanting Phase 3B meant going back to the map and finding
                      a 40px circle among sixteen. These walk template order,
                      3 → 3B → 4 → 4B, so a phase can be read one after
                      another without leaving the panel. */}
                  <button
                    type="button"
                    className="jm-nav-btn"
                    disabled={detail.position <= 1}
                    onClick={() => setSelected(j.nodes[detail.position - 2].key)}
                    title={detail.position > 1 ? `Previous: ${j.nodes[detail.position - 2].fullName}` : 'This is the first phase'}
                  >
                    ← Previous
                  </button>
                  <button
                    type="button"
                    className="jm-nav-btn"
                    disabled={detail.position >= j.nodes.length}
                    onClick={() => setSelected(j.nodes[detail.position].key)}
                    title={detail.position < j.nodes.length ? `Next: ${j.nodes[detail.position].fullName}` : 'This is the last phase'}
                  >
                    Next →
                  </button>
                  <button
                    type="button"
                    className="jm-open-btn"
                    onClick={() => navigate(getStagePath(id, detail.key))}
                  >
                    Open this phase →
                  </button>
                </span>
              </div>
              {/* "needs first" and "holds up" READ AS A GATE, and there is no
                  gate anywhere in this product — any phase can be started
                  today whatever else has or has not happened (see
                  stagesConfig#getStageAccess: "Any phase, any task, any state,
                  on day one"). These say what the PLAN intends, in words that
                  cannot be mistaken for permission. */}
              <div className="jm-kv">
                <span>
                  planned after:{' '}
                  <b>
                    {detail.after.length
                      ? detail.after.map((k) => j.byKey.get(k).name).join(', ')
                      : 'nothing — the plan starts here'}
                  </b>
                </span>
                <span>
                  planned before:{' '}
                  <b>
                    {detail.next.length
                      ? detail.next.map((k) => j.byKey.get(k).name).join(', ')
                      : 'nothing — the plan ends here'}
                  </b>
                </span>
                <span className="jm-free">can be started today — nothing blocks it</span>
                <span>
                  spare days:{' '}
                  <b>{detail.critical ? 'none — on the main road' : detail.float}</b>
                </span>
                {detail.plannedStart && (
                  <span>planned: <b>{fmtDate(detail.plannedStart)} → {fmtDate(detail.plannedEnd)}</b></span>
                )}
              </div>
              {/* WHO IS ON IT — the doer and whoever covers for them. */}
              {detail.people.length > 0 && (
                <div className="jm-sec">
                  <span className="jm-sec-k">Who is on it</span>
                  <div className="jm-chips">
                    {detail.people.map((p) => (
                      <span key={p.who} className="jm-chip">
                        {p.who}{p.backup ? <em> · backup {p.backup}</em> : null}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* EVERY ASSESSMENT THE TEMPLATE GIVES THIS PHASE, filed or not —
                  the gap between what is owed and what exists is the point. */}
              {detail.modules.length > 0 && (
                <div className="jm-sec">
                  <span className="jm-sec-k">
                    Assessments · {detail.modules.length} forms, {detail.fields} questions
                  </span>
                  <div className="jm-chips">
                    {detail.modules.map((m) => (
                      <span key={m.key} className="jm-chip">
                        {m.name} <em>{m.fields}q</em>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.tasks.length > 0 && (
                <div className="jm-sec">
                  <span className="jm-sec-k">
                    Tasks · {detail.doneCount} of {detail.taskCount} done
                  </span>
                  <div className="jm-chips">
                    {detail.tasks.map((t) => (
                      <span key={t._id} className={`jm-chip${t.status === 'complete' ? ' is-done' : ''}`}>
                        {t.status === 'complete' ? '✓ ' : ''}{t.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* The four questions the client runs the business by, straight
                  from the template's own What / Who / When / How. */}
              {detail.brief.length > 0 && (
                <div className="jm-sec">
                  <span className="jm-sec-k">What happens here</span>
                  <div className="jm-brief">
                    {detail.brief.map((r, i) => (
                      <div key={`${r.what}-${i}`}>
                        <b>{r.what}</b>
                        <span>{[r.who, r.when, r.how].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detail.gate && (
                <p className="jm-exit">
                  <em>Sign-off — </em>{detail.gate.label}
                  {detail.gate.approver ? ` · approved by ${detail.gate.approver}` : ''}
                </p>
              )}
              {detail.exitCriteria && (
                <p className="jm-exit"><em>Done when — </em>{detail.exitCriteria}</p>
              )}
            </>
          ) : (
            <p className="jm-muted">
              Hover any circle for its dates, its people and where the plan puts it. Click it to open
              the phase — every phase can be worked on today, whatever else has happened.
            </p>
          )}
        </div>

        {/* ── Three things worth knowing ── */}
        <div className="jm-ins">
          <button
            type="button"
            className={`jm-ic jm-tone-${j.bands[1]?.tone || 2}`}
            onClick={() => { const k = (j.running[0] || j.nodes[0]).key; pickNode(k); focusOn(k); }}
          >
            <span className="jm-icn">{j.done.length}<small>of {j.nodes.length} done</small></span>
            <h4>{j.running.length ? `${j.running[0].name} is on today` : 'Nothing running today'}</h4>
            <p>Click to see what it unlocks next.</p>
          </button>
          {(() => {
            const longest = [...j.critical].sort((a, b) => b.sla - a.sla)[0] || j.nodes[0];
            return (
              <button
                type="button"
                className={`jm-ic jm-tone-${j.bands[2]?.tone || 3}`}
                onClick={() => { pickNode(longest.key); focusOn(longest.key); }}
              >
                <span className="jm-icn">{longest.sla}<small>days, no slack</small></span>
                <h4>{longest.name} is the long one</h4>
                <p>The biggest phase on the main road. Every day lost here lands on the opening.</p>
              </button>
            );
          })()}
          <button
            type="button"
            className={`jm-ic jm-tone-${j.bands[3]?.tone || 4}`}
            onClick={() => {
              const k = (j.slack[0] || j.nodes[0]).key;
              pickNode(k); focusOn(k);
            }}
          >
            <span className="jm-icn">
              {j.slack.reduce((a, n) => a + n.float, 0)}<small>spare days, in total</small>
            </span>
            <h4>{j.slack.length ? 'Very little cushion' : 'No cushion anywhere'}</h4>
            <p>{j.critical.length} of {j.nodes.length} phases have zero spare days.</p>
          </button>
        </div>

        {/* ── Legend ── */}
        <div className="jm-lg">
          {j.bands.map((b) => (
            <span key={b.name}><i className={`jm-tone-${b.tone}`} />{b.name}</span>
          ))}
          <span><span className="jm-rd" />Main road — no spare days</span>
          <span><span className="jm-rd is-side" />Side road — has spare days</span>
        </div>

        <p className="jm-foot">
          <b>The lines are the plan, not a lock.</b> They show the order the work is meant to run in,
          so the picture reads at a glance. Nobody is blocked — any phase can be worked on at any
          time. <b>The main road</b> is the longest route from day 0 to opening. Every phase on it
          has no spare days, so a day lost there is a day added to the opening. Spare days are
          printed under every circle.
        </p>
    </div>
  );
}

/**
 * The full page: /projects/:id/journey — the same map with the project's own
 * header over it, for showing on a screen in a meeting.
 */
export default function JourneyMapPage() {
  const { id } = useParams();
  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: taskResp } = useTasks({ project: id, limit: 1000 }, { skip: !id });
  const tasks = useMemo(() => {
    const raw = taskResp?.data || taskResp || [];
    return Array.isArray(raw) ? raw : [];
  }, [taskResp]);

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            <BackButton />
            <Route size={17} aria-hidden />
            <span className="jm-title">{project?.name || 'Journey'}</span>
            {project?.code && <span className="jm-code">{project.code}</span>}
          </span>
        )}
      />
      <div className="content">
        {isLoading && !project
          ? <SkDetail />
          : <JourneyMap project={project} tasks={tasks} template={template} showHero />}
      </div>
    </>
  );
}
