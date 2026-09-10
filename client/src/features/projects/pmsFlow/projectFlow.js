import { buildJourney } from '../../../lib/journeyPlan.js';

/**
 * THE PROJECT'S OWN FLOW, in the shape the Vault board draws.
 *
 * ── What this is, and what it deliberately is not ────────────────────
 * `pmsFlowData.js` is the prototype: a hand-written 17-phase array with
 * invented people, an invented order book and a fixed "today". It exists to
 * show the SPEC. This file is its counterpart for a real project — the same
 * visual language, every number read from the project itself.
 *
 * Nothing here re-derives the plan. `buildJourney` (lib/journeyPlan.js)
 * already turns a project's stage snapshot into a dependency graph with a
 * forward/backward CPM pass — es, ef, ls, lf, float, critical, levels and the
 * four bands. Re-computing any of that here would give the board a second
 * opinion about the critical path, and the Gantt, Plan-vs-Actual and this
 * screen would slowly stop agreeing. So this adapter only adds what the
 * DRAWING needs on top: lane geometry, stage colours, live clocks, and the
 * per-phase people and actuals pulled off the tasks.
 *
 * ── Day 0 is a real date ─────────────────────────────────────────────
 * The prototype counted from an imaginary origin. Here day 0 is the project's
 * planned start, so "day 34 of 45" and every countdown refer to real calendar
 * time. A project with no planned start gets `clocksLive: false` and the board
 * shows day numbers without pretending to know the hour — an invented origin
 * would make every countdown on the page confidently wrong.
 */

/* ── Vault stage bands. `tone` (1-4) comes from journeyPlan's bandsFor(). ── */
export const BAND_TONES = {
  1: { c: '#14B8A6', tint: '#E6FAF7', line: '#9FE7DC' },
  2: { c: '#6E45FF', tint: '#F1EEFF', line: '#C6B6FF' },
  3: { c: '#F5A623', tint: '#FEF3E0', line: '#F6D79B' },
  4: { c: '#10B981', tint: '#E7F8F1', line: '#A5E4CB' },
};
export const toneOf = (t) => BAND_TONES[t] || BAND_TONES[2];

export const INK_200 = '#E4E6EF';
export const INK_400 = '#9AA0AE';
export const INK_500 = '#6B7280';
export const ACCENT_500 = '#F5A623';
export const ACCENT_600 = '#E08600';
export const DANGER = '#F43F5E';
export const SPINE = '#241157';

/* ── geometry, from the prototype so the two boards read identically ── */
export const R = 38;
export const RING = R + 9;
const COLW = 224;
const ROWH = 268;
const PADX = 70;
const PADY = 118;
/* Extra air under a hanging branch, so its labels never touch the lane above. */
const BRANCH_GAP = 126;

export const DAY_MS = 86400000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v ?? '').trim();

/* ── clocks ───────────────────────────────────────────────────────── */
const two = (n) => (n < 10 ? '0' : '') + n;

export function fmtClock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(t / 86400);
  return `${d > 0 ? `${d}d ` : ''}${two(Math.floor((t % 86400) / 3600))}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A real timestamp, printed the way a log entry reads. */
export function stamp(d) {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return `${t.getDate()} ${MON[t.getMonth()]} ${t.getFullYear()}, ${two(t.getHours())}:${two(t.getMinutes())}`;
}

/**
 * A phase's live clock.
 *
 * Four states, and the honest one matters most: a phase nobody has started
 * counts down to its START, not to a deadline it cannot yet miss. Colour is
 * by remaining fraction — under 20% danger, under 40% amber, otherwise the
 * phase's own stage colour, so a bar going red means something.
 */
export function clockOf(node, t0, now) {
  if (!t0) {
    return node.status === 'complete'
      ? { text: `closed day ${node.ef}`, color: INK_400 }
      : { text: `day ${node.es} → ${node.ef}`, color: INK_500 };
  }
  const start = t0 + node.es * DAY_MS;
  const due = t0 + node.lf * DAY_MS;
  const win = Math.max(node.sla, node.lf - node.es) * DAY_MS;

  if (node.status === 'complete') return { text: `closed day ${node.ef}`, color: INK_400 };
  if (now < start) return { text: `${fmtClock(start - now)} to start`, color: INK_500 };
  if (now >= due) return { text: `OVERDUE ${fmtClock(now - due)}`, color: DANGER };

  const frac = (due - now) / win;
  return {
    text: `${fmtClock(due - now)} left`,
    color: frac < 0.2 ? DANGER : (frac < 0.4 ? ACCENT_600 : toneOf(node.tone).c),
  };
}

/* ── people and actuals, off the phase's own tasks ─────────────────── */
function peopleOf(node) {
  const tasks = node.tasks || [];
  const nameOf = (t) => str(t.assignee?.name) || str(t.primaryAssignee);

  /* Assigned: whoever holds the most of this phase's tasks. One phase can
     have a dozen tasks across three people; naming the busiest is the honest
     answer to "who owns this", and the count says how firm that is. */
  const counts = new Map();
  tasks.forEach((t) => {
    const n = nameOf(t);
    if (n) counts.set(n, (counts.get(n) || 0) + 1);
  });
  const assigned = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const finished = tasks.filter((t) => t.status === 'complete' && t.completedAt);
  const lastDone = finished.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0] || null;
  const approved = tasks
    .filter((t) => t.approvedAt)
    .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0] || null;

  const started = tasks
    .filter((t) => t.startedAt)
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))[0] || null;

  /**
   * `backupAssignee` is a free string and does not always hold a person: on
   * several projects it carries a code like "MR-07". Printing that beside a
   * name reads as "backup MR-07", which tells a user nothing and shows them a
   * database value — so anything that looks like an identifier (no lowercase
   * letters, or no space and containing digits) is dropped rather than
   * displayed. A missing backup is honest; a code pretending to be a person
   * is not.
   */
  const looksLikeAName = (v) => {
    const s = str(v);
    if (!s) return false;
    if (!/[a-z]/.test(s)) return false;
    if (!/\s/.test(s) && /\d/.test(s)) return false;
    return true;
  };
  const rawBackup = str(tasks.find((t) => t.backupAssignee)?.backupAssignee);

  return {
    assignedTo: assigned ? { name: assigned[0], count: assigned[1], of: tasks.length } : null,
    backup: looksLikeAName(rawBackup) ? rawBackup : null,
    /* "Done by" is only answerable once something is actually finished.
       Until then the card says nobody yet — never a name against work that
       has not happened. */
    doneBy: lastDone ? { name: nameOf(lastDone), at: lastDone.completedAt } : null,
    approvedBy: approved
      ? { name: str(approved.approvedBy?.name) || 'Approved', at: approved.approvedAt }
      : null,
    startedAt: started?.startedAt || null,
  };
}

/**
 * Phases with no denominator — where "x of y" and a percentage are a lie.
 *
 * Property capture is open-ended by design: a consultant lists as many
 * options as the catchment has, and however many are shortlisted go on to
 * Site Evaluation. Nobody sets out to capture three. So "2 of 3 properties ·
 * 67%" reads as two thirds of a target when the 3 is simply how many happen
 * to exist so far — capture a fourth and the phase goes BACKWARDS to 50%.
 *
 * These phases show what they have instead: captured, and how many of those
 * moved on. No ring, no percentage, nothing to mistake for a target.
 */
const OPEN_ENDED = new Set(['p1']);

/**
 * Build the render model.
 *
 * @param project   the project with its `stages` snapshot
 * @param tasks     every task on the project
 * @param template  the template, for phase briefs and modules
 * @param now       millis; passed in so the caller's 1s tick drives redraws
 */
export function buildProjectFlow(project, tasks = [], template = null, now = Date.now()) {
  const j = buildJourney(project, tasks, template);
  if (!j) return null;

  /* Day 0 = the planned start. No planned start → day numbers only, and the
     board says so rather than counting from an origin nobody agreed. */
  const startDate = project?.plannedStartDate ? new Date(project.plannedStartDate) : null;
  const t0 = startDate && !Number.isNaN(startDate.getTime()) ? startDate.getTime() : null;
  const todayDay = t0 ? Math.floor((now - t0) / DAY_MS) : null;

  const bandTone = (bandIdx) => j.bands[bandIdx]?.tone ?? 2;

  const nodes = j.nodes.map((n) => {
    const tone = bandTone(n.band);
    const people = peopleOf(n);
    const pct = n.taskCount ? Math.round((n.doneCount / n.taskCount) * 100) : 0;
    /**
     * The circle shows its POSITION, never the template's "3B" / "4B".
     *
     * A letter in a phase number means somebody inserted a phase into a list
     * whose numbers were already taken — and it makes a 16-phase project look
     * like a 13-phase one, which is exactly the confusion this board exists to
     * remove (PMS_UI_SPEC_00 §2). Projects created before the renumbering
     * still carry those names in their snapshot, and their labels are not
     * rewritten: the original is kept in `templateBadge` and shown on the
     * hover card, so the paperwork is still findable.
     */
    const positionBadge = String(n.position);
    return {
      ...n,
      badge: positionBadge,
      templateBadge: n.badge !== positionBadge ? n.badge : null,
      tone,
      color: toneOf(tone).c,
      pct,
      /* The checklist under a circle counts real THINGS. Tasks are the
         fallback, not the answer: "0 of 2 tasks" tells a project manager
         nothing, while "24 of 37 drawings" tells them what is left and
         roughly how long it will take. `applyPhaseCounts` swaps these for the
         phase's own records and its own noun the moment the counts arrive. */
      items: n.taskCount,
      done: n.doneCount,
      unit: n.taskCount === 1 ? 'task' : 'tasks',
      /* A property of the PHASE, not of how much data it happens to hold —
         so it is set here and survives a phase with nothing captured yet,
         which is exactly when a "0%" is most misleading. */
      openEnded: OPEN_ENDED.has(n.key),
      people,
      actualStart: people.startedAt,
      actualEnd: n.status === 'complete' ? people.doneBy?.at || null : null,
    };
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  /* ── lanes ──────────────────────────────────────────────────────────
     Everything snaps to a lane: one phase at a level sits on the middle
     line, two take the outer lanes, three fill all three. Nothing lands on a
     half-lane, so the board reads as straight rows rather than a scatter.
     Critical phases take the top lane so the main road is one line. */
  const rows = Math.max(1, j.rows);
  const mid = (rows - 1) / 2;
  const byLevel = new Map();
  nodes.forEach((n) => {
    if (!byLevel.has(n.level)) byLevel.set(n.level, []);
    byLevel.get(n.level).push(n);
  });
  byLevel.forEach((arr) => {
    /* The main run keeps the middle line; a BRANCH is pushed below it with
       extra clearance so it reads as hanging off the column rather than as
       another step in the sequence. */
    const main = arr.filter((n) => !n.branchOf);
    const branches = arr.filter((n) => n.branchOf);
    const ordered = [...main].sort((a, b) => (a.critical ? 0 : 1) - (b.critical ? 0 : 1));
    ordered.forEach((n, i) => {
      const lane = ordered.length === 1 ? mid : (i * (rows - 1)) / (ordered.length - 1);
      n.cx = PADX + n.level * COLW;
      n.cy = PADY + R + lane * ROWH;
    });
    branches.forEach((n) => {
      n.cx = PADX + n.level * COLW;
      n.cy = PADY + R + (rows - 1) * ROWH + BRANCH_GAP;
    });
  });

  const width = PADX * 2 + (j.levels - 1) * COLW + 210;
  const hasBranch = nodes.some((n) => n.branchOf);
  const height = PADY + rows * ROWH - 6 + (hasBranch ? BRANCH_GAP : 0);

  const bands = j.bands.map((b, i) => {
    const mine = nodes.filter((n) => n.band === i);
    if (!mine.length) return null;
    const t = toneOf(b.tone);
    return {
      ...b,
      ...t,
      x1: Math.min(...mine.map((n) => n.cx)) - R - 34,
      x2: Math.max(...mine.map((n) => n.cx)) + R + 34,
      done: mine.filter((n) => n.status === 'complete').length,
      total: mine.length,
    };
  }).filter(Boolean);

  /* Edges. A level's phases all wait on the level before, so a pair running in
     parallel gets no arrow BETWEEN them — no arrow means no dependency, which
     is the whole visual message of a parallel stream. */
  const edges = [];
  nodes.forEach((n) => {
    /* A branch keeps its dependency (so its dates follow the phase it hangs
       off) but draws NO arrow: nothing waits for it, and an arrow would say
       the opposite. */
    if (n.branchOf) return;
    n.after.forEach((k) => {
      const s = byKey.get(k);
      if (!s) return;
      const ang = Math.atan2(n.cy - s.cy, n.cx - s.cx);
      edges.push({
        id: `${k}->${n.key}`,
        from: k,
        to: n.key,
        x1: s.cx + Math.cos(ang) * (RING + 5),
        y1: s.cy + Math.sin(ang) * (RING + 5),
        x2: n.cx - Math.cos(ang) * (RING + 12),
        y2: n.cy - Math.sin(ang) * (RING + 12),
        main: s.critical && n.critical,
      });
    });
  });

  /**
   * The declared extra arrows — visual only.
   *
   * Purchase Orders is the case: its dates follow Contracts, but what an order
   * is RAISED AGAINST is the approved BOQ. Drawing only the contract arrow
   * answers "when can ordering start" and hides "where do the orders come
   * from", so the template names the second arrow explicitly.
   *
   * Two rules keep it honest:
   *
   * It must ALREADY be a transitive ancestor. An arrow claiming a dependency
   * the schedule does not have is worse than a missing arrow, so anything else
   * is dropped rather than drawn.
   *
   * Drawn STRAIGHT, like every other arrow. A curve was tried to clear the
   * phase being skipped and was simply wrong: the lanes put a skipped phase
   * about 67px off the chord and a circle is 47px, so the straight line
   * already clears it — the bow was solving a problem the layout does not
   * have, and it made one arrow look unlike all the others for no reason.
   */
  const ancestorsOf = (key, seen = new Set()) => {
    byKey.get(key)?.after.forEach((k) => {
      if (!seen.has(k)) { seen.add(k); ancestorsOf(k, seen); }
    });
    return seen;
  };

  nodes.forEach((n) => {
    const declared = n.alsoDrawnFrom || [];
    if (!declared.length) return;
    const ancestors = ancestorsOf(n.key);
    declared.forEach((k) => {
      const s = byKey.get(k);
      if (!s || !ancestors.has(k)) return; // not an ancestor — say nothing rather than lie
      if (n.after.includes(k)) return; // already drawn by the ordinary rule

      const ang = Math.atan2(n.cy - s.cy, n.cx - s.cx);
      const x1 = s.cx + Math.cos(ang) * (RING + 5);
      const y1 = s.cy + Math.sin(ang) * (RING + 5);
      const x2 = n.cx - Math.cos(ang) * (RING + 12);
      const y2 = n.cy - Math.sin(ang) * (RING + 12);

      edges.push({
        id: `${k}~>${n.key}`,
        from: k,
        to: n.key,
        x1,
        y1,
        x2,
        y2,
        main: s.critical && n.critical,
      });
    });
  });

  const openDay = j.days;
  const running = nodes.filter((n) => n.status === 'processing');
  const complete = nodes.filter((n) => n.status === 'complete');

  return {
    journey: j,
    nodes,
    byKey,
    bands,
    edges,
    width,
    height,
    rows,
    days: j.days,
    openDay,
    lastX: PADX + (j.levels - 1) * COLW,
    midY: PADY + R + ((rows - 1) / 2) * ROWH,
    t0,
    todayDay,
    clocksLive: !!t0,
    running,
    complete,
    critical: nodes.filter((n) => n.critical),
    /* The one figure the plan commits to, and the one it saves. Sequential is
       what the same phases would take one behind the other; the difference is
       what the parallel streams buy. */
    sequentialDays: nodes.reduce((s, n) => s + n.sla, 0),
    openOn: t0 ? new Date(t0 + openDay * DAY_MS) : null,
  };
}

/**
 * Swap the task fallback for the phase's OWN records and its OWN noun.
 *
 * `recordNoun` lives on the stage in the template — "Property", "Drawing",
 * "Vendor", "BOQ Item", "Contract", "Role" — so the board says "all 37
 * drawings" and "1 of 6 roles" without a single one of those words being
 * written in this file. A template that adds a phase tomorrow counts and
 * names itself correctly with no code change here.
 *
 * A phase that captures no records at all (a `single`-mode phase, or one
 * nobody has filed against) keeps the task count: something a person can act
 * on beats an empty line.
 */

export function applyPhaseCounts(nodes, counts) {
  if (!counts) return nodes;
  return nodes.map((n) => {
    const c = counts[n.key];
    /* An open-ended phase takes its noun even at zero: without it the label
       falls back to the TASK count and reads "2 tasks captured", which is
       both wrong and the exact confusion this is here to remove. */
    if (!c || (!c.total && !n.openEnded)) return n;
    return {
      ...n,
      items: c.total,
      done: c.done,
      unit: c.noun,
      rejected: c.rejected,
      /* Progress follows the same figures the label shows. A ring at 60% over
         a line reading "2 of 9" is two answers to one question. */
      ...(n.openEnded ? {} : { pct: Math.round((c.done / c.total) * 100) }),
    };
  });
}

/**
 * The two SPLIT RINGS, from the client-flow read model.
 *
 * Some phases measure something more specific than "percent of tasks done",
 * and the prototype drew those as a pale arc under a solid one. Three phases
 * have real data behind them:
 *
 *   p3  Deposit — pale: the figure the LOI agreed · solid: what has arrived.
 *                 The gap between the arcs IS the balance.
 *   p11 Drawings — pale: everything filed of 37 · solid: Set 1 approved.
 *                  The gap between the arcs IS the thing holding the BOQ.
 *   p13 BOQ/orders — pale: lines sent to a vendor · solid: lines received.
 *
 * The deposit ring follows the MONEY, not the instalment count. "One of two
 * instalments" is rarely half — a ₹1L token against a ₹36L deposit is 3% —
 * so the arc is rupees and the count is stated beside it.
 *
 * `flowData` is /pms/flow/:projectId. Absent (an older template, or the call
 * has not resolved) every node simply keeps its ordinary task ring.
 */
/** ₹36,00,000 → "₹36L" · ₹1.2Cr → "₹1.2Cr". The scale people speak in. */
export function lakh(n) {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(v % 10000000 ? 1 : 0)}Cr`;
  if (v >= 100000) return `₹${Math.round(v / 100000)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
}

export function applyFlowRings(nodes, flowData) {
  if (!flowData) return nodes;
  const d = flowData.drawings;
  const orders = flowData.orders;
  const boq = flowData.boq;
  const dep = flowData.deposit;

  return nodes.map((n) => {
    /**
     * Phase 3 carries the deposit as well as its own records, and the two are
     * different questions: the phase can be COMPLETE while the money is not.
     * So the ring shows the money — pale is the whole agreed figure, solid is
     * what has actually arrived — and the gap between them is the balance.
     */
    if (n.key === 'p3' && dep?.agreedKnown) {
      const plan = dep.plan;
      return {
        ...n,
        ring: { pale: 1, solid: Math.min(1, dep.received / dep.agreed) },
        ringColor: ACCENT_500,
        deposit: dep,
        /* "0% paid" and "nobody has opened the ledger yet" look identical on
           a ring and are completely different facts — the second is the LOI
           saying what is owed with no form to record it against. */
        extra: dep.ledgerStarted
          ? { t: `deposit ${dep.pct}% paid`, c: dep.settled ? '#10B981' : ACCENT_600 }
          : { t: `deposit ${lakh(dep.agreed)} agreed`, c: ACCENT_600 },
        /* Two lines and no more. The extras stack 13px apart under a circle
           and the row pitch leaves about 62px before the next lane's ring, so
           a third line here would sit on top of it. With an LOI plan the
           position on that plan is the more useful of the two sentences — the
           agreed and received totals are a hover away either way. */
        extra2: {
          t: (() => {
            if (plan) {
              return `instalment ${plan.settled} of ${plan.count}`
                + `${plan.next ? ` · ${lakh(plan.next.outstanding)} next` : ''}`;
            }
            if (!dep.ledgerStarted) return 'nothing recorded against it yet';
            return `${lakh(dep.received)} of ${lakh(dep.agreed)} · ${lakh(dep.balance)} left`;
          })(),
          c: INK_500,
        },
        detail: plan
          ? `${plan.settled} of ${plan.count} planned instalment${plan.count === 1 ? '' : 's'} settled`
          : (dep.ledgerStarted
            ? `${dep.count} instalment${dep.count === 1 ? '' : 's'} received`
            : 'the deposit is agreed on the LOI; the ledger has not been opened'),
      };
    }
    if (n.key === 'p3' && dep && !dep.agreedKnown) {
      /* Payments with no agreed figure: a list with nothing to measure it
         against. Say the figure is missing rather than show a percentage of
         an unknown. */
      return {
        ...n,
        deposit: dep,
        extra: { t: `${lakh(dep.received)} received · no agreed figure`, c: ACCENT_600 },
      };
    }
    return n;
  }).map((n) => {
    if (n.key === 'p11' && d?.set1?.total) {
      const total = d.total || 37;
      return {
        ...n,
        ring: {
          pale: (d.set1.approved + d.set2.approved) / total,
          solid: d.set1.approved / total,
        },
        extra: d.boqUnlocked
          ? { t: `Set 1 complete — BOQ released`, c: '#10B981' }
          : (d.started
            ? { t: `Set 1 ${d.set1.approved} of ${d.set1.total} · BOQ blocked`, c: ACCENT_600 }
            : { t: 'checklist not started', c: INK_400 }),
        detail: `${d.set1.approved} of ${d.set1.total} Set 1 approved · Set 2 ${d.set2.approved} of ${d.set2.total}`,
      };
    }
    if (n.key === 'p13' && boq?.totals?.lines) {
      const b = orders?.book;
      if (b?.lines) {
        return {
          ...n,
          ring: { pale: b.sent / b.lines, solid: b.received / b.lines },
          extra: { t: `${b.sent} sent · ${b.received} received`, c: ACCENT_600 },
          detail: `${boq.totals.approvedBoqs} of ${boq.totals.ofBoqs} BOQs approved · ${b.notSent} lines not sent`,
        };
      }
      return {
        ...n,
        extra: {
          t: `${boq.totals.approvedBoqs} of ${boq.totals.ofBoqs} BOQs approved`,
          c: boq.totals.approvedBoqs === boq.totals.ofBoqs ? '#10B981' : ACCENT_600,
        },
      };
    }
    if (n.key === 'p15' && orders?.book?.lines) {
      const b = orders.book;
      return {
        ...n,
        ring: { pale: b.sent / b.lines, solid: b.received / b.lines },
        extra: orders.blocked
          ? { t: `${orders.blocked} blocked — no contract`, c: DANGER }
          : { t: `${b.sent} sent · ${b.received} received`, c: ACCENT_600 },
        detail: `${b.stock} from stock · ${b.production} in production · ${orders.orderable} clear to order`,
      };
    }
    if (n.key === 'p21' && flowData.contracts) {
      const c = flowData.contracts.counts;
      return {
        ...n,
        extra: {
          t: `${c.signed} of ${c.total} signed`,
          c: c.total && c.signed === c.total ? '#10B981' : ACCENT_600,
        },
      };
    }
    if (n.key === 'p12' && flowData.panel?.totalCategories) {
      const p = flowData.panel;
      return {
        ...n,
        extra: {
          t: `${p.confirmedCount} of ${p.totalCategories} rates confirmed`,
          c: p.ratesReady ? '#10B981' : ACCENT_600,
        },
      };
    }
    return n;
  });
}

/** The arc path for a progress ring, starting at −90° like the prototype. */
export function arc(cx, cy, r, frac) {
  if (frac <= 0) return '';
  const f = frac >= 1 ? 0.9999 : frac;
  const a = -Math.PI / 2;
  const b = a + f * Math.PI * 2;
  return `M${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
    + ` A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)}`;
}

/** Wrap a label to at most `lines` lines of `max` characters. */
export function wrapN(s, max, lines) {
  const words = String(s || '').split(' ');
  let out = [];
  let cur = '';
  words.forEach((w) => {
    if (`${cur} ${w}`.trim().length <= max) cur = `${cur} ${w}`.trim();
    else { if (cur) out.push(cur); cur = w; }
  });
  if (cur) out.push(cur);
  if (out.length > lines) out = out.slice(0, lines - 1).concat(out.slice(lines - 1).join(' '));
  return out;
}

/**
 * What to say when a phase has nothing done on it — and there are two very
 * different cases behind the same empty column.
 *
 * A phase whose start day is still ahead has simply not come round yet;
 * "nobody yet" is the whole truth. A phase whose start day has PASSED with
 * nothing done is late, and saying "opens day 0" about it on day 26 reads as
 * if the board has not noticed. The distinction is the difference between a
 * plan running normally and a phase nobody has picked up.
 */
export function notStartedText(node, todayDay) {
  if (todayDay == null || todayDay < node.es) return `nobody yet — opens day ${node.es}`;
  const late = todayDay - node.es;
  return `nothing started — due to open day ${node.es}, ${late} day${late === 1 ? '' : 's'} ago`;
}

/** The checklist line under a circle. */
export function checkText(n) {
  /* An open-ended phase counts what it HAS, never what is left: there is no
     target to be short of. "12 properties · 4 shortlisted" is the whole
     story, and capturing a thirteenth does not make it worse. Zero is worth
     saying out loud here — an empty line would read as "nothing to do". */
  if (n.openEnded) {
    if (!n.items) return `no ${n.unit} captured yet`;
    return n.done
      ? `${n.items} ${n.unit} · ${n.done} shortlisted`
      : `${n.items} ${n.unit} captured`;
  }
  if (!n.items) return '';
  if (n.done === n.items) return `✓ all ${n.items} ${n.unit}`;
  if (!n.done) return `0 of ${n.items} ${n.unit}`;
  return `✓ ${n.done} of ${n.items} ${n.unit}`;
}

export default buildProjectFlow;
