import {
  DEPARTMENTS as D,
  PRIORITY as P,
  TEMPLATE_STATUS,
  MASTER_DATA_FIELD_TYPES as F,
} from '../core/constants/index.js';
import { DAILY_SITE_REPORT_TYPE, DAILY_SITE_REPORT_TASK } from './dailySiteReport.js';
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
      approvedBy: 'Project Manager / Operations Head',
      who: 'Architect / Interior Designer', when: 'Within 10 days',
      how: 'Draw the standard set for this site\'s actual area and shape, then upload each one. Upload a new revision each round — nothing is overwritten.',
      list: ['Site measurements confirmed', 'Layout & game zoning drafted', 'Full standard set uploaded'],
      must: ['Site measurements confirmed', 'Full standard set uploaded'],
    }),
    job('p11_approve', 'Review and approve the drawings', D.OPERATIONS, 4, P.CRITICAL, {
      approval: false, // this task IS the decision
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
    // The PO page emails the vendor at this address — without it the compose
    // dialog's To field could never prefill.
    { key: 'email', label: 'Email', type: F.TEXT, section: 'Vendor', order: 3.5 },
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
      key: 'vendor', label: 'Vendor', type: F.SELECT, section: 'BOQ Line', order: 7,
      // Picked from the Phase 4B vendor master, never typed: the purchase-order
      // page fetches the vendor's phone/email/address by this exact name.
      // `scope: 'global'` — every vendor in the business, not just the ones
      // recorded against THIS project. A supplier finalised on one launch is
      // the same supplier on the next, which is what the Vendors master page
      // shows; scoping this per-project left the dropdown empty on every
      // project except the one where the vendor happened to be entered.
      optionsFromStage: { stageKey: 'p12', field: 'vendor_name', scope: 'global' },
      helpText: 'From the vendor master (Phase 4B / the Vendors page). Add a vendor there and it appears here.',
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
      options: ['Ordered', 'Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged', 'Cancelled'],
      helpText: 'Ordered is the default once the PO is sent. Change it as the vendor reports.',
    },
    { key: 'promised_delivery', label: 'Vendor promised delivery', type: F.DATE, section: 'Order tracking', order: 23, tracker: true },
    { key: 'sent_whatsapp_at', label: 'WhatsApp sent at', type: F.TEXT, section: 'Order tracking', order: 24, tracker: true },
    { key: 'sent_whatsapp_to', label: 'WhatsApp sent to', type: F.TEXT, section: 'Order tracking', order: 25, tracker: true },
    { key: 'sent_email_at', label: 'Email sent at', type: F.TEXT, section: 'Order tracking', order: 26, tracker: true },
    { key: 'sent_email_to', label: 'Email sent to', type: F.TEXT, section: 'Order tracking', order: 27, tracker: true },
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
  ],
  tasks: [
    job('p13_t1', 'Generate the BOQ and raise purchase orders', D.PROJECTS, 2, P.CRITICAL, {
      who: 'Project Manager', when: 'Within 2 days of drawings being approved',
      approvedBy: 'MD',
      how: 'Add one BOQ item per line — item, quantity, rate, vendor. Each line becomes a '
        + 'purchase order you can print and send to the vendor from its Order page.',
      list: ['Every drawing costed', 'Quantities cross-checked against drawing areas', 'Vendor set on each line'],
      must: ['Every drawing costed', 'Quantities cross-checked against drawing areas'],
    }),
    job('p13_t2', 'Derive the budget from the BOQ', D.FINANCE, 1, P.HIGH, {
      who: 'Finance', when: '1 day', approvedBy: 'MD',
      how: 'Total the BOQ by category, add contingency, and compare against the estimated budget from project creation.',
      list: ['Category-wise allocation set', 'Contingency added', 'Compared against the initiation estimate'],
      must: ['Category-wise allocation set'],
    }),
    job('p13_t3', 'Build the Gantt chart', D.PROJECTS, 2, P.CRITICAL, {
      who: 'Project Manager', when: 'Within 2 days', approvedBy: 'MD',
      how: 'Schedule every phase and task with dependencies, in calendar days including weekends. The critical path is what the MD tracks.',
      list: ['All phases and tasks scheduled', 'Dependencies linked', 'Critical path identified'],
      must: ['All phases and tasks scheduled', 'Dependencies linked'],
    }),
    job('p13_t4', 'Approve budget & timeline', D.FINANCE, 2, P.CRITICAL, {
      who: 'MD', when: 'Within 2 days',
      approval: false, // this task IS the decision
      how: 'Review the BOQ totals, budget and Gantt, then approve. The approved plan is frozen as the baseline all slippage is measured against.',
      list: ['Budget approved', 'Timeline approved', 'Baseline frozen'],
      must: ['Budget approved', 'Baseline frozen'],
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
const procurement = {
  key: 'p15',
  name: 'Phase 6 — Purchase Orders & Delivery Tracking',
  color: '#14b8a6',
  slaDays: 45,
  ownerDepartment: D.PROCUREMENT,
  description:
    'Every BOQ line from Phase 5 is a purchase order. Send each one to its vendor, '
    + 'then track it on one sheet — ordered, dispatched, delivered, received — with the '
    + 'PO, indent, challan and GRN numbers, what arrived against what was ordered, and '
    + 'who updated what, when. Runs alongside civil works on site.',
  parallelGroup: GROUP.BUILD_PROCURE,
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
    job('p15_t1', 'Send every purchase order to its vendor', D.PROCUREMENT, 3, P.CRITICAL, {
      who: 'Procurement', when: 'Within 3 days of the BOQ being approved',
      approval: false,
      how: 'Open the order tracker. Each BOQ line has an Order button — check the PO, then send it by WhatsApp or email. The tracker records when it went and to whom.',
      list: ['Every BOQ line sent as a PO', 'PO and indent numbers filled in', 'Vendor confirmed a delivery date'],
      must: ['Every BOQ line sent as a PO'],
    }),
    job('p15_t2', 'Track every order until it is dispatched', D.PROCUREMENT, 45, P.CRITICAL, {
      who: 'Procurement', when: 'Daily, until the last order is dispatched',
      approval: false,
      how: 'In the tracker, change the status as the vendor reports — Dispatched, Delivered — and add the challan / LR number. Late orders show in red; use Chase to draft the follow-up.',
      list: ['Every order marked Dispatched or beyond', 'Challan / LR number recorded', 'Late orders chased'],
      must: ['Every order marked Dispatched or beyond'],
    }),
    job('p15_t3', 'Receive goods at site and record the GRN', D.OPERATIONS, 45, P.HIGH, {
      who: 'Store Manager / Site Supervisor', when: 'On each delivery',
      approval: false,
      how: 'Count what arrived. In the tracker, enter the received quantity, GRN number and received date — the pending quantity and "Partly Received" are worked out for you. Note anything short or damaged.',
      list: ['Received quantity entered for every delivery', 'GRN number recorded', 'Short / damaged items noted'],
      must: ['GRN number recorded'],
    }),
    job('p15_t4', 'Marketing & HR pre-launch preparation', D.MARKETING, 30, P.MEDIUM, {
      who: 'Marketing / HR Heads', when: 'In parallel, as per the Gantt',
      approvedBy: 'MD',
      how: 'Plan the launch campaign and start hiring and training — this stream runs alongside procurement so it is ready by opening day.',
      list: ['Launch campaign planned', 'Hiring plan started', 'Staff training scheduled'],
      must: ['Launch campaign planned'],
    }),
  ],
};

/** Phase 9 — Quality Check. §7 Phase 9. */
const qualityCheck = {
  key: 'p16',
  name: 'Phase 8 — Quality Check',
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
    // The two parallel Phase-7 streams get checked here, not just the walls:
    // is the team being hired, and does the technical rough-in actually work.
    job('p16_hiring_check', 'Check hiring is on track', D.HR, 2, P.HIGH, {
      appPath: '/hrms/overview',
      who: 'HR / Hiring owner', when: 'During QC week',
      how: 'Open the HRMS overview: hired vs needed for this centre. Chase every role still open — trial runs (Phase 11) need the team standing on site.',
      list: ['Hired count reviewed against headcount', 'Every open role has interviews scheduled'],
      must: ['Hired count reviewed against headcount'],
    }),
    job('p16_tech_check', 'Verify the technical setup', D.IT, 2, P.HIGH, {
      who: 'IT / Technical', when: 'During QC week',
      how: 'Test what Phase 7 roughed in: internet live at the site, every power point against the game layout, CCTV and AV routes usable. Log a QC Item with a Fail for anything short — the gate holds it open.',
      list: ['Internet tested at site', 'Power points verified against layout', 'Cable routes verified'],
      must: ['Internet tested at site'],
    }),
  ],
};

/** Phase 10 — Logistics & Dispatch. §7 Phase 10. */
const logistics = {
  key: 'p17',
  name: 'Phase 9 — Logistics & Dispatch',
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
  name: 'Phase 10 — Assembly & Installation',
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
  name: 'Phase 11 — Testing & Trial Run',
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
  name: 'Phase 3B — Project Planning & Games',
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
      // A starting list, editable in the template builder. The client's real
      // master game list is still a pending input (flow document §12), so these
      // are deliberately generic placeholders rather than invented titles.
      options: [
        'Escape Room 1', 'Escape Room 2', 'Escape Room 3', 'Escape Room 4',
        'Escape Room 5', 'Escape Room 6', 'Horror Room', 'Adventure Room',
        'Mystery Room', 'Prison Break', 'Heist Room', 'Sci-Fi Room',
        'VR Zone', 'Party / Event Space', 'Cafe / Lounge',
      ],
      helpText:
        'Pick every game this outlet will run. Guide: 4-5 games for 3,000-5,000 sq.ft, '
        + 'about 12 for 12,000 sq.ft. Replace this list with the master game list once supplied.',
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
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 14 },
  ],
  tasks: [
    job('p20_games', 'Select the games for this outlet', D.OPERATIONS, 2, P.CRITICAL, {
      approvedBy: 'MD',
      who: 'MD / Operations Head', when: 'Within 2 days of the lease being signed',
      how: 'Open the planning form and pick the games this site will hold, based on its confirmed area and shape.',
      list: ['Confirmed area checked', 'Games selected', 'Count agreed against the area'],
      must: ['Games selected'],
    }),
    job('p20_dates', 'Fix the opening and construction dates', D.PROJECTS, 2, P.CRITICAL, {
      approvedBy: 'MD',
      who: 'Project Manager', when: 'Within 2 days',
      how: 'Set construction start, handover, testing and target opening. Every later phase is scheduled from these.',
      list: ['Construction start set', 'Target opening set', 'Testing date set'],
      must: ['Construction start set', 'Target opening set'],
    }),
    job('p20_approve', 'Approve the project plan', D.PROJECTS, 1, P.CRITICAL, {
      approval: false, // this task IS the decision
      who: 'MD', when: 'Within 3 days',
      how: 'Review the games, dates and outline budget, then approve so design and vendor work can start.',
      list: ['Games and dates reviewed', 'Outline budget agreed', 'Plan approved'],
      must: ['Plan approved'],
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
      // ONE assignment, not one per property. The consultant visits and fills
      // the property form once per option — ten properties are ten form
      // entries inside this single task, never ten tasks.
      tasks: [
        // CAPTURE, nothing else. No approval on this task — the capturing is
        // judged in the NEXT task, by a person reading the list; an approval
        // stamp on "I filled forms" was process for its own sake.
        job('p1_capture', 'Capture the properties on site', D.EXPANSION, 15, P.HIGH, {
          approval: false,
          who: 'Property Consultant', when: '7–15 days',
          how: 'At each property, press "Submit Property" and fill the form on your phone right there — area, rent, photos, video, live GPS. One entry per property, again and again: 10–12 captures for a search is normal. Nothing to get approved — just capture them all.',
          list: ['Brokers engaged', 'At least 5 properties captured', 'Photos & video uploaded for each', 'Live GPS captured at each site'],
          must: ['At least 5 properties captured', 'Photos & video uploaded for each'],
        }),
        // REVIEW the list, then decide. This task opens the property list
        // page — every capture side by side — never a blank capture form.
        job('p1_shortlist', 'Review the captured properties & shortlist', D.EXPANSION, 3, P.HIGH, {
          approval: false, // this task IS the decision
          openPhaseOnly: true,
          who: 'MD / PM Head', when: 'Within 2 days of listing',
          how: 'Open the property list — every captured property side by side with its photos, rent and AI report. Open each one, then mark it Shortlisted, On Hold or Rejected with a reason. What you shortlist is exactly what Phase 2 assesses.',
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
          approval: false, // this task IS the decision
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
    // Sits between the lease and the parallel streams: drawings are drawn for
    // the game set chosen here, and vendors are quoted against it.
    projectPlanning,
    designDrawings,
    vendorIdentification,
    planningOutput,
    procurement,
    reuse('p6', {
      name: 'Phase 7 — Site Execution / Civil Works',
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
    logistics,
    installation,
    trialRun,
    reuse('p8', {
      name: 'Phase 12 — Readiness Checklist',
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
      name: 'Phase 13 — Branch Opening / Handover',
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
      name: 'Phase 14 — Closure & Delay Analysis',
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
