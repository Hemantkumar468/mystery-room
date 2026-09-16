import {
  DEPARTMENTS as D,
  PRIORITY as P,
  TEMPLATE_STATUS,
  MASTER_DATA_FIELD_TYPES as F,
} from '../core/constants/index.js';
import { DAILY_SITE_REPORT_TYPE, DAILY_SITE_REPORT_TASK } from './dailySiteReport.js';
import { storeLaunchTemplate, t, withOrder } from './storeLaunchTemplate.js';
/* The company masters the client flow is built on. Phases 5, 6, 7 and 9 all
   read from these rather than restating the lists, so the checklist a project
   works through and the checklist the specs describe cannot drift apart. */
import {
  DRAWING_CHECKLIST, DRAWING_SET_1, DRAWING_SET_2, DRAWING_STATUSES,
} from './drawingChecklist.js';
import {
  BOQ_TYPES, BOQ_MASTER, VENDOR_CATEGORIES, SOURCE_OF_SUPPLY_VALUES,
} from './boqMaster.js';

/**
 * The client-approved 16-phase Branch / Franchise Opening lifecycle.
 *
 * Baseline: docs/PMS_Functional_Flow_Document.docx + docs/PMS_Visual_Flowchart.pdf,
 * gap-analysed in docs/PMS_CLIENT_FLOW_GAP.md. Where this file and the client
 * document disagree, the document wins — it is the signed scope.
 *
 * ── Why a second template rather than editing the first ──────────────
 * storeLaunchTemplate.js stays exactly as it is and remains the default, so
 * every existing project and the current demo keep working while the eight new
 * phases are built out. A project picks this playbook explicitly. Once the new
 * phases are deep enough to demo end to end, `isDefault` moves here.
 *
 * ── Why the stage keys look out of order ─────────────────────────────
 * Display order comes from array position (withOrder stamps `order`); the `key`
 * is an identity, not a sequence. Six phases are REUSED from the 10-phase
 * template by key so their form schemas, assessment modules and gate logic
 * carry over untouched — notably `p1` (property capture), `p2` (the four
 * assessments), `p8` (readiness categories) and `p9`/`p10` (launch and
 * closure), which several server-side gates match on by name. Renumbering
 * those to p0–p15 would silently detach that logic, so the client's numbering
 * lives in `name` where users read it, and the keys stay stable.
 *
 * The eight new phases take fresh keys (`p11`–`p19`) precisely because nothing
 * matches on them yet.
 *
 * ── Deliberately dropped ─────────────────────────────────────────────
 *  - `p7` Approval Workflow — the client models approvals as three gates
 *    inside the flow (after Phases 2, 3 and 13), not as a phase of its own.
 *    See docs/PMS_CLIENT_FLOW_GAP.md §3.3.
 *  - `p5` Department Planning — has no counterpart in the client flow. Its
 *    departmental allocation function reappears inside Phase 7, which the
 *    document defines as explicitly parallel across IT / Marketing / HR.
 *  - `p14` Vendor Agreements ("Phase 6") — an agreement is an attribute of
 *    the VENDOR (upload the signed copy on their record in the vendor master),
 *    not a pipeline stage every project must stop at. Removed at the MD's
 *    direction; deviates from flow-doc §7 Phase 6, flagged for client sign-off.
 *  - `p4` Project Initiation ("Phase 0") — the New Project form IS the
 *    initiation: city, name, dates, budget and owner are captured there, and
 *    the template generates the whole plan on create. A phase that is complete
 *    the instant the project exists only added a dead row to every screen, so
 *    the flow now starts at Phase 1. Site-specific planning (games, milestone
 *    dates) lives in Phase 3B, where a signed property makes it answerable.
 */

/** The 10-phase template's stages, addressable by key for reuse below. */
const legacy = Object.fromEntries(storeLaunchTemplate.stages.map((s) => [s.key, s]));

/**
 * One What/Who/When/How row, transcribed verbatim from the client document's
 * per-phase table. Terse on purpose — this renders as a four-column strip on
 * every phase page, the MD's flow map and the doer's task view, so it has to
 * read at a glance to someone non-technical.
 */
const w = (what, who, when, how) => ({ what, who, when, how });

/**
 * One assignment: one person, one form, one deadline.
 *
 * THE unit of work in this template, and deliberately coarse. A task is what
 * lands in somebody's My Tasks and what they click to open a form — "Do the
 * feasibility assessment", not "tick that the catchment was checked". The
 * detail lives in that task's `checklist` and in the form it opens.
 *
 * Getting this wrong is expensive in a specific way: modelling each checklist
 * line as its own task turns a 40-item plan into a 200-item one, and a doer
 * facing 200 rows cannot see what they are actually meant to do today. Phases
 * therefore carry a handful of tasks each — one per person who owns a distinct
 * piece — never one per step.
 *
 * @param opts.who   Plain-language role, for the doer's own brief.
 * @param opts.when  Plain-language timeline ("2 days", "Every working day").
 * @param opts.how   What the person actually does — the method.
 * @param opts.form  assessmentTypes[].key this task opens, if the stage has several.
 * @param opts.list  Checklist labels; `opts.must` names the blocking ones.
 * @param opts.approvedBy  Plain-language name of who signs this off ("MD").
 * @param opts.approval    `false` = completing IS the end of it — for tasks
 *                         that are themselves a decision, an approval of the
 *                         approval is process for its own sake.
 */
const job = (key, title, department, days, priority, opts = {}) => ({
  ...t(key, title, department, days, priority, opts.list || [], opts.must || []),
  brief: {
    what: opts.what || title,
    who: opts.who,
    when: opts.when || `${days} day${days === 1 ? '' : 's'}`,
    how: opts.how,
  },
  formKey: opts.form,
  // Tasks whose work happens in another module (HRMS, the order tracker)
  // name their in-app destination; TaskBrief renders it as the open button.
  appPath: opts.appPath,
  openPhaseOnly: opts.openPhaseOnly,
  taskCategory: opts.category,
  approval: {
    required: opts.approval !== false,
    approver: opts.approvedBy,
  },
});

/** The two places the client's flow branches. Phases sharing a group start together. */
const GROUP = { DESIGN_VENDOR: 'design-vendor', BUILD_PROCURE: 'build-procure' };

/**
 * Reuse a phase from the 10-phase template under the client's wording.
 * Everything not overridden — masterDataSchema, assessmentTypes, tasks,
 * captureMode — carries over exactly, which is the whole point: the parts
 * already built to the client's satisfaction are not rewritten.
 */
const reuse = (key, overrides) => {
  const stage = legacy[key];
  if (!stage) throw new Error(`clientFlowTemplate: no stage "${key}" in storeLaunchTemplate`);
  return { ...stage, ...overrides };
};

/**
 * Turn a reused stage's one-task-per-checklist-item into one task per group.
 *
 * The 10-phase template models Store Readiness as 81 separate tasks and Store
 * Launch as 60 — one per item to be ticked. That is a checklist wearing a
 * task's clothes: it puts 141 rows into people's My Tasks for what is really
 * "each department confirms its own readiness". Here each group becomes ONE
 * task owned by that department, and the items it used to spawn become that
 * task's checklist — which is exactly how the client document describes it
 * ("Each department head gives a single digital approval once their section is
 * complete").
 *
 * Nothing is lost: every original item survives as a checklist line, and
 * `taskCategory` is preserved so the readiness dashboard still groups by it.
 */
const collapseByCategory = (stageKey, label) => {
  const source = legacy[stageKey];
  const groups = new Map();

  for (const task of source.tasks || []) {
    const cat = task.taskCategory || 'general';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(task);
  }

  return [...groups.entries()].map(([cat, items], i) => {
    const dept = items[0].department;
    const pretty = cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    // A group's required items stay required — they are what blocks the gate.
    const list = items.map((it) => it.title);
    const must = items.filter((it) => (it.checklist || []).some((c) => c.required)).map((it) => it.title);

    return job(`${stageKey}_g${i + 1}`, `${label}: ${pretty}`, dept, 3, items[0].priority, {
      who: `${pretty} department head`,
      when: 'Before launch',
      how: `Tick each item, attach evidence, then give one sign-off for ${pretty}.`,
      category: cat,
      list,
      must,
    });
  });
};

/** Attachment accept-list for site/engineering evidence. Shared by new phases. */
const EVIDENCE = '.jpg,.jpeg,.png,.heic,.webp,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.doc,.docx';
/**
 * What an architect or interior designer actually delivers. Deliberately broad:
 * CAD, BIM, 3D and graphic-design formats, plus flat exports for anyone who
 * just needs to look at it. The server accepts these by EXTENSION (browsers
 * report most as application/octet-stream) at up to 150 MB — see
 * core/middleware/upload.js#DESIGN_EXT.
 */
const DRAWING_FILES = [
  '.dwg', '.dxf', '.dwf', '.dgn', // 2D CAD
  '.rvt', '.rfa', '.ifc', '.skp', '.3ds', '.max', '.obj', '.fbx', '.dae', // BIM / 3D
  '.step', '.stp', '.iges', '.igs', '.stl', // engineering
  '.ai', '.psd', '.indd', '.eps', '.cdr', // graphic design
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.zip', '.rar', // exports & bundles
].join(',');

/* ══════════════════════════════════════════════════════════════════════
   New phases — client document §7, Phases 4 through 12.
   Each is `collection` mode: these are all many-rows-per-project concepts
   (drawings, vendors, BOQ lines, POs, QC items, dispatches, installations,
   test runs), which is exactly what collection mode already models for
   candidate properties in p1.
   ══════════════════════════════════════════════════════════════════════ */

/** Phase 4 — Design & Drawings (parallel stream A). Client doc §7 Phase 4. */
const designDrawings = {
  key: 'p11',
  name: 'Phase 5 — Design & Drawings',
  color: '#6366f1',
  /* 10 → 20 days. Thirty-seven drawings was never a ten-day job, and a target
     everybody knows is unmeetable stops being a target. PMS_UI_SPEC_00 §2. */
  slaDays: 20,
  ownerDepartment: D.PROJECTS,
  description:
    'A checklist of 37 fixed drawings in two sets, not a pile of uploads. The 29 in '
    + 'Set 1 are what quantities are extracted from, so the BOQ waits for them; the 8 in '
    + 'Set 2 are finishes and coordination and block nothing. The architect also puts up a '
    + 'spread of front design options first, to choose a look from. Every revision is kept, '
    + 'and only the latest approved one is live.',
  parallelGroup: GROUP.DESIGN_VENDOR,
  exitCriteria:
    'A front design direction chosen, and all 29 Set 1 drawings approved — which is what '
    + 'releases the BOQ. Set 2 may still be in progress.',
  whatWhoWhenHow: [
    w('Put up the initial front design options', 'Architect', 'Within 5 days', 'At least 20 options, uploaded together'),
    w('Choose the look to develop', 'MD / Operations Head', '2 days', 'Approve one option set'),
    w('Work down the Set 1 checklist (29 drawings)', 'Architect', 'Within 20 days', 'Drawing checklist board'),
    w('Review drawings', 'Project Manager / Operations', '2 days per round', 'Review screen with comments'),
    w('Revise as per comments', 'Architect', 'As required', 'New revision upload'),
    w('Approve final drawings', 'MD / Operations Head', 'On final round', 'Digital signature'),
    w('Set 2 (8 drawings) continues into execution', 'Architect', 'Alongside the build', 'Same checklist, blocks nothing'),
  ],
  captureMode: 'collection',
  recordNoun: 'Drawing',
  /* The register is shown as four named lists rather than one table where the
     difference hides in a column. See recordGroupSchema.

     The two SET lists are generated from the drawing master, so adding a
     drawing there puts it in the right set here with no second edit — and the
     29/8 split on screen is the same 29/8 the gate is computed from. Hand-
     typing 37 names into this file twice is exactly how the board and the gate
     would come to disagree.

     `working_drawings` is kept, and kept last, as the catch-all: it takes every
     entry filed before the checklist existed, whose free-text drawing name
     matches none of the 37. Removing it would hide that work rather than
     migrate it. */
  recordGroups: [
    {
      key: 'front_options',
      label: 'Initial front design options',
      hint: 'The spread the architect puts up first — at least 20 front designs in one entry — for the MD to pick a direction from.',
      addLabel: 'Add the design options',
      emptyHint: 'Nothing put up yet. The architect files all the front options here as a single entry.',
      field: 'drawing_type',
      values: ['Initial Design Options (Front)'],
      taskKey: 'p11_concepts',
      columns: ['drawing_name', 'option_count', 'chosen_option'],
    },
    {
      key: 'set_1',
      label: `Set 1 — the ${DRAWING_SET_1.length} drawings the BOQ waits for`,
      hint: 'Quantities are extracted from these. Every one must be approved before the BOQ can start — that is the only hard dependency between design and ordering.',
      addLabel: 'File a Set 1 drawing',
      emptyHint: 'None filed yet. All 29 are on the checklist from day one; filing one fills its row in.',
      field: 'checklist_drawing',
      values: DRAWING_SET_1.map((d) => d.name),
      taskKey: 'p11_draw',
      columns: ['checklist_drawing', 'checklist_status', 'revision_no'],
    },
    {
      key: 'set_2',
      label: `Set 2 — the ${DRAWING_SET_2.length} that block nothing`,
      hint: 'Wall finishes, the 3D reception and the four coordination sets. Needed for execution, not for counting quantities, so these never hold up the BOQ.',
      addLabel: 'File a Set 2 drawing',
      emptyHint: 'None filed yet. These run on into execution and hold nothing up.',
      field: 'checklist_drawing',
      values: DRAWING_SET_2.map((d) => d.name),
      taskKey: 'p11_draw2',
      columns: ['checklist_drawing', 'checklist_status', 'revision_no'],
    },
    {
      key: 'working_drawings',
      label: 'Earlier drawings',
      hint: 'Entries filed before the 37-drawing checklist existed, whose name matches none of it. Re-file them against a checklist row when you next touch them.',
      addLabel: 'Add a drawing',
      emptyHint: 'Nothing here — every drawing on this project is on the checklist.',
      field: 'checklist_drawing',
      excludeValues: DRAWING_CHECKLIST.map((d) => d.name),
      taskKey: 'p11_draw2',
      columns: ['drawing_name', 'drawing_type', 'revision_no'],
    },
  ],
  masterDataSchema: [
    /**
     * WHICH of the 37 this is — the checklist row's identity, and the field
     * the two Set lists are grouped by.
     *
     * It is a select over the master rather than free text because the whole
     * value of a checklist is knowing what is still MISSING, and you cannot
     * subtract what has been filed from what is required unless both sides
     * name the drawing identically. "Elec. layout" and "Electrical Layout
     * Plan" are the same drawing to a person and two different ones to a
     * count, and it is the count that releases the BOQ.
     *
     * Not required: the front design options are filed through this same form
     * and are not a checklist row at all. Leaving it empty is what puts an
     * entry in one of the other two lists.
     */
    {
      key: 'checklist_drawing', label: 'Which drawing is this?', type: F.SELECT,
      section: 'Drawing', order: -1,
      options: DRAWING_CHECKLIST.map((d) => d.name),
      helpText:
        'Pick the row from the 37-drawing checklist. The first 29 are Set 1 — the BOQ cannot '
        + 'start until every one of them is approved. Leave empty for front design options.',
    },
    /**
     * Only `Approved` counts towards the Set 1 gate. "Submitted for review"
     * means the architect has sent it, which is not the same as anybody having
     * checked it — and quantities must never be extracted from a drawing no
     * one has reviewed.
     */
    {
      key: 'checklist_status', label: 'Where has it got to?', type: F.SELECT,
      section: 'Drawing', order: -0.5,
      options: [...DRAWING_STATUSES],
      helpText: 'Only "Approved" counts towards releasing the BOQ.',
    },
    {
      key: 'drawing_name', label: 'Drawing Name', type: F.TEXT, required: true,
      section: 'Drawing', order: 0,
    },
    {
      key: 'drawing_type', label: 'Drawing Type', type: F.SELECT, required: true,
      section: 'Drawing', order: 1,
      // The standard ~10-drawing set the template pre-loads (client doc §7 Ph4).
      options: [
        // First in the list because it is what happens first: the look is
        // chosen from a spread of front options before anything is drawn up.
        'Initial Design Options (Front)',
        'Layout Plan', 'Game Zoning', 'Electrical', 'Plumbing', 'HVAC',
        'False Ceiling', 'Flooring', 'Furniture', 'Signage', 'Fire Line', 'Other',
      ],
    },
    /* Only asked when the entry IS a set of front options — a working layout
       has no "how many options" to answer, and a form that asks anyway trains
       people to ignore it. */
    {
      key: 'option_count', label: 'How many front options are in this set?', type: F.NUMBER,
      section: 'Drawing', order: 1.5,
      showIf: { field: 'drawing_type', in: ['Initial Design Options (Front)'] },
      helpText: 'The brief is at least 20 so there is a real spread to choose from. Upload them all in the file field below.',
    },
    {
      key: 'chosen_option', label: 'Which option was chosen?', type: F.TEXT,
      section: 'Drawing', order: 1.6,
      showIf: { field: 'drawing_type', in: ['Initial Design Options (Front)'] },
      // The reviewer's verdict, not the designer's — so it never appears on an
      // outsourced architect's own brief. See internalOnly.
      internalOnly: true,
      helpText: 'Filled in after the review — name or number the option that was picked to develop.',
    },
    {
      key: 'revision_no', label: 'Revision Number', type: F.NUMBER, required: true,
      section: 'Drawing', order: 2,
      helpText: 'Start at 1. Increase it each time you upload a new round — earlier ones stay available.',
    },
    {
      key: 'drawing_file', label: 'Upload the Drawing', type: F.FILE, required: true, multiple: true,
      accept: DRAWING_FILES, section: 'Drawing', order: 3,
      helpText: 'CAD, BIM, 3D or design files up to 150 MB each — DWG, DXF, RVT, SKP, AI, PSD, PDF and more. Add as many as you need.',
    },
    {
      key: 'remarks', label: 'Notes for the reviewer', type: F.TEXTAREA,
      section: 'Drawing', order: 4,
      helpText: 'Anything the reviewer should know — assumptions made, what changed since the last revision, open questions.',
    },
  ],
  tasks: [
    /* The look comes first. The client's flow asks the architect to put up a
       spread of front designs — at least twenty — so a direction is chosen
       before anyone spends ten days on working drawings for it. It runs
       alongside the drawing task rather than blocking it, because the site
       measurements and zoning work start immediately either way. */
    job('p11_concepts', 'Put up the initial front design options', D.PROJECTS, 5, P.HIGH, {
      approval: false, // the option set is approved as a record, like a drawing
      who: 'Architect / Design Team', when: 'Within 5 days',
      /* Says nothing about picking a drawing type: filing from this list sets
         that itself, and an instruction to do a step the system already did
         is an instruction that sends people looking for a missing field. It
         is also read verbatim by outside designers on their brief page, where
         a reference to an internal form field means nothing at all. */
      how: 'Produce at least 20 front / façade design options for this site and upload them '
        + 'all as ONE entry, with the number of options recorded on it. '
        + 'The MD or Operations Head picks the direction from that spread.',
      list: [
        'Site frontage, dimensions and approach photographed',
        'At least 20 front design options produced',
        'All options uploaded as one entry',
        'Option count recorded on the entry',
        'Direction chosen and noted on the entry',
      ],
      must: ['At least 20 front design options produced', 'All options uploaded as one entry'],
    }),
    /* The task checklists below ARE the client's own Drawing Checklist sheet
       (SHEET/Drawing Checklist.xlsx), phase column and all — generated from
       the same DRAWING_SET_1/2 master the record groups and the BOQ gate read,
       so the board, the gate and the doer's tick-list can never disagree.
       Items are ticked as each drawing is filed; none is a completion blocker
       because the REAL gate is the record approvals (Set 1 releases the BOQ). */
    job('p11_draw', `Create the Phase 1 drawings — the initial set (${DRAWING_SET_1.length})`, D.PROJECTS, 10, P.HIGH, {
      approval: false, // each uploaded drawing is approved as a record
      who: 'Architect / Interior Designer', when: 'Within 10 days',
      how: 'Work down the Phase 1 checklist — the client\'s own drawing sheet: architectural, '
        + 'electrical, electronic, automation, fire, HVAC and plumbing. Upload each drawing as '
        + 'its own entry against its checklist row, and tick the row off here. A new round is a '
        + 'new revision upload — nothing is overwritten. The BOQ waits for every one of these.',
      list: DRAWING_SET_1.map((d) => `${d.category} — ${d.name}`),
    }),
    job('p11_draw2', `Complete the Phase 2 drawings — finishes & coordination (${DRAWING_SET_2.length})`, D.PROJECTS, 15, P.MEDIUM, {
      approval: false, // each uploaded drawing is approved as a record
      who: 'Architect / Interior Designer', when: 'Alongside the build',
      how: 'The Phase 2 half of the same sheet: wall panelling and finishes, the reception 3D '
        + 'and working drawing, and the four coordination sets. These run on into execution and '
        + 'block nothing — file each one against its checklist row and tick it off here.',
      list: DRAWING_SET_2.map((d) => `${d.category} — ${d.name}`),
    }),
    // (No separate approve-the-drawings task: each drawing is approved or
    // sent back as a record from the Approvals queue, revision by revision.)
  ],
};

/** Phase 4B — Vendor Identification & Finalisation (parallel stream B). §7 Phase 4B. */
const vendorIdentification = {
  key: 'p12',
  /**
   * Renamed, and the job inverted with it — fix F-3 of PMS_UI_SPEC_00 §1.
   *
   * "Vendor Identification" described a quotation hunt, as if every branch
   * started from zero and went looking for suppliers. It does not. There is a
   * standing panel of four or five teams who already know this work and have
   * built these rooms before. Per site the questions are only: which team, at
   * what rate, and who is the local general contractor.
   *
   * Comparison is not removed — it stays as the option for a NEW category or a
   * new city, where there genuinely is no panel yet. It is just no longer the
   * default path that every branch is walked down.
   */
  name: 'Phase 6 — Vendor & Contractor Panel',
  color: '#0ea5e9',
  slaDays: 10,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Runs alongside drawings. Opens with the standing panel loaded — the teams who already '
    + 'know this work — and asks only which team is doing this site, at what rate, and who '
    + 'the local general contractor is. Seven categories to confirm, one rate card each. '
    + 'Quotation comparison stays available for a new category or a new city.',
  parallelGroup: GROUP.DESIGN_VENDOR,
  exitCriteria:
    'A team confirmed and a rate agreed for each of the seven categories. Those rate cards '
    + 'are what price the BOQ — a category left unconfirmed produces a BOQ with no rates.',
  whatWhoWhenHow: [
    w('Open the standing panel for each category', 'Procurement', 'Day 1', 'Panel loaded, 4–5 teams per category'),
    w('Confirm the team for this site', 'Procurement / Project Manager', 'Within 10 days', 'Pick from panel'),
    w('Agree the rate card', 'Procurement / MD', 'Within 10 days', 'Rate confirmation'),
    w('Appoint the local general contractor', 'Project Manager', 'Within 10 days', 'Vendor form'),
    w('Compare quotations (new category or city only)', 'Procurement', 'As required', 'Quotation comparison'),
  ],
  captureMode: 'collection',
  recordNoun: 'Vendor',
  /**
   * THE RATE CARD — the thing Phase 6 actually produces for Phase 7.
   *
   * A rate card is a repeating table (item, unit, standard rate, this site's
   * rate, why it differs), and `masterDataSchema` has no repeatable group: its
   * field types are all scalars. Rather than add one — or invent a RateCard
   * collection and re-implement audit, permissions and history around it — a
   * rate line is a nested form under this same phase, exactly as Site
   * Evaluation's four assessments are nested under p2. Each line is a Record
   * with `assessmentType: 'rate_line'` and `parentRecordId` pointing at the
   * vendor it belongs to, so it inherits the changeLog and the activity trail
   * for free.
   *
   * `noDecision` because a rate LINE is not approved on its own — it is filed
   * and read. What gets confirmed is the CARD, once, on the vendor record
   * (`rate_confirmed`), and that single tick is what releases the BOQ to be
   * priced. Sending 40 individual rate lines through the approvals queue would
   * bury the decisions that matter under a pile of arithmetic.
   */
  assessmentTypes: [
    {
      key: 'rate_line',
      name: 'Rate card line',
      subtitle: 'One row of this vendor’s agreed rates for this site.',
      noDecision: true,
      masterDataSchema: [
        { key: 'item', label: 'Item', type: F.TEXT, required: true, section: 'Rate', order: 0 },
        {
          key: 'unit', label: 'Unit', type: F.SELECT, section: 'Rate', order: 1,
          options: ['sq ft', 'running ft', 'nos', 'set', 'lot', 'kg', 'litre', 'day'],
        },
        {
          key: 'standard_rate', label: 'Standard rate', type: F.CURRENCY, section: 'Rate', order: 2,
          helpText: 'The panel rate this vendor normally charges. Shown for comparison; it is not what this site pays.',
        },
        {
          key: 'site_rate', label: 'Rate for this site', type: F.CURRENCY, required: true,
          section: 'Rate', order: 3,
          helpText: 'What this branch is charged. Leave equal to the standard rate unless something was negotiated.',
        },
        {
          key: 'override_reason', label: 'Why it differs', type: F.TEXTAREA, section: 'Rate', order: 4,
          helpText: 'Required whenever this site’s rate is not the standard one. A rate nobody can explain is a rate nobody can defend at closure.',
        },
        { key: 'valid_till', label: 'Valid till', type: F.DATE, section: 'Rate', order: 5 },
      ],
    },
  ],
  masterDataSchema: [
    { key: 'vendor_name', label: 'Vendor Name', type: F.TEXT, required: true, section: 'Vendor', order: 0 },
    /**
     * The panel category — which of the BOQ-facing categories this team is
     * confirmed for. This is the field that ties Phase 6 to Phase 7: each of
     * the seven BOQs names the category that prices it, so a category with no
     * confirmed team produces a BOQ with no rates, and the BOQ workspace can
     * say which one by name instead of showing an empty total.
     *
     * Six options for seven BOQs, deliberately: "All games furniture" and
     * "Common area furniture" are bought from the SAME panel category. That is
     * why a BOQ is not the same thing as a category and neither can be derived
     * from the other.
     *
     * Separate from `category` below, which is the TRADE (civil, electrical…)
     * and stays as it is — every existing vendor record carries one, and
     * replacing the list in place would orphan all of them.
     */
    {
      key: 'panel_category', label: 'Panel category', type: F.SELECT,
      section: 'Vendor', order: 0.5,
      options: [...VENDOR_CATEGORIES],
      helpText: 'Which BOQ-facing category this team is confirmed for on this site. Leave empty for a one-off trade vendor.',
    },
    {
      key: 'category', label: 'Trade', type: F.SELECT, required: true, section: 'Vendor', order: 1,
      options: [
        'Civil', 'Furniture', 'Electrical', 'Signage', 'Windows', 'Painting',
        'HVAC', 'Fire', 'IT & Networking', 'AV', 'Game Props', 'Flooring', 'Housekeeping',
      ],
    },
    { key: 'contact_person', label: 'Contact Person', type: F.TEXT, section: 'Vendor', order: 2 },
    { key: 'contact_phone', label: 'Contact Number', type: F.TEXT, section: 'Vendor', order: 3 },
    // The PO page emails the vendor at this address — without it the compose
    // dialog's To field could never prefill.
    { key: 'email', label: 'Email', type: F.TEXT, section: 'Vendor', order: 3.5 },
    { key: 'address', label: 'Address', type: F.TEXTAREA, section: 'Vendor', order: 4 },
    { key: 'gst', label: 'GST Number', type: F.TEXT, section: 'Statutory', order: 5 },
    { key: 'pan', label: 'PAN', type: F.TEXT, section: 'Statutory', order: 6 },
    { key: 'bank_details', label: 'Bank Details', type: F.TEXTAREA, section: 'Statutory', order: 7 },
    /* What this vendor is actually doing HERE, and which task it is. Both are
       per-engagement, not per-firm: the same electrician wires one store and
       fits out another. Without them the vendor page can say who was engaged
       but not what for, which is the question anyone opening it is asking. */
    {
      key: 'work_scope', label: 'Work to be done', type: F.TEXTAREA,
      section: 'Work on this project', order: 7.5,
      helpText: 'The scope this vendor is engaged for, e.g. "Wiring, DB and lighting".',
    },
    {
      key: 'linked_task_code', label: 'Linked Task Code', type: F.TEXT,
      section: 'Work on this project', order: 7.6,
      helpText: 'The execution task this work sits under, e.g. MR-BPL-001-T019.',
    },
    /**
     * The three questions Phase 6 actually asks per site (fix F-3). They sit
     * ahead of the quotation fields because on a normal branch they are the
     * ONLY ones filled in — the quotation block below is for a new category or
     * a new city, where there is no panel yet.
     */
    {
      key: 'on_panel', label: 'Already on the standing panel?', type: F.BOOLEAN,
      section: 'Panel', order: 7.7,
      helpText: 'Yes for one of the 4–5 teams who already know this work. No means this is a new team and needs the comparison below.',
    },
    {
      key: 'rate_confirmed', label: 'Rate confirmed for this site?', type: F.BOOLEAN,
      section: 'Panel', order: 7.8,
      helpText: 'The BOQ prices itself from confirmed rate cards. Until this is ticked, this category contributes no rates.',
    },
    {
      key: 'rate_card', label: 'The agreed rate card', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Panel', order: 7.85,
      helpText: 'The signed or emailed rate sheet this site is being charged against.',
    },
    {
      key: 'is_local_gc', label: 'Is this the local general contractor?', type: F.BOOLEAN,
      section: 'Panel', order: 7.9,
      helpText: 'Exactly one vendor per project should be marked here — the local team running the site build.',
    },
    { key: 'quoted_amount', label: 'Quoted Amount', type: F.CURRENCY, section: 'Commercials', order: 8 },
    { key: 'negotiated_amount', label: 'Negotiated Amount', type: F.CURRENCY, section: 'Commercials', order: 9 },
    { key: 'payment_terms', label: 'Payment Terms', type: F.TEXT, section: 'Commercials', order: 10 },
    { key: 'credit_period_days', label: 'Credit Period (days)', type: F.NUMBER, section: 'Commercials', order: 11 },
    {
      key: 'past_performance', label: 'Past Performance Notes', type: F.TEXTAREA,
      section: 'Performance', order: 12,
      helpText: 'Delivery delays, quality issues and rework on previous projects.',
    },
    {
      key: 'rating', label: 'Rating (out of 10)', type: F.NUMBER, section: 'Performance', order: 13,
    },
    {
      key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Decision', order: 14,
      options: ['Identified', 'Quotation Received', 'Under Comparison', 'Finalised', 'Rejected', 'Blacklisted'],
    },
    {
      key: 'documents', label: 'Documents & Quotation', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Decision', order: 15,
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 16 },
  ],
  tasks: [
    job('p12_finalise', 'Finalise the vendors for this project', D.PROCUREMENT, 10, P.HIGH, {
      approval: false, // this task IS the decision
      who: 'Project Manager', when: 'Within 10 days',
      how: 'Work down the pre-loaded category checklist. Add each vendor on the vendor form, upload their quotation, compare, and mark one Finalised per category.',
      list: [
        'All categories covered', 'At least 3 quotations per category',
        'Quotations uploaded', 'One vendor finalised per category',
        'High-value categories sent to MD',
      ],
      must: ['All categories covered', 'One vendor finalised per category'],
    }),
  ],
};

/** Phase 5 — Project Planning Output: BOQ, Budget & Gantt. §7 Phase 5. */
const planningOutput = {
  key: 'p13',
  name: 'Phase 7 — BOQ & Budget',
  color: '#f59e0b',
  /* 2 → 5 days. Seven BOQs means seven approvals by seven different owners,
     which was never a two-day job. PMS_UI_SPEC_00 §2. */
  slaDays: 5,
  ownerDepartment: D.PROJECTS,
  description:
    'The only convergence point in the flow: quantities come from the approved Set 1 '
    + 'drawings, rates come from the confirmed vendor panel, and neither alone produces a '
    + 'BOQ. Seven separate BOQs, each with its own lines, total, vendor and approval — not '
    + 'one flat list. The approved plan is frozen as the baseline so later slippage is measurable.',
  exitCriteria:
    'All seven BOQs approved, each by its own owner, and the baseline frozen. Every line '
    + 'carries a source of supply, because only "outside procurement" ever becomes a vendor PO.',
  whatWhoWhenHow: [
    w('Extract quantities from the approved Set 1 drawings', 'Project Manager', 'Within 2 days', 'BOQ builder (item, qty, unit, rate)'),
    w('Price each line from the confirmed rate cards', 'Project Manager', 'Within 2 days', 'Rate cards from the vendor panel'),
    w('File every line under one of the seven BOQs', 'Project Manager', 'As lines are built', 'BOQ workspace'),
    w('Mark each line stock, production or procurement', 'Procurement', 'Before ordering', 'Source of supply on the line'),
    w('Approve each BOQ on its own', 'MD / BOQ owner', '5 days', 'Seven separate approvals'),
    w('Freeze the baseline', 'Project Manager / System', 'On approval', 'Baseline snapshot'),
  ],
  captureMode: 'collection',
  recordNoun: 'BOQ Item',
  /**
   * Seven named lists, one per BOQ — fix F-2 of PMS_UI_SPEC_00 §1.
   *
   * Generated from BOQ_MASTER so the seven here, the seven the workspace
   * totals, and the seven the vendor categories map onto are the same seven.
   *
   * The catch-all is last and is NOT optional: four BOQ lines in this database
   * were approved before `boq_type` existed, and a line no group claims would
   * vanish from the page. "Not assigned to a BOQ" shows them and says what is
   * wrong with them, which is the only way they ever get filed.
   */
  recordGroups: [
    ...BOQ_MASTER.map((b) => ({
      key: `boq_${b.no}`,
      label: b.name,
      hint: `${b.covers}. Priced from the ${b.vendorCategory} rate card; ${b.supply.toLowerCase()}.`,
      addLabel: 'Add a line',
      emptyHint: `No lines yet. Quantities come off the Set 1 drawings, rates from the ${b.vendorCategory} rate card.`,
      field: 'boq_type',
      values: [b.name],
      taskKey: 'p13_t1',
      columns: ['item', 'quantity', 'amount'],
    })),
    {
      key: 'boq_unassigned',
      label: 'Not assigned to a BOQ',
      hint: 'Lines filed before the seven BOQs existed. Each one belongs to exactly one of them — set it and the line moves itself.',
      addLabel: 'Add a line',
      emptyHint: 'Nothing unfiled — every line on this project belongs to a BOQ.',
      field: 'boq_type',
      excludeValues: [...BOQ_TYPES],
      taskKey: 'p13_t1',
      columns: ['item', 'category', 'amount'],
    },
  ],
  masterDataSchema: [
    /**
     * WHICH of the seven BOQs this line belongs to — fix F-2.
     *
     * WHY A FIELD OF ITS OWN. The seven BOQs are DOCUMENTS. One BOQ carries
     * lines of many trades, and two of them ("All games furniture" and "Common
     * area furniture") are the same trade — so `category` cannot stand in for
     * it, and deriving one from the other would merge two BOQs that must stay
     * apart.
     *
     * WHY IT IS A TRACKER FIELD. Content fields freeze once a record is
     * approved — that is what approval means. Lines approved before this field
     * existed still need filing under a BOQ, so it has to stay writable
     * afterwards. `tracker: true` is exactly that permission, and every write
     * lands in the record's own changeLog with the name of whoever made it.
     */
    {
      key: 'boq_type', label: 'BOQ', type: F.SELECT, section: 'BOQ Line', order: -1,
      options: [...BOQ_TYPES],
      tracker: true,
      helpText: 'Which BOQ this line belongs to. Lines of one BOQ are planned, approved and ordered together.',
    },
    /**
     * Where it comes from — fix F-5, and the addition the client's flow
     * demands. A BOQ line is not automatically an order: much of what a branch
     * needs already sits in Delhi, and raising a purchase order for stock the
     * company is holding is how you buy the same thing twice.
     *
     * Only "Outside procurement" ever becomes a vendor PO, and then only
     * against a signed contract (Phase 8).
     */
    {
      key: 'source_of_supply', label: 'Source of supply', type: F.SELECT,
      section: 'BOQ Line', order: -0.5,
      options: [...SOURCE_OF_SUPPLY_VALUES],
      tracker: true,
      helpText:
        'Delhi stock is earmarked and never becomes a PO. Delhi production enters the 20–25 day '
        + 'queue. Only outside procurement raises a vendor purchase order.',
    },
    {
      key: 'item', label: 'Item', type: F.TEXT, required: true, section: 'BOQ Line', order: 0,
      // "+ Add more" under the field: an order for furniture is sofa AND
      // chair AND table — the items listed here stay ONE line, one vendor,
      // one PO, one GRN. The full list is stored beside it as item_list.
      multiAdd: true,
      helpText: 'Ordering several things together? Add each item — they travel as one order.',
    },
    {
      key: 'description', label: 'Description', type: F.TEXTAREA, aiAssist: true,
      section: 'BOQ Line', order: 1,
      helpText: 'What exactly is being ordered — specification, size, finish. AI can draft it from the item name.',
    },
    {
      key: 'category', label: 'Category', type: F.SELECT, required: true, section: 'BOQ Line', order: 2,
      options: [
        'Civil', 'Furniture', 'Electrical', 'Signage', 'Painting', 'HVAC', 'Fire',
        'IT & Networking', 'AV', 'Game Props', 'Flooring', 'Contingency', 'Other',
      ],
    },
    {
      key: 'unit', label: 'Unit', type: F.SELECT, section: 'BOQ Line', order: 3,
      options: ['sq ft', 'running ft', 'nos', 'set', 'lot', 'kg', 'litre', 'day'],
    },
    { key: 'quantity', label: 'Quantity', type: F.NUMBER, required: true, section: 'BOQ Line', order: 4 },
    {
      key: 'rate', label: 'Rate', type: F.CURRENCY, required: true, section: 'BOQ Line', order: 5,
      helpText: 'Defaults from the rate master where one exists; override if the negotiated rate differs.',
    },
    {
      key: 'amount', label: 'Amount', type: F.CURRENCY, section: 'BOQ Line', order: 6,
      // Filled automatically from Quantity × Rate, and still editable — a
      // negotiated lump sum often differs from the arithmetic. Typing over it
      // holds until Quantity or Rate changes again. See RecordFormModal's
      // setValue, which owns this the same way it owns countOf.
      productOf: ['quantity', 'rate'],
      helpText: 'Quantity × Rate — filled in for you, override it if the agreed amount differs.',
    },
    {
      /* TRACKER, deliberately — the vendor is NOT part of building the BOQ.
         Step 1 of the purchase flow lists what to buy; CHOOSING who to buy it
         from is step 2, done on the Purchase Orders sheet's "Choose the
         vendor" action after the line exists. Asking for a vendor on the BOQ
         form made step 2 meaningless and forced a guess before rates were
         compared. Tracker fields are hidden from the BOQ form and stay
         writable after approval, which is exactly this decision's shape. */
      key: 'vendor', label: 'Vendor', type: F.SELECT, section: 'Order tracking', order: 19, tracker: true,
      // Picked from the Phase 4B vendor master, never typed: the purchase-order
      // page fetches the vendor's phone/email/address by this exact name.
      // `scope: 'global'` — every vendor in the business, not just the ones
      // recorded against THIS project. A supplier finalised on one launch is
      // the same supplier on the next, which is what the Vendors master page
      // shows; scoping this per-project left the dropdown empty on every
      // project except the one where the vendor happened to be entered.
      optionsFromStage: { stageKey: 'p12', field: 'vendor_name', scope: 'global' },
      /* The dropdown merges TWO lists — the p12 records this `optionsFromStage`
         names, and the standing supply master under Master Data → Vendors. See
         StageOptionsSelect in DynamicField.jsx for why. */
      helpText: 'From the vendor master (Master Data → Vendors, plus any vendor confirmed on a project’s Phase 6 panel). Add a vendor there and it appears here.',
    },
    { key: 'planned_start', label: 'Planned Start', type: F.DATE, section: 'Schedule', order: 8 },
    { key: 'planned_end', label: 'Planned End', type: F.DATE, section: 'Schedule', order: 9 },
    {
      key: 'depends_on', label: 'Depends On', type: F.TEXT, section: 'Schedule', order: 10,
      helpText: 'Comma-separated items that must finish first — drives the critical path.',
    },
    {
      key: 'is_milestone', label: 'Is a Milestone', type: F.BOOLEAN, section: 'Schedule', order: 11,
      helpText: 'Milestones: property finalised, LOI signed, drawings approved, procurement complete, civil complete, installation complete, trial run complete, launch.',
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 12 },

    /* ── Order tracking (Phase 6) ─────────────────────────────────────────
       Every BOQ line IS a purchase order, so the order's whole life after
       approval is tracked on the same line — never re-entered as a separate
       "indent" in Phase 6. These fields are `tracker: true`: hidden from the
       Phase 5 form, written only by the Phase 6 tracker through
       PATCH /records/:id/tracking (allowed on approved lines), every change
       stamped with who and when in Record.changeLog. */
    {
      key: 'po_number', label: 'PO Number', type: F.TEXT, section: 'Order tracking', order: 20, tracker: true,
      helpText: 'Filled in automatically the first time the order is sent (PO-001, PO-002…). Change it if your PO book uses different numbers.',
    },
    { key: 'indent_number', label: 'Indent Number', type: F.TEXT, section: 'Order tracking', order: 21, tracker: true },
    {
      key: 'order_status', label: 'Order Status', type: F.SELECT, section: 'Order tracking', order: 22, tracker: true,
      // One plain vocabulary, in the order things happen. "Partly Received" is
      // set for you when received quantity < ordered quantity.
      options: ['Ordered', 'Dispatched', 'In Transit', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged', 'Cancelled'],
      helpText: 'Ordered is the default once the PO is sent. Change it as the vendor reports.',
    },
    { key: 'promised_delivery', label: 'Vendor promised delivery', type: F.DATE, section: 'Order tracking', order: 23, tracker: true },
    { key: 'sent_whatsapp_at', label: 'WhatsApp sent at', type: F.TEXT, section: 'Order tracking', order: 24, tracker: true },
    { key: 'sent_whatsapp_to', label: 'WhatsApp sent to', type: F.TEXT, section: 'Order tracking', order: 25, tracker: true },
    /* The OUTCOME of the send, beside its timestamp — a stamp alone said
       "sent" about attempts that never left, while no channel was connected. */
    { key: 'sent_whatsapp_status', label: 'WhatsApp send result', type: F.SELECT, options: ['sent', 'failed'], section: 'Order tracking', order: 25.5, tracker: true },
    { key: 'sent_email_at', label: 'Email sent at', type: F.TEXT, section: 'Order tracking', order: 26, tracker: true },
    { key: 'sent_email_to', label: 'Email sent to', type: F.TEXT, section: 'Order tracking', order: 27, tracker: true },
    { key: 'sent_email_status', label: 'Email send result', type: F.SELECT, options: ['sent', 'failed'], section: 'Order tracking', order: 27.5, tracker: true },
    { key: 'dispatch_date', label: 'Dispatched on', type: F.DATE, section: 'Order tracking', order: 28, tracker: true },
    { key: 'transporter', label: 'Transporter', type: F.TEXT, section: 'Order tracking', order: 29, tracker: true },
    { key: 'lr_docket', label: 'LR / Docket No.', type: F.TEXT, section: 'Order tracking', order: 30, tracker: true },
    { key: 'delivery_challan_no', label: 'Delivery Challan No.', type: F.TEXT, section: 'Order tracking', order: 31, tracker: true },
    { key: 'received_date', label: 'Received on', type: F.DATE, section: 'Order tracking', order: 32, tracker: true },
    { key: 'received_quantity', label: 'Quantity received', type: F.NUMBER, section: 'Order tracking', order: 33, tracker: true },
    {
      key: 'pending_quantity', label: 'Quantity still pending', type: F.NUMBER, section: 'Order tracking', order: 34, tracker: true,
      helpText: 'Ordered minus received — worked out for you on the tracker.',
    },
    { key: 'grn_number', label: 'GRN Number', type: F.TEXT, section: 'Order tracking', order: 35, tracker: true },
    { key: 'shortage_note', label: 'Short / damaged — details', type: F.TEXTAREA, section: 'Order tracking', order: 36, tracker: true },
    { key: 'tracking_remarks', label: 'Tracking remarks', type: F.TEXTAREA, section: 'Order tracking', order: 37, tracker: true },
    /* GRN proper: who signed for it, the photographic proof, and the
       invoice raised from what was ACTUALLY received. All tracker fields —
       the approved line stays frozen; the receipt story lives around it. */
    { key: 'received_by', label: 'Received by', type: F.TEXT, section: 'Order tracking', order: 38, tracker: true },
    { key: 'receipt_photos', label: 'Receipt photos / documents', type: F.FILE, multiple: true, section: 'Order tracking', order: 39, tracker: true },
    { key: 'invoice_number', label: 'Invoice Number', type: F.TEXT, section: 'Order tracking', order: 40, tracker: true },
    { key: 'invoice_date', label: 'Invoice Date', type: F.DATE, section: 'Order tracking', order: 41, tracker: true },
    { key: 'sent_invoice_at', label: 'Invoice sent at', type: F.TEXT, section: 'Order tracking', order: 42, tracker: true },
    { key: 'sent_invoice_to', label: 'Invoice sent to', type: F.TEXT, section: 'Order tracking', order: 43, tracker: true },
  ],
  tasks: [
    // ONE task: build the list. The budget is the sum of the lines (the page
    // totals it), the Gantt already exists from the template, and every line
    // is approved by the MD as a record — so "derive budget", "build Gantt"
    // and "approve" were three tasks for work nobody actually does by hand.
    job('p13_t1', 'Build the BOQ — one line per thing to buy', D.PROJECTS, 3, P.CRITICAL, {
      approval: false, // every BOQ line is approved as a record by the MD
      openPhaseOnly: true,
      who: 'Project Manager', when: 'Within 3 days of drawings being approved',
      how: 'Open the BOQ list and add one line per item — item, quantity, rate, vendor. Each line goes to the MD for approval and then becomes a purchase order you can print and send. The budget totals itself from the lines, and the timeline is already on the Gantt — there is nothing else to prepare here.',
      list: ['Every drawing costed', 'Quantities cross-checked against drawing areas', 'Vendor set on each line'],
      must: ['Every drawing costed', 'Vendor set on each line'],
    }),
  ],
};

/**
 * Phase 6 — Purchase Orders & Delivery Tracking (parallel with civil works).
 * §7 Phase 7 of the client document, re-shaped after the Phase 5/6 review:
 *
 * Phase 5 produces the BOQ as a LIST OF ORDERS — one line per thing to buy,
 * each line printable and sendable as a purchase order. Phase 6 does not ask
 * anyone to re-enter those orders as "indents": it is a TRACKER over the same
 * Phase 5 lines. Each line carries its own tracking fields (PO / indent
 * number, when and how it was sent, vendor status, dispatch, challan, what was
 * received and the GRN) — the `tracker: true` fields on the Phase 5 schema.
 * The tracker page (client: ProcurementTrackerPage, /projects/:id/procurement)
 * IS this phase; it has no form of its own.
 *
 * Partial deliveries are first-class: ordered 100, received 80 → pending 20,
 * status "Partly Received" — the row stays open until the rest arrives. Every
 * change is stamped with who and when (Record.changeLog), so "who marked this
 * dispatched?" is always answerable.
 */
/**
 * Phase 8 — Contracts & Work Orders. NEW: fix F-4 of PMS_UI_SPEC_00 §1.
 *
 * ── The step that had no home ────────────────────────────────────────
 * This phase did not exist anywhere in the system. Rates were captured in
 * Phase 6 and quantities in Phase 7, and then a purchase order was raised —
 * but the agreement in between, the one both sides actually sign, lived in
 * somebody's drawer. The completion date on it is the promise the vendor made,
 * and it was the single most important date on the project that the PMS did
 * not hold.
 *
 * ── What it adds that the BOQ does not ───────────────────────────────
 * The BOQ says WHAT and HOW MUCH. The contract says WHO, FOR HOW MUCH MONEY,
 * BY WHAT DATE — plus penalties and retention, which are the only things that
 * make the date mean anything.
 *
 * ── The rule it enforces ─────────────────────────────────────────────
 * Nothing is ordered before a contract exists. A purchase order in Phase 9 is
 * raised AGAINST a live contract, and the order tracker refuses lines whose
 * vendor has none. That refusal is the whole reason this phase is worth a
 * screen rather than a filing cabinet.
 *
 * Kept as a template stage with a rich form rather than a Mongoose model of
 * its own: a contract is a record with a vendor, a value, dates and a
 * signature, which is exactly what collection mode already models — and doing
 * it this way means approvals, tasks, the audit trail, outsourcing and the
 * activity log all work on day one instead of being re-implemented.
 */
const contracts = {
  key: 'p21',
  name: 'Phase 8 — Contracts & Work Orders',
  color: '#8b5cf6',
  slaDays: 5,
  ownerDepartment: D.PROJECTS,
  description:
    'Once quantities are known, the MD and the vendor sign: scope, total value, start and '
    + 'completion date, penalties, retention. The completion date is the promise the vendor '
    + 'made. No purchase order can be raised against a vendor without a signed contract here.',
  exitCriteria:
    'A signed contract for every vendor who will be issued a purchase order, each with a '
    + 'completion date and a retention percentage.',
  whatWhoWhenHow: [
    w('Draft the work order from the approved BOQ', 'Project Manager', 'Within 2 days of BOQ approval', 'Contract form, scope pulled from the BOQ'),
    w('Agree penalties, retention and payment milestones', 'Projects + Legal', 'Within 3 days', 'Contract commercials'),
    w('Sign with the vendor', 'MD', 'Within 5 days', 'Both signatures, signed copy uploaded'),
    w('Release the vendor to be ordered from', 'Procurement', 'On signature', 'Purchase orders unlock for that vendor'),
  ],
  captureMode: 'collection',
  recordNoun: 'Contract',
  recordGroups: [
    {
      key: 'contracts_live',
      label: 'Signed — these vendors can be ordered from',
      hint: 'A signed contract is what releases purchase orders for that vendor. Until one exists here, Phase 9 will not raise a PO against them.',
      addLabel: 'Record a signed contract',
      emptyHint: 'Nothing signed yet — so no purchase order can be raised on this project.',
      field: 'contract_status',
      values: ['Signed'],
      taskKey: 'p21_sign',
      columns: ['vendor_name', 'contract_value', 'completion_date'],
    },
    {
      key: 'contracts_pending',
      label: 'Drafted, not yet signed',
      hint: 'Agreed on paper but not executed. These block ordering just as firmly as having no contract at all.',
      addLabel: 'Draft a work order',
      emptyHint: 'Nothing in draft.',
      field: 'contract_status',
      excludeValues: ['Signed'],
      taskKey: 'p21_draft',
      columns: ['vendor_name', 'contract_value', 'contract_status'],
    },
  ],
  masterDataSchema: [
    {
      key: 'vendor_name', label: 'Vendor', type: F.SELECT, required: true,
      section: 'Parties', order: 0,
      /* The vendor list comes from the Phase 6 panel rather than being typed
         again — a contract against a vendor who was never confirmed on the
         panel is a contract nobody agreed a rate with. `global` because the
         panel is a standing, company-wide list, which is the same scope the
         BOQ's own Vendor field reads it at. See optionsFromStage. */
      optionsFromStage: { stageKey: 'p12', field: 'vendor_name', scope: 'global' },
      helpText: 'Pick from the vendors confirmed on the panel in Phase 6, or from the supply master under Master Data → Vendors.',
    },
    {
      key: 'panel_category', label: 'Category this covers', type: F.SELECT,
      section: 'Parties', order: 1,
      options: [...VENDOR_CATEGORIES],
    },
    {
      key: 'boq_type', label: 'BOQ this contract covers', type: F.SELECT,
      section: 'Parties', order: 2,
      options: [...BOQ_TYPES],
      helpText: 'Which of the seven BOQs this work order prices. One contract can cover one BOQ.',
    },
    {
      key: 'scope', label: 'Scope of work', type: F.TEXTAREA, required: true, aiAssist: true,
      section: 'The agreement', order: 3,
      helpText: 'What this vendor is contracted to do — drawn from the approved BOQ lines, in plain words.',
    },
    {
      key: 'contract_value', label: 'Total contract value', type: F.CURRENCY, required: true,
      section: 'The agreement', order: 4,
      helpText: 'The agreed total. If it differs from the BOQ total, say why in the notes.',
    },
    { key: 'start_date', label: 'Start date', type: F.DATE, section: 'The agreement', order: 5 },
    {
      key: 'completion_date', label: 'Completion date', type: F.DATE, required: true,
      section: 'The agreement', order: 6,
      helpText: 'The date the vendor is promising. This is the single most important date on the contract — everything downstream is measured against it.',
    },
    {
      key: 'penalty_terms', label: 'Penalty for late completion', type: F.TEXTAREA,
      section: 'Commercials', order: 7,
      helpText: 'e.g. "0.5% of contract value per week, capped at 5%". A completion date with no penalty is a preference, not a commitment.',
    },
    {
      key: 'retention_pct', label: 'Retention (%)', type: F.NUMBER, min: 0, max: 100,
      section: 'Commercials', order: 8,
      helpText: 'Percentage held back until the defect liability period ends.',
    },
    {
      key: 'payment_milestones', label: 'Payment milestones', type: F.TEXTAREA,
      section: 'Commercials', order: 9,
      helpText: 'Advance %, on delivery %, on completion %, retention %. Q-5 in the spec — the company standard is not yet fixed.',
    },
    {
      key: 'contract_status', label: 'Status', type: F.SELECT, required: true,
      section: 'Signature', order: 10,
      options: ['Draft', 'Sent to vendor', 'Under negotiation', 'Signed', 'Cancelled'],
      helpText: 'Only "Signed" releases purchase orders for this vendor.',
    },
    {
      key: 'signed_by_mr', label: 'Signed for Mystery Rooms by', type: F.USER,
      section: 'Signature', order: 11,
      helpText: 'Q-8 in the spec: MD only, or MD plus Projects Head, is not yet settled.',
    },
    { key: 'signed_by_vendor', label: 'Signed for the vendor by', type: F.TEXT, section: 'Signature', order: 12 },
    { key: 'signed_date', label: 'Date signed', type: F.DATE, section: 'Signature', order: 13 },
    {
      key: 'contract_file', label: 'The signed copy', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Signature', order: 14,
      helpText: 'Scan or photograph of the executed document, signed by both sides.',
    },
    { key: 'remarks', label: 'Notes', type: F.TEXTAREA, section: 'Notes', order: 15 },
  ],
  tasks: [
    job('p21_draft', 'Draft the work orders from the approved BOQs', D.PROJECTS, 2, P.CRITICAL, {
      approval: false,
      who: 'Project Manager / Technical Expert', when: 'Within 2 days of BOQ approval',
      how: 'For each vendor who will be ordered from, draft a work order: the scope from their approved BOQ, the total value, a start and completion date, penalties and retention. One contract per vendor per BOQ.',
      list: [
        'Every vendor to be ordered from has a draft',
        'Scope taken from the approved BOQ',
        'Completion date agreed with the vendor',
        'Penalty and retention terms stated',
      ],
      must: ['Every vendor to be ordered from has a draft', 'Completion date agreed with the vendor'],
    }),
    job('p21_sign', 'Sign the contracts with the vendors', D.PROJECTS, 3, P.CRITICAL, {
      approval: true,
      who: 'MD', when: 'Within 5 days',
      how: 'Sign each work order with the vendor and upload the executed copy. Set the status to Signed — that is what releases purchase orders for that vendor in Phase 9. Nothing is ordered before this.',
      list: ['Both signatures on every contract', 'Signed copy uploaded', 'Status set to Signed'],
      must: ['Both signatures on every contract', 'Signed copy uploaded'],
    }),
  ],
};

const procurement = {
  key: 'p15',
  name: 'Phase 9 — Purchase Orders & Delivery Tracking',
  color: '#14b8a6',
  slaDays: 45,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Every BOQ line from Phase 5 is a purchase order. Send each one to its vendor, '
    + 'then track it on one sheet — ordered, dispatched, delivered, received — with the '
    + 'PO, indent, challan and GRN numbers, what arrived against what was ordered, and '
    + 'who updated what, when. Runs alongside civil works on site.',
  parallelGroup: GROUP.BUILD_PROCURE,
  /* Dates follow Contracts; the arrow people need to see comes from the
     approved BOQ, which is what an order is raised against. Visual only —
     see alsoDrawnFrom in template.model.js. */
  alsoDrawnFrom: ['p13'],
  exitCriteria: 'Every purchase order sent and dispatched by its vendor; deliveries and GRNs tracked to closure on the same sheet.',
  whatWhoWhenHow: [
    w('Send every purchase order (WhatsApp / email)', 'Procurement', 'Within 3 days of BOQ approval', 'Order page on each BOQ line — the send time is recorded for you'),
    w('Track each order to dispatch', 'Procurement', 'Daily until dispatched', 'Tracker: status, vendor promised date, challan / LR number'),
    w('Receive at site and raise the GRN', 'Store Manager / Site Supervisor', 'On arrival', 'Tracker: received quantity, GRN number, short / damaged note'),
    w('Chase delays', 'Procurement', 'Whenever a date slips', 'Late orders show in red; AI drafts the follow-up'),
  ],
  // No form of its own — the work is the tracker over Phase 5's lines.
  // 'single' keeps the generic "create a record first" completion rule out of
  // the way; the real gate is project.service.js#completeStage (every order
  // dispatched or closed).
  captureMode: 'single',
  recordNoun: 'Order',
  masterDataSchema: [],
  tasks: [
    job('p15_t1', 'Send every PO and keep the tracker honest', D.PROCUREMENT, 45, P.CRITICAL, {
      who: 'Procurement', when: 'From BOQ approval until the last order lands',
      approval: false,
      how: 'Open the order tracker. Send each BOQ line as a PO by WhatsApp or email, then keep its status current as the vendor reports — Ordered, Dispatched, Delivered — with challan / LR numbers. Late orders turn red; use Chase to draft the follow-up. Sending and tracking are one continuous job, not two tasks.',
      list: ['Every BOQ line sent as a PO', 'PO and indent numbers filled in', 'Statuses kept current as vendors report', 'Late orders chased'],
      must: ['Every BOQ line sent as a PO', 'Statuses kept current as vendors report'],
    }),
    job('p15_t3', 'Receive goods at site and record the GRN', D.OPERATIONS, 45, P.HIGH, {
      who: 'Store Manager / Site Supervisor', when: 'On each delivery',
      approval: false,
      how: 'Count what arrived. In the tracker, enter the received quantity, GRN number and received date — the pending quantity and "Partly Received" are worked out for you. Note anything short or damaged.',
      list: ['Received quantity entered for every delivery', 'GRN number recorded', 'Short / damaged items noted'],
      must: ['GRN number recorded'],
    }),
    // (Marketing & HR prep removed — hiring is Phase 7's own task in HRMS,
    // and launch marketing is Phase 12's readiness checklist. It lived here
    // as a third copy.)
  ],
};

/** Phase 9 — Quality Check. §7 Phase 9. */
const qualityCheck = {
  key: 'p16',
  name: 'Phase 11 — Quality Check',
  color: '#ef4444',
  slaDays: 5,
  ownerDepartment: D.OPERATIONS,
  description:
    'An independent quality gate before material transfer and installation begin. '
    + 'Any Fail raises a rectification task automatically — the gate cannot pass while '
    + 'a mandatory Fail is open.',
  exitCriteria: 'QC passed with all mandatory items cleared.',
  whatWhoWhenHow: [
    w('Physical site inspection', 'Operations Head', 'Within 5 days', 'On-site inspection'),
    w('Complete QC checklist', 'Operations Head', 'Within 5 days', 'Digital checklist'),
    w('Report issues', 'Operations Head', 'Immediately', 'Issue log with photos'),
    w('Rectify & re-check', 'Contractor → Operations Head', 'As required', 'Re-inspection loop'),
  ],
  captureMode: 'collection',
  recordNoun: 'QC Item',
  masterDataSchema: [
    {
      key: 'qc_area', label: 'Area', type: F.SELECT, required: true, section: 'Inspection', order: 0,
      options: [
        'Civil', 'Tiles / Flooring', 'False Ceiling', 'HVAC', 'Fire Line',
        'Electrical', 'Plumbing', 'Paint', 'Doors', 'Signage', 'Cleaning',
      ],
    },
    { key: 'check_item', label: 'Check Item', type: F.TEXT, required: true, section: 'Inspection', order: 1 },
    {
      key: 'result', label: 'Result', type: F.SELECT, required: true, section: 'Inspection', order: 2,
      options: ['Pass', 'Fail', 'Not Applicable'],
    },
    {
      key: 'severity', label: 'Severity', type: F.SELECT, showIf: { field: 'result', in: ['Fail'] }, section: 'Inspection', order: 3,
      options: ['Critical', 'Major', 'Minor'],
      helpText: 'Only meaningful on a Fail — drives how hard the gate blocks.',
    },
    { key: 'observation', label: 'Observation', type: F.TEXTAREA, section: 'Inspection', order: 4 },
    {
      key: 'evidence', label: 'Photographic Evidence', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Inspection', order: 5,
    },
    /* tracker: the rectification story keeps moving AFTER the MD approves
       the Fail — same device as the Phase 6 order tracker, each change logged
       with name and time while the inspected facts stay frozen. */
    { key: 'responsible_party', label: 'Who must fix it', type: F.TEXT, tracker: true, showIf: { field: 'result', in: ['Fail'] }, section: 'Rectification', order: 6 },
    { key: 'rectification_due', label: 'Fix it by', type: F.DATE, tracker: true, showIf: { field: 'result', in: ['Fail'] }, section: 'Rectification', order: 7 },
    {
      key: 'rectification_status', label: 'Rectification Status', type: F.SELECT, tracker: true, showIf: { field: 'result', in: ['Fail'] },
      options: ['Open', 'In Progress', 'Rectified', 'Re-checked & Closed'],
      section: 'Rectification', order: 8,
    },
    {
      key: 'closure_evidence', label: 'Closure Evidence', type: F.FILE, multiple: true, tracker: true, showIf: { field: 'result', in: ['Fail'] },
      accept: EVIDENCE, section: 'Rectification', order: 9,
    },
  ],
  tasks: [
    job('p16_inspect', 'Inspect the site & file QC items', D.OPERATIONS, 3, P.CRITICAL, {
      approval: false, // the QC ITEMS are what the MD approves, one by one
      // NO openPhaseOnly: filing items IS this task's work, so the QC form
      // opens right on the task — one submit per check, again and again,
      // with the checklist alongside. The phase link stays for the list.
      who: 'Operations Head', when: 'Within 3 days',
      how: 'Walk the whole site and file one QC Item per check — civil, tiles, HVAC, fire, electrical… Pass or Fail, photos attached. A Fail asks who must fix it and by when. Every item goes to the MD to accept or reject; a rejected item comes back to you with the reason, to redo.',
      list: ['Every area inspected and filed as a QC item', 'Photos attached to every item', 'Owner and fix-by date on every Fail'],
      must: ['Every area inspected and filed as a QC item', 'Owner and fix-by date on every Fail'],
    }),
    job('p16_rectify', 'Fix what failed & re-check', D.CONSTRUCTION, 5, P.CRITICAL, {
      approval: false, // the fix is proven inside the QC item itself
      openPhaseOnly: true, // their work is EXISTING items — the Fail list, not a blank form
      who: 'Contractor / Site team', when: 'As fails are filed',
      how: 'Work the Fail list: fix each item, attach closure photos, and set its rectification status to Re-checked & Closed. The phase cannot pass while a Critical or Major fail is open.',
      list: ['All Critical and Major fails rectified', 'Closure evidence attached', 'Re-check recorded on every fix'],
      must: ['All Critical and Major fails rectified'],
    }),
    // The two parallel Phase-7 streams get checked here, not just the walls:
    // is the team being hired, and does the technical rough-in actually work.
    job('p16_hiring_check', 'Check hiring is on track', D.HR, 2, P.HIGH, {
      approval: false,
      appPath: '/hrms/overview',
      who: 'HR / Hiring owner', when: 'During QC week',
      how: 'Open the HRMS overview: hired vs needed for this centre. Chase every role still open — trial runs (Phase 11) need the team standing on site.',
      list: ['Hired count reviewed against headcount', 'Every open role has interviews scheduled'],
      must: ['Hired count reviewed against headcount'],
    }),
    job('p16_tech_check', 'Verify the technical setup', D.IT, 2, P.HIGH, {
      approval: false,
      who: 'IT / Technical', when: 'During QC week',
      how: 'Test what Phase 7 roughed in: internet live at the site, every power point against the game layout, CCTV and AV routes usable. Log a QC Item with a Fail for anything short — the gate holds it open.',
      list: ['Internet tested at site', 'Power points verified against layout', 'Cable routes verified'],
      must: ['Internet tested at site'],
    }),
  ],
};

/* Phase 9 (Logistics & Dispatch) was REMOVED at the MD's direction
   (2026-08-26): it duplicated the second half of the Phase 6 order
   tracker field for field — dispatch date, transporter, LR, GRN, damage
   report all live there. One delivery, one place to record it. */

/** Phase 11 — Assembly & Installation. §7 Phase 11. */
const installation = {
  key: 'p18',
  name: 'Phase 12 — Assembly & Installation',
  color: '#a855f7',
  slaDays: 10,
  ownerDepartment: D.AUTOMATION,
  description:
    'Game specialist and technical teams install games, props, AV, IT and networking '
    + 'to the approved layout, following the setup standard for each game.',
  exitCriteria: 'All games and systems installed and verified.',
  whatWhoWhenHow: [
    w('Deploy resources as per plan', 'Game Specialist Team', 'Within 10 days', 'Resource plan'),
    w('Install games, props, AV, IT', 'Game Specialist / IT Team', 'Within 10 days', 'Installation checklist'),
    w('Verify work completion', 'Project Manager', 'On completion', 'Checklist verification'),
  ],
  captureMode: 'collection',
  recordNoun: 'Installation',
  masterDataSchema: [
    {
      key: 'game_or_zone', label: 'Games / zones being installed', type: F.MULTISELECT, required: true,
      section: 'Installation', order: 0,
      // Only the games THIS outlet chose in Phase 3B — typing them by hand let
      // an installation be filed against a game the site was never having.
      // Several at once, because one crew visit usually covers more than one.
      optionsFrom: 'project_games',
      helpText: 'Chosen in Phase 3B. Tick every game or zone this entry covers.',
    },
    {
      key: 'install_type', label: 'Type', type: F.SELECT, required: true, section: 'Installation', order: 1,
      options: ['Game', 'Prop', 'AV', 'IT & Network', 'CCTV', 'POS / Booking Terminal', 'Lighting', 'Control Room'],
    },
    { key: 'technician', label: 'Technician', type: F.TEXT, section: 'Installation', order: 2 },
    { key: 'install_start', label: 'Installation Start', type: F.DATE, section: 'Installation', order: 3 },
    { key: 'install_complete', label: 'Installation Complete', type: F.DATE, section: 'Installation', order: 4 },
    {
      key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Installation', order: 5,
      options: ['Not Started', 'In Progress', 'Installed', 'Calibrated', 'Verified'],
    },
    {
      key: 'calibration_notes', label: 'Calibration & Setup Notes', type: F.TEXTAREA,
      section: 'Verification', order: 6,
    },
    {
      key: 'photographs', label: 'Installation Photographs', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Verification', order: 7,
    },
    { key: 'verified_by', label: 'Verified By', type: F.TEXT, section: 'Verification', order: 8 },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 9 },
  ],
  tasks: [
    job('p18_games', 'Install games, props & AV', D.AUTOMATION, 10, P.CRITICAL, {
      approval: false, // each installation is its own record, verified below
      who: 'Game Specialist Team', when: 'Within 10 days',
      how: 'One Installation record per game / prop zone / AV rig: dates, technician, calibration notes, photos — status ends at Verified, nothing less.',
      list: ['All games installed', 'Props placed to layout', 'AV commissioned'],
      must: ['All games installed'],
    }),
    job('p18_it', 'Install IT, network & systems', D.IT, 5, P.CRITICAL, {
      approval: false,
      who: 'IT Team', when: 'Alongside the game installs',
      how: 'Bring the site live on what Phase 7 roughed in: internet, network and CCTV, POS / booking terminal, inventory system. One Installation record per system.',
      list: ['Internet live', 'Network & CCTV commissioned', 'POS / booking terminal live', 'Inventory system integrated'],
      must: ['Internet live', 'POS / booking terminal live'],
    }),
    job('p18_verify', 'Verify every installation', D.PROJECTS, 2, P.HIGH, {
      approval: false, // this task IS the verification
      who: 'Project Manager', when: 'As installs complete',
      how: 'Walk every installation record: photographs attached, calibration noted, then mark it Verified. Phase 11 tests only what is verified here.',
      list: ['Every installation record verified', 'Photographs attached to each'],
      must: ['Every installation record verified'],
    }),
  ],
};

/** Phase 12 — Testing & Trial Run. §7 Phase 12. */
const trialRun = {
  key: 'p19',
  name: 'Phase 13 — Testing & Trial Run',
  color: '#22c55e',
  slaDays: 10,
  ownerDepartment: D.OPERATIONS,
  description:
    'The branch is physically played and tested end to end. Errors are logged, '
    + 'rectified and re-tested in a loop until All-OK — only then does the readiness gate open.',
  exitCriteria: 'All-OK confirmed; trial run report submitted.',
  whatWhoWhenHow: [
    w('Physical playing & testing', 'Cluster / Branch Manager', 'Within 7–10 days', 'Trial run form'),
    w('Error identification', 'Cluster Manager / Team', 'During testing', 'Issue log'),
    w('Rectify errors', 'Concerned vendor / department', 'As per severity', 'Auto-assigned task'),
    w('Re-test', 'Cluster Manager', 'Until All OK', 'Re-test loop'),
    w('Report submission', 'Cluster Manager', 'On completion', 'Consolidated report'),
  ],
  captureMode: 'collection',
  recordNoun: 'Test Run',
  masterDataSchema: [
    { key: 'game', label: 'Game', type: F.TEXT, required: true, section: 'Test Run', order: 0 },
    { key: 'test_date', label: 'Test Date', type: F.DATE, required: true, section: 'Test Run', order: 1 },
    { key: 'testers', label: 'Testers', type: F.TEXT, section: 'Test Run', order: 2 },
    { key: 'duration_mins', label: 'Duration (minutes)', type: F.NUMBER, section: 'Test Run', order: 3 },
    {
      key: 'result', label: 'Result', type: F.SELECT, required: true, section: 'Test Run', order: 4,
      options: ['Pass', 'Fail'],
    },
    { key: 'observations', label: 'Observations', type: F.TEXTAREA, aiAssist: true, section: 'Test Run', order: 5 },
    {
      key: 'customer_experience', label: 'Customer Experience Notes', type: F.TEXTAREA, aiAssist: true,
      section: 'Test Run', order: 6,
    },
    { key: 'safety_observations', label: 'Safety Observations', type: F.TEXTAREA, section: 'Test Run', order: 7 },
    { key: 'error_description', label: 'Error Description', type: F.TEXTAREA, aiAssist: true, section: 'Error Log', order: 8 },
    {
      key: 'error_severity', label: 'Severity', type: F.SELECT, section: 'Error Log', order: 9,
      options: ['Critical', 'Major', 'Minor'],
    },
    { key: 'error_owner', label: 'Owner', type: F.TEXT, section: 'Error Log', order: 10 },
    { key: 'error_target_date', label: 'Target Date', type: F.DATE, section: 'Error Log', order: 11 },
    {
      key: 'retest_result', label: 'Re-test Result', type: F.SELECT, section: 'Error Log', order: 12,
      options: ['Pending', 'Passed', 'Failed Again'],
    },
    {
      key: 'evidence', label: 'Evidence', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Evidence', order: 13,
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 14 },
  ],
  tasks: [
    job('p19_test', 'Play & test every game — log every error', D.OPERATIONS, 7, P.CRITICAL, {
      approval: false, // each test run is its own record
      who: 'Cluster / Branch Manager', when: 'Within 7 days',
      how: 'Play every game end to end as a customer would. One Test Run record per game: result, observations (AI drafts the write-up), safety notes — and every error found, with its severity and owner. Finding and logging the errors IS the testing.',
      list: ['Every game played end to end', 'Safety checked per game', 'Every error logged with severity and owner'],
      must: ['Every game played end to end', 'Every error logged with severity and owner'],
    }),
    job('p19_fix', 'Fix the errors & re-test until All-OK', D.AUTOMATION, 5, P.CRITICAL, {
      approval: false,
      who: 'Game / technical team', when: 'As errors are logged',
      how: 'Work the error log: fix each one, then the game is played again and its re-test result recorded. The loop ends only at All-OK — a fix without a passed re-test is not closed.',
      list: ['All Critical and Major errors closed', 'Re-test passed on every rectified game', 'All-OK confirmed'],
      must: ['All Critical and Major errors closed', 'All-OK confirmed'],
    }),
    job('p19_staff', 'Staff readiness & mock run', D.HR, 5, P.HIGH, {
      approval: false,
      who: 'HR / Centre Manager', when: 'Before the readiness gate',
      how: 'The hired team (from Phase 7\'s HRMS pipeline) is trained, briefed per game, signs the SOP, and runs a full mock-customer day.',
      list: ['Training completed', 'Game briefing done', 'SOP acknowledged', 'Mock customer run completed'],
      must: ['Training completed', 'Mock customer run completed'],
    }),
  ],
};

/**
 * Phase 3B — Project Planning & Game Selection.
 *
 * The step that only becomes answerable once a property is signed: how many
 * games fit THIS space, which ones, and what the real opening date is.
 *
 * Why it is its own phase. Phase 0 (Project Initiation) is deliberately a short
 * intake form — a city and an intent, filled before any property exists.
 * Everything here depends on the finalised site's actual area and shape, so it
 * cannot be asked at initiation, and it must not wait for BOQ costing in Phase
 * 5 because drawings and vendors are already running by then. The MOM is
 * explicit that "game selection is a major planning input", and that the
 * project record gains setup cost, opening target, construction/handover dates,
 * departments and preferred games at exactly this point.
 *
 * Everything downstream keys off it: drawings are drawn for the selected game
 * set, the BOQ is costed against it, and the launch countdown runs to the date
 * confirmed here.
 */
const projectPlanning = {
  key: 'p20',
  recordNoun: 'Project Plan',
  name: 'Phase 4 — Project Planning & Games',
  color: '#d946ef',
  slaDays: 3,
  ownerDepartment: D.PROJECTS,
  description:
    'With the property signed, fix the plan for this specific site: which games it '
    + 'will hold, the real opening date, and the construction and testing milestones '
    + 'every other phase is scheduled against.',
  exitCriteria: 'Games selected, opening date fixed, and the outline budget agreed.',
  whatWhoWhenHow: [
    w('Confirm the site plan against the signed property', 'Project Manager', 'Day 1', 'Planning form'),
    w('Select the games for this outlet', 'MD / Operations Head', 'Within 2 days', 'Game list — pick multiple'),
    w('Fix opening, construction & testing dates', 'Project Manager / MD', 'Within 2 days', 'Milestone dates on the form'),
    w('Approve the plan', 'MD', 'Within 3 days', 'Digital approval'),
  ],
  captureMode: 'single',
  recordNoun: 'Project Plan',
  masterDataSchema: [
    // ── The site, as finalised ──
    {
      key: 'confirmed_area', label: 'Confirmed Area (sq.ft)', type: F.NUMBER, required: true,
      section: 'The Site', order: 0,
      helpText: 'From the signed property. Everything below is planned against this number.',
    },
    {
      key: 'site_shape', label: 'Shape / Layout Notes', type: F.TEXTAREA, aiAssist: true,
      section: 'The Site', order: 1,
      helpText: 'Anything about the shape that constrains the layout — columns, level changes, odd corners.',
    },

    // ── Games ──
    {
      key: 'selected_games', label: 'Games for this outlet', type: F.MULTISELECT, required: true,
      section: 'Games', order: 2,
      // The real catalogue (Master Data -> Games), seeded from the client's own
      // spreadsheet — not a list typed into this template, which would go stale
      // the first time a game is added and silently disagree with the master.
      // Each option shows the floor area the game needs, because that is the
      // decision being made: what fits in this outlet.
      optionsFrom: 'games',
      helpText:
        'Pick every game this outlet will run. The area each one needs is shown beside it. '
        + 'Guide: 4-5 games for 3,000-5,000 sq.ft, about 12 for 12,000 sq.ft.',
    },
    {
      key: 'game_count', label: 'Number of Games', type: F.NUMBER, section: 'Games', order: 3,
      // Follows the ticked boxes above automatically; still editable.
      countOf: 'selected_games',
    },
    {
      key: 'game_notes', label: 'Game Planning Notes', type: F.TEXTAREA, aiAssist: true,
      section: 'Games', order: 4,
      helpText: 'Mandatory vs preferred games, and what was ruled out for this area.',
    },

    // ── The dates everything else is scheduled against ──
    { key: 'construction_start', label: 'Construction Start', type: F.DATE, required: true, section: 'Milestones', order: 5 },
    { key: 'handover_date', label: 'Site Handover Date', type: F.DATE, section: 'Milestones', order: 6 },
    { key: 'testing_date', label: 'Testing / Trial Run Date', type: F.DATE, section: 'Milestones', order: 7 },
    {
      key: 'target_opening', label: 'Target Opening Date', type: F.DATE, required: true,
      section: 'Milestones', order: 8,
      helpText: 'The date the launch countdown runs to.',
    },

    // ── Money & people ──
    { key: 'setup_cost', label: 'Estimated Setup Cost', type: F.CURRENCY, section: 'Budget & Team', order: 9 },
    { key: 'monthly_operating_cost', label: 'Estimated Monthly Operating Cost', type: F.CURRENCY, section: 'Budget & Team', order: 10 },
    { key: 'project_manager', label: 'Project Manager', type: F.USER, section: 'Budget & Team', order: 11 },
    {
      key: 'departments_involved', label: 'Departments Involved', type: F.MULTISELECT,
      section: 'Budget & Team', order: 12,
      options: [
        'Construction', 'Interior', 'Procurement', 'Automation', 'IT',
        'Marketing', 'HR', 'Finance', 'Operations', 'Legal',
      ],
    },
    {
      key: 'cad_files', label: 'Site CAD / Floor Plan', type: F.FILE, multiple: true,
      accept: DRAWING_FILES, section: 'Budget & Team', order: 13,
      helpText: 'The as-signed site drawing the architect will design against.',
    },
    /* At the BOTTOM on purpose: it reads everything above it — the
       confirmed area, the shape notes, the chosen games — and only then
       can it draw. Geometry is computed exactly from the Games master;
       the AI contributes the walk order and the fit-out notes. */
    {
      key: 'layout_plan', label: 'Outlet Layout (AI-generated)', type: F.LAYOUT,
      section: 'Layout', order: 14,
      helpText: 'Fill the area and pick the games above, then Generate — the plan is drawn to scale from each game’s real square footage.',
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 14 },
  ],
  tasks: [
    // The plan RECORD these two tasks fill is what the MD approves in the
    // Approvals queue (games, dates, budget — the actual data). The tasks
    // finish when their doers mark them done; queueing them too doubled
    // every decision.
    // ONE task, because it is ONE form. Games, dates and outline budget are
    // all fields of the same project plan; splitting them into three tasks
    // (and a fourth to approve them) was the form's sections wearing task
    // clothes. The submitted plan is what the MD approves, from Approvals.
    job('p20_games', 'Fill the project plan — games, dates & budget', D.OPERATIONS, 2, P.CRITICAL, {
      approval: false, // the submitted plan record is what the MD approves
      who: 'Operations Head / PM', when: 'Within 2 days of the lease being signed',
      how: 'One form, everything this phase needs: the games this site will hold (by its confirmed area and shape), construction start, handover, testing and target opening dates, and the outline budget. Submit it and the plan goes to the MD to approve — every later phase is scheduled from what is approved here.',
      list: ['Games selected against the confirmed area', 'Construction, testing and opening dates set', 'Outline budget entered'],
      must: ['Games selected against the confirmed area', 'Construction, testing and opening dates set'],
    }),
  ],
};

/**
 * HR Hiring & Training — a BRANCH off Project Planning, and nothing else.
 *
 * The day the games are agreed the headcount follows from them, so hiring can
 * open that same day. It feeds no other phase: no arrow leaves it, nothing
 * downstream waits on it, and it is deliberately NOT on the critical path.
 * Because it has no successor its deadline is its own target date rather than
 * the project end — a late hire delays the roster, not the opening.
 *
 * The work itself runs in the HRMS module (requisitions, JDs, applications,
 * interviews, offers), which already exists. This phase is the PMS's handle on
 * it: it puts the headcount on the project plan so the MD can see hiring
 * running alongside the build instead of discovering on launch week that
 * nobody was recruited.
 */
const hrHiring = {
  key: 'p22',
  /**
   * NO phase number, deliberately. The spec's rule is that a letter in a phase
   * number ("3B", "4B", "4H") means somebody inserted a phase into a list whose
   * numbers were already taken — so "Phase 4H" would reintroduce exactly what
   * this pass removes. Numbering it plainly is no better: it would make Design
   * & Drawings "Phase 6" and shift every phase after it, contradicting the
   * numbering the specs and the client's deck both use.
   *
   * It is not a step in the sequence. It is a branch that opens with Phase 4
   * and runs alongside everything, and the name says so.
   */
  /* No parenthetical. `branchOf` below is what says it hangs off Phase 4,
     and the board draws that — a name that repeats the diagram is a name
     that goes stale the day the structure changes. */
  name: 'HR Hiring & Training',
  /* Sits in Project Planning's column and is nobody's predecessor — see
     branchOf in template.model.js. Nothing downstream waits for hiring. */
  branchOf: 'p20',
  color: '#ec4899',
  slaDays: 30,
  ownerDepartment: D.HR,
  description:
    'Opens with the games and runs alongside everything else. Requisitions per role, JDs '
    + 'from the JD Master, applications, interviews and offers — then induction and training '
    + 'on the actual games. The team size follows from the games chosen in Phase 4. Runs in '
    + 'the HRMS; no other phase waits on it.',
  exitCriteria: 'Every role filled and the team trained on the games this branch is opening with.',
  whatWhoWhenHow: [
    w('Work out the headcount from the game set', 'HR Head', 'Day 1 of planning', 'Games × shifts'),
    w('Raise a requisition per role', 'HR Manager', 'Within 3 days', 'HRMS requisition'),
    w('Shortlist, interview and offer', 'HR Manager', 'Within 25 days', 'HRMS pipeline'),
    w('Induct and train on the actual games', 'Operations / Games Head', 'Before the trial run', 'On-site training'),
  ],
  captureMode: 'collection',
  recordNoun: 'Role',
  masterDataSchema: [
    { key: 'role_title', label: 'Role', type: F.TEXT, required: true, section: 'Role', order: 0 },
    {
      key: 'headcount', label: 'How many needed', type: F.NUMBER, required: true,
      section: 'Role', order: 1,
      helpText: 'Follows from the games chosen in Phase 4 — typically two shifts per game room.',
    },
    { key: 'hired_count', label: 'How many hired so far', type: F.NUMBER, section: 'Progress', order: 2, tracker: true },
    {
      key: 'hiring_status', label: 'Status', type: F.SELECT, section: 'Progress', order: 3, tracker: true,
      options: ['Not started', 'Requisition raised', 'Interviewing', 'Offers out', 'Filled', 'Trained'],
    },
    { key: 'target_date', label: 'Needed on site by', type: F.DATE, section: 'Progress', order: 4 },
    { key: 'remarks', label: 'Notes', type: F.TEXTAREA, section: 'Notes', order: 5 },
  ],
  tasks: [
    job('p22_hire', 'Hire and train the team for this branch', D.HR, 30, P.HIGH, {
      approval: false,
      who: 'HR Head / HR Manager', when: 'From the day the games are agreed',
      how: 'Work out the headcount from the game set, raise a requisition per role in the HRMS, then run the pipeline through to offers. Induct and train everyone on the actual games before the trial run.',
      list: ['Headcount agreed per role', 'Requisitions raised', 'Offers accepted', 'Team trained on the games'],
      must: ['Headcount agreed per role', 'Offers accepted'],
    }),
  ],
};

/* ══════════════════════════════════════════════════════════════════════
   The template — client document §6 Phase Map, in order.
   ══════════════════════════════════════════════════════════════════════ */

export const clientFlowTemplate = withOrder({
  // No stage count in the name — it drifted the moment Phase 3B was added, and
  // a template row already shows its own live counts.
  name: 'Branch Opening — Client Flow',
  code: 'MR-PMS-CLIENT-FLOW',
  description:
    'The client-approved end-to-end Branch / Franchise Opening lifecycle: project '
    + 'initiation through closure and delay analysis, with three approval gates and '
    + 'parallel design, vendor, procurement and execution streams.',
  category: 'Store Launch',
  icon: 'Store',
  color: '#e0a13a',
  status: TEMPLATE_STATUS.PUBLISHED,
  // Deliberately NOT the default while the eight new phases are still shallow —
  // storeLaunchTemplate stays default so existing demos are untouched.
  isDefault: false,
  /**
   * The master template runs itself: creating a project from this playbook
   * generates all 202 tasks with their owners, buddies, lead times and
   * checklists, so no one hand-allocates work the template already defines.
   * Only this template opts in — see the field's note in template.model.js.
   */
  autoAssignTasks: true,
  tags: ['pms', 'store-launch', 'client-flow', 'official'],
  stages: [
    // The flow starts at property research — creating the project (the old
    // "Phase 0") is the New Project form itself, not a phase to work through.
    reuse('p1', {
      name: 'Phase 1 — Property Research & Site Capture',
      slaDays: 15,
      description:
        'The property consultant visits each option with the broker and records it on '
        + 'the spot from a phone. Ten properties can sit under one search, all comparable side by side.',
      exitCriteria: 'Properties recorded and one or more shortlisted (typically 10 listed → 4 shortlisted).',
      whatWhoWhenHow: [
        w('Visit each property with broker', 'Property Consultant', '7–15 days', 'Physical visit, on-site mobile entry'),
        w('Capture property details + media', 'Property Consultant', 'At the site', 'Mobile form with live GPS'),
        w('Run AI location analysis', 'System (AI) / Consultant', 'Instant, on demand', 'AI engine'),
        w('Review & shortlist properties', 'MD / PM Head', 'Within 2 days of listing', 'Comparison view'),
      ],
      /**
       * ONE task. Phase 1 is property capture and nothing else.
       *
       * There used to be a second task — "review the captured properties &
       * shortlist" — and it was a job with no work in it. Shortlisting is a
       * decision taken on a property, one at a time, and the moment it is
       * taken that property is in Phase 2. There is nothing left for a task
       * to track: no separate list to open, no separate thing to finish. A
       * second row that closes itself the instant somebody clicks Shortlist
       * is a row that only ever reports on another row.
       *
       * Ten properties are ten form entries inside this single task, never
       * ten tasks — and never two tasks either.
       */
      tasks: [
        job('p1_capture', 'Capture the properties on site', D.EXPANSION, 15, P.HIGH, {
          approval: false,
          who: 'Property Consultant', when: '7–15 days',
          how: 'At each property, press "Submit Property" and fill the form on your phone right there — area, rent, photos, video, live GPS. One entry per property, again and again: 10–12 captures for a search is normal. Then open the list and mark each one Shortlisted or Rejected with a reason — whatever you shortlist is already in Phase 2, there is nothing else to close here.',
          list: [
            'Brokers engaged',
            'At least 5 properties captured',
            'Photos & video uploaded for each',
            'Live GPS captured at each site',
            'Every property shortlisted or rejected, with a reason',
          ],
          must: ['At least 5 properties captured', 'Photos & video uploaded for each'],
        }),
      ],
    }),
    reuse('p2', {
      name: 'Phase 2 — Site Evaluation',
      slaDays: 5,
      description:
        'Each shortlisted property goes through four independent expert assessments — '
        + 'feasibility, financial, operational and technical — consolidated into one comparable report.',
      exitCriteria: 'One final property selected and approved with signature.',
      gate: {
        label: 'Gate 1 — Property Approved',
        approver: 'MD',
        unlocks: 'Commercial negotiation on exactly one selected property',
      },
      whatWhoWhenHow: [
        w('Feasibility Assessment', 'Feasibility Expert', '2 days', 'Form + AI prefill'),
        w('Financial Assessment', 'Finance Expert', '2 days', 'Form (human-driven)'),
        w('Operational Assessment', 'Operations Expert', '2 days', 'Form + AI prefill'),
        w('Technical Assessment', 'Technical Expert', '2 days', 'Site visit + form'),
        w('Consolidated report generation', 'System', 'Instant on completion', 'Auto-compiled PDF'),
        w('Approve / Reject property', 'MD', 'Within 2 days', 'Digital approval with reason'),
      ],
      // Four assessors, four separate assignments — each lands in one person's
      // My Tasks and opens that person's own form (`form` names which one).
      tasks: [
        job('p2_feasibility', 'Do the Feasibility assessment', D.EXPANSION, 2, P.HIGH, {
          approval: false, // the submitted assessment record is what gets approved
          who: 'Feasibility Expert', when: '2 days', form: 'feasibility',
          how: 'Open the Feasibility form on each shortlisted property. AI pre-fills competition, footfall and audience — you validate and give the recommendation.',
          list: ['Catchment & audience reviewed', 'Competition checked', 'Recommendation with rating given'],
          must: ['Recommendation with rating given'],
        }),
        job('p2_financial', 'Do the Financial assessment', D.FINANCE, 2, P.HIGH, {
          approval: false, // the submitted assessment record is what gets approved
          who: 'Finance Expert', when: '2 days', form: 'financial',
          how: 'Open the Financial form. Human-driven — AI is used only for city benchmarks.',
          list: ['Rent vs projected revenue done', 'Setup & monthly cost estimated', 'Break-even and ROI calculated'],
          must: ['Break-even and ROI calculated'],
        }),
        job('p2_operational', 'Do the Operational assessment', D.OPERATIONS, 2, P.HIGH, {
          approval: false, // the submitted assessment record is what gets approved
          who: 'Operations Expert', when: '2 days', form: 'operational',
          how: 'Open the Operational form — shifts, staffing, permitted hours, customer flow.',
          list: ['Shift feasibility checked', 'Staffing requirement set', 'Landlord operating hours confirmed'],
          must: ['Shift feasibility checked'],
        }),
        job('p2_technical', 'Do the Technical assessment', D.PROJECTS, 2, P.HIGH, {
          approval: false, // the submitted assessment record is what gets approved
          who: 'Technical Expert', when: '2 days — site visit required', form: 'technical',
          how: 'Visit the site, then fill the Technical form — civil, power, water, fire NOC, HVAC, ceiling height.',
          list: ['Site visited', 'Power & water load checked', 'Fire safety / NOC feasibility checked', 'Ceiling height recorded'],
          must: ['Site visited', 'Fire safety / NOC feasibility checked'],
        }),
        job('p2_decision', 'Select the final property', D.EXPANSION, 2, P.CRITICAL, {
          approval: false, // this task IS the decision
          who: 'MD', when: 'Within 2 days of all four being complete',
          how: 'Read the consolidated report, then approve exactly one property or reject with a reason. Digitally signed.',
          list: ['All four assessments reviewed', 'One property approved', 'Digital signature recorded'],
          must: ['One property approved', 'Digital signature recorded'],
        }),
      ],
    }),
    reuse('p3', {
      // Each commercial document (LOI, lease, legal, deposit, NOCs…) is
      // submitted as a record and APPROVED AS A RECORD — the MD signs the
      // document itself. The task that opened it finishes when its doer
      // marks it done; a second approval on the task queued everything twice.
      tasks: (legacy.p3.tasks || []).map((task) => ({ ...task, approval: { required: false } })),
      name: 'Phase 3 — Commercial Closure',
      slaDays: 7,
      description:
        'Negotiation, LOI and lease for the selected property. LOI approval is the hard '
        + 'gate: every downstream stream unlocks from here, and the rent-free fit-out period starts running.',
      exitCriteria: 'LOI approved and lease executed; downstream parallel streams released.',
      gate: {
        label: 'Gate 2 — LOI Approved',
        approver: 'MD',
        unlocks: 'All parallel streams: design, vendors, procurement and site execution',
      },
      whatWhoWhenHow: [
        w('Negotiate & submit counter-proposal', 'PM / MD', '3–7 days', 'Counter-proposal vs landlord quote'),
        w('Issue and sign LOI', 'MD', 'On agreement', 'Document upload + OCR'),
        w('Execute Lease / Rent Agreement', 'Legal / PM', 'As agreed', 'Document upload + OCR'),
        w('Initiate statutory NOCs', 'PM / Compliance', 'Parallel, ongoing', 'Compliance tracker'),
        w('Release downstream streams', 'System', 'On LOI approval', 'Auto-trigger'),
      ],
    }),
    // Sits between the lease and the parallel streams: drawings are drawn for
    // the game set chosen here, and vendors are quoted against it.
    projectPlanning,
    // Hangs off Project Planning and nothing else. The day the games are
    // agreed the headcount is known, so hiring can open that day — and it
    // feeds no other phase, which is why nothing downstream waits on it.
    hrHiring,
    designDrawings,
    vendorIdentification,
    planningOutput,
    // NEW. Sits between the BOQ and the purchase orders because that is where
    // it belongs: quantities are known, so now the agreement can be signed —
    // and nothing may be ordered until it is. See `contracts`.
    contracts,
    procurement,
    reuse('p6', {
      name: 'Phase 10 — Site Execution / Civil Works',
      parallelGroup: GROUP.BUILD_PROCURE,
      // The ten department modules carry over untouched; the Daily Site
      // Report joins them as an eleventh form, and the Site Supervisor gets
      // the task that opens it. See seed/dailySiteReport.js.
      assessmentTypes: [...(legacy.p6.assessmentTypes || []), DAILY_SITE_REPORT_TYPE],
      // THREE tasks, deliberately. The document's Phase 7 is three parallel
      // streams — the site builds, HR hires, IT wires — and each stream is
      // one person's clear job. The five oversight rows this used to carry
      // ("track status", "manage dependencies") were nobody's actual work
      // and buried the real three in every task list.
      tasks: [
        DAILY_SITE_REPORT_TASK,
        job('p6_hiring', 'Start hiring for this centre', D.HR, 12, P.HIGH, {
          appPath: '/hrms/requisitions',
          who: 'HR / Hiring owner', when: 'Start within 3 days of site handover',
          how: 'Open HRMS and create a requisition for every role this centre needs — the centre presets (Game Masters ×4, Centre Manager…) are one click. Draft each JD with AI, open applications, and share the public apply link on WhatsApp and job portals. Move candidates through the pipeline as interviews happen; Phase 8 checks the hired count against headcount.',
          list: ['Requisition created for every role', 'JDs approved and applications open', 'Apply link shared (WhatsApp / portals)', 'First interviews scheduled'],
          must: ['Requisition created for every role', 'JDs approved and applications open'],
        }),
        job('p6_tech', 'Get the site technically ready', D.IT, 12, P.HIGH, {
          who: 'IT / Technical', when: 'Alongside civil works',
          how: 'Work with the contractor while the walls are open: internet line ordered, network and CCTV cable routes laid, power points placed to the game layout, control-room space kept. Phase 10 installs onto what you rough-in here — anything missed now means breaking finished walls later.',
          list: ['Internet connection ordered', 'Network & CCTV cabling routed', 'Power points as per game layout', 'Control room space ready'],
          must: ['Network & CCTV cabling routed', 'Power points as per game layout'],
        }),
      ],
      description:
        'Physical construction on site, reported daily by the site supervisor from a '
        + 'mobile-friendly form designed to take under two minutes.',
      exitCriteria: 'Civil and fit-out works complete as per approved drawings and BOQ.',
      whatWhoWhenHow: [
        w('Daily site progress report', 'Site Supervisor', 'Every working day', 'Mobile daily form'),
        w('Hiring for the centre', 'HR', 'Parallel with the build', 'HRMS — requisitions, AI JDs, pipeline'),
        w('Technical rough-in', 'IT', 'Parallel with the build', 'Cabling, power, connectivity'),
        w('Track against Gantt', 'System', 'Continuous', 'Auto plan-vs-actual'),
      ],
    }),
    qualityCheck,
    installation,
    trialRun,
    reuse('p8', {
      name: 'Phase 14 — Readiness Checklist',
      description:
        'The final consolidated gate. Every department independently confirms its own '
        + 'readiness; mandatory items block launch, optional items are tracked but do not.',
      exitCriteria: 'All mandatory departmental checklists approved.',
      gate: {
        label: 'Gate 3 — Launch Clearance',
        approver: 'All Department Heads → Director',
        unlocks: 'Branch opening and handover to Operations',
      },
      whatWhoWhenHow: [
        w('Complete departmental checklist', 'Each Department Head', 'Rolling, before launch', 'Departmental checklist screen'),
        w('Department approval', 'Department Head', 'On completion', 'Digital sign-off'),
        w('Consolidated readiness review', 'Operations Head / MD', 'Before launch', 'Readiness dashboard'),
      ],
      // 81 one-item tasks → one task per department, each carrying its items.
      tasks: collapseByCategory('p8', 'Readiness'),
    }),
    reuse('p9', {
      name: 'Phase 15 — Branch Opening / Handover',
      description:
        'Formal go-live and transfer of the completed site to the operations team, with the full handover pack.',
      exitCriteria: 'Branch live; handover accepted by Operations.',
      whatWhoWhenHow: [
        w('Final approval', 'Director / MD', '3 days', 'Digital approval'),
        w('Handover to Operations', 'Project Manager → Operations Head', 'On approval', 'Handover checklist & sign-off'),
        w('Branch go-live', 'Operations', 'Launch date', 'Live status change'),
      ],
      // 60 one-item tasks → one per launch area, each carrying its items.
      tasks: collapseByCategory('p9', 'Go-live'),
    }),
    reuse('p10', {
      name: 'Phase 16 — Closure & Delay Analysis',
      description:
        'Plan versus actual for every phase, department-wise delay attribution, budget '
        + 'variance and vendor performance — the learning that feeds back into the template.',
      exitCriteria: 'Closure report accepted; project archived but permanently searchable.',
      whatWhoWhenHow: [
        w('Compile plan vs actual', 'System', 'Automatic', 'Baseline vs actual engine'),
        w('Delay analysis', 'Project Manager', 'On closure', 'Variance report'),
        w('Lessons learned', 'Project Manager / MD', 'On closure', 'Closure form'),
        w('Close project', 'Project Manager', 'On acceptance', 'Status change to Closed'),
      ],
    }),
  ],
});

export default clientFlowTemplate;
