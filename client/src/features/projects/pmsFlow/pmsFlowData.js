/* ============================================================================
   PMS Flow — the model behind the 16-phase board.

   A faithful port of the data half of the `pms-latest-version.html` prototype:
   the phase list, the people, the order book, the deposit schedule, the
   drawing checklist, the seven BOQs, and everything derived from them (the
   CPM pass, the per-phase checklists, the geometry of the diagram).

   Nothing here touches React. The page and the diagram read from it; a later
   change that swaps these constants for server data only has to keep the same
   shapes.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   The Vault palette, mirrored from styles/pmsFlow.css.

   The prototype read its colours back out of the cascade with
   getComputedStyle(document.documentElement). It cannot here: the tokens are
   scoped to `.pmsflow` rather than :root (the ERP owns :root and several names
   collide), and the SVG needs colour strings during render, before any ref is
   attached. So the values live here as well, resolved — `--st1` is the hex of
   `--secondary-500`, not the reference. Change a colour in one place, change
   it in the other.
   --------------------------------------------------------------------------- */
export const TOKENS = {
  '--primary-50': '#F1EEFF',
  '--primary-500': '#6E45FF',
  '--primary-700': '#4922B4',
  '--primary-900': '#241157',
  '--accent-400': '#FFC24B',
  '--accent-500': '#F5A623',
  '--accent-600': '#E08600',
  '--secondary-400': '#2DD4BF',
  '--secondary-500': '#14B8A6',
  '--secondary-600': '#0E8F9E',
  '--ink-50': '#F6F7FB',
  '--ink-200': '#E4E6EF',
  '--ink-400': '#9AA0AE',
  '--ink-500': '#6B7280',
  '--ink-900': '#12101F',
  '--ink-950': '#0B0A14',
  '--success': '#10B981',
  '--warning': '#F59E0B',
  '--danger': '#F43F5E',
  '--info': '#38BDF8',
  '--bg': '#F6F7FB',
  '--surface': '#FFFFFF',
  '--text': '#12101F',
  '--muted': '#6B7280',
  '--border': '#E4E6EF',
  '--st1': '#14B8A6', '--st1-t': '#E6FAF7', '--st1-l': '#9FE7DC',
  '--st2': '#6E45FF', '--st2-t': '#F1EEFF', '--st2-l': '#C6B6FF',
  '--st3': '#F5A623', '--st3-t': '#FEF3E0', '--st3-l': '#F6D79B',
  '--st4': '#10B981', '--st4-t': '#E7F8F1', '--st4-l': '#A5E4CB',
};

export function cssv(n) { return TOKENS[n] || ''; }

/* ============================================================================
   THE 16 PHASES — PMS_UI_SPEC_00 §2
   `key` is the database key and never changes. `no` is the display position and
   is recomputed from array order, so a phase can be inserted or removed without
   anyone inventing a "3B" again.
   ========================================================================== */
export const P = [
  {
    id: '1', key: 'p1', name: 'Property Research & Site Capture', was: '—', dept: 'Expansion', sla: 15,
    status: 'complete', pct: 100, after: [],
    alias: 'capture 10–12 candidate properties, nothing committed',
    plain: 'Two lead profiles: a lead who already has a property, and a lead who has none — the second is a '
      + 'profiling form, not a property form. AI location report with sources.',
    screens: [['SCR-01-*', '/projects/:id/property-identification']],
  },
  {
    id: '2', key: 'p2', name: 'Site Evaluation', was: 'Site Evaluation (4 Assessments)', dept: 'Expansion', sla: 5,
    status: 'complete', pct: 100, gate: { n: 'GATE 1', t: 'Property Approved', who: 'MD' },
    after: [{ id: '1', lab: 'shortlisted properties' }],
    alias: 'four independent assessments, four assessors',
    plain: 'Feasibility, Financial, Operational, Technical — each its own form and owner. Comparison screen '
      + 'puts shortlisted properties side by side. Gate 1: the MD approves exactly one.',
    screens: [['SCR-02-*', '/projects/:id/site-evaluation']],
  },
  {
    id: '3', key: 'p3', name: 'Commercial Closure', was: '—', dept: 'Legal', sla: 7,
    status: 'complete', pct: 100, gate: { n: 'GATE 2', t: 'LOI Approved', who: 'MD' }, isDeposit: true,
    after: [{ id: '2', lab: 'gate 1 · one property approved' }],
    alias: 'LOI, lease, deposit schedule, NOCs',
    plain: 'Two additions the walkthrough demands: a structured three-milestone deposit schedule read by OCR '
      + 'from the LOI, and AutoCAD layout ingestion so AI zoning works from the real contour, not a '
      + 'rectangle. Gate 2 starts the rent-free fit-out clock.',
    screens: [['SCR-03-*', '/projects/:id/commercial-finalization']],
  },
  {
    id: '4', key: 'p20', name: 'Project Planning & Games', was: 'Phase 3B', dept: 'Projects', sla: 3,
    status: 'complete', pct: 100, after: [{ id: '3', lab: 'gate 2 · LOI signed · clock starts' }],
    alias: 'which games, what area, what opening date',
    plain: 'The games chosen here pre-fill BOQs 2, 3, 4, 5 and 7 from each game’s standard prop, sensor, '
      + 'camera and speaker counts. Choosing games well is what makes quantity extraction a check rather '
      + 'than a count.',
    screens: [['SCR-04-*', '/projects/:id/phase/p20']],
  },
  /* A branch off Project Planning and nothing else. The day the games are agreed
     the headcount is known, so hiring can open that day. It feeds no other phase
     — no arrow leaves it — and it runs on the HRMS, not on this build. Because it
     has no successor, its deadline is its OWN target date, not the project end. */
  {
    id: '4H', key: 'p22', name: 'HR Hiring & Training', was: 'did not exist', dept: 'HR', sla: 30,
    status: 'processing', pct: 63, isHr: true,
    after: [{ id: '4', hide: true }], /* keeps its dates and its position, draws no line */
    alias: 'opens with the games · connected to nothing else',
    plain: 'Requisitions per role, JDs from the JD Master, applications, interviews, offers, then induction '
      + 'and training on the actual games. The team size follows from the games chosen in Phase 4, so '
      + 'hiring starts the same day. It runs on the HRMS and is tied to no other module in this flow.',
    screens: [['SCR-HR-01', '/projects/:id/hiring']],
  },
  {
    id: '5', key: 'p11', name: 'Design & Drawings', was: 'Phase 4', dept: 'Projects', sla: 20,
    status: 'processing', pct: 83, pair: 1, isDraw: true,
    after: [{ id: '4', lab: 'games & opening date' }],
    alias: '37 drawings, 2 sets, one checklist',
    plain: 'Rebuilt as a checklist board over 37 fixed drawings. Set 1 (29) is what quantities come off and '
      + 'blocks the BOQ; Set 2 (8) is finishes and coordination and blocks nothing. Target moved 10 → 20 '
      + 'days: 37 drawings was never a ten-day job.',
    screens: [['SCR-05-01', '/projects/:id/drawings'], ['SCR-05-02', '/drawings/:drawingId'],
      ['SCR-05-03', '/drawings/:drawingId/review']],
  },
  {
    id: '6', key: 'p12', name: 'Vendor & Contractor Panel', was: 'Phase 4B — Vendor Identification',
    dept: 'Procurement', sla: 10, status: 'processing', pct: 71, pair: 1, isVendor: true,
    after: [{ id: '4', lab: '7 categories to assign' }],
    alias: 'pick from the standing panel, confirm the rate',
    plain: 'Not a quotation hunt. There is a standing panel of 4–5 teams who already know the work. Per site '
      + 'the questions are only: which team, at what rate, and who is the local general contractor. '
      + 'Comparison stays as an option for a new category or a new city.',
    screens: [['SCR-06-01', '/projects/:id/vendor-panel'], ['SCR-06-02', '/vendor-panel/:vendorId']],
  },
  {
    id: '7', key: 'p13', name: 'BOQ & Budget', was: 'Phase 5 — BOQ, Budget & Gantt', dept: 'Projects', sla: 5,
    status: 'pending', pct: 0, isBoq: true,
    after: [{ id: '5', lab: 'SET 1 APPROVED → quantities' }, { id: '6', lab: 'confirmed rate cards → prices' }],
    alias: 'seven BOQs, each approved on its own',
    plain: 'The only convergence point in the flow: quantities from Set 1 drawings, rates from the panel. '
      + 'Neither alone produces a BOQ. Seven named BOQs, each with its own lines, total, vendor and '
      + 'approval. Target moved 2 → 5 days: seven BOQs, seven approvals.',
    screens: [['SCR-07-01', '/projects/:id/boq'], ['SCR-07-02', '/boq/:boqType'],
      ['SCR-07-03', '/boq/extract']],
  },
  {
    id: '8', key: 'p21', name: 'Contracts & Work Orders', was: 'did not exist', dept: 'Projects + Legal', sla: 5,
    status: 'pending', pct: 0, after: [{ id: '7', lab: 'approved BOQ · scope & value' }],
    alias: 'what is my work, and by when will you finish',
    plain: 'The step that had no home. Once quantities are known the MD and the vendor sign: scope, total '
      + 'value, start and completion date, penalties, retention. The completion date is the promise the '
      + 'vendor made — and until now it lived in somebody’s drawer.',
    screens: [['SCR-08-01', '/projects/:id/contracts'], ['SCR-08-02', '/contracts/:contractId']],
  },
  {
    id: '9', key: 'p15', name: 'Purchase Orders & Delivery Tracking', was: 'Phase 6', dept: 'Procurement', sla: 45,
    status: 'pending', pct: 0, pair: 2, isPo: true,
    after: [{ id: '7' }, { id: '8', hide: true }], /* the contract link is kept but not drawn,
                                                      so the dates do not move */
    alias: 'stock, production or procurement — three different paths',
    plain: 'One sheet over the approved BOQ lines. Every line is one of three: earmarked from Delhi stock '
      + '(no PO at all), Delhi production (20–25 day queue), or outside procurement (a real GST PO). '
      + 'A PO may carry several lines for one vendor — that is the fix for one-line-per-PO.',
    screens: [['SCR-09-01', '/projects/:id/procurement'], ['SCR-09-02', '/procurement/:recordId'],
      ['SCR-09-03', '/purchase-order/:recordId']],
  },
  {
    id: '10', key: 'p6', name: 'Site Execution / Civil Works', was: 'Phase 7', dept: 'Projects', sla: 45,
    status: 'pending', pct: 0, pair: 2, isSite: true,
    after: [{ id: '8', lab: 'signed work order · 60-day promise' }],
    alias: 'three unlinked tracks: civil, hiring, IT',
    plain: 'Not one stream. Civil & fit-out with a two-minute daily report, HR hiring for this centre, and '
      + 'the IT rough-in that must land while the walls are still open. Three departments, three '
      + 'turnarounds, drawn as three unlinked bars — never nested.',
    screens: [['SCR-10-01', '/projects/:id/execution'], ['SCR-10-02', '/execution/daily']],
  },
  {
    id: '11', key: 'p16', name: 'Quality Check', was: 'Phase 8', dept: 'Operations', sla: 5,
    status: 'pending', pct: 0,
    after: [{ id: '9', lab: 'goods at site · GRN' }, { id: '10', lab: 'zones ready to inspect' }],
    alias: 'pass, fail or not applicable — a fail raises its own task',
    plain: 'Where the two 45-day tracks meet: the site must be ready to receive and the goods must have '
      + 'arrived. Any Fail raises a rectification task automatically on the responsible party. A re-check '
      + 'reopens the same item, so the history reads as one thread.',
    screens: [['SCR-11-*', '/projects/:id/phase/p16']],
  },
  {
    id: '12', key: 'p18', name: 'Assembly & Installation', was: 'Phase 9', dept: 'Automation', sla: 10,
    status: 'pending', pct: 0, after: [{ id: '11', lab: 'passed zones' }],
    alias: 'games × installation types, one grid',
    plain: 'One record per installation against the setup standard for that game, pulled from the Games '
      + 'Master. Progress reads as a grid of games by installation type.',
    screens: [['SCR-12-*', '/projects/:id/phase/p18']],
  },
  {
    id: '13', key: 'p19', name: 'Testing & Trial Run', was: 'Phase 10', dept: 'Operations', sla: 10,
    status: 'pending', pct: 0, after: [{ id: '12', lab: 'rooms installed' }],
    alias: 'run 1 fail → issues → run 2 → run 3 pass',
    plain: 'The loop is the point. A Fail logs issues, each issue auto-assigns, a re-test references the '
      + 'original run — so "is this game actually ready?" is answered at a glance.',
    screens: [['SCR-13-*', '/projects/:id/phase/p19']],
  },
  {
    id: '14', key: 'p8', name: 'Readiness Checklist', was: 'Phase 11', dept: 'Operations', sla: 10,
    status: 'pending', pct: 0, gate: { n: 'GATE 3', t: 'Launch Clearance', who: 'Dept heads → Director' },
    after: [{ id: '13', lab: 'tested · snags closed' }],
    alias: 'fourteen departments, fourteen sign-offs',
    plain: 'One card per department with its own checklist and its own head. Mandatory items block the '
      + 'launch; optional items are tracked and do not. The screen states plainly what is blocking and '
      + 'who owns it.',
    screens: [['SCR-14-*', '/projects/:id/store-readiness']],
  },
  {
    id: '15', key: 'p9', name: 'Branch Opening / Handover', was: 'Phase 12', dept: 'Operations', sla: 5,
    status: 'pending', pct: 0, after: [{ id: '14', lab: 'gate 3 · launch clearance' }],
    alias: 'the handover pack, then a one-way door',
    plain: 'As-built drawings, signed contracts, warranties, asset register, keys, SOPs, roster, snag list '
      + 'with owners. Launch Store is deliberately one-way and lists anything still open first.',
    screens: [['SCR-15-*', '/projects/:id/store-launch']],
  },
  {
    id: '16', key: 'p10', name: 'Closure & Delay Analysis', was: 'Phase 13', dept: 'Finance', sla: 7,
    status: 'pending', pct: 0, after: [{ id: '15', lab: 'actuals vs baseline' }],
    alias: 'what it cost, what slipped, and whose fault it was',
    plain: 'Plan vs actual per phase, delay attribution by department, budget variance by BOQ, and vendor '
      + 'performance that writes back to the vendor master — so the next project’s panel selection is '
      + 'informed by this one.',
    screens: [['SCR-16-*', '/projects/:id/closure']],
  },
];
P.forEach((p, i) => { p.no = i + 1; });

/* ============================================================================
   PEOPLE — the real employee list from the ERP (/employees).
   Name, job title and department are as they appear there, so a name on a card
   can be looked up in the HRMS without translation.
   ========================================================================== */
export const PEOPLE = {
  prateek: { n: 'Prateek', r: 'Managing Director · MD' },
  rahul: { n: 'Rahul Yadav', r: 'ERP Administrator' },
  priya: { n: 'Priya Menon', r: 'Expansion Lead · Expansion' },
  manoj: { n: 'Manoj Parihar', r: 'Property / Franchise Consultant · Expansion' },
  feas: { n: 'Feasibility Expert', r: 'Expansion' },
  arjun: { n: 'Arjun Nair', r: 'Projects Head · Projects' },
  omPrakash: { n: 'Om Prakash', r: 'Technical Expert · Projects' },
  karan: { n: 'Karan Gupta', r: 'Site Engineer · Projects' },
  architect: { n: 'Architect / Design Team', r: 'Projects' },
  kavya: { n: 'Kavya Reddy', r: 'Interior Designer · Interior' },
  civilHead: { n: 'Civil Head', r: 'Construction' },
  aditya: { n: 'Aditya Rao', r: 'Site Supervisor · Construction' },
  fardeen: { n: 'Fardeen', r: 'Site Supervisor / Contractor · Construction' },
  meera: { n: 'Meera Pillai', r: 'Civil Engineer · Construction' },
  logistics: { n: 'Logistics Head', r: 'Procurement' },
  rajesh: { n: 'Rajesh Kumar', r: 'Procurement Executive · Procurement' },
  ajay: { n: 'Ajay Sahni', r: 'Operations Head · Operations' },
  ashwini: { n: 'Ashwini Rawale', r: 'Cluster / Branch Manager · Operations' },
  qaExec: { n: 'QA Test Executor', r: 'Operations' },
  gamesHead: { n: 'Games Head', r: 'Automation' },
  nikhil: { n: 'Nikhil Bhatt', r: 'Automation Engineer · Automation' },
  chandan: { n: 'Chandan Kumar', r: 'IT Head · IT' },
  amit: { n: 'Amit Trivedi', r: 'IT Executive · IT' },
  radhika: { n: 'Radhika', r: 'HR Head · HR' },
  neha: { n: 'Neha Kapoor', r: 'HR Manager · HR' },
  ananya: { n: 'Ananya Das', r: 'Finance Analyst · Finance' },
  finExp: { n: 'Financial Expert', r: 'Finance' },
  heads: { n: 'All department heads', r: 'Readiness panel' },
};

/* as = who it is assigned to · did = who actually does it · sg = who signs it */
export const TEAM = {
  1: { as: 'priya', did: 'manoj', sg: 'prateek', sgN: 'shortlist approved' },
  2: { as: 'priya', did: 'feas', sg: 'prateek', sgN: 'Gate 1 — property approved' },
  3: { as: 'priya', did: 'manoj', sg: 'prateek', sgN: 'Gate 2 — the LOI' },
  4: { as: 'arjun', did: 'gamesHead', sg: 'prateek', sgN: 'games & opening date' },
  '4H': { as: 'radhika', did: 'neha', sg: 'ajay', sgN: 'headcount signed off' },
  5: { as: 'arjun', did: 'architect', sg: 'prateek', sgN: 'drawing approval' },
  6: { as: 'logistics', did: 'rajesh', sg: 'prateek', sgN: 'rate cards confirmed' },
  7: { as: 'arjun', did: 'omPrakash', sg: 'prateek', sgN: 'approves each of the 7 BOQs' },
  8: { as: 'arjun', did: 'omPrakash', sg: 'prateek', sgN: 'signs with the vendor' },
  9: { as: 'logistics', did: 'rajesh', sg: 'prateek', sgN: 'PO release' },
  10: { as: 'civilHead', did: 'aditya', sg: 'arjun', sgN: 'zone handover' },
  11: { as: 'ajay', did: 'karan', sg: 'arjun', sgN: 'rectification closed' },
  12: { as: 'gamesHead', did: 'nikhil', sg: 'arjun' },
  13: { as: 'ashwini', did: 'nikhil', sg: 'ajay' },
  14: { as: 'heads', did: 'ashwini', sg: 'prateek', sgN: 'Gate 3 — launch clearance' },
  15: { as: 'ajay', did: 'ashwini', sg: 'prateek' },
  16: { as: 'finExp', did: 'ananya', sg: 'prateek' },
};

/* what ACTUALLY happened, in project days — the planned figures are above.
   Site Evaluation ran two days over; Legal and Planning pulled it back. */
export const ACTUAL = {
  1: { s: 0, e: 15 },
  2: { s: 15, e: 22 },
  3: { s: 22, e: 28 },
  4: { s: 28, e: 30 },
  '4H': { s: 30 }, /* opened with the games, still running */
  5: { s: 30, e: 51 }, /* drawings, one day over */
  6: { s: 30, e: 44 }, /* vendor panel, four days over */
  7: { s: 51, e: 56 }, /* BOQ */
  8: { s: 56, e: 61 }, /* contracts */
  9: { s: 61 }, /* purchase orders, running */
  10: { s: 61 }, /* site execution, running */
};
P.forEach((p) => {
  p.team = TEAM[p.id] || {};
  p.act = ACTUAL[p.id] || null;
});

export function who(k) { return PEOPLE[k] || { n: k, r: '' }; }

/* ============================================================================
   THE ORDER BOOK — Spec 01 §5.2. 312 lines across the seven BOQs, each one on
   one of three paths. Only "procure" ever becomes a vendor PO.
   ========================================================================== */
export const ORDER = {
  lines: 312, notSent: 41, production: 96, dispatched: 128, received: 47,
  stock: 68, toProcure: 148, late: 7,
};
ORDER.sent = ORDER.lines - ORDER.notSent;
ORDER.pctIn = Math.round((ORDER.received / ORDER.lines) * 100);
ORDER.pctSent = Math.round((ORDER.sent / ORDER.lines) * 100);

/* the two tracks that really are inside Site Execution — Spec 01 §6.2.
   Spec 01 §6.1 also lists hiring here as a third track. */
export const SITE = [
  { n: 'Civil & fit-out', owner: 'Site Supervisor', pct: 72 },
  { n: 'Technical rough-in', owner: 'IT', pct: 63 },
];
SITE.pct = Math.round(SITE.reduce((a, t) => a + t.pct, 0) / SITE.length);

/* ============================================================================
   THE DEPOSIT — Spec 02 §10. One amount fixed by the LOI, released in three
   parts on three triggers. The phase can be complete while the money is not:
   the last instalment only falls due on launch day.
   ========================================================================== */
export const DEPOSIT = [
  { n: 'Signing amount', amt: 1800000, trigger: 'on LOI execution', fire: { id: '3', at: 'end' } },
  { n: 'Fit-out amount', amt: 1200000, trigger: 'at civil work start', fire: { id: '10', at: 'start' } },
  { n: 'Opening amount', amt: 600000, trigger: 'on the store launch day', fire: { id: '15', at: 'start' } },
];

export function inr(n) {
  const x = String(n);
  let last3 = x.slice(-3);
  const rest = x.slice(0, -3);
  if (rest) last3 = `,${last3}`;
  return `₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')}${last3}`;
}
export function lakh(n) {
  return n >= 10000000 ? `₹${(n / 10000000).toFixed(1)}Cr` : `₹${Math.round(n / 100000)}L`;
}
export const DEP = { total: 0, paid: 0, due: 0, paidN: 0 };

/* the two parallel pairs — Spec 00 §2 "Runs with" */
export const PAIRS = [
  {
    n: 1,
    ids: ['5', '6'],
    why: 'Drawings ‖ Vendor Panel',
    saved: 10,
    txt: 'The architect needs no vendors to draw. Procurement needs no drawings to confirm a rate card. '
      + 'Both start the day Gate 2 clears and converge at the BOQ.',
  },
  {
    n: 2,
    ids: ['9', '10'],
    why: 'Purchase Orders ‖ Site Execution',
    saved: 45,
    txt: 'Delhi production takes 20–25 days. If ordering waited for civil work to finish, the branch would '
      + 'stand idle for a month. They converge at Quality Check.',
  },
];

/* ---------- the drawing checklist, Spec 03 §1 — all 37 rows ---------- */
export const DRAW = [
  [1, 'Architectural', 'Floor layout plan with furniture', 1],
  [2, 'Architectural', 'Partition Layout plan with door details', 1],
  [3, 'Architectural', 'Door schedule (Normal / Hidden / Tunnel Doors)', 1],
  [4, 'Architectural', 'Mezzanine floor plan with its LVL from FFL', 1],
  [5, 'Architectural', 'Furniture and Prop on-site making drawing', 1],
  [6, 'Architectural', 'Wall panelling drawings', 2],
  [7, 'Architectural', '4-Wall open layout drawing of all game rooms', 1],
  [8, 'Architectural', 'Ceiling layout', 1],
  [9, 'Architectural', 'Wall finish layout', 2],
  [10, 'Architectural', 'Tile / Floor finish layout', 1],
  [11, 'Electrical', 'Electrical Layout Plan', 1],
  [12, 'Electrical', 'Reset Light Layout', 1],
  [13, 'Electrical', 'Control Box Layout', 1],
  [14, 'Electrical', 'Electrical Looping Diagram', 1],
  [15, 'Electrical', 'AC/DC Single line diagram (220V / 12V)', 1],
  [16, 'Electrical', 'Main Line Single Line Diagram', 1],
  [17, 'Electrical', 'Distribution Board (DB) Layout', 1],
  [18, 'Electrical', 'Server room Layout', 1],
  [19, 'Electronic', 'Sensor layout (RFID / Switches)', 1],
  [20, 'Electronic', 'RFID / Sensor Wiring Layout', 1],
  [21, 'Electronic', 'Game Control System Layout', 1],
  [22, 'Automation', 'Audio Speaker Layout', 1],
  [23, 'Automation', 'CCTV Layout', 1],
  [24, 'Automation', 'Network Layout (LAN / CAT-6)', 1],
  [25, 'Fire Fighting', 'Sprinkler and Pipe Layout', 1],
  [26, 'Fire Fighting', 'Fire Detection Layout (Smoke detector, MCP & Hooter)', 1],
  [27, 'HVAC', 'Duct and Diffuser Layout', 1],
  [28, 'HVAC', 'Diffuser Layout', 1],
  [29, 'HVAC', 'Equipment Layout', 1],
  [30, 'HVAC', 'Heat Load Sheet', 1],
  [31, 'Plumbing', 'Drainage Layout', 1],
  [32, 'Reception', '3D Drawing of Reception', 2],
  [33, 'Reception', 'Working Drawing for Reception ⚠ label unconfirmed', 2],
  [34, 'Coordination', 'Architectural / Drawings Set', 2],
  [35, 'Coordination', 'Electrical Drawings Set', 2],
  [36, 'Coordination', 'Fire Fighting & Alarm Drawings Set', 2],
  [37, 'Coordination', 'HVAC Drawings Set', 2],
];
export const SET1 = DRAW.filter((d) => d[3] === 1).length;
export const SET2 = DRAW.length - SET1;
/* today's position, matching the Spec 01 §1.2 board: 24 of 29 approved */
export const SET1_DONE = 29;
export const SET2_DONE = 8;

/* ---------- the seven BOQs, Spec 03 §2 ---------- */
export const BOQS = [
  [1, 'General Contractor BOQ', 'General Contractor (local)', 'Outside procurement', 44,
    'Civil, walls, flooring, ceiling, painting, HVAC install', 'construction'],
  [2, 'All games furniture BOQ', 'Games Furniture (panel)', 'Delhi stock + production', 20,
    'Props, sets, custom furniture per game', 'furniture'],
  [3, 'All games electronic BOQ', 'Games Electronic (internal)', 'Delhi production', 14,
    'Sensors, RFID, control boxes, game logic', 'procurement'],
  [4, 'All games cameras BOQ', 'Games Cameras (panel)', 'Outside procurement', 4,
    'CCTV, game cameras, DVR/NVR', 'procurement'],
  [5, 'All games speaker BOQ', 'Games Speaker (panel)', 'Outside procurement', 3,
    'Audio, amplifiers, speaker runs', 'procurement'],
  [6, 'Common area furniture BOQ', 'Games Furniture (panel)', 'Outside procurement', 7,
    'Reception, waiting, lockers, briefing room', 'furniture'],
  [7, 'Procurement BOQ of all games', 'MR Central Facility (internal)', 'Delhi stock + production', 8,
    'Everything drawn from or produced by the central facility', 'procurement'],
];

/* ============================================================================
   THE BOQ IS THREE THINGS
   Seven sheets, but only three kinds of work — and each kind is handed to a
   different track. That is what the BOQ actually splits into.
   ========================================================================== */
export const STREAMS = [
  {
    k: 'construction', ttl: 'Construction', who: 'the local contractor builds it on site', goes: 'Site Execution',
  },
  {
    k: 'furniture', ttl: 'Furniture', who: 'made to drawing at the Delhi facility', goes: 'Delhi production, then Assembly',
  },
  {
    k: 'procurement', ttl: 'Procurement', who: 'bought in from panel vendors', goes: 'Purchase Orders, then Assembly',
  },
];
STREAMS.forEach((st) => {
  st.rows = BOQS.filter((b) => b[6] === st.k);
  st.share = st.rows.reduce((a, b) => a + b[4], 0);
  st.count = st.rows.length;
});

/* ---------- the five structural fixes, Spec 00 §1 ---------- */
export const FIXES = [
  ['F-1', 'Drawings arrive as <b>two defined sets</b> against a fixed 37-item checklist. Set 1 (29) is what quantities come off; Set 2 (8) follows later.',
    'One flat upload list, ~12 generic types and a revision number. No sets, no checklist, no completeness meter.',
    'Phase 5 rebuilt around the Drawing Checklist — two tabs, 37 tracked rows, a ring per category, and a hard <i>Set 1 complete → BOQ unlocked</i> marker.', '5'],
  ['F-2', 'There are <b>7 separate BOQs</b> — different owners, vendors and timelines.',
    'One flat BOQ list.',
    'Phase 7 becomes a workspace of 7 named BOQs, each with its own lines, total, owner and approval.', '7'],
  ['F-3', 'Vendors are <b>not discovered per project</b>. A standing panel of 4–5 teams already knows the work; per site you pick and agree a rate.',
    '“Vendor Identification”, as if every branch starts from zero and hunts quotations.',
    'Renamed <b>Vendor &amp; Contractor Panel</b> — opens with the panel loaded, asks only which team, at what rate, for this site.', '6'],
  ['F-4', 'After quantities are known the <b>MD and vendor sign a contract</b> — scope, value, completion date.',
    'No such step existed anywhere. Rates were captured; the agreement had no home.',
    '<b>New Phase 8 — Contracts &amp; Work Orders</b>, between BOQ and Purchase Orders. A PO can only be raised against a signed contract.', '8'],
  ['F-5', 'The purchase order is a <b>GST tax document</b> — voucher number, both GSTINs, state codes, SKU, CGST/SGST, amount in words, authorised signatory. Much Delhi stock already exists.',
    'A simple item/qty/rate print with a GST line if the vendor happened to have one.',
    'PO print rebuilt to the client’s own format, plus a <b>stock / production / procure</b> split on every line.', '9'],
];

/* ---------- the five rules, Spec 00 §3 ---------- */
export const RULES = [
  ['1', '<b>Design starts the day the LOI is signed.</b> Not after documentation, not after vendors. Gate 2 releases it.'],
  ['2', '<b>Set 1 drawings unlock the BOQ. Set 2 does not block anything.</b> Wall finishes and 3D reception views are needed for execution, not for counting quantities.'],
  ['3', '<b>Quantities come from drawings; rates come from the panel.</b> Neither alone produces a BOQ. This is the only convergence point in the whole flow.'],
  ['4', '<b>Nothing is ordered before a contract exists.</b> The BOQ says what and how much. The contract says who, for how much money, by what date.'],
  ['5', '<b>Ordering and building run together for 45 days.</b> Delhi production takes 20–25 days; if it waited for civil work the branch would stand idle for a month.'],
];

/* ---------- build order, Spec 00 §9 ---------- */
export const BUILD = [
  [1, 'Shell — sidebar, header, project context bar, tokens, shared components', '—', 'Everything else drops into it'],
  [2, 'Drawing Checklist board + detail', 'SCR-05-01 · SCR-05-02', 'The client’s first missing piece; drives everything downstream'],
  [3, 'BOQ workspace + line editor + extraction', 'SCR-07-01/02/03', 'The core complaint'],
  [4, 'Contracts & Work Orders', 'SCR-08-01/02', 'The step that does not exist at all today'],
  [5, 'Order tracker + GST PO print', 'SCR-09-01/02/03', 'Completes BOQ → PO → delivery'],
  [6, 'Vendor & Contractor Panel', 'SCR-06-01/02', 'Feeds rates back into step 3'],
  [7, 'Site execution + daily report', 'SCR-10-01/02', 'The parallel track, mobile-first'],
  [8, 'Gantt with unlinked parallel bars', 'SCR-G-05', 'Makes the parallelism visible'],
  [9, 'Dashboard, Approvals', 'SCR-G-01 · SCR-G-03', 'The MD’s daily view'],
  [10, 'Remaining phases 1–4, 11–16', 'SCR-01/02/03/04, 11–16', 'Already largely built; brought to the new pattern'],
];

/* ---------- open questions, Spec 03 §7 ---------- */
export const QS = [
  ['Q-1', 'Drawing checklist row 33 — the label is cut off as “Working Drawing for”. For Reception?', 'Seeding the drawing master'],
  ['Q-2', 'The PO shows two GST numbers with different state codes (04 and 07). Which is the place of supply?', 'CGST/SGST vs IGST logic'],
  ['Q-3', 'Voucher series — is <span class="mono">PO-DL/26-27/###</span> per location, per FY, per entity, or one running series?', 'PO numbering'],
  ['Q-4', 'Are the 7 BOQs always all seven, or does the set vary by site size?', 'BOQ workspace defaults'],
  ['Q-5', 'Standard payment-milestone template — advance %, on-delivery %, on-completion %, retention %?', 'Contract commercials defaults'],
  ['Q-6', 'Standard contractor duration — the walkthrough said 60 days. Fixed, or per site area?', 'Contract timeline default'],
  ['Q-7', 'Is the Delhi central facility a vendor record, an internal warehouse, or both?', 'Source-of-supply routing and the future IMS'],
  ['Q-8', 'Who signs a work order on the Mystery Rooms side — MD only, or MD + Projects Head?', 'Contract signature block'],
  ['Q-9', '<b>New.</b> Spec 00 says “200 days of phase targets”, but the table sums to <b>207</b>. Which is right — the total, or one of the durations?', 'The headline arithmetic on every deck'],
];

/* ---------- stages ---------- */
export const STAGES = [
  { n: 'Find the place', sub: 'Stage 1 of 4', lv: [0, 2], c: '--st1' },
  { n: 'Design & commit', sub: 'Stage 2 of 4', lv: [3, 6], c: '--st2' },
  { n: 'Build & fit out', sub: 'Stage 3 of 4', lv: [7, 9], c: '--st3' },
  { n: 'Open the doors', sub: 'Stage 4 of 4', lv: [10, 13], c: '--st4' },
];

export const BY = {};
P.forEach((p) => { BY[p.id] = p; p.next = []; });
P.forEach((p) => { p.after.forEach((a) => { if (BY[a.id]) BY[a.id].next.push({ id: p.id }); }); });

/* ---------- schedule ---------- */
export let DAYS = 0;
export let SEQ = 0;
export let OPEN_DAY = 0;
(function cpm() {
  const order = [];
  const seen = {};
  function visit(p) {
    if (seen[p.id]) return;
    seen[p.id] = 1;
    p.after.forEach((a) => visit(BY[a.id]));
    order.push(p);
  }
  P.forEach(visit);
  order.forEach((p) => {
    p.es = p.after.length ? Math.max(...p.after.map((a) => BY[a.id].ef)) : 0;
    p.ef = p.es + p.sla;
    p.level = p.after.length ? Math.max(...p.after.map((a) => BY[a.id].level)) + 1 : 0;
  });
  DAYS = Math.max(...P.map((p) => p.ef));
  SEQ = P.reduce((s, p) => s + p.sla, 0);
  OPEN_DAY = BY['15'].ef; /* the doors open at Phase 15 */
  order.slice().reverse().forEach((p) => {
    p.lf = p.next.length ? Math.min(...p.next.map((n) => BY[n.id].ls)) : DAYS;
    p.ls = p.lf - p.sla;
    p.float = p.ls - p.es;
    p.critical = p.float <= 0;
  });
  /* the HR branch keeps the column of the phase it hangs off, so its arrow is
     a straight drop rather than a diagonal into the next column */
  P.forEach((p) => { if (p.isHr && p.after.length) p.level = BY[p.after[0].id].level; });
  P.forEach((p) => {
    for (let i = 0; i < STAGES.length; i += 1) {
      if (p.level >= STAGES[i].lv[0] && p.level <= STAGES[i].lv[1]) { p.stage = i; break; }
    }
  });
}());

/* today, in project days — everything below reads from it */
export const DAY_MS = 86400000;
export const TODAY_DAY = 94; /* day 34 of the 45-day build window */
export const T0 = Date.now() - TODAY_DAY * DAY_MS;

/* each instalment's due day comes from the plan, so if civil work moves the
   fit-out payment moves with it — nobody keeps a date in their head */
DEPOSIT.forEach((dp) => {
  const f = BY[dp.fire.id];
  dp.day = dp.fire.at === 'end' ? f.ef : f.es;
  dp.on = f;
  dp.paid = TODAY_DAY >= dp.day;
  DEP.total += dp.amt;
  if (dp.paid) { DEP.paid += dp.amt; DEP.paidN += 1; }
});
DEP.due = DEP.total - DEP.paid;
DEP.pct = Math.round((DEP.paid / DEP.total) * 100);

/* ============================================================================
   THE CHECKLIST ON EVERY PHASE
   Each phase is a count of real things, not an abstract percentage: 37 drawings,
   7 BOQs, 4 assessments, 14 department sign-offs. Where a real figure exists it
   is used; otherwise the count follows the phase's progress.
   ========================================================================== */
const CHECK = {
  1: { t: 12, u: 'properties captured' },
  2: { t: 4, u: 'assessments' },
  3: { t: 6, u: 'modules' }, /* LOI · lease · legal DD · deposit · NOCs · negotiation */
  4: { t: 5, u: 'decisions' }, /* games · opening date · milestones · testing window · budget */
  '4H': { t: 16, u: 'roles hired' }, /* 6 games × 2 shifts → 16 people */
  5: { t: 0, u: 'drawings' }, /* filled from the checklist below */
  6: { t: 7, u: 'vendor categories' },
  7: { t: 7, u: 'BOQs' },
  8: { t: 7, u: 'contracts' },
  9: { t: 0, u: 'order lines' }, /* filled from ORDER below */
  10: { t: 6, u: 'site activities' }, /* partition · flooring · ceiling · electrical · HVAC · painting */
  11: { t: 7, u: 'QC areas' },
  12: { t: 6, u: 'installations' }, /* one per game */
  13: { t: 6, u: 'trial runs' }, /* one per game */
  14: { t: 14, u: 'department sign-offs' },
  15: { t: 8, u: 'handover pack items' },
  16: { t: 4, u: 'closure reports' },
};
CHECK[5].t = DRAW.length;
CHECK[9].t = ORDER.lines;
/* the real counts, where the specs give one */
const CHECK_DONE = {
  '4H': 10,
  5: SET1_DONE + SET2_DONE,
  9: ORDER.received,
  10: 1, /* only partition walls is closed out */
};

/* ---------- where every phase actually stands ----------
   Status and percentage are DERIVED from today's day, so moving TODAY_DAY moves
   the whole board. Where real progress differs from elapsed time — the order
   book, the site tracks, hiring — the real figure wins. */
const PROGRESS = {
  '4H': { pct: Math.round((10 / 16) * 100), note: '10 of 16 roles hired' },
  9: { pct: 0, note: '' }, /* filled below from ORDER */
  10: { pct: SITE.pct, note: `civil ${SITE[0].pct}% · IT rough-in ${SITE[1].pct}%` },
};
PROGRESS[9] = { pct: ORDER.pctIn, note: `${ORDER.received} of ${ORDER.lines} lines received` };
P.forEach((p) => {
  const pr = PROGRESS[p.id];
  const elapsed = TODAY_DAY >= p.ef ? 100
    : (TODAY_DAY > p.es ? Math.round(((TODAY_DAY - p.es) / p.sla) * 100) : 0);
  p.pct = pr ? pr.pct : elapsed;
  p.status = p.pct >= 100 ? 'complete' : (TODAY_DAY > p.es ? 'processing' : 'pending');
  if (pr && pr.note) p.note = pr.note;

  const c = CHECK[p.id];
  if (c) {
    p.items = c.t;
    p.unit = c.u;
    p.done = CHECK_DONE[p.id] != null ? CHECK_DONE[p.id]
      : (p.status === 'complete' ? c.t
        : (p.status === 'pending' ? 0 : Math.round((c.t * p.pct) / 100)));
  }
});

/* how a checklist reads anywhere on the page */
export function checkTxt(p) {
  if (!p.items) return '';
  const left = p.items - p.done;
  if (!left) return `✓ all ${p.items} ${p.unit}`;
  if (!p.done) return `0 of ${p.items} ${p.unit}`;
  return `✓ ${p.done} of ${p.items} ${p.unit}`;
}

/* ---------- the clock ----------
   Today is day 44: Phase 5 is 14 days into its 20 (the Spec 01 board shows
   "6 days left of 20"), and Phase 6's 10-day window closed on day 40. */

function two(n) { return (n < 10 ? '0' : '') + n; }
export function fmtClock(ms) {
  const t = Math.floor(ms / 1000);
  const d = Math.floor(t / 86400);
  return `${d > 0 ? `${d}d ` : ''}${two(Math.floor((t % 86400) / 3600))}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}`;
}
/* a project day turned into a real date and a real time — so a stamp reads
   like a log entry, not like an arithmetic result. The hour is derived from
   the phase id, so it is the same on every render rather than random. */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function stampAt(p, day, slot) {
  /* slot 0 assigned · 1 started · 2 finished · 3 signed. The hour rises with
     the slot so that when two of them fall on the same day they still read in
     the order they happened — signed can never print before finished. */
  const h = 9 + slot * 2 + (parseInt(p.id, 10) % 2);
  const mi = (parseInt(p.id, 10) * 13 + slot * 17) % 60;
  const dt = new Date(T0 + day * DAY_MS);
  dt.setHours(h, mi, 0, 0);
  return `${dt.getDate()} ${MON[dt.getMonth()]} ${dt.getFullYear()}, ${two(h)}:${two(mi)}`;
}
export function clockOf(p) {
  const now = Date.now();
  const st = T0 + p.es * DAY_MS;
  const due = T0 + p.lf * DAY_MS;
  const win = Math.max(p.sla, p.lf - p.es) * DAY_MS;
  if (p.status === 'complete') {
    const ago = fmtClock(Math.max(0, now - (T0 + p.ef * DAY_MS)));
    return { t: `closed ${ago} ago`, s: `closed day ${p.ef}`, c: cssv('--ink-400'), k: 'done' };
  }
  if (now < st) { /* not open yet — count down to it */
    const w = fmtClock(st - now);
    return { t: `opens in ${w}`, s: `${w} to start`, c: cssv('--ink-500'), k: 'waiting' };
  }
  if (now >= due) {
    const o = `OVERDUE ${fmtClock(now - due)}`;
    return { t: o, s: o, c: cssv('--danger'), k: 'late' };
  }
  const left = due - now;
  const frac = left / win;
  const txt = `${fmtClock(left)} left`;
  return {
    t: txt,
    s: txt,
    k: frac < 0.2 ? 'risk' : 'running',
    c: frac < 0.2 ? cssv('--danger') : (frac < 0.4 ? cssv('--accent-600') : cssv(STAGES[p.stage].c)),
  };
}

/* ---------- geometry: middle spine, branches above and below ---------- */
const BRANCH_GAP = 126; /* extra air under a hanging branch */
export const R = 38;
export const RING = R + 9;
const COLW = 224;
const ROWH = 268;
const PADX = 70;
const PADY = 118;
export let LEVELS = 0;
export let ROWS = 0;
(function layout() {
  const cols = {};
  P.forEach((p) => { (cols[p.level] = cols[p.level] || []).push(p); });
  Object.keys(cols).forEach((k) => { ROWS = Math.max(ROWS, cols[k].length); });
  LEVELS = Object.keys(cols).length;
  /* Everything snaps to a lane. One phase alone sits on the middle line; two
     take the outer lanes; three fill all three. Nothing lands on a half-lane,
     so the diagram reads as three straight rows instead of a scatter. */
  const MID = (ROWS - 1) / 2;
  Object.keys(cols).forEach((k) => {
    const arr = cols[k];
    /* the main run keeps the middle line; a branch is pushed to the bottom lane
       so it reads as hanging off, not as part of the sequence */
    const main = arr.filter((x) => !x.isHr);
    const branch = arr.filter((x) => x.isHr);
    main.sort((a, b) => (a.critical ? 0 : 1) - (b.critical ? 0 : 1));
    main.forEach((p, i) => {
      const lane = main.length === 1 ? MID : (i * (ROWS - 1)) / (main.length - 1);
      p.cx = PADX + p.level * COLW;
      p.cy = PADY + R + lane * ROWH;
    });
    branch.forEach((p) => {
      p.cx = PADX + p.level * COLW;
      p.cy = PADY + R + (ROWS - 1) * ROWH + BRANCH_GAP; /* pushed clear of the lane above */
    });
  });
}());
export const W = PADX * 2 + (LEVELS - 1) * COLW + 200;
export const H = PADY + ROWS * ROWH - 6 + (P.some((p) => p.isHr) ? BRANCH_GAP : 0);
export const LAST_X = PADX + (LEVELS - 1) * COLW;
export const MID_Y = PADY + R + ((ROWS - 1) / 2) * ROWH;

/* ---------- small SVG helpers ---------- */
export function wrapN(s, max, lines) {
  const w = s.split(' ');
  let out = [];
  let cur = '';
  w.forEach((x) => {
    if (`${cur} ${x}`.trim().length <= max) cur = `${cur} ${x}`.trim();
    else { if (cur) out.push(cur); cur = x; }
  });
  if (cur) out.push(cur);
  if (out.length > lines) out = out.slice(0, lines - 1).concat(out.slice(lines - 1).join(' '));
  return out;
}
export function arc(cx, cy, r, frac) {
  if (frac <= 0) return '';
  let f = frac;
  if (f >= 1) f = 0.9999;
  const a = -Math.PI / 2;
  const b = a + f * Math.PI * 2;
  return `M${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`
    + ` A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)}`;
}

/* ---------- graph traversal, for the highlight ---------- */
function up(id, a = {}) {
  BY[id].after.forEach((x) => { if (!a[x.id]) { a[x.id] = 1; up(x.id, a); } });
  return a;
}
function down(id, a = {}) {
  BY[id].next.forEach((x) => { if (!a[x.id]) { a[x.id] = 1; down(x.id, a); } });
  return a;
}
export function chainOf(id) {
  const s = up(id);
  Object.assign(s, down(id));
  s[id] = 1;
  return s;
}
export function setOf(a) {
  const s = {};
  a.forEach((i) => { s[i] = 1; });
  return s;
}
