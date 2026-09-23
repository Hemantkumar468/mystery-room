import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  P, BY, STAGES, PAIRS, FIXES, SEQ, DAYS, OPEN_DAY, TODAY_DAY, T0, DAY_MS,
  SET1, SET1_DONE, cssv, chainOf, setOf, fmtClock,
} from './pmsFlow/pmsFlowData.js';
import { tipHTML } from './pmsFlow/pmsFlowTip.js';
import { PmsFlowDiagram } from './pmsFlow/PmsFlowDiagram.jsx';
import {
  WhoTable, PhasesTable, MathTable, FixesTab, DrawingsTab, BoqTab, GatesTab, ScreensTab, QuestionsTab,
} from './pmsFlow/PmsFlowTables.jsx';
import '../../styles/pmsFlow.css';

/**
 * PMS Flow — the 16-phase branch opening flow, as one page.
 *
 * Route: /pms-flow  and  /projects/:id/pms-flow
 *
 * A port of the `pms-latest-version.html` prototype into the app, kept
 * deliberately faithful: same layout, same palette, same copy, same numbers,
 * same interactions. The data is still the prototype's own constants (see
 * pmsFlow/pmsFlowData.js) rather than the project API — this page is the spec
 * made visible, and swapping the constants for live records is a separate
 * change that should not move a pixel.
 *
 * Three things are managed imperatively rather than through render, exactly as
 * the prototype did, and for the same reasons:
 *
 *  - The hover card. Its position depends on its own measured size, so the
 *    content has to be in the DOM before it can be placed. Writing it through
 *    a ref keeps show-then-measure in one synchronous step.
 *  - Horizontal focus. `focusOn` is a smooth scroll, not a piece of state.
 *  - The countdowns tick on a `now` state, which re-renders the board and the
 *    phase table once a second; every other tab is memoised so it does not.
 *
 * Interaction state is otherwise ordinary React state. `pinned` is not stored
 * — in the prototype it was true exactly when a phase was selected, so it is
 * derived here instead of tracked.
 */

const TABS = [
  ['The 16 phases', 'tp0'], ['What was wrong', 'tp1'], ['Drawing checklist', 'tp2'],
  ['The 7 BOQs', 'tp3'], ['Gates & rules', 'tp4'], ['Screens & build order', 'tp5'],
  ['Open questions', 'tp6'],
];

/* ---------- walkthrough ---------- */
const STEPS = [
  {
    t: 'Sixteen phases, no letters',
    b: '3B and 4B are gone — the number is now just the position, so a phase can be inserted or removed and '
      + 'everything renumbers itself. The database keys never change, which is why p20 still sits fourth and '
      + 'p6 tenth. Users read names; the key is internal.',
    set: () => null,
    focus: '1',
  },
  {
    t: 'Gate 2 releases design and vendors together',
    b: 'The LOI signature starts the rent-free fit-out clock, and Phases 5 and 6 open on the same day. The '
      + 'architect needs no vendors to draw; procurement needs no drawings to confirm a rate card. Ten days saved.',
    set: () => setOf(['3', '5', '6']),
    focus: '5',
  },
  {
    t: 'Set 1 unlocks the BOQ. Set 2 blocks nothing.',
    b: 'Thirty-seven drawings in two sets. The 29 in Set 1 are what quantities are extracted from, so the BOQ '
      + 'waits for them. The 8 in Set 2 — wall finishes, 3D reception, coordination sets — are needed for '
      + 'execution, not for counting, so they run on and block nothing.',
    set: () => setOf(['5', '7']),
    focus: '7',
  },
  {
    t: 'Quantities meet rates — the only convergence point',
    b: 'Quantities come from the drawings, rates come from the panel. Neither alone produces a BOQ. Seven '
      + 'BOQs, each approved on its own — which is why the target moved from two days to five.',
    set: () => setOf(['5', '6', '7']),
    focus: '7',
  },
  {
    t: 'Nothing is ordered without a contract',
    b: 'Phase 8 did not exist in the system at all. The BOQ says what and how much; the contract says who, '
      + 'for how much money, by what date. The completion date is the vendor’s promise — and it used to live '
      + 'in somebody’s drawer. Every purchase order now cites its contract.',
    set: () => setOf(['7', '8', '9']),
    focus: '8',
  },
  {
    t: 'Ordering and building run together',
    b: 'Both start the day the contract is signed, both run 45 days, and they converge at Quality Check. '
      + `Delhi production alone takes 20–25 days — if ordering waited for civil work, the branch would stand `
      + `idle for a month. That single pair is 45 of the ${SEQ - DAYS} days this plan saves.`,
    set: () => setOf(['9', '10', '11']),
    focus: '9',
  },
];

export function PmsFlowPage() {
  const [mode, setMode] = useState(null); /* 'pairs' | 'gates' | 'newp' | 'crit' | null */
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState(-1); /* -1 = the walkthrough is off */
  const [highlight, setHighlight] = useState(null);
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState('tp0');
  const [now, setNow] = useState(() => Date.now());

  const svgRef = useRef(null);
  const scrollerRef = useRef(null);
  const stageBoxRef = useRef(null);
  const tipRef = useRef(null);
  const tipForRef = useRef(null);
  const selectedRef = useRef(null);

  const tourOn = step >= 0;
  const pinned = selected !== null;
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  /* ---------- the countdowns ---------- */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---------- the hover card, managed by hand ---------- */
  const setTipTo = useCallback((p) => {
    const tip = tipRef.current;
    if (!tip) return;
    if (tipForRef.current !== p) { /* only rebuild on a real change */
      tipForRef.current = p;
      tip.innerHTML = tipHTML(p);
      tip.style.borderTopColor = cssv(STAGES[p.stage].c);
    }
    tip.classList.add('on');
  }, []);

  const moveTip = useCallback((ev) => {
    const tip = tipRef.current;
    if (!tip) return;
    const VW = window.innerWidth;
    const VH = window.innerHeight;
    const PAD = 12;
    const GAP = 22;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = ev.clientX + GAP;
    if (x + w > VW - PAD) x = ev.clientX - GAP - w;
    if (x < PAD) x = Math.min(PAD, VW - w - PAD);
    let y = ev.clientY - h / 2;
    if (y + h > VH - PAD) y = VH - h - PAD;
    if (y < PAD) y = PAD;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
  }, []);

  const hideTip = useCallback((force) => {
    if (selectedRef.current !== null && !force) return;
    if (tipRef.current) tipRef.current.classList.remove('on');
    tipForRef.current = null;
  }, []);

  const focusOn = useCallback((id) => {
    if (!BY[id]) return;
    const sc = scrollerRef.current;
    if (!sc) return;
    const x = Math.max(0, BY[id].cx - sc.clientWidth / 2);
    if (typeof sc.scrollTo === 'function') sc.scrollTo({ left: x, behavior: 'smooth' });
    else sc.scrollLeft = x;
  }, []);

  /* ---------- selection ---------- */
  const pick = useCallback((id) => {
    setMode(null);
    setStep(-1);
    setInfo(null);
    if (selectedRef.current === id) {
      selectedRef.current = null;
      setSelected(null);
      setHighlight(null);
      hideTip(true);
      return;
    }
    selectedRef.current = id;
    setSelected(id);
    setHighlight(chainOf(id));
    setTipTo(BY[id]);
  }, [hideTip, setTipTo]);

  /* ---------- pointer handling on the board ----------
     A phase is a <g> holding a dozen shapes — rings, arcs, the circle, five
     text labels. Moving the pointer from the circle onto its own label fires
     mouseout and then mouseover again, which was hiding and re-showing the
     card on every crossing: the flicker. Both handlers ignore movement that
     stays inside the same phase, and the card is only rebuilt when the phase
     actually changes. */
  const onPointerOver = useCallback((e) => {
    const n = e.target.closest('.node');
    if (!n) return;
    const from = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.node') : null;
    if (from === n) { moveTip(e); return; } /* same phase — nothing to rebuild */
    setTipTo(BY[n.dataset.id]);
    moveTip(e);
    if (!selected && !mode && !tourOn) setHighlight(chainOf(n.dataset.id));
  }, [moveTip, setTipTo, selected, mode, tourOn]);

  const onPointerMove = useCallback((e) => {
    if (tipRef.current && tipRef.current.classList.contains('on') && e.target.closest('.node')) moveTip(e);
  }, [moveTip]);

  const onPointerOut = useCallback((e) => {
    const n = e.target.closest('.node');
    if (!n) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.node') : null;
    if (to === n) return; /* still inside the same phase */
    if (pinned && selected) {
      if (tipForRef.current !== BY[selected]) setTipTo(BY[selected]);
      return;
    }
    hideTip();
    if (!selected && !mode && !tourOn) setHighlight(null);
  }, [hideTip, setTipTo, pinned, selected, mode, tourOn]);

  /* scrolling anywhere moves the board out from under the card */
  useEffect(() => {
    const onScroll = () => hideTip();
    const sc = scrollerRef.current;
    const box = stageBoxRef.current;
    window.addEventListener('scroll', onScroll, { passive: true });
    if (sc) sc.addEventListener('scroll', onScroll, { passive: true });
    if (box) box.addEventListener('mouseleave', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (sc) sc.removeEventListener('scroll', onScroll);
      if (box) box.removeEventListener('mouseleave', onScroll);
    };
  }, [hideTip]);

  /* ---------- the mode buttons ---------- */
  const goStep = useCallback((i) => {
    const s = STEPS[i];
    setStep(i);
    setHighlight(s.set());
    setInfo({
      title: `Step ${i + 1} of ${STEPS.length} — ${s.t}`,
      sub: s.b,
      kv: '<span>use <b>Next</b> to continue, or press <b>Escape</b> to stop</span>',
      tour: true,
      col: cssv('--primary-500'),
    });
    if (s.focus) focusOn(s.focus);
  }, [focusOn]);

  const endTour = useCallback(() => {
    setStep(-1);
    setInfo(null);
    setHighlight(null);
  }, []);

  const toggleMode = useCallback((key, build) => {
    const was = mode === key;
    setStep(-1);
    setSelected(null);
    selectedRef.current = null;
    setMode(null);
    if (was) { setHighlight(null); setInfo(null); return; }
    setMode(key);
    build();
  }, [mode]);

  const onPairs = () => toggleMode('pairs', () => {
    let ids = [];
    PAIRS.forEach((p) => { ids = ids.concat(p.ids); });
    setHighlight(setOf(ids));
    setInfo({
      title: 'The two parallel pairs',
      sub: 'Two places where one phase releases two. Everything else queues.',
      kv: `<span>targets add up to <b>${SEQ} days</b></span>`
        + `<span>the doors open on <b>day ${OPEN_DAY}</b></span>`
        + `<span>the pairs save <b>${PAIRS[0].saved + PAIRS[1].saved} days</b></span>`,
      chips: PAIRS.map((p) => `<span class="chip"><b>${p.why}</b> — ${p.txt}</span>`).join(''),
      col: cssv('--accent-500'),
    });
    focusOn('5');
  });

  const onGates = () => toggleMode('gates', () => {
    const g = P.filter((p) => p.gate);
    setHighlight(setOf(g.map((p) => p.id)));
    setInfo({
      title: 'The three gates',
      sub: 'The only hard stops. Everything between Gate 2 and Gate 3 is scheduled by dependency, not permission.',
      kv: '<span>Gate 2 releases <b>Phases 5 and 6 together</b> and starts the fit-out clock</span>'
        + '<span>every other phase opens when its input arrives, not when someone allows it</span>',
      chips: g.map((p) => `<span class="chip"><b>${p.gate.n}</b> — ${p.gate.t} · ${p.gate.who}</span>`).join(''),
      col: cssv('--primary-900'),
    });
    focusOn('3');
  });

  const onNew = () => toggleMode('newp', () => {
    setHighlight(setOf(['5', '6', '7', '8', '9']));
    setInfo({
      title: 'What this spec changes',
      sub: 'Five structural fixes, all of them in Phases 5 to 9 — which is why that is the build order.',
      kv: '<span><b>Phase 8 is new</b> — contracts had no home at all</span>'
        + '<span><b>Phase 5: 10 → 20 days</b>, Phase 7: <b>2 → 5 days</b></span>'
        + '<span>Phase 6 renamed — a standing panel, not a quotation hunt</span>',
      chips: FIXES.map((f) => `<span class="chip"><b>${f[0]}</b> ${f[3].replace(/<[^>]+>/g, '').slice(0, 72)}…</span>`).join(''),
      col: cssv('--accent-500'),
    });
    focusOn('8');
  });

  /* "Where the project is today" is a snapshot, not a mode — it does not
     latch, so it never lights its own button. */
  const onActive = () => {
    setStep(-1);
    setSelected(null);
    selectedRef.current = null;
    setMode(null);
    const a = P.filter((p) => p.status === 'processing');
    setHighlight(setOf(a.map((p) => p.id)));
    setInfo({
      title: `Where the project is today — day ${TODAY_DAY}`,
      sub: `${a.length} phases are open. The BOQ cannot start until Set 1 is approved.`,
      kv: `<span>drawings: <b>${SET1_DONE} of ${SET1}</b> in Set 1, 5 still open</span>`
        + '<span>vendor panel: <b>5 of 7</b> categories confirmed</span>'
        + `<span>Phase 6 target closed on <b>day ${BY['6'].ef}</b> — it is late</span>`,
      chips: a.map((p) => `<span class="chip">${p.no} · ${p.name} — ${p.pct}%</span>`).join(''),
      col: cssv('--accent-500'),
    });
    focusOn('5');
  };

  const onCrit = () => toggleMode('crit', () => {
    const chain = P.filter((p) => p.critical);
    setHighlight(setOf(chain.map((p) => p.id)));
    setInfo({
      title: 'The critical path',
      sub: `${chain.length} of the ${P.length} phases · day 0 to day ${DAYS}`,
      kv: '<span>a day lost on any of these is <b>a day added to the opening</b></span>'
        + '<span>the phases with float are the ones you can afford to move</span>',
      chips: chain.map((p) => `<span class="chip">${p.no} · ${p.name} (${p.sla}d)</span>`).join(''),
      col: cssv('--danger'),
    });
  });

  const onClear = () => {
    setSelected(null);
    selectedRef.current = null;
    setMode(null);
    setStep(-1);
    setHighlight(null);
    setInfo(null);
    hideTip(true);
  };

  /* arrow keys and Escape drive the walkthrough */
  useEffect(() => {
    if (!tourOn) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' && step < STEPS.length - 1) goStep(step + 1);
      if (e.key === 'ArrowLeft' && step > 0) goStep(step - 1);
      if (e.key === 'Escape') endTour();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tourOn, step, goStep, endTour]);

  /* ---------- table rows light the diagram ----------
     Delegated from the wrapper: every row that belongs to a phase carries
     data-go, so no table has to know about the board. */
  const onRowOver = (e) => {
    const tr = e.target.closest('tr[data-go]');
    if (!tr || selected || mode || tourOn) return;
    setHighlight(chainOf(tr.dataset.go));
  };
  const onRowOut = (e) => {
    const tr = e.target.closest('tr[data-go]');
    if (!tr || selected || mode || tourOn) return;
    setHighlight(null);
  };
  const onRowClick = (e) => {
    const tr = e.target.closest('tr[data-go]');
    if (!tr) return;
    pick(tr.dataset.go);
    focusOn(tr.dataset.go);
    if (stageBoxRef.current) stageBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  /* ---------- header numbers ---------- */
  const running = P.filter((p) => p.status === 'processing');
  const doneCount = P.filter((p) => p.status === 'complete').length;
  const openLeft = (T0 + OPEN_DAY * DAY_MS) - now;
  const openTxt = openLeft > 0 ? fmtClock(openLeft) : `OVERDUE ${fmtClock(-openLeft)}`;

  /* the tabs that do not move are built once */
  const staticTabs = useMemo(() => ({
    who: <WhoTable />,
    math: <MathTable />,
    tp1: <FixesTab />,
    tp2: <DrawingsTab />,
    tp3: <BoqTab />,
    tp4: <GatesTab />,
    tp5: <ScreensTab />,
    tp6: <QuestionsTab />,
  }), []);

  return (
    <>
      {/* The app's top bar — this page is reachable from the sidebar and
          had none, so it opened with no title and no way to sign out. */}
      <Topbar title="PMS flow" />
      <div className="pmsflow">
      <div className="wrap">

        <div className="ctx">
          <div>
            <div className="code">MR-BHO-003 <span>· DB Mall, Bhopal</span></div>
            <div className="ph">
              {`Phase ${running[0].no} — ${running[0].name} `}&nbsp;·&nbsp;{' '}
              <b>{`${doneCount} of ${P.length}`}</b> phases complete
            </div>
          </div>
          <div className="right">
            <span className="badge warn">AT RISK</span>
            <span className="badge day">{`DAY ${TODAY_DAY} / ${OPEN_DAY}`}</span>
            <span className="badge ok">OPENS IN <b>{openTxt}</b></span>
          </div>
        </div>

        <div className="ribbon">
          {P.map((p) => (
            <i
              key={p.id}
              role="button"
              tabIndex={-1}
              title={`${p.no} · ${p.name} — ${p.status}`}
              style={{
                background: p.status === 'complete' ? cssv(STAGES[p.stage].c)
                  : p.status === 'processing' ? cssv('--accent-500') : cssv('--ink-200'),
              }}
              onClick={() => { pick(p.id); focusOn(p.id); }}
            />
          ))}
        </div>
        <div className="riblab">
          <span>Day 0 — Property Research starts</span>
          <span>{`we are here — day ${TODAY_DAY}, ${running.length} phases open`}</span>
          <span>{`Day ${OPEN_DAY} — doors open · day ${DAYS} closed`}</span>
        </div>

        <h1>The 16-phase branch opening flow</h1>
        <p className="sub">
          Built from the four UI specs. Sixteen phases, plain numbering with no letter suffixes, the
          {' '}<b>database keys unchanged</b>. Two parallel pairs — Drawings ‖ Vendor Panel and Purchase Orders ‖
          Site Execution — and three gates, which are the only hard stops. <b>Hover any circle</b> for its key,
          owner, dates, <b>who it is assigned to, who actually did it and who approved it — each with its own
          timing</b>, what unlocks it, what it blocks and which screens build it. Every clock on this page runs
          {' '}<b>by the second, not by the day</b> — an open phase counts down to its deadline, a phase that has
          not opened counts down to its start, and the badge above counts down to opening day.
        </p>

        <div className="stats">
          <div className="stat"><b>{P.length}</b><span>{`Phases, numbered 1–${P.length}, no letters`}</span></div>
          <div className="stat"><b>{SEQ}</b><span>Days of phase targets added up</span></div>
          <div className="stat">
            <b style={{ fontSize: 19, color: openLeft > 0 ? cssv('--primary-500') : cssv('--danger') }}>{openTxt}</b>
            <span>{`Left until the doors open — day ${OPEN_DAY}`}</span>
          </div>
          <div className="stat"><b style={{ color: cssv('--success') }}>{SEQ - DAYS}</b><span>Days saved by the two pairs</span></div>
          <div className="stat"><b style={{ color: cssv('--accent-600') }}>3</b><span>Gates — the only hard stops</span></div>
          <div className="stat">
            <b style={{ color: cssv('--danger') }}>1</b>
            <span>Phase that did not exist: Contracts &amp; Work Orders</span>
          </div>
        </div>

        <div className="bar">
          <button type="button" className="btn amber" onClick={() => (tourOn ? endTour() : goStep(0))}>
            {tourOn ? '■ Stop' : '▶ Walk me through it'}
          </button>
          <button type="button" className={`btn${mode === 'pairs' ? ' on' : ''}`} onClick={onPairs}>The two parallel pairs</button>
          <button type="button" className={`btn${mode === 'gates' ? ' on' : ''}`} onClick={onGates}>The three gates</button>
          <button type="button" className={`btn${mode === 'newp' ? ' on' : ''}`} onClick={onNew}>What is new in this spec</button>
          <button type="button" className="btn" onClick={onActive}>Where the project is today</button>
          <button type="button" className={`btn${mode === 'crit' ? ' on' : ''}`} onClick={onCrit}>The critical path</button>
          <button type="button" className="btn" onClick={onClear}>Clear</button>
          <span className="hint">Hover for detail · click to pin · table rows light the diagram</span>
        </div>

        <div className="stage" ref={stageBoxRef}>
          <div className="scroller" ref={scrollerRef}>
            <PmsFlowDiagram
              ref={svgRef}
              highlight={highlight}
              onPick={pick}
              onPointerOver={onPointerOver}
              onPointerMove={onPointerMove}
              onPointerOut={onPointerOut}
            />
          </div>
        </div>

        <div className={`info${info ? ' on' : ''}`} style={info ? { borderLeftColor: info.col } : undefined}>
          {info && (
            <>
              <h2>{info.title}</h2>
              <p className="s">{info.sub}</p>
              <div className="kv" dangerouslySetInnerHTML={{ __html: info.kv }} />
              {info.tour ? (
                <div className="chips">
                  <span className="chip" style={{ cursor: 'pointer' }} onClick={() => { if (step > 0) goStep(step - 1); }}>‹ Back</span>
                  <span
                    className="chip"
                    style={{ cursor: 'pointer', background: cssv('--primary-500'), color: '#fff', borderColor: cssv('--primary-500') }}
                    onClick={() => { if (step === STEPS.length - 1) endTour(); else goStep(step + 1); }}
                  >
                    {step === STEPS.length - 1 ? 'Finish' : 'Next ›'}
                  </span>
                </div>
              ) : (
                <div className="chips" dangerouslySetInnerHTML={{ __html: info.chips || '' }} />
              )}
            </>
          )}
        </div>

        <div className="lg">
          {STAGES.map((s) => (
            <span key={s.n}><i style={{ background: cssv(s.c) }} />{s.n}</span>
          ))}
          <span><span className="gt">GATE</span>Hard stop — named on the card and in Gates &amp; rules</span>
          <span><span className="gt" style={{ background: cssv('--accent-500') }}>NEW</span>Phase that did not exist</span>
          <span><span className="rd" />Critical path — no spare days</span>
          <span>Hover any circle for who is on it, and when</span>
        </div>

        <div className="data" onMouseOver={onRowOver} onMouseOut={onRowOut} onClick={onRowClick}>
          <h2>The specs, as data</h2>
          <p className="s">
            Every table below comes straight from the four spec files — the phase list and renumbering
            from Spec 00, the five structural fixes from Spec 00 §1, the drawing checklist and BOQ types from
            Spec 03, the screen inventory from Spec 00 §5, and the open questions from Spec 03 §7.
          </p>
          <div className="tabs">
            {TABS.map(([label, id]) => (
              <button key={id} type="button" className={`tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          <section className={`tp${tab === 'tp0' ? ' on' : ''}`}>
            {staticTabs.who}
            <PhasesTable />
            {staticTabs.math}
          </section>
          <section className={`tp${tab === 'tp1' ? ' on' : ''}`}>{staticTabs.tp1}</section>
          <section className={`tp${tab === 'tp2' ? ' on' : ''}`}>{staticTabs.tp2}</section>
          <section className={`tp${tab === 'tp3' ? ' on' : ''}`}>{staticTabs.tp3}</section>
          <section className={`tp${tab === 'tp4' ? ' on' : ''}`}>{staticTabs.tp4}</section>
          <section className={`tp${tab === 'tp5' ? ' on' : ''}`}>{staticTabs.tp5}</section>
          <section className={`tp${tab === 'tp6' ? ' on' : ''}`}>{staticTabs.tp6}</section>
        </div>

        <p className="foot">
          <b>Gate 2 is the one that matters.</b> The LOI signature starts the rent-free fit-out clock and releases
          Phases 5 and 6 together — design does not wait for vendors, and vendors do not wait for drawings.
          {' '}<b>Set 1 drawings are the only hard dependency between design and the BOQ.</b> Set 2 — wall finishes,
          the 3D reception, the four coordination sets — is needed for execution, not for counting quantities, so
          it never blocks ordering.
          {' '}<b>Nothing is ordered before a contract exists.</b> The BOQ says what and how much; the contract says
          who, for how much money, by what date; the PO is issued against a live contract. That middle step is
          Phase 8, and it did not exist in the system at all before this spec.
        </p>
      </div>

      {/* Portalled to <body>: the card is position:fixed, and a transformed
          ancestor anywhere in the app shell would position it against that
          ancestor instead of the viewport. */}
      {createPortal(<div className="pmsflow-tip" ref={tipRef} />, document.body)}
      </div>
    </>
  );
}

export default PmsFlowPage;
