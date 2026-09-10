import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { chainThrough } from '../../../lib/journeyPlan.js';
import { getStagePath } from '../stagesConfig.jsx';
import { useGetProjectFlowQuery } from '../../../app/api/flowApi.js';
import {
  buildProjectFlow, applyFlowRings, applyPhaseCounts, clockOf, stamp, arc, wrapN, checkText, toneOf,
  notStartedText,
  R, RING, DAY_MS, INK_200, INK_400, INK_500, ACCENT_500, DANGER, SPINE,
} from './projectFlow.js';
import './projectFlowBoard.css';

/**
 * The project's flow, drawn in the Vault language.
 *
 * Replaces the previous JourneyMap on the project page. Same job — the whole
 * plan as one picture — in the visual system of PMS_UI_SPEC_00: four stage
 * bands, a circle per phase carrying its progress ring and its live clock,
 * the critical path as the thick spine, a hover card answering who a phase is
 * assigned to / who did it / who approved it, a walkthrough, and the phase
 * tables underneath whose rows light the diagram both ways.
 *
 * ── Every number here is the project's ───────────────────────────────
 * Phases, dependencies, critical path and bands come from `buildJourney`;
 * people, actuals and task counts from the phase's own tasks; the split rings
 * from /pms/flow/:projectId. Nothing is illustrative. Where the project cannot
 * answer something the board says so — "nobody yet", "not signed yet",
 * "checklist not started" — rather than filling the space.
 */

const TIP_W = 250;

/* How many phase rows a folded table shows before "View N more". */
const ROWS_SHUT = 6;

/* The three tables under the board, named for the question each answers.
   The ids are what `tab` holds; the labels are what the reader clicks. */
const TABS = [
  ['Who did it', 'who'], ['The phases', 'phases'], ['The arithmetic', 'math'],
];

/* Whole days from one date to another, forward. Local to this file: the
   `dayDiff` in orderTracking.jsx subtracts the other way round, and a
   duration that comes out negative would read as a phase finishing before it
   started. */
const dayDiff = (from, to) => Math.round(
  (new Date(to).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0)) / 86400000,
);

function Pill({ tone = 'grey', children }) {
  return <span className={`pfb-pill ${tone}`}>{children}</span>;
}

/**
 * The control under a folded table.
 *
 * Names the number still hidden rather than saying "View more": "11 more
 * phases" answers the question the button raises, and a reader deciding
 * whether to click should not have to click to find out how much there is.
 */
function MoreRows({ hidden, open, onToggle, total }) {
  if (!hidden && !open) return null;
  return (
    <div className="pfb-more">
      <button type="button" className="pfb-more-btn" onClick={onToggle} aria-expanded={open}>
        {open
          ? `Show fewer — the first ${ROWS_SHUT} of ${total}`
          : `View ${hidden} more phase${hidden === 1 ? '' : 's'}`}
        <ChevronDown size={14} className={open ? 'up' : undefined} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── the hover card ───────────────────────────────────────────────────
   Answers three questions and nothing else. The honest states matter more
   than the full ones: a phase nobody has started shows "nobody yet", never a
   name against work that has not happened. */
function tipHtml(n, flow) {
  const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const row = (name, sub, when, late) => '<div class="pfb-pr">'
    + `<b>${esc(name)}</b><span class="ro">${esc(sub)}</span>`
    + (when ? `<em${late ? ' class="lt"' : ''}>${esc(when)}</em>` : '')
    + '</div>';
  const none = (why) => `<div class="pfb-pr"><span class="ro">${esc(why)}</span></div>`;

  const p = n.people;
  const assigned = p.assignedTo
    ? row(p.assignedTo.name,
      p.backup ? `${n.dept || 'Phase owner'} · backup ${p.backup}` : (n.dept || 'Phase owner'),
      `holds ${p.assignedTo.count} of ${p.assignedTo.of} tasks`)
    : none('Not assigned yet');

  let done;
  if (p.doneBy) {
    done = row(p.doneBy.name, `${n.doneCount} of ${n.taskCount} tasks complete`,
      `last finished ${stamp(p.doneBy.at)}`);
  } else if (n.status === 'processing' && p.startedAt) {
    done = row(p.assignedTo?.name || 'In progress', 'nothing finished yet',
      `started ${stamp(p.startedAt)}`, true);
  } else {
    done = none(notStartedText(n, flow.todayDay));
  }

  const approved = p.approvedBy
    ? row(p.approvedBy.name, 'approved', `signed ${stamp(p.approvedBy.at)}`)
    : `<div class="pfb-pr"><span class="ro">not signed yet</span>${
      n.gate ? `<em class="lt">${esc(n.gate.label)}</em>` : ''}</div>`;

  const c = clockOf(n, flow.t0, Date.now());
  return `<h4 style="color:${n.color}">${esc(n.badge)} · ${esc(n.name)}</h4>`
    /* Projects created before the renumbering still say "Phase 3B" on their
       own paperwork. The circle shows the position; this line keeps the name
       they will actually search for. */
    + (n.templateBadge
      ? `<p class="pfb-when">the template calls this Phase ${esc(n.templateBadge)}</p>`
      : '')
    + `<p class="pfb-when">day ${n.es} → ${n.ef} · ${n.sla} day${n.sla === 1 ? '' : 's'}`
    + `${n.critical ? ' · on the critical path' : ` · ${n.float} days spare`}</p>`
    + `<p class="pfb-when" style="color:${c.color}">${esc(c.text)}</p>`
    + (n.detail ? `<p class="pfb-when">${esc(n.detail)}</p>` : '')
    + '<p class="pfb-lb">Assigned to</p>' + assigned
    + '<p class="pfb-lb">Done by</p>' + done
    + '<p class="pfb-lb">Approved by</p>' + approved
    + depositHtml(n, esc);
}

/**
 * The deposit, instalment by instalment.
 *
 * Two different lists can appear here and they answer different questions:
 *
 *   THE PLAN — from the LOI ("two instalments, 50/50"). Every instalment is
 *   listed whether or not it has been paid, so the card says what is still
 *   owed and not only what has arrived. This is the list when a plan exists.
 *
 *   WHAT ARRIVED — the ledger entries themselves, each with the running
 *   percentage it took the project to. Shown when the LOI names no split, so
 *   there is nothing to lay the payments against.
 *
 * The phase can be COMPLETE while the money is not, which is exactly why this
 * sits under the sign-off rather than inside it.
 */
function depositHtml(n, esc) {
  const d = n.deposit;
  if (!d) return '';
  if (!d.agreedKnown) {
    return '<p class="pfb-lb">Deposit</p>'
      + `<div class="pfb-pr"><b>${esc(inr(d.received))} received</b>`
      + `<span class="ro">${d.count} instalment${d.count === 1 ? '' : 's'} · `
      + 'no agreed figure on the LOI yet, so there is nothing to measure it against</span></div>';
  }

  /* Two documents describe one deposit and they are allowed to disagree in
     the data. Where they do, the card shows both rather than picking a side
     — somebody has to look at it, and hiding it guarantees nobody will. */
  const clash = d.disagrees
    ? `<div class="pfb-pr"><span class="ro">the LOI says ${esc(inr(d.loiAmount))} `
      + `and the deposit form says ${esc(inr(d.formAmount))} — they disagree</span></div>`
    : '';

  /* Agreed on the LOI, with no Deposit Management form yet. The amount is
     real and worth showing; a percentage of it would be arithmetic over a
     ledger nobody has opened. */
  if (!d.ledgerStarted) {
    return '<p class="pfb-lb">Deposit</p>'
      + `<div class="pfb-pr"><b>${esc(inr(d.agreed))} agreed</b>`
      + '<span class="ro">on the LOI · no payment recorded, and the deposit '
      + 'form has not been opened</span></div>'
      + clash;
  }

  const head = '<p class="pfb-lb">Deposit</p>'
    + `<div class="pfb-pr"><b>${esc(inr(d.received))} of ${esc(inr(d.agreed))}</b>`
    + `<span class="ro">${d.settled
      ? 'settled in full'
      : `${esc(inr(d.balance))} still to pay · ${d.pct}% received`}</span></div>`
    + clash;

  const p = d.plan;
  if (p) {
    const rows = p.instalments.map((i) => {
      const state = i.status === 'paid'
        ? `paid${i.paidOn ? ` ${esc(i.paidOn)}` : ''}`
        : (i.status === 'part'
          ? `${esc(inr(i.paid))} in · ${esc(inr(i.outstanding))} still due`
          : `${esc(inr(i.outstanding))} due`);
      return `<div class="pfb-pr pfb-dep-${i.status}">`
        + `<b>${esc(inr(i.expected))}<span class="pfb-dep-pct">${i.cumulativePct}%</span></b>`
        + `<span class="ro">instalment ${i.no} of ${p.count} · ${i.pct}% · ${state}</span>`
        + '</div>';
    }).join('');
    return head
      + `<p class="pfb-lb">LOI plan — ${p.settled} of ${p.count} settled</p>`
      + rows
      /* An equal split this code worked out is not the same fact as a split
         the LOI states, and the card must not let the two read alike. */
      + (p.evenSplit
        ? '<div class="pfb-pr"><span class="ro">split equally — the LOI names a count but no percentages</span></div>'
        : '')
      + (p.over > 0
        ? `<div class="pfb-pr"><span class="ro">${esc(inr(p.over))} received beyond the plan</span></div>`
        : '')
      /* The LOI fixes how much and how many; no field anywhere records WHEN.
         The card says so rather than inventing a date. */
      + (p.next ? '<div class="pfb-pr"><span class="ro">no due date is recorded for it</span></div>' : '');
  }

  const rows = d.instalments.map((i) => '<div class="pfb-pr">'
    + `<b>${esc(inr(i.amount))}<span class="pfb-dep-pct">${i.cumulativePct}%</span></b>`
    + `<span class="ro">instalment ${i.no}${i.paidOn ? ` · ${esc(i.paidOn)}` : ''}`
    + `${i.mode ? ` · ${esc(i.mode)}` : ''}</span>`
    + (i.reference ? `<em>${esc(i.reference)}</em>` : '')
    + '</div>').join('');

  return head
    + (d.count
      ? '<p class="pfb-lb">Payments received</p>' + rows
      : '<div class="pfb-pr"><span class="ro">no payment recorded against it yet</span></div>')
    /* No plan on the LOI means no instalment to be owed and no date to owe it
       on — the card says what is missing rather than filling the space. */
    + (d.settled ? ''
      : '<div class="pfb-pr"><span class="ro">the LOI names no instalment split, '
        + 'so there is no schedule to measure the balance against</span></div>');
}

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export function ProjectFlowBoard({ project, tasks = [], template = null }) {
  const navigate = useNavigate();
  const projectId = project?._id || project?.id;
  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [info, setInfo] = useState(null);
  const [step, setStep] = useState(-1);
  const [tab, setTab] = useState('who');
  /* The phase tables run to seventeen rows and push everything below them off
     the screen. They open at six — enough to see the shape — and say exactly
     how many are folded away, so nobody has to guess whether the list ended
     or was cut. */
  const [allRows, setAllRows] = useState(false);

  const scrollerRef = useRef(null);
  const stageRef = useRef(null);
  const tipRef = useRef(null);
  const tipForRef = useRef(null);
  const selectedRef = useRef(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  /* One tick drives every clock on the board. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* The client flow's own read model — drawings, BOQ, contracts, order book.
     Absent or still loading, the board simply draws ordinary task rings. */
  const { data: flowData } = useGetProjectFlowQuery(projectId, { skip: !projectId });

  /* Rebuilt only when the project actually changes — not on the 1s tick,
     which would rebuild the whole graph 60 times a minute. Clocks read `now`
     at render instead. */
  const flow = useMemo(() => {
    const f = buildProjectFlow(project, tasks, template, Date.now());
    if (!f) return null;
    /* Record counts first (they set items/done/pct from the phase's own
       records), then the split rings, which override the ring for the three
       phases that measure two things at once. */
    const counted = applyPhaseCounts(f.nodes, flowData?.phaseCounts);
    const nodes = applyFlowRings(counted, flowData);
    return { ...f, nodes, byKey: new Map(nodes.map((n) => [n.key, n])) };
  }, [project, tasks, template, flowData]);

  const lit = useCallback((key) => !!(highlight && highlight.has(key)), [highlight]);

  const setTip = useCallback((n) => {
    const tip = tipRef.current;
    if (!tip || !flow) return;
    if (tipForRef.current !== n.key) {
      tipForRef.current = n.key;
      tip.innerHTML = tipHtml(n, flow);
      tip.style.borderTopColor = n.color;
    }
    tip.classList.add('on');
  }, [flow]);

  const moveTip = useCallback((e) => {
    const tip = tipRef.current;
    if (!tip) return;
    const PAD = 12;
    const GAP = 22;
    const h = tip.offsetHeight;
    let x = e.clientX + GAP;
    if (x + TIP_W > window.innerWidth - PAD) x = e.clientX - GAP - TIP_W;
    if (x < PAD) x = PAD;
    let y = e.clientY - h / 2;
    if (y + h > window.innerHeight - PAD) y = window.innerHeight - h - PAD;
    if (y < PAD) y = PAD;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  }, []);

  const hideTip = useCallback((force) => {
    if (selectedRef.current && !force) return;
    tipRef.current?.classList.remove('on');
    tipForRef.current = null;
  }, []);

  const focusOn = useCallback((key) => {
    const n = flow?.byKey.get(key);
    const sc = scrollerRef.current;
    if (!n || !sc) return;
    sc.scrollTo({ left: Math.max(0, n.cx - sc.clientWidth / 2), behavior: 'smooth' });
  }, [flow]);

  const clearAll = useCallback(() => {
    selectedRef.current = null;
    setSelected(null);
    setMode(null);
    setStep(-1);
    setHighlight(null);
    setInfo(null);
    hideTip(true);
  }, [hideTip]);

  const pick = useCallback((key) => {
    setMode(null);
    setStep(-1);
    setInfo(null);
    if (selectedRef.current === key) {
      selectedRef.current = null;
      setSelected(null);
      setHighlight(null);
      hideTip(true);
      return;
    }
    selectedRef.current = key;
    setSelected(key);
    setHighlight(chainThrough(flow.journey, key));
    const n = flow.byKey.get(key);
    if (n) setTip(n);
  }, [flow, hideTip, setTip]);

  /* A phase is a <g> of a dozen shapes; moving from the circle onto its own
     label fires mouseout then mouseover again. Comparing relatedTarget is
     what stops the card flickering on every crossing. */
  const onOver = (e) => {
    const g = e.target.closest?.('.pfb-node');
    if (!g || !flow) return;
    const from = e.relatedTarget?.closest?.('.pfb-node');
    if (from === g) { moveTip(e); return; }
    const n = flow.byKey.get(g.dataset.key);
    if (!n) return;
    setTip(n);
    moveTip(e);
    if (!selected && !mode && step < 0) setHighlight(chainThrough(flow.journey, n.key));
  };
  const onMove = (e) => {
    if (tipRef.current?.classList.contains('on') && e.target.closest?.('.pfb-node')) moveTip(e);
  };
  const onOut = (e) => {
    const g = e.target.closest?.('.pfb-node');
    if (!g) return;
    if (e.relatedTarget?.closest?.('.pfb-node') === g) return;
    if (selected) return;
    hideTip();
    if (!mode && step < 0) setHighlight(null);
  };

  useEffect(() => {
    const off = () => hideTip();
    window.addEventListener('scroll', off, { passive: true });
    const sc = scrollerRef.current;
    sc?.addEventListener('scroll', off, { passive: true });
    return () => {
      window.removeEventListener('scroll', off);
      sc?.removeEventListener('scroll', off);
    };
  }, [hideTip]);

  /* ── the walkthrough ───────────────────────────────────────────────
     Six steps, every one stating a fact about THIS project rather than the
     spec. A tour that recites generic principles teaches nothing about the
     branch you are looking at. */
  const steps = useMemo(() => {
    if (!flow) return [];
    const parallelLevels = [...new Set(flow.nodes.map((n) => n.level))]
      .filter((l) => flow.nodes.filter((n) => n.level === l).length > 1);
    const parallelKeys = flow.nodes.filter((n) => parallelLevels.includes(n.level)).map((n) => n.key);
    const gates = flow.nodes.filter((n) => n.gate);
    const late = flow.nodes.filter((n) => n.status !== 'complete' && flow.t0
      && now > flow.t0 + n.lf * DAY_MS);

    const out = [
      {
        t: `${flow.nodes.length} phases, numbered by position`,
        b: `Every circle is numbered by where it sits, 1 to ${flow.nodes.length} — no 3B, no 4B. `
          + 'A letter in a phase number means somebody inserted a phase into a list whose numbers '
          + 'were already taken, and it makes this project look shorter than it is. The database '
          + 'keys never change, so every form and saved record still works.',
        keys: [],
        focus: flow.nodes[0]?.key,
      },
      {
        t: 'The lines are the planned order, not a lock',
        b: `${flow.bands.length} stages, ${flow.days} days end to end. An arrow says what a phase `
          + 'normally waits for — not that it is forbidden. Any phase can be opened today, whatever '
          + 'else has or has not finished.',
        keys: [],
        focus: flow.nodes[0]?.key,
      },
    ];

    if (parallelKeys.length) {
      out.push({
        t: 'What runs side by side',
        b: `${parallelLevels.length} place${parallelLevels.length === 1 ? '' : 's'} where one phase `
          + `releases two. Phases sharing a column have NO arrow between them — no arrow means no `
          + `dependency. That is what saves ${flow.sequentialDays - flow.days} days: one behind the `
          + `other these phases would take ${flow.sequentialDays}, together they take ${flow.days}.`,
        keys: parallelKeys,
        focus: parallelKeys[0],
      });
    }

    out.push({
      t: 'The critical path',
      b: `${flow.critical.length} of the ${flow.nodes.length} phases have no spare days. A day lost `
        + 'on any of them is a day added to the opening. The rest carry float — those are the ones '
        + 'you can afford to move.',
      keys: flow.critical.map((n) => n.key),
      focus: flow.critical[0]?.key,
    });

    if (gates.length) {
      out.push({
        t: `The ${gates.length} gate${gates.length === 1 ? '' : 's'}`,
        b: 'The only hard stops in the whole plan. Everything between them is scheduled by what it '
          + 'needs, not by who allows it.',
        keys: gates.map((n) => n.key),
        focus: gates[0]?.key,
      });
    }

    out.push({
      t: 'Where this project is today',
      b: flow.running.length
        ? `${flow.running.length} phase${flow.running.length === 1 ? ' is' : 's are'} open`
          + `${flow.clocksLive ? `, on day ${flow.todayDay} of ${flow.openDay}` : ''}`
          + `. ${flow.complete.length} of ${flow.nodes.length} are complete`
          + `${late.length ? `, and ${late.length} ${late.length === 1 ? 'is' : 'are'} past the date the plan gives them.` : '.'}`
        : 'Nothing is open yet — no phase has a task in progress.',
      keys: flow.running.map((n) => n.key),
      focus: flow.running[0]?.key || flow.nodes[0]?.key,
    });

    return out;
  }, [flow, now]);

  const goStep = useCallback((i) => {
    const s = steps[i];
    if (!s) return;
    setStep(i);
    setSelected(null);
    selectedRef.current = null;
    setMode(null);
    setHighlight(s.keys.length ? new Set(s.keys) : null);
    setInfo({
      title: `Step ${i + 1} of ${steps.length} — ${s.t}`,
      sub: s.b,
      tour: true,
    });
    if (s.focus) focusOn(s.focus);
  }, [steps, focusOn]);

  useEffect(() => {
    if (step < 0) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && step < steps.length - 1) goStep(step + 1);
      if (e.key === 'ArrowLeft' && step > 0) goStep(step - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [step, steps.length, goStep]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') clearAll(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [clearAll]);

  /* ── table rows light the diagram, both ways ───────────────────────── */
  const onRowOver = (e) => {
    const tr = e.target.closest?.('tr[data-go]');
    if (!tr || selected || mode || step >= 0 || !flow) return;
    setHighlight(chainThrough(flow.journey, tr.dataset.go));
  };
  const onRowOut = (e) => {
    const tr = e.target.closest?.('tr[data-go]');
    if (!tr || selected || mode || step >= 0) return;
    setHighlight(null);
  };
  const onRowClick = (e) => {
    const tr = e.target.closest?.('tr[data-go]');
    if (!tr) return;
    if (projectId) navigate(getStagePath(projectId, tr.dataset.go));
  };

  if (!flow) return null;

  const toggle = (key, keys, panel) => {
    if (mode === key) { setMode(null); setHighlight(null); setInfo(null); return; }
    setSelected(null);
    selectedRef.current = null;
    setStep(-1);
    setMode(key);
    setHighlight(new Set(keys));
    setInfo(panel);
  };

  const gates = flow.nodes.filter((n) => n.gate);
  const parallelLevels = [...new Set(flow.nodes.map((n) => n.level))]
    .filter((l) => flow.nodes.filter((n) => n.level === l).length > 1);
  const parallel = flow.nodes.filter((n) => parallelLevels.includes(n.level));
  const runsWith = (n) => flow.nodes.filter((m) => m.level === n.level && m.key !== n.key);
  const rows = allRows ? flow.nodes : flow.nodes.slice(0, ROWS_SHUT);
  const hiddenRows = flow.nodes.length - rows.length;

  return (
    <section className="pfb" aria-label="Project flow">
      {/* ── action bar ── */}
      <div className="pfb-bar">
        <button
          type="button"
          className="pfb-btn amber"
          onClick={() => (step >= 0 ? clearAll() : goStep(0))}
        >
          {step >= 0 ? '■ Stop' : '▶ Walk me through it'}
        </button>
        <button
          type="button"
          className={`pfb-btn${mode === 'today' ? ' on' : ''}`}
          onClick={() => toggle('today', flow.running.map((n) => n.key), {
            title: flow.clocksLive
              ? `Where this project is today — day ${flow.todayDay}`
              : 'Where this project is today',
            sub: flow.running.length
              ? `${flow.running.length} phase${flow.running.length === 1 ? ' is' : 's are'} open, `
                + `${flow.complete.length} of ${flow.nodes.length} complete.`
              : 'No phase has a task in progress.',
            /* An open-ended phase has no percentage to report — it says
               what it has captured instead. */
            chips: flow.running.map((n) => `${n.badge} · ${n.name} — `
              + (n.openEnded ? `${n.items || 0} ${n.unit || 'records'}` : `${n.pct}%`)),
          })}
        >
          What is happening today
        </button>
        <button
          type="button"
          className={`pfb-btn${mode === 'crit' ? ' on' : ''}`}
          onClick={() => toggle('crit', flow.critical.map((n) => n.key), {
            title: 'The critical path',
            sub: `${flow.critical.length} of the ${flow.nodes.length} phases · day 0 to day ${flow.days}. `
              + 'A day lost on any of these is a day added to the opening; the phases with float are '
              + 'the ones you can afford to move.',
            chips: flow.critical.map((n) => `${n.badge} · ${n.name} (${n.sla}d)`),
          })}
        >
          The critical path
        </button>
        {parallel.length > 0 && (
          <button
            type="button"
            className={`pfb-btn${mode === 'parallel' ? ' on' : ''}`}
            onClick={() => toggle('parallel', parallel.map((n) => n.key), {
              title: 'What runs side by side',
              sub: `${parallelLevels.length} place${parallelLevels.length === 1 ? '' : 's'} where one `
                + 'phase releases two. Phases sharing a column have no arrow between them — no arrow '
                + 'means no dependency.',
              kv: [
                `one behind the other: <b>${flow.sequentialDays} days</b>`,
                `as planned: <b>${flow.days} days</b>`,
                `saved: <b>${flow.sequentialDays - flow.days} days</b>`,
              ],
              chips: parallelLevels.map((l) => flow.nodes.filter((n) => n.level === l)
                .map((n) => n.name).join('  ‖  ')),
            })}
          >
            What runs together
          </button>
        )}
        {gates.length > 0 && (
          <button
            type="button"
            className={`pfb-btn${mode === 'gates' ? ' on' : ''}`}
            onClick={() => toggle('gates', gates.map((n) => n.key), {
              title: `The ${gates.length} gate${gates.length === 1 ? '' : 's'}`,
              sub: 'The only hard stops. Everything between them is scheduled by what it needs, not '
                + 'by who allows it.',
              chips: gates.map((n) => `${n.gate.label}${n.gate.approver ? ` · ${n.gate.approver}` : ''}`),
            })}
          >
            {`The ${gates.length} gate${gates.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button type="button" className="pfb-btn" onClick={clearAll}>Clear</button>
        <span className="pfb-hint">Hover for detail · click to open the phase · table rows light the diagram</span>
      </div>

      {/* ── the board ── */}
      <div className="pfb-stage" ref={stageRef} onMouseLeave={() => hideTip()}>
        <div className="pfb-scroller" ref={scrollerRef}>
          <svg
            width={flow.width}
            height={flow.height}
            viewBox={`0 0 ${flow.width} ${flow.height}`}
            role="group"
            aria-label={`${flow.nodes.length} phases across ${flow.bands.length} stages`}
            onMouseOver={onOver}
            onMouseMove={onMove}
            onMouseOut={onOut}
            /* Click OPENS the phase — the same `getStagePath` route the
               previous board used, so every phase lands on the module that was
               already built for it. Hovering already shows the detail, so a
               click that only pinned a card was a click that did nothing. */
            onClick={(e) => {
              const g = e.target.closest?.('.pfb-node');
              if (g && projectId) navigate(getStagePath(projectId, g.dataset.key));
            }}
            onKeyDown={(e) => {
              const g = e.target.closest?.('.pfb-node');
              if (!g) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (projectId) navigate(getStagePath(projectId, g.dataset.key));
              }
            }}
          >
            <defs>
              <marker id="pfbMain" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M1 1L9 5L1 9" fill="none" stroke={SPINE} strokeWidth="2.2" strokeLinecap="round" />
              </marker>
              <marker id="pfbSide" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M1 1L9 5L1 9" fill="none" stroke={INK_400} strokeWidth="1.8" strokeLinecap="round" />
              </marker>
              <marker id="pfbFx" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M1 1L9 5L1 9" fill="none" stroke={ACCENT_500} strokeWidth="2.2" strokeLinecap="round" />
              </marker>
            </defs>

            <g>
              {flow.bands.map((b) => (
                <g key={b.name}>
                  <rect
                    x={b.x1} y={20} width={b.x2 - b.x1} height={flow.height - 40} rx={10}
                    fill={b.tint} opacity={0.55} stroke={b.line} strokeWidth={1}
                  />
                  <text x={b.x1 + 20} y={44} className="pfb-bandsub" fill={b.c}>{b.sub}</text>
                  <text x={b.x1 + 20} y={64} className="pfb-bandttl" fill={b.c}>{b.name}</text>
                  {/* SVG text does not wrap and does not push its neighbour,
                      so a narrow band printed these two on top of each other —
                      "Find the place" and "0 of 3 done" came out as "Find
                      theplacedone". The count is the droppable half: the band
                      is named once, and counted again on every circle in it. */}
                  {(() => {
                    const count = `${b.done} of ${b.total} done`;
                    /* Rough advance widths — 13px semibold title, 11px count.
                       An estimate is the honest tool here: measuring SVG text
                       properly needs a layout pass this render does not have,
                       and the cost of being wrong is one hidden count. */
                    const needed = b.name.length * 7.2 + count.length * 5.8 + 56;
                    if (b.x2 - b.x1 < needed) return null;
                    return (
                      <text x={b.x2 - 20} y={64} textAnchor="end" className="pfb-bandcnt" fill={b.c}>
                        {count}
                      </text>
                    );
                  })()}
                </g>
              ))}
            </g>

            <g>
              {flow.edges.map((e) => {
                const on = lit(e.from) && lit(e.to);
                return (
                  <path
                    key={e.id}
                    d={`M${e.x1} ${e.y1} L${e.x2} ${e.y2}`}
                    className="pfb-edge"
                    stroke={on ? ACCENT_500 : (e.main ? SPINE : INK_400)}
                    strokeWidth={on ? 3.2 : (e.main ? 2.4 : 1.6)}
                    markerEnd={on ? 'url(#pfbFx)' : (e.main ? 'url(#pfbMain)' : 'url(#pfbSide)')}
                  />
                );
              })}
            </g>

            <g>
              {flow.nodes.map((n) => {
                const solid = n.status !== 'pending';
                const t = toneOf(n.tone);
                const y = n.cy + RING + 21;
                const my = y + 3 * 14 + 6;
                const c = clockOf(n, flow.t0, now);
                const extras = [];
                /* An open-ended phase speaks at zero too — "no properties
                   captured yet" is the useful line there, and the old gate
                   on n.items showed nothing at all. */
                if (n.items || n.openEnded) {
                  extras.push({
                    t: checkText(n),
                    c: n.done === n.items ? '#10B981' : (n.done ? '#12101F' : INK_400),
                    b: 1,
                  });
                }
                if (n.rejected > 0) {
                  extras.push({ t: `${n.rejected} sent back`, c: DANGER });
                }
                if (n.extra) extras.push({ ...n.extra, b: 1 });
                if (n.extra2) extras.push(n.extra2);
                if (n.gate) extras.push({ t: n.gate.label, c: '#4922B4', b: 1 });
                if (!n.critical && n.float > 0 && n.status !== 'complete') {
                  extras.push({ t: `${n.float} days spare`, c: INK_500 });
                }
                return (
                  <g
                    key={n.key}
                    className={`pfb-node${lit(n.key) ? ' fx' : ''}`}
                    data-key={n.key}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.name}, ${n.dept || 'phase'}, ${n.sla} days, ${n.status}`}
                  >
                    <circle cx={n.cx} cy={n.cy} r={RING + 9} fill="none" stroke={ACCENT_500} strokeWidth={2.5} className="pfb-fxring" />
                    {n.status === 'processing' && (
                      <circle cx={n.cx} cy={n.cy} r={RING + 7} fill="none" stroke={n.color} strokeWidth={1} opacity={0.45} />
                    )}
                    <circle cx={n.cx} cy={n.cy} r={RING} fill="none" stroke={INK_200} strokeWidth={6} />
                    {/* A split ring where the phase measures two things: pale
                        is the wider figure, solid the one that counts. The gap
                        between them is the thing still outstanding. */}
                    {/* An open-ended phase draws no arc: there is no target
                        for a ring to be a fraction of. See OPEN_ENDED. */}
                    {n.ring ? (
                      <>
                        <path d={arc(n.cx, n.cy, RING, n.ring.pale)} fill="none" stroke={t.line} strokeWidth={6} strokeLinecap="round" />
                        <path d={arc(n.cx, n.cy, RING, n.ring.solid)} fill="none" stroke={n.ringColor || n.color} strokeWidth={6} strokeLinecap="round" />
                      </>
                    ) : (!n.openEnded && n.pct > 0) ? (
                      <path d={arc(n.cx, n.cy, RING, n.pct / 100)} fill="none" stroke={n.color} strokeWidth={6} strokeLinecap="round" />
                    ) : null}
                    <circle
                      cx={n.cx} cy={n.cy} r={R}
                      fill={solid ? n.color : '#fff'}
                      stroke={solid ? n.color : t.line}
                      strokeWidth={solid ? 2 : 2.5}
                    />
                    <text
                      x={n.cx}
                      y={n.cy - (n.openEnded && n.status !== 'complete' ? 0 : (n.status === 'complete' ? 5 : 6))}
                      textAnchor="middle" dominantBaseline="central"
                      className="pfb-num" fill={solid ? '#fff' : n.color}
                      style={{ fontSize: String(n.badge).length > 2 ? 15 : 21 }}
                    >
                      {n.badge}
                    </text>
                    {n.status === 'complete'
                      ? <text x={n.cx} y={n.cy + 17} textAnchor="middle" className="pfb-tick">✓</text>
                      /* No percentage on an open-ended phase — the number is
                         centred on its own instead of sitting above a figure
                         that would mean nothing. */
                      : !n.openEnded && (
                        <text
                          x={n.cx} y={n.cy + 17} textAnchor="middle" className="pfb-pctin"
                          fill={n.status === 'processing' ? '#fff' : INK_400}
                        >
                          {`${n.pct}%`}
                        </text>
                      )}
                    {wrapN(`${n.badge} · ${n.name}`, 22, 3).map((line, i) => (
                      <text key={line + i} x={n.cx} y={y + i * 14} textAnchor="middle" className="pfb-nm">{line}</text>
                    ))}
                    <text x={n.cx} y={my} textAnchor="middle" className="pfb-tgt">
                      {`${n.sla} ${n.sla === 1 ? 'day' : 'days'}`}
                    </text>
                    <text x={n.cx} y={my + 14} textAnchor="middle" className="pfb-meta">
                      {`day ${n.es}→${n.ef}`}
                    </text>
                    <text x={n.cx} y={my + 29} textAnchor="middle" className="pfb-cd" fill={c.color}>{c.text}</text>
                    {extras.map((x, i) => (
                      <text
                        key={x.t} x={n.cx} y={my + 43 + i * 13} textAnchor="middle"
                        className="pfb-ck" fill={x.c} style={x.b ? { fontWeight: 700 } : undefined}
                      >
                        {x.t}
                      </text>
                    ))}
                  </g>
                );
              })}
            </g>

            <g>
              <rect x={flow.lastX + 58} y={flow.midY - 32} width={132} height={64} rx={8} className="pfb-msr" />
              <text x={flow.lastX + 124} y={flow.midY - 6} textAnchor="middle" className="pfb-mst">Doors open</text>
              <text x={flow.lastX + 124} y={flow.midY + 13} textAnchor="middle" className="pfb-msd">
                {`day ${flow.openDay}`}
              </text>
            </g>
          </svg>
        </div>
      </div>

      {/* ── the panel that explains whatever is lit ── */}
      {info && (
        <div className="pfb-info" style={info.tour ? { borderLeftColor: '#6E45FF' } : undefined}>
          <h3>{info.title}</h3>
          <p className="pfb-info-s">{info.sub}</p>
          {info.kv?.length > 0 && (
            <div className="pfb-kv">
              {info.kv.map((k) => (
                <span key={k} dangerouslySetInnerHTML={{ __html: k }} />
              ))}
            </div>
          )}
          {info.tour ? (
            <div className="pfb-chips">
              <button type="button" className="pfb-chip act" disabled={step <= 0} onClick={() => goStep(step - 1)}>
                ‹ Back
              </button>
              <button
                type="button"
                className="pfb-chip act primary"
                onClick={() => (step === steps.length - 1 ? clearAll() : goStep(step + 1))}
              >
                {step === steps.length - 1 ? 'Finish' : 'Next ›'}
              </button>
              <span className="pfb-chip-hint">or use ← → · Escape to stop</span>
            </div>
          ) : info.chips?.length > 0 && (
            <div className="pfb-chips">
              {info.chips.map((ch) => <span key={ch} className="pfb-chip">{ch}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="pfb-legend">
        {flow.bands.map((b) => (
          <span key={b.name}><i style={{ background: b.c }} />{b.name}</span>
        ))}
        <span><span className="pfb-rd" />Critical path — no spare days</span>
        <span>Click a circle to open its phase · hover for who is on it</span>
      </div>

      {/* ── the tables ── */}
      <div className="pfb-data" onMouseOver={onRowOver} onMouseOut={onRowOut} onClick={onRowClick}>
        <div className="pfb-tabs" role="tablist">
          {TABS.map(([label, id]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`pfb-tab${tab === id ? ' on' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'who' && (
          <div className="pfb-panel">
            <h3>Who did it, and when</h3>
            <p className="pfb-s2">
              Three different questions with three different answers. The person a phase is
              {' '}<b>assigned to</b> owns it; the person who <b>did</b> it is often somebody else; the
              person who <b>approved</b> it is a third name again. Where a phase has not started, this
              says so — a name against work nobody has done is a lie the page would repeat every time
              you look at it.
            </p>
            <div className="pfb-tw">
              <table>
                <thead>
                  <tr>
                    <th className="r">#</th><th>Phase</th><th>Assigned to</th><th>Done by</th>
                    <th>Approved by</th><th className="r">Planned</th><th className="r">Actual</th><th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((n) => {
                    const p = n.people;
                    const took = n.status === 'complete'
                      ? dayDiff(n.actualStart, n.actualEnd)
                      : (n.actualStart ? dayDiff(n.actualStart, new Date()) : null);
                    const dv = took == null ? null : took - n.sla;
                    return (
                      <tr key={n.key} data-go={n.key}>
                        <td className="r">{n.badge}</td>
                        <td className="nme">
                          <b style={{ color: n.color }}>{n.name}</b>
                          <small>{n.dept || '—'}{n.gate ? ` · ${n.gate.label}` : ''}</small>
                        </td>
                        <td className="nme">
                          {p.assignedTo
                            ? <><b>{p.assignedTo.name}</b><small>{`holds ${p.assignedTo.count} of ${p.assignedTo.of} tasks`}</small></>
                            : <span className="pfb-none">not assigned</span>}
                        </td>
                        <td className="nme">
                          {p.doneBy
                            ? <><b>{p.doneBy.name}</b><small>{`last finished ${stamp(p.doneBy.at)}`}</small></>
                            : <span className="pfb-none">{notStartedText(n, flow.todayDay)}</span>}
                        </td>
                        <td className="nme">
                          {p.approvedBy
                            ? <><b>{p.approvedBy.name}</b><small>{`signed ${stamp(p.approvedBy.at)}`}</small></>
                            : <span className="pfb-none">not signed yet</span>}
                        </td>
                        <td className="r">{`${n.sla}d`}</td>
                        <td className="r">{took == null ? '—' : `${took}d${n.status === 'complete' ? '' : ' so far'}`}</td>
                        <td>
                          {dv == null ? <Pill>not started</Pill>
                            : dv === 0 ? <Pill tone="ok">on target</Pill>
                              : dv < 0 ? <Pill tone="ok">{`${Math.abs(dv)}d early`}</Pill>
                                : <Pill tone="dan">{`+${dv}d over`}</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <MoreRows
              hidden={hiddenRows} open={allRows} total={flow.nodes.length}
              onToggle={() => setAllRows((v) => !v)}
            />
          </div>
        )}

        {tab === 'phases' && (
          <div className="pfb-panel">
            <h3>The phases</h3>
            <p className="pfb-s2">
              Numbered by position, 1 to {flow.nodes.length} — no letter suffixes. <b>The database keys
              do not change</b>, so every existing form, approval rule and saved record keeps working.
              Users read names; the key is internal.
            </p>
            <div className="pfb-tw">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Phase</th><th>Key</th><th>Owner</th>
                    <th className="r">Days</th><th>Day span</th><th className="r">Time left</th>
                    <th>Runs with</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((n) => {
                    const c = clockOf(n, flow.t0, now);
                    const with_ = runsWith(n);
                    return (
                      <tr key={n.key} data-go={n.key}>
                        <td><b>{n.badge}</b></td>
                        <td className="nme">
                          <b style={{ color: n.color }}>{n.name}</b>
                          {n.templateBadge && <small>{`the template calls this Phase ${n.templateBadge}`}</small>}
                        </td>
                        <td className="mono">{n.key}</td>
                        <td>{n.dept || '—'}</td>
                        <td className="r">{`${n.sla}d`}</td>
                        <td className="mono">{`day ${n.es} → ${n.ef}`}</td>
                        <td className="r"><b className="mono" style={{ color: c.color }}>{c.text}</b></td>
                        <td>
                          {with_.length
                            ? <Pill tone="warn">{`‖ ${with_.map((m) => m.name).join(', ')}`}</Pill>
                            : <span className="pfb-none">—</span>}
                        </td>
                        <td>
                          {n.status === 'complete' ? <Pill tone="ok">complete</Pill>
                            : n.status === 'processing' ? <Pill tone="warn">{n.openEnded ? 'running' : `${n.pct}% running`}</Pill>
                              : <Pill>not started</Pill>}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="tot">
                    <td />
                    <td>{`All ${flow.nodes.length} phases`}</td>
                    <td /><td />
                    <td className="r">{`${flow.sequentialDays}d`}</td>
                    <td className="mono">{`day 0 → ${flow.days}`}</td>
                    <td />
                    <td>{parallelLevels.length ? <Pill tone="warn">{`${parallelLevels.length} parallel`}</Pill> : ''}</td>
                    <td><b>{`${flow.sequentialDays - flow.days} days saved`}</b></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <MoreRows
              hidden={hiddenRows} open={allRows} total={flow.nodes.length}
              onToggle={() => setAllRows((v) => !v)}
            />
          </div>
        )}

        {tab === 'math' && (
          <div className="pfb-panel">
            <h3>The calendar arithmetic</h3>
            <div className="pfb-tw">
              <table>
                <tbody>
                  <tr>
                    <td>Add up every phase target</td>
                    <td className="r"><b style={{ fontSize: 16 }}>{`${flow.sequentialDays} days`}</b></td>
                    <td><span className="pfb-none">the Days column, one behind the other</span></td>
                  </tr>
                  {parallelLevels.map((l) => {
                    const at = flow.nodes.filter((n) => n.level === l);
                    const saved = at.reduce((s, n) => s + n.sla, 0) - Math.max(...at.map((n) => n.sla));
                    return (
                      <tr key={l}>
                        <td>{`Saved by ${at.map((n) => n.name).join(' ‖ ')}`}</td>
                        <td className="r"><b style={{ fontSize: 16 }}>{`${saved} days`}</b></td>
                        <td><span className="pfb-none">they start together, so only the longest counts</span></td>
                      </tr>
                    );
                  })}
                  <tr className="tot">
                    <td>The doors open</td>
                    <td className="r"><b style={{ fontSize: 16 }}>{`${flow.openDay} days`}</b></td>
                    <td>
                      <span className="pfb-none">
                        {flow.openOn
                          ? flow.openOn.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
                          : 'no planned start set, so no calendar date'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {!flow.clocksLive && (
              <p className="pfb-s2" style={{ paddingTop: 10 }}>
                This project has <b>no planned start date</b>, so the board counts in days and shows no
                clocks. Set one on the project and every countdown here becomes real calendar time.
              </p>
            )}
          </div>
        )}
      </div>

      {createPortal(<div className="pfb-tip" ref={tipRef} />, document.body)}
    </section>
  );
}

export default ProjectFlowBoard;
