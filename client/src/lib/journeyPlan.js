/**
 * THE JOURNEY PLAN — one project's phases as a dependency graph with a
 * critical path, computed from the project's own snapshot.
 *
 * ── Where the arrows come from ────────────────────────────────────────
 * Nothing here is hand-drawn. A template declares which phases run SIDE BY
 * SIDE through `parallelGroup` — the client flow puts Design (p11) and Vendor
 * Identification (p12) in `design-vendor`, and Purchase Orders (p15) and Site
 * Execution (p6) in `build-procure`. That is the only structural fact needed:
 *
 *   consecutive phases sharing a parallelGroup  →  one LEVEL (they run together)
 *   a phase with no group                        →  a level of its own
 *   every phase at level L depends on every phase at level L-1
 *
 * So a template that adds a parallel stream tomorrow draws correctly with no
 * code change, and a template that declares none draws as a straight line —
 * which is what it is.
 *
 * ── Why a critical path at all ────────────────────────────────────────
 * "Which phase is late" is a fact anyone can read off a list. "Which phase
 * being late moves the OPENING DATE" is the question a director actually
 * asks, and it has a different answer: a phase with spare days can slip
 * without costing anything, and a phase with none cannot slip at all. Float
 * is what separates them, and float needs the whole graph.
 *
 * Standard forward/backward pass (CPM):
 *   es = latest ef of everything it waits on      ef = es + duration
 *   lf = earliest ls of everything waiting on it  ls = lf - duration
 *   float = ls - es        critical = float is 0
 *
 * Durations are the phase's own SLA in days — the plan, not the actuals, because
 * this answers "what does the plan commit us to", and actuals are shown beside
 * it rather than folded into it.
 */

/** The four acts of a store opening, in the client's words. Keyed by template
 *  code, because these names are that playbook's, not a universal truth. Any
 *  other template falls back to neutral quarters — see bandsFor(). */
const NAMED_BANDS = {
  'MR-PMS-CLIENT-FLOW': [
    { name: 'Find the place', tone: 1 },
    { name: 'Design and plan', tone: 2 },
    { name: 'Build and fit out', tone: 3 },
    { name: 'Open the doors', tone: 4 },
  ],
};

const GENERIC_BANDS = [
  { name: 'Getting started', tone: 1 },
  { name: 'Planning', tone: 2 },
  { name: 'Doing the work', tone: 3 },
  { name: 'Finishing', tone: 4 },
];

/**
 * Levels → four contiguous bands, as evenly as the level count allows.
 * Deliberately NOT a fixed level map: a 15-phase template and a 10-phase one
 * both get four readable acts instead of one of them getting an empty band.
 */
function bandsFor(templateCode, levelCount) {
  const names = NAMED_BANDS[templateCode] || GENERIC_BANDS;
  const per = levelCount / names.length;
  return names.map((b, i) => ({
    ...b,
    sub: `Stage ${i + 1} of ${names.length}`,
    from: Math.round(i * per),
    to: Math.round((i + 1) * per) - 1,
  }));
}

/** A phase's progress, from its own tasks — the project snapshot stores no
 *  status (see server phaseProgress.js), so it is derived here the same way. */
function progressOf(tasks) {
  if (!tasks.length) return 'pending';
  if (tasks.every((t) => t.status === 'complete')) return 'complete';
  return tasks.some((t) => t.status !== 'pending') ? 'processing' : 'pending';
}

/**
 * @param project   the project, with its `stages` snapshot
 * @param tasks     every task in the project (for per-phase progress)
 * @param template  optional, for a phase's task list in the detail panel
 * @returns {{ nodes, bands, days, levels, rows, critical, slack }}
 */
export function buildJourney(project, tasks = [], template = null) {
  /* THE SHAPE OF THE PLAN COMES FROM THE TEMPLATE.
     `branchOf`, `parallelGroup` and `alsoDrawnFrom` say how the phases are
     wired to each other. A project snapshots them at creation and nothing in
     the product ever edits them afterwards — so where a snapshot is silent,
     the template is the answer, not "no branch".
     This matters because `branchOf` was added after most live projects were
     created: their snapshots have no such field, and without this HR Hiring
     was drawn in the main chain, blocking two phases it does not block. The
     project's own value always wins where it has one. */
  const tplByKey = new Map((template?.stages || []).map((t) => [t.key, t]));
  const shaped = (s) => {
    const t = tplByKey.get(s.key);
    if (!t) return s;
    return {
      ...s,
      branchOf: s.branchOf ?? t.branchOf ?? null,
      parallelGroup: s.parallelGroup ?? t.parallelGroup ?? null,
      alsoDrawnFrom: (s.alsoDrawnFrom?.length ? s.alsoDrawnFrom : t.alsoDrawnFrom) || [],
    };
  };

  const stages = [...(project?.stages || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(shaped);
  if (!stages.length) return null;

  const byStage = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!byStage.has(t.stageKey)) byStage.set(t.stageKey, []);
    byStage.get(t.stageKey).push(t);
  }

  /* ── Levels: consecutive phases sharing a parallelGroup run together ──
     A phase declaring `branchOf` joins the column of the phase it hangs off
     instead of taking a column of its own. It is NOT a group member: the
     wiring below skips it when deciding what the next level waits for, so it
     hangs there and holds nothing up. See branchOf in template.model.js. */
  const levels = [];
  stages.forEach((s) => {
    const host = s.branchOf
      ? levels.find((l) => l.items.some((x) => x.key === s.branchOf))
      : null;
    if (host) { host.items.push(s); return; }
    const group = s.parallelGroup || null;
    const last = levels[levels.length - 1];
    if (group && last && last.group === group) last.items.push(s);
    else levels.push({ group, items: [s] });
  });

  const nodes = stages.map((s, i) => {
    const own = byStage.get(s.key) || [];
    const tpl = (template?.stages || []).find((x) => x.key === s.key) || null;
    const level = levels.findIndex((l) => l.items.some((x) => x.key === s.key));
    // "Phase 4B" from the template's own name; the position is the honest
    // number, since a template numbering 15 stages 1–13 makes 3B and 4B look
    // like a shorter journey than it is.
    const head = String(s.name || '').split(/\s+[—–-]\s+/)[0].trim();
    const numbered = /^phase\b/i.test(head);
    return {
      key: s.key,
      /* Hangs off another phase and feeds nothing — drawn with no arrow. */
      branchOf: s.branchOf || null,
      /* Extra arrows to draw only — no dependency. See template.model.js. */
      alsoDrawnFrom: s.alsoDrawnFrom || [],
      // The short badge inside the circle: the template's own "3B"/"4B" where
      // it has one, since that is what the client's paperwork says.
      badge: numbered ? head.replace(/^phase\s*/i, '') : String(i + 1),
      position: i + 1,
      name: numbered
        ? (String(s.name).split(/\s+[—–-]\s+/).slice(1).join(' — ') || s.name)
        : s.name,
      fullName: s.name,
      dept: s.ownerDepartment || null,
      sla: Number.isFinite(s.slaDays) ? s.slaDays : 7,
      status: progressOf(own),
      level,
      after: [],
      next: [],
      tasks: own,
      taskCount: own.length,
      doneCount: own.filter((t) => t.status === 'complete').length,
      plannedStart: s.plannedStart || null,
      plannedEnd: s.plannedEnd || null,
      exitCriteria: s.exitCriteria || null,
      gate: s.gate?.label ? s.gate : null,
      blueprint: tpl?.tasks || [],
      /* EVERYTHING THE PHASE ACTUALLY IS, carried on the node so the detail
         panel can show a phase in full without a second lookup: the four
         management questions, its assessments, who is on it and who covers
         them, and how many questions its forms ask in total. */
      brief: (s.whatWhoWhenHow || []).filter((r) => r && (r.what || r.who || r.when || r.how)),
      modules: (tpl?.assessmentTypes || []).map((a) => ({
        key: a.key,
        name: a.name,
        fields: (a.masterDataSchema || []).length,
      })),
      fields: (tpl?.masterDataSchema || []).length
        + (tpl?.assessmentTypes || []).reduce((n, a) => n + (a.masterDataSchema || []).length, 0),
      // The doer and the person who covers for them — one name never answers
      // "who do I chase" on the day the first person is away.
      people: [...new Map(own
        .map((t) => [t.assignee?.name || t.primaryAssignee, t.backupAssignee || t.backupAssignees?.[0] || null])
        .filter(([who]) => who))].map(([who, backup]) => ({ who, backup })),
    };
  });

  const byKey = new Map(nodes.map((n) => [n.key, n]));

  /* Every phase at a level waits on every phase at the level before it —
     except a BRANCH, which waits only on the phase it hangs off and is
     nobody's predecessor. Left in the general rule, hiring would both wait
     for the whole previous column and hold up the whole next one, which is
     the opposite of what a branch is. */
  nodes.forEach((n) => {
    if (n.branchOf) {
      const host = byKey.get(n.branchOf);
      if (host) { n.after.push(host.key); host.next.push(n.key); }
      return;
    }
    if (n.level === 0) return;
    levels[n.level - 1].items
      .filter((prev) => !prev.branchOf)
      .forEach((prev) => {
        n.after.push(prev.key);
        byKey.get(prev.key).next.push(n.key);
      });
  });

  /* ── Forward pass ── */
  nodes.forEach((n) => {
    n.es = n.after.length ? Math.max(...n.after.map((k) => byKey.get(k).ef)) : 0;
    n.ef = n.es + n.sla;
  });
  const days = Math.max(...nodes.map((n) => n.ef));

  /* ── Backward pass ── */
  [...nodes].reverse().forEach((n) => {
    n.lf = n.next.length ? Math.min(...n.next.map((k) => byKey.get(k).ls)) : days;
    n.ls = n.lf - n.sla;
    n.float = n.ls - n.es;
    n.critical = n.float === 0;
  });

  /* The code lives on the POPULATED template ref (`.populate('template.ref',
     'name code')`) or on the template itself — never on `project.template`,
     which snapshots only { ref, name, version }. Reading it from there gave
     every project the generic band names. */
  const templateCode = template?.code || project?.template?.ref?.code || null;
  const bands = bandsFor(templateCode, levels.length)
    .map((b) => ({ ...b, nodes: nodes.filter((n) => n.level >= b.from && n.level <= b.to) }))
    .filter((b) => b.nodes.length);

  nodes.forEach((n) => { n.band = bands.findIndex((b) => b.nodes.includes(n)); });

  const rows = Math.max(...levels.map((l) => l.items.length));

  return {
    nodes,
    byKey,
    bands,
    days,
    levels: levels.length,
    rows,
    critical: nodes.filter((n) => n.critical),
    slack: nodes.filter((n) => !n.critical).sort((a, b) => b.float - a.float),
    running: nodes.filter((n) => n.status === 'processing'),
    done: nodes.filter((n) => n.status === 'complete'),
  };
}

/** Everything this phase waits on, transitively. */
export function upstream(journey, key, acc = new Set()) {
  journey.byKey.get(key)?.after.forEach((k) => {
    if (!acc.has(k)) { acc.add(k); upstream(journey, k, acc); }
  });
  return acc;
}

/** Everything waiting on this phase, transitively. */
export function downstream(journey, key, acc = new Set()) {
  journey.byKey.get(key)?.next.forEach((k) => {
    if (!acc.has(k)) { acc.add(k); downstream(journey, k, acc); }
  });
  return acc;
}

/** The whole route through one phase — what it needs, and what needs it. */
export function chainThrough(journey, key) {
  const s = upstream(journey, key);
  downstream(journey, key).forEach((k) => s.add(k));
  s.add(key);
  return s;
}

export default buildJourney;
