import {
  DEPARTMENTS as D,
  PRIORITY as P,
  TEMPLATE_STATUS,
  MASTER_DATA_FIELD_TYPES as F,
} from '../core/constants/index.js';

/**
 * The client's official 10-phase Project Management System workflow: property
 * identification through project closure.
 *
 * Seeded as the *default* template — a new project starts here unless the
 * creator picks another playbook. Nothing in this file is load-bearing: every
 * phase, task, checklist row and assignee can be edited in the template builder.
 */

/**
 * Primary "doer" and backup buddy per department, mirroring `client/src/lib/employees.js`.
 * The buddy carries the task when the primary can't.
 */
const DUO = {
  [D.EXPANSION]: ['emp-exp-001', 'emp-exp-003'],
  [D.LEGAL]: ['emp-leg-001', 'emp-leg-003'],
  [D.PROJECTS]: ['emp-prj-002', 'emp-prj-003'],
  [D.HR]: ['emp-hr-001', 'emp-hr-003'],
  [D.MARKETING]: ['emp-mkt-001', 'emp-mkt-003'],
  [D.FINANCE]: ['emp-fin-001', 'emp-fin-002'],
  [D.OPERATIONS]: ['emp-ops-001', 'emp-ops-002'],
  [D.CONSTRUCTION]: ['emp-con-001', 'emp-con-003'],
  [D.INTERIOR]: ['emp-int-001', 'emp-int-002'],
  [D.PROCUREMENT]: ['emp-pro-001', 'emp-pro-002'],
  [D.AUTOMATION]: ['emp-aut-001', 'emp-aut-002'],
  [D.IT]: ['emp-it-001', 'emp-it-002'],
};

/**
 * Roster members who are busy or on leave. A task whose primary is listed here
 * materializes with `reassignNeeded`, so the buddy is surfaced on day one.
 */
const UNAVAILABLE = new Set([
  'emp-exp-002', 'emp-leg-002', 'emp-prj-001', 'emp-hr-002', 'emp-mkt-002',
  'emp-fin-003', 'emp-ops-003', 'emp-con-002', 'emp-int-003', 'emp-aut-002',
]);

/** Build a template task, deriving assignees from the department duo. */
const t = (key, title, department, estimatedDays, priority, checklist = [], must = [], override = {}) => {
  const [duoPrimary, duoBackup] = DUO[department] || [];
  const primaryAssignee = override.primaryAssignee || duoPrimary;
  const backupAssignee = override.backupAssignee || duoBackup;
  return {
    key,
    title,
    department,
    estimatedDays,
    priority,
    primaryAssignee,
    backupAssignee,
    assignees: [primaryAssignee, backupAssignee].filter(Boolean),
    primaryAssigneeUnavailable: UNAVAILABLE.has(primaryAssignee),
    checklist: checklist.map((label, i) => ({
      label,
      required: must.includes(label),
      order: i,
    })),
  };
};

/**
 * Stamp `order` from array position, so the literal below stays readable and
 * reordering a phase or task never desyncs from a hand-written index.
 */
const withOrder = (template) => ({
  ...template,
  stages: template.stages.map((stage, sIdx) => ({
    ...stage,
    order: sIdx,
    tasks: stage.tasks.map((task, tIdx) => ({ ...task, order: tIdx })),
  })),
});

/**
 * One uniform task-tracking form, reused identically by every Execution (p6)
 * department module — the department itself is already carried by which
 * module card a task is filed under (its `assessmentType`), so there's no
 * separate "Department" field here. Every field maps 1:1 to the Phase 6
 * spec's Task Model (name, assignee, priority, status, progress, dates,
 * dependencies, delay reason, risk level, remarks) plus a multi-file
 * attachments field covering photos/videos/PDF/Excel/CAD/documents.
 */
const executionTaskFields = () => [
  { key: 'task_name', label: 'Task Name', type: F.TEXT, required: true, section: 'Task Details', order: 0 },
  { key: 'priority', label: 'Priority', type: F.SELECT, required: true, options: ['Low', 'Medium', 'High', 'Critical'], section: 'Task Details', order: 1 },
  {
    key: 'status', label: 'Status', type: F.SELECT, required: true, section: 'Task Details', order: 2,
    options: ['Not Started', 'In Progress', 'Completed', 'Delayed', 'Blocked', 'On Hold', 'Cancelled'],
  },
  { key: 'progress_pct', label: 'Progress %', type: F.NUMBER, required: true, placeholder: '0–100', section: 'Task Details', order: 3 },
  { key: 'risk_level', label: 'Risk Level', type: F.SELECT, options: ['Low', 'Medium', 'High'], section: 'Task Details', order: 4 },
  { key: 'assigned_to', label: 'Assigned To', type: F.TEXT, required: true, section: 'Assignment & Schedule', order: 5 },
  { key: 'start_date', label: 'Start Date', type: F.DATE, section: 'Assignment & Schedule', order: 6 },
  { key: 'due_date', label: 'Due Date', type: F.DATE, required: true, section: 'Assignment & Schedule', order: 7 },
  { key: 'completed_date', label: 'Completed Date', type: F.DATE, section: 'Assignment & Schedule', order: 8 },
  { key: 'dependencies', label: 'Dependencies (task names)', type: F.TEXT, helpText: 'Comma-separated names of tasks this depends on', section: 'Dependencies & Delay', order: 9 },
  { key: 'delay_reason', label: 'Delay Reason', type: F.TEXTAREA, section: 'Dependencies & Delay', order: 10 },
  {
    key: 'attachments', label: 'Attachments', type: F.FILE, multiple: true, section: 'Attachments', order: 11,
    accept: '.jpg,.jpeg,.png,.heic,.mp4,.mov,.avi,.pdf,.xls,.xlsx,.csv,.dwg,.dxf,.doc,.docx',
    helpText: 'Photos, videos, PDF, Excel, CAD drawings, documents — unlimited uploads',
  },
  { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 12 },
];

/** One Execution (p6) department module — same task form, own key/name/subtitle. */
const executionModule = (key, name, subtitle) => ({
  key,
  name,
  subtitle,
  masterDataSchema: executionTaskFields(),
});

/**
 * One Store Readiness (p8) checklist module — a straight pre-launch
 * checklist (not a task board), so its form is just N boolean checklist
 * items plus a Remarks/Attachments pair for evidence, same trailing fields
 * every other module form ends with.
 */
const storeReadinessModule = (key, name, subtitle, items) => ({
  key,
  name,
  subtitle,
  masterDataSchema: [
    ...items.map((label, i) => ({
      key: `item_${i + 1}`,
      label,
      type: F.BOOLEAN,
      section: 'Checklist',
      order: i,
    })),
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: items.length },
    {
      key: 'attachments', label: 'Attachments', type: F.FILE, multiple: true, section: 'Attachments', order: items.length + 1,
      accept: '.jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx',
      helpText: 'Photos, certificates, evidence documents — unlimited uploads',
    },
  ],
});

/**
 * One Store Launch (p9) module — the same straight checklist shape as Store
 * Readiness modules (N boolean items + Remarks/Attachments), optionally
 * preceded by a handful of extra fields. Only Go-Live Approval uses
 * `extraFields` — it also carries the Store Summary's sign-off facts (store
 * manager, actual opening date, actual cost) and its own boolean checklist
 * doubles as the page's "Store Launch Checklist" strip / Overall Launch
 * Progress figure.
 */
const storeLaunchModule = (key, name, subtitle, items, extraFields = []) => ({
  key,
  name,
  subtitle,
  masterDataSchema: [
    ...extraFields,
    ...items.map((label, i) => ({
      key: `item_${i + 1}`,
      label,
      type: F.BOOLEAN,
      section: 'Checklist',
      order: extraFields.length + i,
    })),
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: extraFields.length + items.length },
    {
      key: 'attachments', label: 'Attachments', type: F.FILE, multiple: true, section: 'Attachments', order: extraFields.length + items.length + 1,
      accept: '.jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx',
      helpText: 'Photos, certificates, evidence documents — unlimited uploads',
    },
  ],
});

/** Extra sign-off fields carried only by the Go-Live Approval module. */
const goLiveSignoffFields = [
  { key: 'store_manager', label: 'Store Manager', type: F.TEXT, required: true, section: 'Sign-off Details', order: 0 },
  { key: 'actual_opening_date', label: 'Actual Opening Date', type: F.DATE, required: true, section: 'Sign-off Details', order: 1 },
  { key: 'actual_cost', label: 'Actual Cost', type: F.CURRENCY, required: true, section: 'Sign-off Details', order: 2 },
];

/**
 * One Project Closure (p10) module — same straight-checklist shape as Store
 * Readiness/Store Launch modules (N boolean items + Remarks/Attachments),
 * preceded by whatever module-specific facts/figures `extraFields` supplies
 * (e.g. Budget Analysis's planned/actual cost, Vendor Performance's rating).
 * Every module supports unlimited resubmissions, same as every other
 * collection-mode stage — nothing here is single-shot.
 */
const projectClosureModule = (key, name, subtitle, items, extraFields = []) => ({
  key,
  name,
  subtitle,
  masterDataSchema: [
    ...extraFields,
    ...items.map((label, i) => ({
      key: `item_${i + 1}`,
      label,
      type: F.BOOLEAN,
      section: 'Checklist',
      order: extraFields.length + i,
    })),
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: extraFields.length + items.length },
    {
      key: 'attachments', label: 'Attachments', type: F.FILE, multiple: true, section: 'Attachments', order: extraFields.length + items.length + 1,
      accept: '.jpg,.jpeg,.png,.heic,.pdf,.xls,.xlsx,.doc,.docx',
      helpText: 'Photos, certificates, evidence documents — unlimited uploads',
    },
  ],
});

/** Extra facts carried only by the Budget Analysis module — feeds the Project Summary's Budget/Actual Cost/Budget Variance tiles. */
const budgetAnalysisFields = [
  { key: 'planned_budget', label: 'Planned Budget', type: F.CURRENCY, required: true, section: 'Budget Details', order: 0 },
  { key: 'actual_cost', label: 'Actual Cost', type: F.CURRENCY, required: true, section: 'Budget Details', order: 1 },
  { key: 'variance_notes', label: 'Variance Notes', type: F.TEXTAREA, section: 'Budget Details', order: 2 },
];

/** Extra facts carried only by the Delay Analysis module — feeds the Project Summary's Execution Days/Delay Days tiles. */
const delayAnalysisFields = [
  { key: 'planned_duration_days', label: 'Planned Duration (days)', type: F.NUMBER, required: true, section: 'Schedule Details', order: 0 },
  { key: 'actual_duration_days', label: 'Actual Duration (days)', type: F.NUMBER, required: true, section: 'Schedule Details', order: 1 },
  { key: 'delay_reason', label: 'Delay Reason', type: F.TEXTAREA, section: 'Schedule Details', order: 2 },
];

/** Extra facts carried only by the Vendor Performance module — one record per vendor, feeds Avg. Vendor Rating / Total Vendors. */
const vendorPerformanceFields = [
  { key: 'vendor_name', label: 'Vendor Name', type: F.TEXT, required: true, section: 'Vendor Details', order: 0 },
  { key: 'vendor_category', label: 'Vendor Category', type: F.SELECT, options: ['Construction', 'Interior', 'Procurement', 'Automation', 'IT', 'Marketing', 'Other'], section: 'Vendor Details', order: 1 },
  { key: 'rating', label: 'Rating (out of 5)', type: F.NUMBER, required: true, section: 'Vendor Details', order: 2 },
  { key: 'on_time_delivery', label: 'On-Time Delivery', type: F.SELECT, options: ['Yes', 'No', 'Partial'], section: 'Vendor Details', order: 3 },
];

/** Extra facts carried only by the Financial Closure module — feeds Pending Payments. */
const financialClosureFields = [
  { key: 'total_invoiced', label: 'Total Invoiced', type: F.CURRENCY, section: 'Financial Details', order: 0 },
  { key: 'total_paid', label: 'Total Paid', type: F.CURRENCY, section: 'Financial Details', order: 1 },
  { key: 'pending_payment', label: 'Pending Payment', type: F.CURRENCY, section: 'Financial Details', order: 2 },
  { key: 'closure_certificate_no', label: 'Closure Certificate No.', type: F.TEXT, section: 'Financial Details', order: 3 },
];

/** Extra facts carried only by the Document Archive module — feeds Documents Archived. */
const documentArchiveFields = [
  { key: 'document_category', label: 'Document Category', type: F.SELECT, options: ['Legal', 'Financial', 'Vendor Contracts', 'Project Media', 'Compliance & NOCs', 'Other'], section: 'Archive Details', order: 0 },
  { key: 'documents_count', label: 'Documents Archived (count)', type: F.NUMBER, required: true, section: 'Archive Details', order: 1 },
];

/** Extra facts carried only by the Lessons Learned module. */
const lessonsLearnedFields = [
  { key: 'key_learnings', label: 'Key Learnings', type: F.TEXTAREA, required: true, section: 'Retrospective', order: 0 },
  { key: 'challenges', label: 'Challenges Faced', type: F.TEXTAREA, section: 'Retrospective', order: 1 },
  { key: 'recommendations', label: 'Recommendations for Next Project', type: F.TEXTAREA, section: 'Retrospective', order: 2 },
];

/** Extra facts carried only by the Project Sign-Off module — the closure's final gate, mirrors Store Launch's Go-Live Approval. */
const projectSignOffFields = [
  { key: 'signed_off_by', label: 'Signed Off By', type: F.TEXT, required: true, section: 'Sign-off Details', order: 0 },
  { key: 'sign_off_date', label: 'Sign-off Date', type: F.DATE, required: true, section: 'Sign-off Details', order: 1 },
  { key: 'overall_rating', label: 'Overall Project Rating (out of 100)', type: F.NUMBER, required: true, section: 'Sign-off Details', order: 2 },
];

/**
 * One Approval Workflow (p7) module — same small sign-off form, own
 * key/name/subtitle. `key` is a department for the first ten modules and a
 * plain string ('management', 'ceo_md') for the final two, since
 * assessmentType is a free string, not tied to the DEPARTMENTS enum.
 */
const approvalModule = (key, name, subtitle) => ({
  key,
  name,
  subtitle,
  masterDataSchema: [
    { key: 'approval_type', label: 'Approval Type', type: F.TEXT, required: true, section: 'Approval', order: 0 },
    { key: 'approval_date', label: 'Approval Date', type: F.DATE, section: 'Approval', order: 1 },
    { key: 'approved_by', label: 'Approved By', type: F.TEXT, section: 'Approval', order: 2 },
    { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
  ],
});

export const storeLaunchTemplate = withOrder({
  name: 'Store Launch — Official PMS Workflow',
  code: 'MR-PMS-STORE-LAUNCH',
  description:
    'The complete 10-phase lifecycle for opening a new outlet — property identification through project closure, with departmental checklists, doers and backup buddies.',
  category: 'Store Launch',
  icon: 'Store',
  color: '#e0a13a',
  status: TEMPLATE_STATUS.PUBLISHED,
  isDefault: true,
  tags: ['pms', 'store-launch', 'official'],
  stages: [
    {
      key: 'p1',
      name: 'Property Identification',
      color: '#e0a13a',
      slaDays: 10,
      ownerDepartment: D.EXPANSION,
      description:
        'Search the catchment, capture every option in a comparable format, and shortlist or reject.',
      // Collection mode: each candidate property is its own Record row.
      captureMode: 'collection',
      recordNoun: 'Property',
      // Property-capture form (Phase-1 §5), grouped into sections. `section` is
      // read by RecordFormModal so grouping stays data-driven — reordering or
      // adding a field here needs no component change.
      masterDataSchema: [
        // ── Property Information ──────────────────────────────
        { key: 'property_name', label: 'Property Name', type: F.TEXT, required: true, section: 'Property Information', order: 0 },
        { key: 'locality', label: 'Locality', type: F.TEXT, required: true, section: 'Property Information', order: 1 },
        { key: 'city', label: 'City', type: F.TEXT, required: true, section: 'Property Information', order: 2 },
        { key: 'carpet_area', label: 'Area', type: F.NUMBER, required: true, section: 'Property Information', order: 3 },
        { key: 'frontage_ft', label: 'Frontage', type: F.NUMBER, section: 'Property Information', order: 4 },
        { key: 'floor', label: 'Floor', type: F.SELECT, options: ['Ground', 'First', 'Second', 'Basement', 'Other'], section: 'Property Information', order: 5 },
        { key: 'live_location', label: 'Live Location', type: F.LOCATION, section: 'Property Information', order: 6 },
        // ── Commercial Information ────────────────────────────
        // `commercial_type` gates everything else in this section — each
        // field below only appears once its `showIf` condition matches the
        // selected type. Purely data-driven: no per-type logic in the UI.
        {
          key: 'commercial_type', label: 'Commercial Type', type: F.SELECT, required: true,
          options: ['Rent', 'Lease'],
          section: 'Commercial Information', order: 7,
        },
        // Rent
        { key: 'monthly_rent', label: 'Monthly Rent', type: F.CURRENCY, section: 'Commercial Information', order: 8, showIf: { field: 'commercial_type', in: ['Rent'] } },
        { key: 'deposit', label: 'Deposit', type: F.CURRENCY, section: 'Commercial Information', order: 9, showIf: { field: 'commercial_type', in: ['Rent', 'Lease'] } },
        { key: 'available_from', label: 'Available From', type: F.DATE, section: 'Commercial Information', order: 10, showIf: { field: 'commercial_type', in: ['Rent', 'Lease'] } },
        // Lease
        { key: 'lease_amount', label: 'Lease Amount', type: F.CURRENCY, section: 'Commercial Information', order: 11, showIf: { field: 'commercial_type', in: ['Lease'] } },
        { key: 'lease_duration', label: 'Lease Duration (months)', type: F.NUMBER, section: 'Commercial Information', order: 12, showIf: { field: 'commercial_type', in: ['Lease'] } },
        // ── Owner Details ─────────────────────────────────────
        { key: 'owner_name', label: 'Owner Name', type: F.TEXT, section: 'Owner Details', order: 13 },
        { key: 'owner_phone', label: 'Owner Phone', type: F.TEXT, section: 'Owner Details', order: 14 },
        // ── Broker Details ────────────────────────────────────
        { key: 'broker_name', label: 'Broker Name', type: F.TEXT, section: 'Broker Details', order: 15 },
        { key: 'broker_phone', label: 'Broker Phone', type: F.TEXT, section: 'Broker Details', order: 16 },
        // ── Media ─────────────────────────────────────────────
        {
          key: 'documents', label: 'Documents', type: F.FILE, section: 'Media', order: 17, multiple: true,
          // Images, videos, office/text documents and archives — anything a
          // doer might capture or attach on a site visit.
          accept: '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
        },
        {
          key: 'audio', label: 'Audio', type: F.FILE, section: 'Media', order: 18, multiple: true,
          recordAudio: true, // captured via the in-browser recorder, not a file picker
          accept: '.mp3,.wav,.m4a,.aac,.ogg,audio/*',
        },
        // ── Notes ─────────────────────────────────────────────
        { key: 'notes', label: '', type: F.TEXTAREA, section: 'Notes', order: 19 },
      ],
      tasks: [
        t('p1_t1', 'Search & source candidate properties', D.EXPANSION, 3, P.HIGH,
          ['Local brokers engaged', 'Minimum 5 options sourced', 'Target localities agreed'],
          ['Local brokers engaged']),
        t('p1_t2', 'Capture property details', D.EXPANSION, 2, P.MEDIUM,
          ['Carpet area recorded', 'Frontage & floor recorded', 'Quoted rent recorded', 'Landlord contact captured'],
          ['Carpet area recorded']),
        t('p1_t3', 'Upload documents & photographs', D.EXPANSION, 2, P.MEDIUM,
          ['Ownership documents uploaded', 'Site photographs uploaded', 'Floor plan uploaded'],
          ['Ownership documents uploaded']),
        t('p1_t4', 'Shortlist or reject decision', D.EXPANSION, 3, P.HIGH,
          ['Scorecard completed for each option', 'Rejection reasons logged', 'Shortlist signed off by Expansion Head'],
          ['Scorecard completed for each option', 'Shortlist signed off by Expansion Head']),
      ],
    },
    {
      key: 'p2',
      name: 'Site Evaluation',
      color: '#16a79a',
      slaDays: 8,
      ownerDepartment: D.EXPANSION,
      description:
        'Run the feasibility, financial, technical and operational assessments on every shortlisted site.',
      // Collection mode: every shortlisted property gets its own set of
      // assessment Records (see assessmentTypes below), same as Property
      // Identification's candidate properties.
      captureMode: 'collection',
      recordNoun: 'Assessment',
      // Superseded by assessmentTypes — this stage's data now lives in four
      // independent forms instead of one flat schema.
      masterDataSchema: [],
      // Independent dynamic forms nested under this one stage — one per
      // assessment. Each is its own masterDataSchema, section-grouped and
      // rendered through the exact same RecordFormModal/DynamicField used for
      // Property Identification. Adding a 5th assessment later is purely a
      // seed-data change, no frontend code changes required.
      assessmentTypes: [
        {
          key: 'feasibility',
          name: 'Feasibility',
          masterDataSchema: [
            { key: 'purpose', label: 'Purpose', type: F.TEXTAREA, section: 'Feasibility Details', order: 0 },
            { key: 'market_potential', label: 'Market Potential', type: F.SELECT, options: ['Low', 'Medium', 'High'], required: true, section: 'Feasibility Details', order: 1 },
            { key: 'competitor_analysis', label: 'Competitor Analysis', type: F.TEXTAREA, section: 'Feasibility Details', order: 2 },
            { key: 'footfall_assessment', label: 'Footfall Assessment (Score /10)', type: F.NUMBER, section: 'Feasibility Details', order: 3 },
            { key: 'accessibility', label: 'Accessibility', type: F.SELECT, options: ['Poor', 'Average', 'Good', 'Excellent'], section: 'Feasibility Details', order: 4 },
            { key: 'target_audience', label: 'Target Audience', type: F.TEXT, section: 'Feasibility Details', order: 5 },
            { key: 'expansion_potential', label: 'Expansion Potential', type: F.SELECT, options: ['Low', 'Medium', 'High'], section: 'Feasibility Details', order: 6 },
            { key: 'risk_factors', label: 'Risk Factors', type: F.TEXTAREA, section: 'Feasibility Details', order: 7 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Feasibility Details', order: 8 },
            {
              key: 'documents', label: 'Documents', type: F.FILE, section: 'Media', order: 9, multiple: true,
              accept: '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
            },
            {
              key: 'audio', label: 'Audio', type: F.FILE, section: 'Media', order: 10, multiple: true,
              recordAudio: true,
              accept: '.mp3,.wav,.m4a,.aac,.ogg,audio/*',
            },
            { key: 'notes', label: "Doer's Notes", type: F.TEXTAREA, section: 'Notes', order: 11 },
          ],
        },
        {
          key: 'financial',
          name: 'Financial',
          masterDataSchema: [
            { key: 'purpose', label: 'Purpose', type: F.TEXTAREA, section: 'Financial Details', order: 0 },
            { key: 'estimated_investment', label: 'Estimated Investment', type: F.CURRENCY, required: true, section: 'Financial Details', order: 1 },
            { key: 'monthly_revenue', label: 'Monthly Revenue', type: F.CURRENCY, section: 'Financial Details', order: 2 },
            { key: 'roi', label: 'ROI (%)', type: F.NUMBER, section: 'Financial Details', order: 3 },
            { key: 'payback_period', label: 'Payback Period (months)', type: F.NUMBER, section: 'Financial Details', order: 4 },
            { key: 'capex', label: 'CAPEX', type: F.CURRENCY, section: 'Financial Details', order: 5 },
            { key: 'opex', label: 'OPEX (Monthly)', type: F.CURRENCY, section: 'Financial Details', order: 6 },
            { key: 'profit_margin', label: 'Profit Margin (%)', type: F.NUMBER, section: 'Financial Details', order: 7 },
            { key: 'financial_risk', label: 'Financial Risk', type: F.SELECT, options: ['Low', 'Medium', 'High'], section: 'Financial Details', order: 8 },
            { key: 'financial_remarks', label: 'Financial Remarks', type: F.TEXTAREA, section: 'Financial Details', order: 9 },
            {
              key: 'documents', label: 'Documents', type: F.FILE, section: 'Media', order: 10, multiple: true,
              accept: '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
            },
            {
              key: 'audio', label: 'Audio', type: F.FILE, section: 'Media', order: 11, multiple: true,
              recordAudio: true,
              accept: '.mp3,.wav,.m4a,.aac,.ogg,audio/*',
            },
            { key: 'notes', label: "Doer's Notes", type: F.TEXTAREA, section: 'Notes', order: 12 },
          ],
        },
        {
          key: 'technical',
          name: 'Technical',
          masterDataSchema: [
            { key: 'purpose', label: 'Purpose', type: F.TEXTAREA, section: 'Technical Details', order: 0 },
            { key: 'building_condition', label: 'Building Condition', type: F.SELECT, options: ['Poor', 'Average', 'Good', 'Excellent'], required: true, section: 'Technical Details', order: 1 },
            { key: 'civil_condition', label: 'Civil', type: F.SELECT, options: ['Poor', 'Average', 'Good', 'Excellent'], section: 'Technical Details', order: 2 },
            { key: 'electrical_capacity', label: 'Electrical Capacity (kW)', type: F.NUMBER, section: 'Technical Details', order: 3 },
            { key: 'hvac', label: 'HVAC', type: F.SELECT, options: ['Not Available', 'Available', 'Centralized'], section: 'Technical Details', order: 4 },
            { key: 'water_supply', label: 'Water Supply', type: F.SELECT, options: ['Not Available', 'Available', 'Abundant'], section: 'Technical Details', order: 5 },
            { key: 'internet_availability', label: 'Internet Availability', type: F.SELECT, options: ['Not Available', 'Available'], section: 'Technical Details', order: 6 },
            { key: 'fire_safety', label: 'Fire Safety', type: F.SELECT, options: ['Not Compliant', 'Compliant'], section: 'Technical Details', order: 7 },
            { key: 'parking', label: 'Parking', type: F.SELECT, options: ['Not Available', 'Limited', 'Adequate', 'Ample'], section: 'Technical Details', order: 8 },
            // Moved here from Operational — Technical is the correct home for
            // building/M&E upkeep; the field `key` is unchanged so any
            // already-submitted data stays readable under its new section.
            { key: 'maintenance', label: 'Maintenance', type: F.TEXTAREA, section: 'Technical Details', order: 9 },
            { key: 'structural_assessment', label: 'Structural Assessment', type: F.TEXTAREA, section: 'Technical Details', order: 10 },
            { key: 'technical_remarks', label: 'Technical Remarks', type: F.TEXTAREA, section: 'Technical Details', order: 11 },
            {
              key: 'documents', label: 'Documents', type: F.FILE, section: 'Media', order: 12, multiple: true,
              accept: '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
            },
            {
              key: 'audio', label: 'Audio', type: F.FILE, section: 'Media', order: 13, multiple: true,
              recordAudio: true,
              accept: '.mp3,.wav,.m4a,.aac,.ogg,audio/*',
            },
            { key: 'notes', label: "Doer's Notes", type: F.TEXTAREA, section: 'Notes', order: 14 },
          ],
        },
        {
          key: 'operational',
          name: 'Operational',
          masterDataSchema: [
            { key: 'purpose', label: 'Purpose', type: F.TEXTAREA, section: 'Operational Details', order: 0 },
            { key: 'staff_requirement', label: 'Staff Requirement (Headcount)', type: F.NUMBER, required: true, section: 'Operational Details', order: 1 },
            { key: 'operating_hours', label: 'Operating Hours', type: F.TEXT, placeholder: 'e.g. 10 AM - 10 PM', section: 'Operational Details', order: 2 },
            { key: 'operations_readiness', label: 'Operations Readiness', type: F.SELECT, options: ['Not Ready', 'Partially Ready', 'Ready'], section: 'Operational Details', order: 3 },
            { key: 'security', label: 'Security', type: F.SELECT, options: ['Not Required', 'Required'], section: 'Operational Details', order: 4 },
            { key: 'inventory', label: 'Inventory', type: F.SELECT, options: ['Poor', 'Adequate', 'Good'], section: 'Operational Details', order: 5 },
            { key: 'training', label: 'Training', type: F.SELECT, options: ['Not Started', 'In Progress', 'Completed'], section: 'Operational Details', order: 6 },
            { key: 'customer_flow', label: 'Customer Flow', type: F.TEXTAREA, section: 'Operational Details', order: 7 },
            { key: 'utility_availability', label: 'Utility Availability', type: F.SELECT, options: ['Poor', 'Adequate', 'Good'], section: 'Operational Details', order: 8 },
            { key: 'vendor_availability', label: 'Vendor Availability', type: F.SELECT, options: ['Poor', 'Adequate', 'Good'], section: 'Operational Details', order: 9 },
            { key: 'operational_risks', label: 'Operational Risks', type: F.TEXTAREA, section: 'Operational Details', order: 10 },
            { key: 'operational_remarks', label: 'Operational Remarks', type: F.TEXTAREA, section: 'Operational Details', order: 11 },
            {
              key: 'documents', label: 'Documents', type: F.FILE, section: 'Media', order: 12, multiple: true,
              accept: '.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.avi,.mkv,.webm,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar',
            },
            {
              key: 'audio', label: 'Audio', type: F.FILE, section: 'Media', order: 13, multiple: true,
              recordAudio: true,
              accept: '.mp3,.wav,.m4a,.aac,.ogg,audio/*',
            },
            { key: 'notes', label: "Doer's Notes", type: F.TEXTAREA, section: 'Notes', order: 14 },
          ],
        },
      ],
      tasks: [
        t('p2_t1', 'Feasibility assessment', D.EXPANSION, 2, P.HIGH,
          ['Footfall & catchment study done', 'Competitor mapping done', 'Accessibility & parking assessed'],
          ['Footfall & catchment study done']),
        t('p2_t2', 'Financial assessment', D.FINANCE, 2, P.CRITICAL,
          ['Rent-to-revenue ratio modelled', 'Break-even month projected', 'CapEx estimate prepared', 'ROI threshold met'],
          ['Break-even month projected', 'ROI threshold met']),
        t('p2_t3', 'Technical assessment', D.CONSTRUCTION, 2, P.HIGH,
          ['Structural survey completed', 'Power load verified', 'Water & drainage verified', 'Fire exits verified'],
          ['Structural survey completed', 'Fire exits verified']),
        t('p2_t4', 'Operational assessment', D.OPERATIONS, 1, P.MEDIUM,
          ['Game room layout viable', 'Staff room & storage viable', 'Customer flow simulated']),
      ],
    },
    {
      key: 'p3',
      name: 'Commercial Finalization',
      color: '#6366f1',
      slaDays: 12,
      ownerDepartment: D.LEGAL,
      description: 'LOI, lease agreement, legal verification, deposits, NOCs and statutory approvals.',
      captureMode: 'collection',
      recordNoun: 'Commercial Record',
      masterDataSchema: [],
      // Six independent workflows, same shape as p2's assessmentTypes — every
      // module supports unlimited resubmissions (see recordUi.js), so none of
      // these are single-shot forms. NOCs and Commercial Approvals each track
      // several required sub-items (one record per NOC type / approval
      // level) via `subKeyField`, naming the select field whose `options`
      // become the required checklist — purely data-driven, no hardcoded NOC
      // or approval-level list anywhere in the frontend.
      assessmentTypes: [
        {
          key: 'loi',
          name: 'LOI',
          subtitle: 'Letter of Intent',
          masterDataSchema: [
            { key: 'loi_number', label: 'LOI Number', type: F.TEXT, required: true, section: 'Details', order: 0 },
            { key: 'loi_date', label: 'LOI Date', type: F.DATE, required: true, section: 'Details', order: 1 },
            { key: 'valid_until', label: 'Valid Until', type: F.DATE, section: 'Details', order: 2 },
            { key: 'proposed_rent', label: 'Proposed Rent', type: F.CURRENCY, required: true, section: 'Details', order: 3 },
            { key: 'deposit_amount', label: 'Deposit Amount', type: F.CURRENCY, section: 'Details', order: 4 },
            { key: 'lockin_period_months', label: 'Lock-in Period (months)', type: F.NUMBER, section: 'Details', order: 5 },
            { key: 'notice_period_months', label: 'Notice Period (months)', type: F.NUMBER, section: 'Details', order: 6 },
            { key: 'revenue_share_pct', label: 'Revenue Share (%)', type: F.NUMBER, section: 'Details', order: 7 },
            { key: 'commercial_terms', label: 'Commercial Terms', type: F.TEXTAREA, section: 'Details', order: 8 },
            { key: 'documents', label: 'Attach Documents', type: F.FILE, multiple: true, section: 'Documents', order: 9, accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png' },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 10 },
          ],
        },
        {
          key: 'lease',
          name: 'Lease Agreement',
          subtitle: 'Lease Agreement',
          masterDataSchema: [
            { key: 'lease_start_date', label: 'Lease Start Date', type: F.DATE, required: true, section: 'Details', order: 0 },
            { key: 'lease_end_date', label: 'Lease End Date', type: F.DATE, required: true, section: 'Details', order: 1 },
            { key: 'renewal_option', label: 'Renewal Option', type: F.SELECT, options: ['Yes', 'No'], section: 'Details', order: 2 },
            { key: 'stamp_duty', label: 'Stamp Duty', type: F.CURRENCY, section: 'Details', order: 3 },
            { key: 'registration_details', label: 'Registration Details', type: F.TEXTAREA, section: 'Details', order: 4 },
            { key: 'lease_document', label: 'Lease Copy Upload', type: F.FILE, required: true, multiple: true, section: 'Documents', order: 5, accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png' },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 6 },
          ],
        },
        {
          key: 'legal',
          name: 'Legal Verification',
          subtitle: 'Property Legal Verification',
          masterDataSchema: [
            { key: 'property_ownership', label: 'Property Ownership', type: F.TEXT, section: 'Details', order: 0 },
            { key: 'title_verification', label: 'Title Verification', type: F.SELECT, options: ['Clear', 'Issues Found', 'Pending'], required: true, section: 'Details', order: 1 },
            { key: 'encumbrance_check', label: 'Encumbrance Check', type: F.SELECT, options: ['Clear', 'Encumbered', 'Pending'], section: 'Details', order: 2 },
            { key: 'litigation_status', label: 'Litigation Status', type: F.SELECT, options: ['None', 'Pending', 'Resolved'], section: 'Details', order: 3 },
            { key: 'legal_opinion', label: 'Legal Opinion', type: F.TEXTAREA, section: 'Details', order: 4 },
            { key: 'advocate_name', label: 'Advocate Name', type: F.TEXT, section: 'Details', order: 5 },
            { key: 'verification_date', label: 'Verification Date', type: F.DATE, section: 'Details', order: 6 },
            { key: 'documents', label: 'Documents', type: F.FILE, multiple: true, section: 'Documents', order: 7, accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png' },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 8 },
          ],
        },
        {
          key: 'deposit',
          name: 'Deposit Management',
          subtitle: 'Deposit & Payment',
          masterDataSchema: [
            { key: 'security_deposit', label: 'Security Deposit', type: F.CURRENCY, required: true, section: 'Details', order: 0 },
            { key: 'advance_rent', label: 'Advance Rent', type: F.CURRENCY, section: 'Details', order: 1 },
            { key: 'payment_mode', label: 'Payment Mode', type: F.SELECT, options: ['Cheque', 'NEFT/RTGS', 'UPI', 'Cash', 'Other'], section: 'Details', order: 2 },
            { key: 'transaction_number', label: 'Transaction Number', type: F.TEXT, section: 'Details', order: 3 },
            { key: 'payment_date', label: 'Payment Date', type: F.DATE, section: 'Details', order: 4 },
            { key: 'payment_proof', label: 'Payment Proof', type: F.FILE, required: true, multiple: true, section: 'Documents', order: 5, accept: '.pdf,.jpg,.jpeg,.png' },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 6 },
          ],
        },
        {
          key: 'nocs',
          name: 'NOC Management',
          subtitle: 'Government & Statutory NOCs',
          // One record per NOC type — every option below needs its own
          // Approved record before NOC Management counts as done.
          subKeyField: 'noc_type',
          masterDataSchema: [
            {
              key: 'noc_type', label: 'NOC Type', type: F.SELECT, required: true, section: 'Details', order: 0,
              options: ['Fire NOC', 'Municipal NOC', 'Pollution NOC', 'Electricity Approval', 'Water Approval', 'Trade License', 'Building Approval'],
            },
            { key: 'noc_document', label: 'Document', type: F.FILE, required: true, multiple: true, section: 'Documents', order: 1, accept: '.pdf,.jpg,.jpeg,.png' },
            { key: 'expiry_date', label: 'Expiry Date', type: F.DATE, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: 'approvals',
          name: 'Commercial Approvals',
          subtitle: 'Management Sign-off',
          // One record per approval level — every option below needs its own
          // Approved record before Commercial Approvals counts as done.
          subKeyField: 'approval_level',
          masterDataSchema: [
            { key: 'approval_level', label: 'Approval Level', type: F.SELECT, options: ['Legal', 'Finance', 'Operations', 'Management', 'CEO'], required: true, section: 'Details', order: 0 },
            { key: 'approval_document', label: 'Approval Document', type: F.FILE, multiple: true, section: 'Documents', order: 1, accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png' },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 2 },
          ],
        },
      ],
      tasks: [
        t('p3_t1', 'Issue Letter of Intent (LOI)', D.LEGAL, 2, P.HIGH,
          ['Commercials agreed with landlord', 'LOI drafted', 'LOI countersigned'],
          ['LOI countersigned']),
        t('p3_t2', 'Draft & finalize lease agreement', D.LEGAL, 3, P.CRITICAL,
          ['Lock-in period agreed', 'Escalation clause agreed', 'Exit clause reviewed', 'Agreement registered'],
          ['Agreement registered']),
        t('p3_t3', 'Legal verification & title due diligence', D.LEGAL, 2, P.CRITICAL,
          ['Title chain verified', 'Encumbrance certificate obtained', 'Landlord identity verified'],
          ['Title chain verified']),
        t('p3_t4', 'Security deposit & token payment', D.FINANCE, 1, P.HIGH,
          ['Deposit approved', 'Payment released', 'Receipt filed'],
          ['Deposit approved']),
        t('p3_t5', 'NOCs & statutory approvals', D.LEGAL, 2, P.HIGH,
          ['Fire NOC applied', 'Trade licence applied', 'Society / mall NOC obtained', 'Signage permission obtained'],
          ['Fire NOC applied', 'Trade licence applied']),
      ],
    },
    {
      key: 'p4',
      name: 'Project Creation',
      color: '#f43f5e',
      slaDays: 5,
      ownerDepartment: D.PROJECTS,
      description:
        'Convert the commercially finalized site into a live project — information, budget, timeline, manager, team and final approval.',
      // Collection mode: every commercially-finalized property gets its own
      // set of Project Creation records (see assessmentTypes below), same as
      // Site Evaluation and Commercial Finalization.
      captureMode: 'collection',
      recordNoun: 'Project',
      // Superseded by assessmentTypes — this stage's data now lives in six
      // independent forms instead of one flat schema.
      masterDataSchema: [],
      // Six independent modules, same shape as p3's assessmentTypes — every
      // module supports unlimited resubmissions (see recordUi.js), so none of
      // these are single-shot forms.
      assessmentTypes: [
        {
          key: 'project_information',
          name: 'Project Information',
          subtitle: 'Basic Project Information',
          masterDataSchema: [
            { key: 'project_name', label: 'Project Name', type: F.TEXT, required: true, section: 'Details', order: 0 },
            { key: 'project_code', label: 'Project Code', type: F.TEXT, section: 'Details', order: 1 },
            { key: 'project_type', label: 'Project Type', type: F.SELECT, options: ['New Launch', 'Expansion', 'Relocation', 'Renovation'], section: 'Details', order: 2 },
            { key: 'store_format', label: 'Store Format', type: F.SELECT, options: ['Standalone', 'Mall', 'High Street', 'Food Court'], section: 'Details', order: 3 },
            { key: 'business_unit', label: 'Business Unit', type: F.TEXT, section: 'Details', order: 4 },
            { key: 'region', label: 'Region', type: F.TEXT, section: 'Details', order: 5 },
            { key: 'description', label: 'Description', type: F.TEXTAREA, section: 'Notes', order: 6 },
          ],
        },
        {
          key: 'budget',
          name: 'Budget Planning',
          subtitle: 'Budget & Cost Planning',
          masterDataSchema: [
            { key: 'estimated_budget', label: 'Estimated Budget', type: F.CURRENCY, required: true, section: 'Budget', order: 0 },
            { key: 'capex', label: 'CapEx', type: F.CURRENCY, section: 'Budget', order: 1 },
            { key: 'opex', label: 'OpEx', type: F.CURRENCY, section: 'Budget', order: 2 },
            { key: 'contingency_budget', label: 'Contingency Budget', type: F.CURRENCY, section: 'Budget', order: 3 },
            { key: 'currency', label: 'Currency', type: F.SELECT, options: ['INR', 'USD', 'EUR', 'GBP'], section: 'Budget', order: 4 },
            { key: 'budget_remarks', label: 'Budget Remarks', type: F.TEXTAREA, section: 'Notes', order: 5 },
          ],
        },
        {
          key: 'timeline',
          name: 'Timeline Planning',
          subtitle: 'Target Opening & Key Milestones',
          masterDataSchema: [
            { key: 'target_opening_date', label: 'Target Opening Date', type: F.DATE, required: true, section: 'Timeline', order: 0 },
            { key: 'project_start_date', label: 'Project Start Date', type: F.DATE, section: 'Timeline', order: 1 },
            { key: 'construction_start', label: 'Construction Start', type: F.DATE, section: 'Timeline', order: 2 },
            { key: 'interior_start', label: 'Interior Start', type: F.DATE, section: 'Timeline', order: 3 },
            { key: 'testing_date', label: 'Testing Date', type: F.DATE, section: 'Timeline', order: 4 },
            { key: 'expected_completion', label: 'Expected Completion', type: F.DATE, section: 'Timeline', order: 5 },
            { key: 'milestones', label: 'Milestones', type: F.TEXTAREA, section: 'Notes', order: 6 },
          ],
        },
        {
          key: 'manager_assignment',
          name: 'Project Manager Assignment',
          subtitle: 'PM & Leadership Assignment',
          masterDataSchema: [
            { key: 'project_manager', label: 'Project Manager', type: F.TEXT, required: true, section: 'Assignment', order: 0 },
            { key: 'reporting_manager', label: 'Reporting Manager', type: F.TEXT, section: 'Assignment', order: 1 },
            { key: 'construction_head', label: 'Construction Head', type: F.TEXT, section: 'Assignment', order: 2 },
            { key: 'operations_head', label: 'Operations Head', type: F.TEXT, section: 'Assignment', order: 3 },
            { key: 'owner', label: 'Owner', type: F.TEXT, section: 'Assignment', order: 4 },
            { key: 'communication_notes', label: 'Communication Notes', type: F.TEXTAREA, section: 'Notes', order: 5 },
          ],
        },
        {
          key: 'team_setup',
          name: 'Project Team Setup',
          subtitle: 'Departments & Leads',
          masterDataSchema: [
            {
              key: 'departments_involved', label: 'Departments Involved', type: F.MULTISELECT, required: true, section: 'Team', order: 0,
              options: ['Construction', 'Interior', 'Procurement', 'Automation', 'IT', 'Marketing', 'HR', 'Finance', 'Operations', 'Legal'],
            },
            { key: 'department_leads', label: 'Assign Department Leads', type: F.TEXTAREA, section: 'Team', order: 1 },
          ],
        },
        {
          key: 'approval',
          name: 'Project Approval',
          subtitle: 'Final Management Sign-off',
          masterDataSchema: [
            { key: 'approval_status', label: 'Approval Status', type: F.SELECT, options: ['Pending', 'Approved', 'Rejected'], required: true, section: 'Approval', order: 0 },
            { key: 'approver', label: 'Approver', type: F.TEXT, section: 'Approval', order: 1 },
            { key: 'approval_date', label: 'Approval Date', type: F.DATE, section: 'Approval', order: 2 },
            { key: 'management_remarks', label: 'Management Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
      ],
      tasks: [
        t('p4_t1', 'Define project budget', D.FINANCE, 2, P.CRITICAL,
          ['CapEx heads broken down', 'Contingency % agreed', 'Budget approved by Management'],
          ['Budget approved by Management']),
        t('p4_t2', 'Set target opening date', D.PROJECTS, 1, P.HIGH,
          ['Backward schedule prepared', 'Long-lead items identified', 'Date communicated to all departments'],
          ['Date communicated to all departments']),
        // Primary is deliberately an overloaded PM, so the project materializes
        // with `reassignNeeded` and the buddy system is visible on day one.
        t('p4_t3', 'Assign project manager', D.PROJECTS, 2, P.HIGH,
          ['PM named & accepted', 'Handover from Expansion completed', 'Kick-off meeting held'],
          ['PM named & accepted'],
          { primaryAssignee: 'emp-prj-001', backupAssignee: 'emp-prj-002' }),
      ],
    },
    {
      key: 'p5',
      name: 'Department Planning',
      color: '#38bdf8',
      slaDays: 7,
      ownerDepartment: D.PROJECTS,
      description:
        'Allocate the work packet to every department. Each allocation names a doer and a backup buddy.',
      // Collection mode: every property that's cleared Project Creation gets
      // its own set of Department Planning records (see assessmentTypes
      // below), same as Site Evaluation, Commercial Finalization and Project
      // Creation.
      captureMode: 'collection',
      recordNoun: 'Department Plan',
      // Superseded by assessmentTypes — this stage's data now lives in ten
      // independent forms (one per department) instead of one flat schema.
      masterDataSchema: [],
      assessmentTypes: [
        {
          key: D.CONSTRUCTION,
          name: 'Construction',
          subtitle: 'Civil & Structural Planning',
          masterDataSchema: [
            { key: 'scope_of_work', label: 'Scope of Work', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'contractor_name', label: 'Contractor', type: F.TEXT, section: 'Details', order: 1 },
            { key: 'estimated_cost', label: 'Estimated Cost', type: F.CURRENCY, section: 'Details', order: 2 },
            { key: 'timeline_days', label: 'Timeline (days)', type: F.NUMBER, section: 'Details', order: 3 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 4 },
          ],
        },
        {
          key: D.INTERIOR,
          name: 'Interior',
          subtitle: 'Interior Design & Execution',
          masterDataSchema: [
            { key: 'theme_brief', label: 'Theme Brief', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'drawings_status', label: 'Drawings Status', type: F.SELECT, options: ['Pending', 'Submitted', 'Approved'], section: 'Details', order: 1 },
            { key: 'estimated_cost', label: 'Estimated Cost', type: F.CURRENCY, section: 'Details', order: 2 },
            { key: 'timeline_days', label: 'Timeline (days)', type: F.NUMBER, section: 'Details', order: 3 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 4 },
          ],
        },
        {
          key: D.PROCUREMENT,
          name: 'Procurement',
          subtitle: 'Vendor & Material Planning',
          masterDataSchema: [
            { key: 'boq_status', label: 'BOQ Status', type: F.SELECT, options: ['Draft', 'Finalized'], required: true, section: 'Details', order: 0 },
            { key: 'vendor_name', label: 'Vendor', type: F.TEXT, section: 'Details', order: 1 },
            { key: 'long_lead_items', label: 'Long-Lead Items', type: F.TEXTAREA, section: 'Details', order: 2 },
            { key: 'estimated_cost', label: 'Estimated Cost', type: F.CURRENCY, section: 'Details', order: 3 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 4 },
          ],
        },
        {
          key: D.AUTOMATION,
          name: 'Automation',
          subtitle: 'Automation & Smart Systems',
          masterDataSchema: [
            { key: 'automation_spec', label: 'Automation Spec', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'integration_plan', label: 'Integration Plan', type: F.TEXTAREA, section: 'Details', order: 1 },
            { key: 'estimated_cost', label: 'Estimated Cost', type: F.CURRENCY, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: D.IT,
          name: 'IT',
          subtitle: 'IT Infrastructure & Networking',
          masterDataSchema: [
            { key: 'network_spec', label: 'Network & POS Spec', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'hardware_indent', label: 'Hardware Indent', type: F.TEXTAREA, section: 'Details', order: 1 },
            { key: 'estimated_cost', label: 'Estimated Cost', type: F.CURRENCY, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: D.MARKETING,
          name: 'Marketing',
          subtitle: 'Branding & Launch Planning',
          masterDataSchema: [
            { key: 'campaign_brief', label: 'Launch Campaign Brief', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'launch_budget', label: 'Launch Budget', type: F.CURRENCY, section: 'Details', order: 1 },
            { key: 'target_date', label: 'Target Launch Date', type: F.DATE, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: D.HR,
          name: 'HR',
          subtitle: 'Recruitment & Staffing',
          masterDataSchema: [
            { key: 'manpower_plan', label: 'Manpower Plan', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'headcount', label: 'Headcount', type: F.NUMBER, section: 'Details', order: 1 },
            { key: 'hiring_timeline', label: 'Hiring Timeline', type: F.DATE, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: D.FINANCE,
          name: 'Finance',
          subtitle: 'Budget & Financial Planning',
          masterDataSchema: [
            { key: 'cash_flow_plan', label: 'Cash-Flow Plan', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'payment_milestones', label: 'Payment Milestones', type: F.TEXTAREA, section: 'Details', order: 1 },
            { key: 'allocated_budget', label: 'Allocated Budget', type: F.CURRENCY, section: 'Details', order: 2 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 3 },
          ],
        },
        {
          key: D.OPERATIONS,
          name: 'Operations',
          subtitle: 'Operational Readiness',
          masterDataSchema: [
            { key: 'sop_pack_status', label: 'SOP Pack Status', type: F.SELECT, options: ['Pending', 'Issued', 'Approved'], required: true, section: 'Details', order: 0 },
            { key: 'opening_rota', label: 'Opening Rota', type: F.TEXTAREA, section: 'Details', order: 1 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 2 },
          ],
        },
        {
          key: D.LEGAL,
          name: 'Legal',
          subtitle: 'Legal Compliance & Documentation',
          masterDataSchema: [
            { key: 'compliance_calendar', label: 'Compliance Calendar', type: F.TEXTAREA, required: true, section: 'Details', order: 0 },
            { key: 'vendor_contracts_status', label: 'Vendor Contracts Status', type: F.SELECT, options: ['Pending', 'Queued', 'Signed'], section: 'Details', order: 1 },
            { key: 'remarks', label: 'Remarks', type: F.TEXTAREA, section: 'Notes', order: 2 },
          ],
        },
      ],
      tasks: [
        t('p5_t1', 'Allocate Construction scope', D.CONSTRUCTION, 1, P.HIGH,
          ['Scope of work issued', 'Contractor shortlisted', 'Timeline committed']),
        t('p5_t2', 'Allocate Interior scope', D.INTERIOR, 1, P.HIGH,
          ['Theme brief issued', 'Drawings approved', 'Timeline committed']),
        t('p5_t3', 'Allocate Procurement scope', D.PROCUREMENT, 1, P.HIGH,
          ['BOQ finalized', 'Long-lead items ordered', 'Vendor SLAs signed'],
          ['Long-lead items ordered']),
        t('p5_t4', 'Allocate Automation scope', D.AUTOMATION, 1, P.MEDIUM,
          ['Game automation spec issued', 'Integration plan agreed']),
        t('p5_t5', 'Allocate IT scope', D.IT, 1, P.MEDIUM,
          ['Network & POS spec issued', 'Hardware indent raised']),
        t('p5_t6', 'Allocate Marketing scope', D.MARKETING, 1, P.MEDIUM,
          ['Launch campaign brief issued', 'Budget allocated']),
        t('p5_t7', 'Allocate HR scope', D.HR, 1, P.MEDIUM,
          ['Manpower plan approved', 'Hiring timeline committed']),
        t('p5_t8', 'Allocate Finance scope', D.FINANCE, 1, P.MEDIUM,
          ['Cash-flow plan issued', 'Payment milestones agreed']),
        t('p5_t9', 'Allocate Operations scope', D.OPERATIONS, 1, P.MEDIUM,
          ['SOP pack issued', 'Opening rota drafted']),
        t('p5_t10', 'Allocate Legal scope', D.LEGAL, 1, P.MEDIUM,
          ['Compliance calendar issued', 'Vendor contracts queued']),
      ],
    },
    {
      key: 'p6',
      name: 'Execution',
      color: '#10b981',
      slaDays: 45,
      ownerDepartment: D.PROJECTS,
      description:
        'Run the build. Track status, progress, attachments, dependencies and delays against the plan.',
      // Collection mode: every department gets its own unlimited stream of
      // task records (see assessmentTypes below), same shape as Department
      // Planning — just one form per task instead of one form per department.
      captureMode: 'collection',
      recordNoun: 'Execution Task',
      // Superseded by assessmentTypes — this stage's data now lives in ten
      // independent department task-boards instead of one flat schema.
      masterDataSchema: [],
      // Ten department modules, one non-wrapping workspace row — same keys as
      // Department Planning (p5) so a department's identity stays consistent
      // from planning through execution. Every module shares the exact same
      // task form (see executionTaskFields); the department itself is
      // implicit in which module a task is filed under.
      assessmentTypes: [
        executionModule(D.CONSTRUCTION, 'Construction Execution', 'Track civil construction work'),
        executionModule(D.INTERIOR, 'Interior Execution', 'Track interior and furnishing work'),
        executionModule(D.PROCUREMENT, 'Procurement Tracking', 'Track material procurement'),
        executionModule(D.AUTOMATION, 'Automation Installation', 'Track automation installation'),
        executionModule(D.IT, 'IT Infrastructure', 'Track IT infrastructure setup'),
        executionModule(D.MARKETING, 'Marketing Execution', 'Track marketing campaigns'),
        executionModule(D.HR, 'HR Readiness', 'Track hiring and training'),
        executionModule(D.FINANCE, 'Finance Tracking', 'Track budget and expense flow'),
        executionModule(D.OPERATIONS, 'Operations Readiness', 'Track store readiness and SOP'),
        executionModule(D.LEGAL, 'Legal Compliance', 'Track licenses and compliance'),
      ],
      tasks: [
        t('p6_t1', 'Track task status & progress', D.PROJECTS, 12, P.HIGH,
          ['Progress % updated weekly', 'Blockers raised within 24h']),
        t('p6_t2', 'Maintain attachments & site evidence', D.PROJECTS, 8, P.LOW,
          ['Weekly site photos uploaded', 'Bills & invoices attached']),
        t('p6_t3', 'Manage inter-department dependencies', D.PROJECTS, 10, P.HIGH,
          ['Dependency map maintained', 'Handover dates confirmed'],
          ['Dependency map maintained']),
        t('p6_t4', 'Flag & escalate delays', D.PROJECTS, 8, P.CRITICAL,
          ['Delays flagged with reason', 'Recovery plan agreed', 'Management informed'],
          ['Recovery plan agreed']),
        t('p6_t5', 'Weekly progress review', D.OPERATIONS, 7, P.MEDIUM,
          ['Review deck circulated', 'Actions assigned with owners']),
      ],
    },
    {
      key: 'p7',
      name: 'Approval Workflow',
      color: '#8b5cf6',
      slaDays: 5,
      ownerDepartment: D.OPERATIONS,
      description: 'Department and management approvals that gate progression to store readiness.',
      requiresApproval: true,
      approverRoles: ['Department Head', 'Management'],
      // Collection mode: every property that's cleared Department Planning gets
      // its own set of Approval Workflow records (see assessmentTypes below),
      // same shape as Department Planning — one form per department, plus two
      // non-department modules (Management, CEO/MD) for final sign-off.
      captureMode: 'collection',
      recordNoun: 'Approval Record',
      // Superseded by assessmentTypes — this stage's data now lives in twelve
      // independent forms instead of one flat schema.
      masterDataSchema: [],
      assessmentTypes: [
        approvalModule(D.CONSTRUCTION, 'Construction', 'Verify construction execution'),
        approvalModule(D.INTERIOR, 'Interior', 'Verify interior and quality'),
        approvalModule(D.PROCUREMENT, 'Procurement', 'Verify vendors and deliveries'),
        approvalModule(D.AUTOMATION, 'Automation', 'Verify automation installation'),
        approvalModule(D.IT, 'IT', 'Verify IT infrastructure readiness'),
        approvalModule(D.MARKETING, 'Marketing', 'Verify marketing execution'),
        approvalModule(D.HR, 'HR', 'Verify HR readiness and training'),
        approvalModule(D.FINANCE, 'Finance', 'Verify budget utilization'),
        approvalModule(D.OPERATIONS, 'Operations', 'Verify operations readiness'),
        approvalModule(D.LEGAL, 'Legal', 'Verify legal compliance'),
        approvalModule('management', 'Management', 'Management level approval'),
        approvalModule('ceo_md', 'CEO / MD', 'Final approval by CEO / MD'),
      ],
      tasks: [
        t('p7_t1', 'Department head sign-off', D.OPERATIONS, 2, P.HIGH,
          ['Every department has signed off', 'Open snags listed'],
          ['Every department has signed off']),
        t('p7_t2', 'Management approval', D.FINANCE, 2, P.CRITICAL,
          ['Budget variance reviewed', 'Schedule variance reviewed', 'Approval recorded'],
          ['Approval recorded']),
        t('p7_t3', 'Stage progression gate', D.PROJECTS, 1, P.HIGH,
          ['All prior phases marked complete', 'Gate decision logged'],
          ['All prior phases marked complete']),
      ],
    },
    {
      key: 'p8',
      name: 'Store Readiness Checklist',
      color: '#ec4899',
      slaDays: 10,
      ownerDepartment: D.OPERATIONS,
      description:
        'The pre-launch gate: construction, utilities, IT, hiring, training, marketing, testing, inventory and compliance.',
      // Collection mode: every property that's cleared Approval Workflow gets
      // its own set of Store Readiness records (see assessmentTypes below),
      // same shape as every collection-mode stage since Site Evaluation — one
      // form per checklist module, unlimited resubmissions per module.
      captureMode: 'collection',
      recordNoun: 'Checklist Submission',
      // Superseded by assessmentTypes — this stage's data now lives in
      // fourteen independent checklist forms instead of one flat schema.
      masterDataSchema: [],
      assessmentTypes: [
        storeReadinessModule('construction_readiness', 'Construction Readiness', 'Civil work, finishing & handover', [
          'Civil work complete',
          'Flooring complete',
          'Ceiling work complete',
          'Wall finishes complete',
          'Washrooms complete',
          'Fire exits constructed',
          'Structural safety certified',
          'Paint & finishing complete',
          'Signage mounting points ready',
          'Snag list closed',
          'Handover certificate issued',
          'Site cleared of construction debris',
        ]),
        storeReadinessModule('electrical_utilities', 'Electrical & Utilities', 'Power, water & HVAC live', [
          'Permanent power connection live',
          'DG / UPS backup tested',
          'Electrical panel & wiring certified',
          'Earthing & safety checks passed',
          'Lighting fixtures installed',
          'Water & drainage live',
          'Water heater installed',
          'HVAC commissioned',
          'Exhaust & ventilation tested',
          'Utility billing account activated',
        ]),
        storeReadinessModule('it_infrastructure', 'IT Infrastructure', 'Systems, software & support ready', [
          'Broadband live with backup link',
          'LAN & Wi-Fi access points installed',
          'Local systems & servers configured',
          'Software licenses activated',
          'Printer & peripherals installed',
          'IT asset inventory logged',
          'Helpdesk / support contact set up',
          'Backup & data recovery tested',
        ]),
        storeReadinessModule('internet_network', 'Internet & Network', 'Connectivity & Wi-Fi ready', [
          'Primary ISP connection live',
          'Backup ISP link tested',
          'Network switches configured',
          'Static IP / firewall configured',
          'Wi-Fi coverage tested across floor',
          'Network uptime monitoring enabled',
        ]),
        storeReadinessModule('security_cctv', 'Security & CCTV', 'CCTV, access control & alarms ready', [
          'CCTV cameras installed',
          'CCTV live & recording tested',
          'Access control system installed',
          'Alarm system tested',
          'Security guard posted',
          'Visitor log process set up',
          'Emergency lockdown procedure tested',
        ]),
        storeReadinessModule('furniture_fixtures', 'Furniture & Fixtures', 'Furniture installation complete', [
          'Reception furniture installed',
          'Seating & waiting area set up',
          'Storage & cabinets installed',
          'Game room furniture installed',
          'Lighting fixtures fitted',
          'Curtains / blinds installed',
          'Signage & branding fixtures mounted',
          'Furniture safety check passed',
        ]),
        storeReadinessModule('inventory_stock', 'Inventory Stock', 'Stock received & verified', [
          'Opening stock received',
          'Consumables buffer in place',
          'Asset register updated',
          'Stock stored & labeled',
          'Inventory management system updated',
          'Reorder levels configured',
          'Stock audit completed',
          'Damaged / expired stock removed',
          'Vendor supply schedule confirmed',
        ]),
        storeReadinessModule('pos_billing', 'POS & Billing', 'POS installed & tested', [
          'POS hardware installed',
          'POS software installed & tested',
          'Payment gateway integrated',
          'Billing staff login credentials issued',
          'Test transaction completed successfully',
        ]),
        storeReadinessModule('hiring_complete', 'Hiring Complete', 'All staff onboarded successfully', [
          'Outlet manager onboarded',
          'Game masters onboarded',
          'Front desk staff onboarded',
          'Housekeeping staff onboarded',
          'Background verification completed',
          'Employment documentation completed',
        ]),
        storeReadinessModule('staff_training', 'Staff Training', 'Training & orientation complete', [
          'Game master certification passed',
          'Safety drill completed',
          'POS training completed',
          'Customer service training completed',
          'Emergency response training completed',
          'Product / experience knowledge test passed',
        ]),
        storeReadinessModule('marketing_ready', 'Marketing Ready', 'Marketing collateral ready', [
          'Google Business listing live',
          'Booking page live',
          'Launch campaign scheduled',
          'Social media pages live',
          'Local marketing collateral distributed',
          'Influencer / press outreach initiated',
        ]),
        storeReadinessModule('branding_signage', 'Branding & Signage', 'Branding and signage installed', [
          'Storefront signage installed',
          'Interior branding installed',
          'Directional signage installed',
          'Brand guideline compliance verified',
        ]),
        storeReadinessModule('fire_safety', 'Fire & Safety', 'Fire safety and alarms ready', [
          'Fire extinguishers installed',
          'Fire alarm system tested',
          'Emergency exits clearly marked',
          'Fire drill conducted',
          'First aid kit stocked',
          'Emergency contact list displayed',
        ]),
        storeReadinessModule('licenses_compliance', 'Licenses & Compliance', 'All licenses and approvals in place', [
          'Fire NOC received',
          'Trade licence received',
          'Insurance active',
          'Shops & Establishment registered',
          'GST registration updated for outlet',
          'Signage / hoarding permission received',
          'Local municipal compliance certificate received',
          'Labour law compliance documentation filed',
        ]),
      ],
      tasks: [
        t('p8_t1', 'Construction readiness', D.CONSTRUCTION, 1, P.HIGH,
          ['Civil work complete', 'Snag list closed', 'Handover certificate issued'],
          ['Snag list closed']),
        t('p8_t2', 'Utilities & power', D.CONSTRUCTION, 1, P.HIGH,
          ['Permanent power connection live', 'DG / UPS backup tested', 'Water & drainage live', 'HVAC commissioned'],
          ['Permanent power connection live']),
        t('p8_t3', 'IT & network setup', D.IT, 1, P.HIGH,
          ['Broadband live with backup link', 'POS installed & tested', 'CCTV live', 'Wi-Fi coverage tested'],
          ['POS installed & tested', 'CCTV live']),
        t('p8_t4', 'Automation & game systems', D.AUTOMATION, 1, P.HIGH,
          ['All game props wired', 'Control panel tested', 'Emergency override tested'],
          ['Emergency override tested']),
        t('p8_t5', 'Hiring complete', D.HR, 1, P.MEDIUM,
          ['Outlet manager onboarded', 'Game masters onboarded', 'Front desk onboarded'],
          ['Outlet manager onboarded']),
        t('p8_t6', 'Training & certification', D.HR, 1, P.MEDIUM,
          ['Game master certification passed', 'Safety drill completed', 'POS training completed'],
          ['Safety drill completed']),
        t('p8_t7', 'Marketing readiness', D.MARKETING, 1, P.MEDIUM,
          ['Google Business listing live', 'Booking page live', 'Launch campaign scheduled'],
          ['Booking page live']),
        t('p8_t8', 'Testing & dry runs', D.OPERATIONS, 1, P.CRITICAL,
          ['Full dry run completed', 'Puzzle difficulty tuned', 'Reset time measured'],
          ['Full dry run completed']),
        t('p8_t9', 'Inventory & consumables', D.PROCUREMENT, 1, P.MEDIUM,
          ['Opening stock received', 'Consumables buffer in place', 'Asset register updated']),
        t('p8_t10', 'Statutory compliance', D.LEGAL, 1, P.CRITICAL,
          ['Fire NOC received', 'Trade licence received', 'Insurance active', 'Shops & Establishment registered'],
          ['Fire NOC received', 'Trade licence received', 'Insurance active']),
      ],
    },
    {
      key: 'p9',
      name: 'Store Launch',
      color: '#e0a13a',
      slaDays: 5,
      ownerDepartment: D.OPERATIONS,
      description: 'Go-live approval and the public opening.',
      requiresApproval: true,
      approverRoles: ['Management'],
      // Collection mode: same shape as Store Readiness (p8) — one form per
      // launch module, unlimited resubmissions per module. Go-Live Approval
      // also carries the Store Summary's sign-off facts and the page's
      // twelve-item final checklist (see storeLaunchModule/goLiveSignoffFields).
      captureMode: 'collection',
      recordNoun: 'Module Submission',
      // Superseded by assessmentTypes.
      masterDataSchema: [],
      assessmentTypes: [
        storeLaunchModule('go_live_approval', 'Go-Live Approval', 'Final management sign-off before opening', [
          'Store Open',
          'POS Running',
          'Internet Working',
          'Electricity',
          'Billing Tested',
          'Employees Present',
          'Security Ready',
          'Cleaning Done',
          'Marketing Active',
          'Opening Stock Available',
          'Emergency Contact Ready',
          'Compliance Verified',
        ], goLiveSignoffFields),
        storeLaunchModule('final_store_inspection', 'Final Store Inspection', 'Final walkthrough before go-live', [
          'Final cleanliness inspection passed',
          'All fixtures & fittings verified',
          'Safety walkthrough completed',
          'Signage & branding verified',
          'Emergency exits verified clear',
          'Final photography documentation completed',
          'Snag list closed',
          'Inspection sign-off obtained',
        ]),
        storeLaunchModule('inventory_verification', 'Inventory Verification', 'Opening stock counted & verified', [
          'Opening stock counted',
          'Stock tallied against purchase orders',
          'Consumables buffer verified',
          'Inventory system updated with opening stock',
          'Damaged / short stock reported',
          'Reorder levels configured',
        ]),
        storeLaunchModule('pos_billing_activation', 'POS & Billing Activation', 'Point-of-sale & billing systems live', [
          'POS hardware powered on & tested',
          'Billing software live',
          'Payment gateway activated',
          'Test transaction completed successfully',
          'Billing staff logins issued',
          'Receipt printer tested',
        ]),
        storeLaunchModule('staff_attendance_verification', 'Staff Attendance Verification', 'All staff reported & verified', [
          'All staff reported on time',
          'Attendance system verified',
          'Uniforms & ID badges issued',
          'Shift roster confirmed',
          'Staff briefing completed',
        ]),
        storeLaunchModule('marketing_launch', 'Marketing Launch', 'Grand opening campaign launched', [
          'Launch campaign activated',
          'Social media announcement posted',
          'Local marketing collateral distributed',
          'Google Business listing updated to open',
          'Press / influencer outreach completed',
          'Opening day offers configured',
        ]),
        storeLaunchModule('store_opening_ceremony', 'Store Opening Ceremony', 'Inauguration event completed', [
          'Ceremony date & time confirmed',
          'Guest list & invitations sent',
          'Ribbon-cutting arrangements ready',
          'Ceremony logistics confirmed',
          'Inauguration event executed',
          'Ceremony photos / videos captured',
        ]),
        storeLaunchModule('customer_go_live', 'Customer Go Live', 'Store is now live for customers', [
          'Store opened to customers',
          'First customer transaction completed',
          'Customer feedback mechanism live',
          'Day-1 footfall tracked',
          'Customer service desk operational',
        ]),
      ],
      tasks: [
        t('p9_t1', 'Go-live approval', D.OPERATIONS, 2, P.CRITICAL,
          ['Readiness checklist 100% complete', 'Management go-live sign-off', 'Ops handover accepted'],
          ['Readiness checklist 100% complete', 'Management go-live sign-off']),
        t('p9_t2', 'Store opening & launch event', D.MARKETING, 3, P.HIGH,
          ['Launch event executed', 'Day-1 bookings tracked', 'Customer feedback captured']),
      ],
    },
    {
      key: 'p10',
      name: 'Project Closure',
      color: '#16a79a',
      slaDays: 7,
      ownerDepartment: D.FINANCE,
      description:
        'Close the book: budget variance, delay analysis, vendor performance and lessons learned.',
      requiresApproval: true,
      approverRoles: ['Management'],
      // Collection mode: same shape as Store Launch (p9) — one form per
      // closure module, unlimited resubmissions per module. Project Sign-Off
      // is the final gate and also carries the Project Summary's sign-off
      // facts, same role Go-Live Approval plays for Store Launch.
      captureMode: 'collection',
      recordNoun: 'Module Submission',
      // Superseded by assessmentTypes.
      masterDataSchema: [],
      assessmentTypes: [
        projectClosureModule('budget_analysis', 'Budget Analysis', 'Compare budget and actual cost, and variance', [
          'Planned vs actual cost compiled',
          'Cost overruns explained',
          'Final cost signed off by Finance',
        ], budgetAnalysisFields),
        projectClosureModule('delay_analysis', 'Delay Analysis', 'Analyze delays, root cause and rollup', [
          'Phase-wise slippage computed',
          'Root causes documented',
          'Recovery actions logged',
        ], delayAnalysisFields),
        projectClosureModule('vendor_performance', 'Vendor Performance', 'Evaluate vendor score and quality', [
          'Vendor scorecard completed',
          'Preferred / blacklist status updated',
        ], vendorPerformanceFields),
        projectClosureModule('financial_closure', 'Financial Closure', 'Invoices, payments and final dues', [
          'All vendor invoices reconciled',
          'Final payments released',
          'Financial closure certificate issued',
        ], financialClosureFields),
        projectClosureModule('asset_handover', 'Asset Handover', 'Handover of all assets and equipment', [
          'All fixed assets handed over',
          'Keys & access cards handed over',
          'Warranty documents handed over',
          'AMC / service contracts handed over',
          'Equipment inventory verified',
          'Handover certificate signed',
        ]),
        projectClosureModule('document_archive', 'Document Archive', 'Archive all project documents and media', [
          'Legal documents archived',
          'Financial documents archived',
          'Vendor contracts archived',
          'Project photos & videos archived',
          'Compliance certificates & NOCs archived',
        ], documentArchiveFields),
        projectClosureModule('lessons_learned', 'Lessons Learned', 'Key learnings, challenges and recommendations', [
          'Retrospective meeting held',
          'Key learnings documented',
          'Playbook updated for next outlet',
        ], lessonsLearnedFields),
        projectClosureModule('project_sign_off', 'Project Sign-Off', 'Collect final sign-off from all stakeholders', [
          'All stakeholders signed off',
          'All closure modules completed',
          'Final closure report generated',
          'Project formally closed',
        ], projectSignOffFields),
      ],
      tasks: [
        t('p10_t1', 'Budget variance analysis', D.FINANCE, 2, P.HIGH,
          ['Planned vs actual compiled', 'Overruns explained', 'Final cost signed off'],
          ['Final cost signed off']),
        t('p10_t2', 'Delay & schedule analysis', D.PROJECTS, 1, P.MEDIUM,
          ['Phase-wise slippage computed', 'Root causes documented']),
        t('p10_t3', 'Vendor performance review', D.PROCUREMENT, 1, P.MEDIUM,
          ['Vendors scored', 'Blacklist / preferred list updated']),
        t('p10_t4', 'Lessons learned documentation', D.OPERATIONS, 1, P.MEDIUM,
          ['Retrospective held', 'Playbook updated for next outlet'],
          ['Playbook updated for next outlet']),
      ],
    },
  ],
});

export default storeLaunchTemplate;
