/**
 * Who actually does each task — the real Mystery Rooms people, from
 * SHEET/USERROLE.xlsx (see createRealUsers.js, which creates their accounts).
 *
 * This is the file to edit when someone joins, leaves or changes role. It maps
 * ROLE → person, then TASK → roles, and `assignRealPeople.js` stamps the
 * result onto the templates. Nothing here is code — it is the org chart.
 *
 * Two ideas run through it:
 *
 *  1. SEVERAL DOERS ARE NORMAL. A task can name more than one person: it lands
 *     in every one of their My Tasks, and the FIRST to complete it closes it
 *     for everyone — it disappears from the others' lists, with who finished it
 *     and when recorded on the task. So the three MDs share every approval (any
 *     one of them decides), and the people who share a job share its work.
 *
 *  2. BUDDIES ARE COVER, NOT WORK. A buddy watches the task and can pick it up
 *     if the doer is away, but it does not sit in their list demanding action.
 *
 * Everyone is referenced by `employeeId` (MR-01 …), never by name or email, so
 * a person changing their email address breaks nothing.
 */

/* ── The people, by the job they do ──────────────────────────────────────── */
export const R = Object.freeze({
  MD: ['MR-01', 'MR-02', 'MR-03'],   // Prateek, Shikhir, Sapna — any one of them decides
  PM: ['MR-04'],                     // Siddharth Kumar — Project Management Head / Project Manager
  PROPERTY: ['MR-05'],               // Manoj Parihar — Property / Franchise Consultant
  TECH_EXPERT: ['MR-06'],            // Om Prakash — Technical Expert
  OPS_EXPERT: ['MR-07'],             // Shishir — Operational Expert
  ARCHITECT: ['MR-08'],              // Architect / Design Team
  CIVIL: ['MR-09'],                  // Ram Singh — Civil Head (and Games Head)
  GAMES: ['MR-09'],                  // Ram Singh — Games Head
  IT: ['MR-10'],                     // Chandan Kumar — IT Head
  HR: ['MR-11'],                     // Radhika — HR Head
  MARKETING: ['MR-12'],              // Marketing Head
  STORE: ['MR-13'],                  // Store Head
  LOGISTICS: ['MR-14'],              // Logistics Head
  SUPERVISOR: ['MR-15'],             // Fardeen — Site Supervisor / Contractor
  PROCUREMENT: ['MR-16'],            // Store / Procurement Manager
  OPS_HEAD: ['MR-17'],               // Ajay Sahni — Operations Head
  CLUSTER: ['MR-18', 'MR-19', 'MR-20', 'MR-21', 'MR-22'], // Yogita, Yash, Ashwini, Vishal, Dawood
  /** Prateek wears these two expert hats as well as being an MD (see the sheet). */
  FINANCE_EXPERT: ['MR-01'],
  FEASIBILITY_EXPERT: ['MR-01'],
});

const flat = (...groups) => [...new Set(groups.flat())];

/** doers → the people it lands on; buddies → cover, who only watch. */
const a = (doers, buddies = []) => ({
  doers: flat(doers),
  buddies: flat(buddies).filter((id) => !flat(doers).includes(id)),
});

/* ── Task by task ────────────────────────────────────────────────────────── */
export const TASK_ASSIGNMENTS = Object.freeze({
  /* Phase 1 — Property Research */
  p1_capture: a(R.PROPERTY, R.PM),
  p1_shortlist: a(R.MD, R.PM),

  /* Phase 2 — the four assessments, each to its own expert */
  p2_feasibility: a(R.FEASIBILITY_EXPERT, R.PM),
  p2_financial: a(R.FINANCE_EXPERT, R.PM),
  p2_technical: a(R.TECH_EXPERT, R.CIVIL),
  p2_operational: a(R.OPS_EXPERT, R.OPS_HEAD),
  p2_decision: a(R.MD, R.PM),

  /* Phase 3 — Commercial Closure. The sheet has no legal role, so the deal
     sits with the MDs and the PM Head coordinates the paperwork. */
  p3_t1: a(R.MD, R.PM),
  p3_t2: a(R.MD, R.PM),
  p3_t3: a(R.PM, R.MD),
  p3_t4: a(R.FINANCE_EXPERT, R.PM),
  p3_t5: a(R.PM, R.OPS_HEAD),

  /* Phase 3B — Planning & Games */
  p20_games: a([...R.GAMES, ...R.OPS_HEAD], R.MD),
  p20_dates: a(R.PM, R.MD),
  p20_approve: a(R.MD, R.PM),

  /* Phase 4 — Design & Drawings */
  p11_concepts: a(R.ARCHITECT, R.PM),
  p11_draw: a(R.ARCHITECT, R.PM),
  p11_approve: a(R.PM, [...R.MD, ...R.OPS_HEAD]),

  /* Phase 4B — Vendors */
  p12_finalise: a([...R.PROCUREMENT, ...R.PM], R.STORE),

  /* Phase 5 — BOQ, Budget & Gantt */
  p13_t1: a(R.PM, R.PROCUREMENT),
  p13_t2: a(R.FINANCE_EXPERT, R.PM),
  p13_t3: a(R.PM, R.OPS_HEAD),
  p13_t4: a(R.MD, R.PM),

  /* Phase 6 — Purchase orders & delivery tracking */
  p15_t1: a([...R.PROCUREMENT, ...R.STORE], R.PM),
  p15_t2: a([...R.PROCUREMENT, ...R.STORE, ...R.LOGISTICS], R.PM),
  p15_t3: a([...R.STORE, ...R.SUPERVISOR], R.LOGISTICS),
  p15_t4: a([...R.MARKETING, ...R.HR], R.PM),

  /* Phase 7 — Site execution */
  p6_daily_report: a(R.SUPERVISOR, R.CIVIL),
  p6_hiring: a(R.HR, R.OPS_HEAD),
  p6_tech: a(R.IT, R.PM),

  /* Phase 8 — Quality check */
  p16_t1: a([...R.OPS_HEAD, ...R.PM], R.CIVIL),
  p16_t2: a(R.OPS_HEAD, R.CIVIL),
  p16_t3: a(R.OPS_HEAD, R.PM),
  p16_t4: a([...R.CIVIL, ...R.SUPERVISOR], R.PM),
  p16_hiring_check: a(R.HR, R.OPS_HEAD),
  p16_tech_check: a(R.IT, R.PM),

  /* Phase 9 — Logistics & dispatch */
  p17_t1: a([...R.LOGISTICS, ...R.STORE], R.PROCUREMENT),
  p17_t2: a(R.LOGISTICS, R.PROCUREMENT),
  p17_t3: a(R.LOGISTICS, R.STORE),
  p17_t4: a([...R.SUPERVISOR, ...R.STORE], R.LOGISTICS),

  /* Phase 10 — Assembly & installation */
  p18_t1: a(R.GAMES, R.PM),
  p18_t2: a(R.GAMES, R.SUPERVISOR),
  p18_t3: a(R.IT, R.GAMES),
  p18_t4: a(R.PM, R.OPS_HEAD),

  /* Phase 11 — Testing & trial run */
  p19_t1: a([...R.OPS_HEAD, ...R.OPS_EXPERT], R.GAMES),
  p19_t2: a([...R.OPS_HEAD, ...R.OPS_EXPERT], R.GAMES),
  p19_t3: a(R.GAMES, R.IT),
  p19_t4: a([...R.OPS_HEAD, ...R.OPS_EXPERT], R.GAMES),
  p19_t5: a([...R.HR, ...R.OPS_HEAD], R.CLUSTER),

  /* Phase 12 — Readiness checklist, one per department head */
  p8_g1: a(R.CIVIL, R.SUPERVISOR),
  p8_g2: a(R.CIVIL, R.IT),
  p8_g3: a(R.IT, R.PM),
  p8_g4: a(R.HR, R.OPS_HEAD),
  p8_g5: a(R.HR, R.OPS_HEAD),
  p8_g6: a(R.MARKETING, R.OPS_HEAD),
  p8_g7: a(R.OPS_HEAD, R.OPS_EXPERT),
  p8_g8: a(R.STORE, R.PROCUREMENT),
  p8_g9: a(R.PM, R.MD),

  /* Phase 13 — Go-live. The cluster managers cover the branch handover. */
  p9_g1: a(R.OPS_HEAD, [...R.OPS_EXPERT, ...R.CLUSTER]),
  p9_g2: a(R.IT, R.PM),
  p9_g3: a(R.IT, R.STORE),
  p9_g4: a(R.IT, R.PM),
  p9_g5: a(R.CIVIL, R.IT),
  p9_g6: a(R.HR, R.OPS_HEAD),
  p9_g7: a(R.OPS_HEAD, R.CIVIL),
  p9_g8: a(R.OPS_HEAD, R.HR),
  p9_g9: a(R.STORE, R.PROCUREMENT),
  p9_g10: a(R.MARKETING, R.OPS_HEAD),
  p9_g11: a(R.PM, R.MD),
  p9_g12: a(R.FINANCE_EXPERT, R.PM),

  /* Phase 14 — Closure */
  p10_t1: a(R.FINANCE_EXPERT, R.PM),
  p10_t2: a(R.PM, R.FINANCE_EXPERT),
  p10_t3: a([...R.PROCUREMENT, ...R.STORE], R.PM),
  p10_t4: a([...R.PM, ...R.OPS_HEAD], R.MD),
});

/**
 * Last resort for a task this file has never heard of — a phase added to a
 * template later. The department's own head gets it, so a new task is never
 * born ownerless; naming it above is still better.
 */
export const DEPARTMENT_FALLBACK = Object.freeze({
  expansion: a(R.PROPERTY, R.PM),
  legal: a(R.PM, R.MD),
  projects: a(R.PM, R.OPS_HEAD),
  hr: a(R.HR, R.OPS_HEAD),
  marketing: a(R.MARKETING, R.OPS_HEAD),
  finance: a(R.FINANCE_EXPERT, R.PM),
  operations: a(R.OPS_HEAD, R.OPS_EXPERT),
  construction: a(R.CIVIL, R.SUPERVISOR),
  interior: a(R.ARCHITECT, R.PM),
  procurement: a(R.PROCUREMENT, R.STORE),
  automation: a(R.GAMES, R.IT),
  it: a(R.IT, R.PM),
});

/** The assignment for one template task. */
export function assignmentFor(taskKey, department) {
  return TASK_ASSIGNMENTS[taskKey] || DEPARTMENT_FALLBACK[department] || null;
}

export default { R, TASK_ASSIGNMENTS, DEPARTMENT_FALLBACK, assignmentFor };
