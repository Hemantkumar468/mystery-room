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
        'Search the catchment, capture every broker option as its own row, and shortlist or reject each one.',
      // Collection mode: each candidate property is a separate Record (row) with
      // its own values, attachments and shortlist/reject decision (the Phase-2 gate).
      captureMode: 'collection',
      recordNoun: 'Property',
      masterDataSchema: [
        { key: 'property_name', label: 'Property / Building Name', type: F.TEXT, required: true, order: 0 },
        { key: 'locality', label: 'Locality / Address', type: F.TEXT, required: true, order: 1 },
        { key: 'carpet_area', label: 'Carpet Area (sq.ft)', type: F.NUMBER, required: true, order: 2 },
        { key: 'frontage_ft', label: 'Frontage (ft)', type: F.NUMBER, order: 3 },
        { key: 'floor', label: 'Floor', type: F.SELECT, options: ['Ground', 'First', 'Second', 'Basement', 'Other'], order: 4 },
        { key: 'monthly_rent', label: 'Expected Monthly Rent', type: F.CURRENCY, order: 5 },
        { key: 'deposit', label: 'Expected Deposit', type: F.CURRENCY, order: 6 },
        { key: 'available_from', label: 'Available From', type: F.DATE, order: 7 },
        { key: 'owner_name', label: 'Owner Name', type: F.TEXT, order: 8 },
        { key: 'owner_phone', label: 'Owner Contact', type: F.TEXT, order: 9 },
        { key: 'broker_name', label: 'Broker Name', type: F.TEXT, order: 10 },
        { key: 'broker_phone', label: 'Broker Contact', type: F.TEXT, order: 11 },
        { key: 'photos', label: 'Site Photos', type: F.FILE, order: 12, helpText: 'Attach one or more photos' },
        { key: 'walkthrough', label: 'Video Walkthrough', type: F.FILE, order: 13 },
        { key: 'notes', label: "Doer's Notes / Pros & Cons", type: F.TEXTAREA, order: 14 },
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
      masterDataSchema: [
        { key: 'carpet_area', label: 'Carpet Area (sq.ft)', type: F.NUMBER, required: true, order: 0 },
        { key: 'frontage_ft', label: 'Frontage (ft)', type: F.NUMBER, order: 1 },
        { key: 'floor', label: 'Floor', type: F.SELECT, options: ['Ground', 'First', 'Second', 'Basement'], order: 2 },
        { key: 'footfall_score', label: 'Footfall Score (1-10)', type: F.NUMBER, order: 3 },
        { key: 'break_even_month', label: 'Projected Break-even (months)', type: F.NUMBER, order: 4 },
        { key: 'power_load_kw', label: 'Sanctioned Power Load (kW)', type: F.NUMBER, order: 5 },
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
      masterDataSchema: [
        { key: 'monthly_rent', label: 'Monthly Rent', type: F.CURRENCY, required: true, order: 0 },
        { key: 'security_deposit', label: 'Security Deposit', type: F.CURRENCY, order: 1 },
        { key: 'lockin_months', label: 'Lock-in (months)', type: F.NUMBER, order: 2 },
        { key: 'escalation_pct', label: 'Rent Escalation %', type: F.NUMBER, order: 3 },
        { key: 'agreement_type', label: 'Agreement Type', type: F.SELECT, options: ['Lease', 'Leave & License'], required: true, order: 4 },
        { key: 'registration_done', label: 'Registration Done', type: F.BOOLEAN, order: 5 },
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
        'Convert the finalized site into a live project with a budget, target opening date and project manager.',
      requiresApproval: true,
      approverRoles: ['Management'],
      masterDataSchema: [
        { key: 'project_budget', label: 'Approved Project Budget', type: F.CURRENCY, required: true, order: 0 },
        { key: 'target_opening', label: 'Target Opening Date', type: F.DATE, required: true, order: 1 },
        { key: 'project_manager', label: 'Project Manager', type: F.TEXT, order: 2 },
        { key: 'contingency_pct', label: 'Contingency %', type: F.NUMBER, order: 3 },
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
      masterDataSchema: [
        { key: 'departments_engaged', label: 'Departments Engaged', type: F.NUMBER, order: 0 },
        { key: 'kickoff_date', label: 'Planning Kick-off Date', type: F.DATE, order: 1 },
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
      masterDataSchema: [
        { key: 'overall_progress', label: 'Overall Progress %', type: F.NUMBER, order: 0 },
        { key: 'delay_days', label: 'Cumulative Delay (days)', type: F.NUMBER, order: 1 },
        { key: 'budget_spent', label: 'Budget Spent To Date', type: F.CURRENCY, order: 2 },
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
      masterDataSchema: [
        { key: 'approval_date', label: 'Approval Date', type: F.DATE, order: 0 },
        { key: 'approved_by', label: 'Approved By', type: F.TEXT, order: 1 },
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
      masterDataSchema: [
        { key: 'readiness_pct', label: 'Readiness %', type: F.NUMBER, required: true, order: 0 },
        { key: 'open_snags', label: 'Open Snags', type: F.NUMBER, order: 1 },
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
      masterDataSchema: [
        { key: 'go_live_date', label: 'Go-Live Date', type: F.DATE, required: true, order: 0 },
        { key: 'day1_bookings', label: 'Day-1 Bookings', type: F.NUMBER, order: 1 },
        { key: 'handover_signoff', label: 'Ops Handover Sign-off', type: F.BOOLEAN, order: 2 },
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
      masterDataSchema: [
        { key: 'final_cost', label: 'Final Project Cost', type: F.CURRENCY, required: true, order: 0 },
        { key: 'budget_variance_pct', label: 'Budget Variance %', type: F.NUMBER, order: 1 },
        { key: 'schedule_slippage_days', label: 'Schedule Slippage (days)', type: F.NUMBER, order: 2 },
        { key: 'lessons_doc', label: 'Lessons Learned Document', type: F.FILE, order: 3 },
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
