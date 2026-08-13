import {
  DEPARTMENTS as D,
  PRIORITY as P,
  TEMPLATE_STATUS,
  MASTER_DATA_FIELD_TYPES as F,
} from '../core/constants/index.js';
import { storeLaunchTemplate, t, withOrder } from './storeLaunchTemplate.js';

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
  taskCategory: opts.category,
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
  name: 'Phase 4 — Design & Drawings',
  color: '#6366f1',
  slaDays: 10,
  ownerDepartment: D.PROJECTS,
  description:
    'The architect prepares layouts for the actual site area and shape. Multiple '
    + 'drawing rounds are expected — every revision is kept, and only the latest '
    + 'approved one is live.',
  parallelGroup: GROUP.DESIGN_VENDOR,
  exitCriteria: 'Final drawing set approved and signed.',
  whatWhoWhenHow: [
    w('Prepare drawings (Phase 1 & Phase 2 sets)', 'Architect', 'Within 10 days', 'CAD / DWG upload'),
    w('Review drawings', 'Project Manager / Operations', '2 days per round', 'Review screen with comments'),
    w('Revise as per comments', 'Architect', 'As required', 'New revision upload'),
    w('Approve final drawings', 'MD / Operations Head', 'On final round', 'Digital signature'),
  ],
  captureMode: 'collection',
  recordNoun: 'Drawing',
  masterDataSchema: [
    {
      key: 'drawing_name', label: 'Drawing Name', type: F.TEXT, required: true,
      section: 'Drawing', order: 0,
    },
    {
      key: 'drawing_type', label: 'Drawing Type', type: F.SELECT, required: true,
      section: 'Drawing', order: 1,
      // The standard ~10-drawing set the template pre-loads (client doc §7 Ph4).
      options: [
        'Layout Plan', 'Game Zoning', 'Electrical', 'Plumbing', 'HVAC',
        'False Ceiling', 'Flooring', 'Furniture', 'Signage', 'Fire Line', 'Other',
      ],
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
    job('p11_draw', 'Create the drawings for this property', D.PROJECTS, 10, P.HIGH, {
      who: 'Architect / Interior Designer', when: 'Within 10 days',
      how: 'Draw the standard set for this site\'s actual area and shape, then upload each one. Upload a new revision each round — nothing is overwritten.',
      list: ['Site measurements confirmed', 'Layout & game zoning drafted', 'Full standard set uploaded'],
      must: ['Site measurements confirmed', 'Full standard set uploaded'],
    }),
    job('p11_approve', 'Review and approve the drawings', D.OPERATIONS, 4, P.CRITICAL, {
      who: 'Project Manager → MD / Operations Head', when: '2 days per round',
      how: 'Comment on each drawing, send back for revision if needed, then sign off the final set. Site work can only use the approved set.',
      list: ['Checked against the technical assessment', 'Fire-line & exit clearances checked', 'Final set signed off'],
      must: ['Final set signed off'],
    }),
  ],
};

/** Phase 4B — Vendor Identification & Finalisation (parallel stream B). §7 Phase 4B. */
const vendorIdentification = {
  key: 'p12',
  name: 'Phase 4B — Vendor Identification',
  color: '#0ea5e9',
  slaDays: 10,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Runs alongside drawings. The category checklist is pre-loaded so no trade is '
    + 'forgotten, quotations are compared side by side, and one vendor is finalised per category.',
  parallelGroup: GROUP.DESIGN_VENDOR,
  exitCriteria: 'Vendors finalised per category.',
  whatWhoWhenHow: [
    w('Circulate vendor checklist by category', 'Project Manager', 'Day 1', 'Pre-loaded checklist'),
    w('Collect quotations', 'Project Manager / Procurement', 'Within 10 days', 'Quotation upload & comparison'),
    w('Finalise vendors', 'Project Manager / MD', 'Within 10 days', 'Comparison + approval'),
  ],
  captureMode: 'collection',
  recordNoun: 'Vendor',
  masterDataSchema: [
    { key: 'vendor_name', label: 'Vendor Name', type: F.TEXT, required: true, section: 'Vendor', order: 0 },
    {
      key: 'category', label: 'Category', type: F.SELECT, required: true, section: 'Vendor', order: 1,
      options: [
        'Civil', 'Furniture', 'Electrical', 'Signage', 'Windows', 'Painting',
        'HVAC', 'Fire', 'IT & Networking', 'AV', 'Game Props', 'Flooring', 'Housekeeping',
      ],
    },
    { key: 'contact_person', label: 'Contact Person', type: F.TEXT, section: 'Vendor', order: 2 },
    { key: 'contact_phone', label: 'Contact Number', type: F.TEXT, section: 'Vendor', order: 3 },
    { key: 'address', label: 'Address', type: F.TEXTAREA, section: 'Vendor', order: 4 },
    { key: 'gst', label: 'GST Number', type: F.TEXT, section: 'Statutory', order: 5 },
    { key: 'pan', label: 'PAN', type: F.TEXT, section: 'Statutory', order: 6 },
    { key: 'bank_details', label: 'Bank Details', type: F.TEXTAREA, section: 'Statutory', order: 7 },
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
  name: 'Phase 5 — BOQ, Budget & Gantt',
  color: '#f59e0b',
  slaDays: 2,
  ownerDepartment: D.PROJECTS,
  description:
    'Approved drawings plus finalised vendor rates converge into the plan the MD '
    + 'monitors for the rest of the project. The Gantt is the primary tracking view; '
    + 'the approved plan is frozen as the baseline so all later slippage is measurable.',
  exitCriteria: 'BOQ, budget and Gantt approved. Baseline frozen.',
  whatWhoWhenHow: [
    w('Generate BOQ from approved drawings', 'Project Manager', 'Within 2 days', 'BOQ builder (item, qty, unit, rate)'),
    w('Derive budget from BOQ', 'System', 'Instant', 'Rate presets × quantities'),
    w('Build Gantt chart', 'Project Manager / System', 'Within 2 days', 'Auto-generated from template + lead times'),
    w('Approve budget & timeline', 'MD', '2 days', 'Digital approval'),
  ],
  captureMode: 'collection',
  recordNoun: 'BOQ Item',
  masterDataSchema: [
    { key: 'item', label: 'Item', type: F.TEXT, required: true, section: 'BOQ Line', order: 0 },
    { key: 'description', label: 'Description', type: F.TEXTAREA, section: 'BOQ Line', order: 1 },
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
      helpText: 'Quantity × Rate.',
    },
    { key: 'vendor', label: 'Vendor', type: F.TEXT, section: 'BOQ Line', order: 7 },
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
  ],
  tasks: [
    t('p13_t1', 'Generate BOQ from approved drawings', D.PROJECTS, 2, P.CRITICAL,
      ['Every drawing costed', 'Quantities cross-checked against drawing areas', 'Rates applied from rate master'],
      ['Every drawing costed', 'Quantities cross-checked against drawing areas']),
    t('p13_t2', 'Derive budget from BOQ', D.FINANCE, 1, P.HIGH,
      ['Category-wise allocation set', 'Contingency added', 'Compared against estimated budget at initiation'],
      ['Category-wise allocation set']),
    t('p13_t3', 'Build Gantt chart', D.PROJECTS, 2, P.CRITICAL,
      ['All phases and tasks scheduled', 'Dependencies linked', 'Critical path identified', 'Lead times counted in calendar days'],
      ['All phases and tasks scheduled', 'Dependencies linked']),
    t('p13_t4', 'Approve budget & timeline', D.FINANCE, 2, P.CRITICAL,
      ['Budget approved', 'Timeline approved', 'Baseline frozen'],
      ['Budget approved', 'Baseline frozen']),
  ],
};

/** Phase 6 — Documentation & Vendor Agreements. §7 Phase 6. */
const vendorAgreements = {
  key: 'p14',
  name: 'Phase 6 — Vendor Agreements',
  color: '#8b5cf6',
  slaDays: 2,
  ownerDepartment: D.LEGAL,
  description:
    'Pre-set agreement formats are issued to every finalised vendor so scope, time, '
    + 'penalty and reward are contractually fixed before any work starts.',
  exitCriteria: 'All vendor agreements signed and filed.',
  whatWhoWhenHow: [
    w('Generate agreements from preset format', 'Project Manager', 'Within 2 days', 'Template merge'),
    w('Collect signatures from all vendors', 'Project Manager', 'Within 2 days', 'Digital + physical'),
    w('Upload & file', 'Project Manager', 'On receipt', 'Upload + physical file reference'),
  ],
  captureMode: 'collection',
  recordNoun: 'Agreement',
  masterDataSchema: [
    { key: 'vendor_name', label: 'Vendor Name', type: F.TEXT, required: true, section: 'Agreement', order: 0 },
    { key: 'agreement_number', label: 'Agreement Number', type: F.TEXT, required: true, section: 'Agreement', order: 1 },
    { key: 'scope_of_work', label: 'Scope of Work', type: F.TEXTAREA, required: true, section: 'Terms', order: 2 },
    { key: 'timeline', label: 'Agreed Timeline', type: F.TEXT, section: 'Terms', order: 3 },
    { key: 'penalty_clause', label: 'Penalty Clause', type: F.TEXTAREA, section: 'Terms', order: 4 },
    {
      key: 'reward_clause', label: 'Reward / Early-Completion Clause', type: F.TEXTAREA,
      section: 'Terms', order: 5,
    },
    { key: 'payment_milestones', label: 'Payment Milestones', type: F.TEXTAREA, section: 'Terms', order: 6 },
    { key: 'warranty', label: 'Warranty', type: F.TEXT, section: 'Terms', order: 7 },
    { key: 'sent_date', label: 'Sent Date', type: F.DATE, section: 'Tracking', order: 8 },
    { key: 'signed_date', label: 'Signed Date', type: F.DATE, section: 'Tracking', order: 9 },
    { key: 'signatory', label: 'Signatory', type: F.TEXT, section: 'Tracking', order: 10 },
    {
      key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Tracking', order: 11,
      options: ['Drafted', 'Sent', 'Signed', 'Filed'],
    },
    {
      key: 'physical_file_location', label: 'Physical File Location', type: F.TEXT,
      section: 'Tracking', order: 12,
      helpText: 'Where the hard copy is filed — the soft copy alone is not the record.',
    },
    {
      key: 'soft_copy', label: 'Signed Copy', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Tracking', order: 13,
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 14 },
  ],
  tasks: [
    t('p14_t1', 'Generate agreements from preset format', D.LEGAL, 2, P.HIGH,
      ['Format merged per vendor', 'Scope, penalty and reward clauses filled'],
      ['Scope, penalty and reward clauses filled']),
    t('p14_t2', 'Collect signatures from all vendors', D.LEGAL, 2, P.HIGH,
      ['All agreements signed', 'Signatory recorded'],
      ['All agreements signed']),
    t('p14_t3', 'Upload & file', D.LEGAL, 1, P.MEDIUM,
      ['Soft copy uploaded', 'Physical file location recorded'],
      ['Soft copy uploaded']),
  ],
};

/** Phase 7 — Procurement & Manufacturing (parallel). §7 Phase 7. */
const procurement = {
  key: 'p15',
  name: 'Phase 7 — Procurement & Manufacturing',
  color: '#14b8a6',
  slaDays: 45,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Game items, custom furniture and long-lead materials are procured and manufactured '
    + 'while civil work proceeds on site. IT, Marketing and HR pre-launch streams run in '
    + 'parallel here rather than queueing behind construction.',
  parallelGroup: GROUP.BUILD_PROCURE,
  exitCriteria: 'All materials ordered, with dispatch and delivery dates confirmed.',
  whatWhoWhenHow: [
    w('Procure all game items', 'Store Manager', '30 days', 'Indent → PO → checklist'),
    w('Procure / manufacture custom furniture', 'Project Manager', '45 days', 'Order + factory checklist'),
    w('Raise factory indents & purchase orders', 'Store / Procurement', 'On BOQ approval', 'Auto-triggered by template'),
    w('IT / networking procurement', 'IT Department', 'As per Gantt', 'Departmental task'),
    w('Marketing & HR pre-launch tasks', 'Marketing / HR Heads', 'As per Gantt', 'Departmental tasks'),
  ],
  captureMode: 'collection',
  recordNoun: 'Indent / PO',
  masterDataSchema: [
    { key: 'indent_number', label: 'Indent Number', type: F.TEXT, section: 'Order', order: 0 },
    { key: 'po_number', label: 'PO Number', type: F.TEXT, section: 'Order', order: 1 },
    { key: 'vendor', label: 'Vendor', type: F.TEXT, required: true, section: 'Order', order: 2 },
    {
      key: 'stream', label: 'Stream', type: F.SELECT, required: true, section: 'Order', order: 3,
      // The parallel departmental streams the client document names explicitly.
      options: ['Game Items', 'Custom Furniture', 'Civil Material', 'IT & Networking', 'Marketing', 'HR'],
    },
    { key: 'items', label: 'Items', type: F.TEXTAREA, required: true, section: 'Order', order: 4 },
    { key: 'quantity', label: 'Quantity', type: F.NUMBER, section: 'Order', order: 5 },
    { key: 'rate', label: 'Rate', type: F.CURRENCY, section: 'Order', order: 6 },
    { key: 'value', label: 'Total Value', type: F.CURRENCY, section: 'Order', order: 7 },
    {
      key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Progress', order: 8,
      // The full chain from the client document — one vocabulary end to end.
      options: [
        'Ordered', 'In Production', 'QC Passed', 'Dispatched',
        'In Transit', 'Delivered', 'Received (GRN)', 'Installed',
      ],
    },
    { key: 'production_stage', label: 'Production Stage', type: F.TEXT, section: 'Progress', order: 9 },
    {
      key: 'qc_before_dispatch', label: 'QC Passed Before Dispatch', type: F.BOOLEAN,
      section: 'Progress', order: 10,
    },
    { key: 'expected_dispatch', label: 'Expected Dispatch Date', type: F.DATE, section: 'Dates', order: 11 },
    { key: 'expected_delivery', label: 'Expected Delivery Date', type: F.DATE, required: true, section: 'Dates', order: 12 },
    { key: 'payment_milestone', label: 'Payment Milestone', type: F.TEXT, section: 'Dates', order: 13 },
    {
      key: 'pending_quantity', label: 'Pending Quantity', type: F.NUMBER, section: 'Dates', order: 14,
      helpText: 'For partial deliveries — what is still owed.',
    },
    {
      key: 'photographs', label: 'Photographs of Finished Items', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Evidence', order: 15,
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 16 },
  ],
  tasks: [
    t('p15_t1', 'Raise factory indents & purchase orders', D.PROCUREMENT, 3, P.CRITICAL,
      ['Indents raised against approved BOQ', 'POs issued to agreed vendors', 'Agreement signed before PO release'],
      ['POs issued to agreed vendors', 'Agreement signed before PO release']),
    t('p15_t2', 'Procure all game items', D.PROCUREMENT, 30, P.CRITICAL,
      ['All game items ordered', 'Dispatch dates confirmed', 'Delivery risk reviewed'],
      ['All game items ordered', 'Dispatch dates confirmed']),
    t('p15_t3', 'Procure / manufacture custom furniture', D.INTERIOR, 45, P.HIGH,
      ['Production started', 'Factory QC passed', 'Dispatch cleared'],
      ['Factory QC passed']),
    t('p15_t4', 'IT & networking procurement', D.IT, 20, P.HIGH,
      ['Internet connection ordered', 'Network hardware ordered', 'POS / booking terminals ordered'],
      ['Internet connection ordered']),
    t('p15_t5', 'Marketing & HR pre-launch tasks', D.MARKETING, 30, P.MEDIUM,
      ['Launch campaign planned', 'Hiring plan started', 'Staff training scheduled'],
      ['Launch campaign planned']),
  ],
};

/** Phase 9 — Quality Check. §7 Phase 9. */
const qualityCheck = {
  key: 'p16',
  name: 'Phase 9 — Quality Check',
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
      key: 'severity', label: 'Severity', type: F.SELECT, section: 'Inspection', order: 3,
      options: ['Critical', 'Major', 'Minor'],
      helpText: 'Only meaningful on a Fail — drives how hard the gate blocks.',
    },
    { key: 'observation', label: 'Observation', type: F.TEXTAREA, section: 'Inspection', order: 4 },
    {
      key: 'evidence', label: 'Photographic Evidence', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Inspection', order: 5,
    },
    { key: 'responsible_party', label: 'Responsible Party', type: F.TEXT, section: 'Rectification', order: 6 },
    { key: 'rectification_due', label: 'Rectification Due Date', type: F.DATE, section: 'Rectification', order: 7 },
    {
      key: 'rectification_status', label: 'Rectification Status', type: F.SELECT,
      options: ['Open', 'In Progress', 'Rectified', 'Re-checked & Closed'],
      section: 'Rectification', order: 8,
    },
    {
      key: 'closure_evidence', label: 'Closure Evidence', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Rectification', order: 9,
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 10 },
  ],
  tasks: [
    t('p16_t1', 'Physical site inspection', D.OPERATIONS, 2, P.CRITICAL,
      ['Full site walked', 'Every QC area covered'],
      ['Every QC area covered']),
    t('p16_t2', 'Complete QC checklist', D.OPERATIONS, 2, P.CRITICAL,
      ['Every item marked Pass / Fail / NA', 'Photographic evidence attached to each Fail'],
      ['Every item marked Pass / Fail / NA']),
    t('p16_t3', 'Report issues & raise rectification', D.OPERATIONS, 1, P.HIGH,
      ['Issue register filled', 'Owner and due date set on every Fail'],
      ['Owner and due date set on every Fail']),
    t('p16_t4', 'Rectify & re-check', D.CONSTRUCTION, 5, P.CRITICAL,
      ['All Critical and Major fails rectified', 'Re-inspection passed', 'Closure evidence attached'],
      ['All Critical and Major fails rectified', 'Re-inspection passed']),
  ],
};

/** Phase 10 — Logistics & Dispatch. §7 Phase 10. */
const logistics = {
  key: 'p17',
  name: 'Phase 10 — Logistics & Dispatch',
  color: '#0891b2',
  slaDays: 7,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Movement of manufactured and procured items from factory and warehouse to site, '
    + 'timed against installation readiness. A short or damaged receipt raises a '
    + 'replacement task on the vendor automatically.',
  exitCriteria: 'All materials delivered and receipted at site.',
  whatWhoWhenHow: [
    w('Material readiness check', 'Logistic Head', 'As per lead time', 'Readiness checklist'),
    w('Dispatch planning', 'Logistic Head', 'As per lead time', 'Dispatch schedule'),
    w('Material transfer & confirmation', 'Logistic Head / Store Manager', 'On dispatch', 'Transfer note'),
    w('Delivery tracking & receipt', 'Site Supervisor', 'On arrival', 'GRN with photos'),
  ],
  captureMode: 'collection',
  recordNoun: 'Dispatch',
  masterDataSchema: [
    { key: 'item_list', label: 'Items', type: F.TEXTAREA, required: true, section: 'Dispatch', order: 0 },
    { key: 'dispatch_date', label: 'Dispatch Date', type: F.DATE, required: true, section: 'Dispatch', order: 1 },
    { key: 'transporter', label: 'Transporter', type: F.TEXT, section: 'Dispatch', order: 2 },
    { key: 'vehicle_number', label: 'Vehicle Number', type: F.TEXT, section: 'Dispatch', order: 3 },
    { key: 'lr_docket', label: 'LR / Docket Number', type: F.TEXT, section: 'Dispatch', order: 4 },
    { key: 'expected_arrival', label: 'Expected Arrival', type: F.DATE, section: 'Dispatch', order: 5 },
    { key: 'dispatched_quantity', label: 'Dispatched Quantity', type: F.NUMBER, section: 'Dispatch', order: 6 },
    { key: 'received_date', label: 'Received Date', type: F.DATE, section: 'Receipt', order: 7 },
    { key: 'received_quantity', label: 'Received Quantity', type: F.NUMBER, section: 'Receipt', order: 8 },
    { key: 'grn_number', label: 'GRN Number', type: F.TEXT, section: 'Receipt', order: 9 },
    {
      key: 'damage_shortage', label: 'Damage / Shortage Report', type: F.TEXTAREA,
      section: 'Receipt', order: 10,
      helpText: 'Anything recorded here raises a replacement task on the vendor.',
    },
    {
      key: 'receipt_photos', label: 'Receipt Photographs', type: F.FILE, multiple: true,
      accept: EVIDENCE, section: 'Receipt', order: 11,
    },
    {
      key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Receipt', order: 12,
      options: ['Ready to Dispatch', 'Dispatched', 'In Transit', 'Delivered', 'Received (GRN)', 'Short / Damaged'],
    },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 13 },
  ],
  tasks: [
    t('p17_t1', 'Material readiness check', D.PROCUREMENT, 2, P.HIGH,
      ['All items accounted for', 'Readiness confirmed against installation date'],
      ['All items accounted for']),
    t('p17_t2', 'Dispatch planning', D.PROCUREMENT, 2, P.HIGH,
      ['Dispatch schedule prepared', 'Transporter booked'],
      ['Dispatch schedule prepared']),
    t('p17_t3', 'Material transfer & confirmation', D.PROCUREMENT, 3, P.MEDIUM,
      ['Transfer note issued', 'LR / docket recorded'],
      ['Transfer note issued']),
    t('p17_t4', 'Delivery tracking & receipt', D.OPERATIONS, 2, P.HIGH,
      ['GRN raised', 'Damage / shortage recorded with photos', 'Replacement raised where needed'],
      ['GRN raised']),
  ],
};

/** Phase 11 — Assembly & Installation. §7 Phase 11. */
const installation = {
  key: 'p18',
  name: 'Phase 11 — Assembly & Installation',
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
    { key: 'game_or_zone', label: 'Game / Zone', type: F.TEXT, required: true, section: 'Installation', order: 0 },
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
    t('p18_t1', 'Deploy resources as per plan', D.AUTOMATION, 2, P.HIGH,
      ['Team mobilised', 'Setup instructions issued per game'],
      ['Team mobilised']),
    t('p18_t2', 'Install games, props & AV', D.AUTOMATION, 10, P.CRITICAL,
      ['All games installed', 'Props placed to layout', 'AV commissioned'],
      ['All games installed']),
    t('p18_t3', 'Install IT, network & systems', D.IT, 5, P.CRITICAL,
      ['Internet live', 'Network & CCTV commissioned', 'POS / booking terminal live', 'Inventory system integrated'],
      ['Internet live', 'POS / booking terminal live']),
    t('p18_t4', 'Verify work completion', D.PROJECTS, 2, P.HIGH,
      ['Every installation checklist verified', 'Photographs attached'],
      ['Every installation checklist verified']),
  ],
};

/** Phase 12 — Testing & Trial Run. §7 Phase 12. */
const trialRun = {
  key: 'p19',
  name: 'Phase 12 — Testing & Trial Run',
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
    { key: 'observations', label: 'Observations', type: F.TEXTAREA, section: 'Test Run', order: 5 },
    {
      key: 'customer_experience', label: 'Customer Experience Notes', type: F.TEXTAREA,
      section: 'Test Run', order: 6,
    },
    { key: 'safety_observations', label: 'Safety Observations', type: F.TEXTAREA, section: 'Test Run', order: 7 },
    { key: 'error_description', label: 'Error Description', type: F.TEXTAREA, section: 'Error Log', order: 8 },
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
    t('p19_t1', 'Physical playing & testing', D.OPERATIONS, 7, P.CRITICAL,
      ['Every game played end to end', 'Duration and flow recorded', 'Safety checked per game'],
      ['Every game played end to end', 'Safety checked per game']),
    t('p19_t2', 'Error identification & logging', D.OPERATIONS, 3, P.HIGH,
      ['Every error logged with severity', 'Owner assigned per error'],
      ['Every error logged with severity']),
    t('p19_t3', 'Rectify errors', D.AUTOMATION, 5, P.CRITICAL,
      ['All Critical errors closed', 'All Major errors closed'],
      ['All Critical errors closed']),
    t('p19_t4', 'Re-test until All-OK', D.OPERATIONS, 3, P.CRITICAL,
      ['Re-test passed on every rectified game', 'All-OK confirmed'],
      ['All-OK confirmed']),
    t('p19_t5', 'Staff readiness & mock run', D.HR, 5, P.HIGH,
      ['Training completed', 'Game briefing done', 'SOP acknowledged', 'Mock customer run completed'],
      ['Training completed', 'Mock customer run completed']),
  ],
};

/* ══════════════════════════════════════════════════════════════════════
   The template — client document §6 Phase Map, in order.
   ══════════════════════════════════════════════════════════════════════ */

export const clientFlowTemplate = withOrder({
  name: 'Branch Opening — Client Flow (16 Phases)',
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
    // ── Phase 0 — the spine change. Project Initiation now comes FIRST, so the
    // pipeline is visible from the day a city is chosen rather than appearing
    // only once a property is signed (client doc §7 Phase 0).
    reuse('p4', {
      name: 'Phase 0 — Project Initiation',
      slaDays: 1,
      description:
        'A project exists the moment the intent to open in a city is created — well '
        + 'before any property is finalised — so the pipeline is visible from day one.',
      exitCriteria: 'Project created, code generated, template applied, owners notified.',
      whatWhoWhenHow: [
        w('Create project record', 'MD / PM Head', 'Day 0', 'Short web form'),
        w('Select project type & template', 'MD / PM Head', 'Day 0', 'Dropdown selection'),
        w('Assign project owner', 'MD', 'Day 0', 'User picker'),
        w('Auto-generate task plan', 'System', 'Instant', 'Template engine'),
      ],
    }),
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
      // ONE assignment, not one per property. The consultant visits and fills
      // the property form once per option — ten properties are ten form
      // entries inside this single task, never ten tasks.
      tasks: [
        job('p1_capture', 'Visit the properties and capture each one', D.EXPANSION, 15, P.HIGH, {
          who: 'Property Consultant', when: '7–15 days',
          how: 'Go to each property with the broker and fill the property form on your phone at the site — area, rent, photos, video, live GPS. One entry per property.',
          list: ['Brokers engaged', 'At least 5 properties captured', 'Photos & video uploaded for each', 'Live GPS captured at each site'],
          must: ['At least 5 properties captured', 'Photos & video uploaded for each'],
        }),
        job('p1_shortlist', 'Shortlist or reject each property', D.EXPANSION, 3, P.HIGH, {
          who: 'MD / PM Head', when: 'Within 2 days of listing',
          how: 'Compare the captured properties side by side, read the AI report, then mark each Shortlisted, On Hold or Rejected with a reason.',
          list: ['Every property has a decision', 'Rejection reasons recorded'],
          must: ['Every property has a decision'],
        }),
      ],
    }),
    reuse('p2', {
      name: 'Phase 2 — Site Evaluation (4 Assessments)',
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
          who: 'Feasibility Expert', when: '2 days', form: 'feasibility',
          how: 'Open the Feasibility form on each shortlisted property. AI pre-fills competition, footfall and audience — you validate and give the recommendation.',
          list: ['Catchment & audience reviewed', 'Competition checked', 'Recommendation with rating given'],
          must: ['Recommendation with rating given'],
        }),
        job('p2_financial', 'Do the Financial assessment', D.FINANCE, 2, P.HIGH, {
          who: 'Finance Expert', when: '2 days', form: 'financial',
          how: 'Open the Financial form. Human-driven — AI is used only for city benchmarks.',
          list: ['Rent vs projected revenue done', 'Setup & monthly cost estimated', 'Break-even and ROI calculated'],
          must: ['Break-even and ROI calculated'],
        }),
        job('p2_operational', 'Do the Operational assessment', D.OPERATIONS, 2, P.HIGH, {
          who: 'Operations Expert', when: '2 days', form: 'operational',
          how: 'Open the Operational form — shifts, staffing, permitted hours, customer flow.',
          list: ['Shift feasibility checked', 'Staffing requirement set', 'Landlord operating hours confirmed'],
          must: ['Shift feasibility checked'],
        }),
        job('p2_technical', 'Do the Technical assessment', D.PROJECTS, 2, P.HIGH, {
          who: 'Technical Expert', when: '2 days — site visit required', form: 'technical',
          how: 'Visit the site, then fill the Technical form — civil, power, water, fire NOC, HVAC, ceiling height.',
          list: ['Site visited', 'Power & water load checked', 'Fire safety / NOC feasibility checked', 'Ceiling height recorded'],
          must: ['Site visited', 'Fire safety / NOC feasibility checked'],
        }),
        job('p2_decision', 'Select the final property', D.EXPANSION, 2, P.CRITICAL, {
          who: 'MD', when: 'Within 2 days of all four being complete',
          how: 'Read the consolidated report, then approve exactly one property or reject with a reason. Digitally signed.',
          list: ['All four assessments reviewed', 'One property approved', 'Digital signature recorded'],
          must: ['One property approved', 'Digital signature recorded'],
        }),
      ],
    }),
    reuse('p3', {
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
    designDrawings,
    vendorIdentification,
    planningOutput,
    vendorAgreements,
    procurement,
    reuse('p6', {
      name: 'Phase 8 — Site Execution / Civil Works',
      parallelGroup: GROUP.BUILD_PROCURE,
      description:
        'Physical construction on site, reported daily by the site supervisor from a '
        + 'mobile-friendly form designed to take under two minutes.',
      exitCriteria: 'Civil and fit-out works complete as per approved drawings and BOQ.',
      whatWhoWhenHow: [
        w('Mobilise site team', 'Contractor', 'Within 3 days of handover', 'Team assignment'),
        w('Daily site progress report', 'Site Supervisor', 'Every working day', 'Mobile daily form'),
        w('Supervise & verify', 'Site Engineer / PM', 'Weekly', 'Site visit + verification'),
        w('Track against Gantt', 'System', 'Continuous', 'Auto plan-vs-actual'),
      ],
    }),
    qualityCheck,
    logistics,
    installation,
    trialRun,
    reuse('p8', {
      name: 'Phase 13 — Readiness Checklist',
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
      name: 'Phase 14 — Branch Opening / Handover',
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
      name: 'Phase 15 — Closure & Delay Analysis',
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
