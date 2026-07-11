/**
 * The client's official 10-phase store-launch workflow, expressed in the shape
 * CreateTemplateModal edits locally (`id` doubles as the server `key`).
 *
 * This is a *scaffold*, not a contract: every phase, task, checklist row and
 * assignee below can be renamed, reordered or deleted in the builder. It exists
 * so a new template starts from the client's process instead of a blank page.
 *
 * Employee ids reference the roster in `lib/employees.js`. Each task carries a
 * primary "doer" and a backup buddy from the same department, so the buddy can
 * pick the task up when the primary is unavailable.
 */

/** Primary + backup buddy pairing per department, drawn from the roster. */
const DUO = {
  expansion: ['emp-exp-001', 'emp-exp-003'],
  legal: ['emp-leg-001', 'emp-leg-003'],
  projects: ['emp-prj-002', 'emp-prj-003'],
  hr: ['emp-hr-001', 'emp-hr-003'],
  marketing: ['emp-mkt-001', 'emp-mkt-003'],
  finance: ['emp-fin-001', 'emp-fin-002'],
  operations: ['emp-ops-001', 'emp-ops-002'],
  construction: ['emp-con-001', 'emp-con-003'],
  interior: ['emp-int-001', 'emp-int-002'],
  procurement: ['emp-pro-001', 'emp-pro-002'],
  automation: ['emp-aut-001', 'emp-aut-002'],
  it: ['emp-it-001', 'emp-it-002'],
};

/** Build one blueprint task; `checklist` is a plain string[] plus optional `must` labels. */
const task = (id, title, department, estimatedDays, priority, checklist = [], must = []) => {
  const [primaryAssignee, backupAssignee] = DUO[department] || ['', ''];
  return {
    id,
    title,
    department,
    estimatedDays,
    priority,
    primaryAssignee,
    backupAssignee,
    assignees: [primaryAssignee, backupAssignee].filter(Boolean),
    checklist: checklist.map((label, i) => ({
      cid: `${id}-c${i + 1}`,
      label,
      required: must.includes(label),
    })),
  };
};

export const PMS_BLUEPRINT_PHASES = [
  {
    id: 'p1',
    name: 'Property Identification',
    description:
      'Search the catchment, capture every option in a comparable format, and shortlist or reject.',
    ownerDepartment: 'expansion',
    slaDays: 10,
    color: '#e0a13a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p1_t1', 'Search & source candidate properties', 'expansion', 3, 'high',
        ['Local brokers engaged', 'Minimum 5 options sourced', 'Target localities agreed'],
        ['Local brokers engaged']),
      task('p1_t2', 'Capture property details', 'expansion', 2, 'medium',
        ['Carpet area recorded', 'Frontage & floor recorded', 'Quoted rent recorded', 'Landlord contact captured'],
        ['Carpet area recorded']),
      task('p1_t3', 'Upload documents & photographs', 'expansion', 2, 'medium',
        ['Ownership documents uploaded', 'Site photographs uploaded', 'Floor plan uploaded'],
        ['Ownership documents uploaded']),
      task('p1_t4', 'Shortlist or reject decision', 'expansion', 3, 'high',
        ['Scorecard completed for each option', 'Rejection reasons logged', 'Shortlist signed off by Expansion Head'],
        ['Scorecard completed for each option', 'Shortlist signed off by Expansion Head']),
    ],
  },
  {
    id: 'p2',
    name: 'Site Evaluation',
    description:
      'Run the feasibility, financial, technical and operational assessments on every shortlisted site.',
    ownerDepartment: 'expansion',
    slaDays: 8,
    color: '#16a79a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p2_t1', 'Feasibility assessment', 'expansion', 2, 'high',
        ['Footfall & catchment study done', 'Competitor mapping done', 'Accessibility & parking assessed'],
        ['Footfall & catchment study done']),
      task('p2_t2', 'Financial assessment', 'finance', 2, 'critical',
        ['Rent-to-revenue ratio modelled', 'Break-even month projected', 'CapEx estimate prepared', 'ROI threshold met'],
        ['Break-even month projected', 'ROI threshold met']),
      task('p2_t3', 'Technical assessment', 'construction', 2, 'high',
        ['Structural survey completed', 'Power load verified', 'Water & drainage verified', 'Fire exits verified'],
        ['Structural survey completed', 'Fire exits verified']),
      task('p2_t4', 'Operational assessment', 'operations', 1, 'medium',
        ['Game room layout viable', 'Staff room & storage viable', 'Customer flow simulated']),
    ],
  },
  {
    id: 'p3',
    name: 'Commercial Finalization',
    description:
      'LOI, lease agreement, legal verification, deposits, NOCs and statutory approvals.',
    ownerDepartment: 'legal',
    slaDays: 12,
    color: '#6366f1',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p3_t1', 'Issue Letter of Intent (LOI)', 'legal', 2, 'high',
        ['Commercials agreed with landlord', 'LOI drafted', 'LOI countersigned'],
        ['LOI countersigned']),
      task('p3_t2', 'Draft & finalize lease agreement', 'legal', 3, 'critical',
        ['Lock-in period agreed', 'Escalation clause agreed', 'Exit clause reviewed', 'Agreement registered'],
        ['Agreement registered']),
      task('p3_t3', 'Legal verification & title due diligence', 'legal', 2, 'critical',
        ['Title chain verified', 'Encumbrance certificate obtained', 'Landlord identity verified'],
        ['Title chain verified']),
      task('p3_t4', 'Security deposit & token payment', 'finance', 1, 'high',
        ['Deposit approved', 'Payment released', 'Receipt filed'],
        ['Deposit approved']),
      task('p3_t5', 'NOCs & statutory approvals', 'legal', 2, 'high',
        ['Fire NOC applied', 'Trade licence applied', 'Society / mall NOC obtained', 'Signage permission obtained'],
        ['Fire NOC applied', 'Trade licence applied']),
    ],
  },
  {
    id: 'p4',
    name: 'Project Creation',
    description:
      'Convert the finalized site into a live project with a budget, target opening date and project manager.',
    ownerDepartment: 'projects',
    slaDays: 5,
    color: '#f43f5e',
    requiresApproval: true,
    approverRoles: ['Management'],
    tasks: [
      task('p4_t1', 'Define project budget', 'finance', 2, 'critical',
        ['CapEx heads broken down', 'Contingency % agreed', 'Budget approved by Management'],
        ['Budget approved by Management']),
      task('p4_t2', 'Set target opening date', 'projects', 1, 'high',
        ['Backward schedule prepared', 'Long-lead items identified', 'Date communicated to all departments'],
        ['Date communicated to all departments']),
      {
        // Deliberately assigned to a primary who is currently overloaded, so the
        // project materializes with `reassignNeeded` and the buddy is surfaced.
        ...task('p4_t3', 'Assign project manager', 'projects', 2, 'high',
          ['PM named & accepted', 'Handover from Expansion completed', 'Kick-off meeting held'],
          ['PM named & accepted']),
        primaryAssignee: 'emp-prj-001',
        backupAssignee: 'emp-prj-002',
        assignees: ['emp-prj-001', 'emp-prj-002'],
      },
    ],
  },
  {
    id: 'p5',
    name: 'Department Planning',
    description:
      'Allocate the work packet to every department. Each allocation names a doer and a backup buddy.',
    ownerDepartment: 'projects',
    slaDays: 7,
    color: '#38bdf8',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p5_t1', 'Allocate Construction scope', 'construction', 1, 'high',
        ['Scope of work issued', 'Contractor shortlisted', 'Timeline committed']),
      task('p5_t2', 'Allocate Interior scope', 'interior', 1, 'high',
        ['Theme brief issued', 'Drawings approved', 'Timeline committed']),
      task('p5_t3', 'Allocate Procurement scope', 'procurement', 1, 'high',
        ['BOQ finalized', 'Long-lead items ordered', 'Vendor SLAs signed'],
        ['Long-lead items ordered']),
      task('p5_t4', 'Allocate Automation scope', 'automation', 1, 'medium',
        ['Game automation spec issued', 'Integration plan agreed']),
      task('p5_t5', 'Allocate IT scope', 'it', 1, 'medium',
        ['Network & POS spec issued', 'Hardware indent raised']),
      task('p5_t6', 'Allocate Marketing scope', 'marketing', 1, 'medium',
        ['Launch campaign brief issued', 'Budget allocated']),
      task('p5_t7', 'Allocate HR scope', 'hr', 1, 'medium',
        ['Manpower plan approved', 'Hiring timeline committed']),
      task('p5_t8', 'Allocate Finance scope', 'finance', 1, 'medium',
        ['Cash-flow plan issued', 'Payment milestones agreed']),
      task('p5_t9', 'Allocate Operations scope', 'operations', 1, 'medium',
        ['SOP pack issued', 'Opening rota drafted']),
      task('p5_t10', 'Allocate Legal scope', 'legal', 1, 'medium',
        ['Compliance calendar issued', 'Vendor contracts queued']),
    ],
  },
  {
    id: 'p6',
    name: 'Execution',
    description:
      'Run the build. Track status, progress, attachments, dependencies and delays against the plan.',
    ownerDepartment: 'projects',
    slaDays: 45,
    color: '#10b981',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p6_t1', 'Track task status & progress', 'projects', 12, 'high',
        ['Progress % updated weekly', 'Blockers raised within 24h']),
      task('p6_t2', 'Maintain attachments & site evidence', 'projects', 8, 'low',
        ['Weekly site photos uploaded', 'Bills & invoices attached']),
      task('p6_t3', 'Manage inter-department dependencies', 'projects', 10, 'high',
        ['Dependency map maintained', 'Handover dates confirmed'],
        ['Dependency map maintained']),
      task('p6_t4', 'Flag & escalate delays', 'projects', 8, 'critical',
        ['Delays flagged with reason', 'Recovery plan agreed', 'Management informed'],
        ['Recovery plan agreed']),
      task('p6_t5', 'Weekly progress review', 'operations', 7, 'medium',
        ['Review deck circulated', 'Actions assigned with owners']),
    ],
  },
  {
    id: 'p7',
    name: 'Approval Workflow',
    description:
      'Department and management approvals that gate progression to store readiness.',
    ownerDepartment: 'operations',
    slaDays: 5,
    color: '#8b5cf6',
    requiresApproval: true,
    approverRoles: ['Department Head', 'Management'],
    tasks: [
      task('p7_t1', 'Department head sign-off', 'operations', 2, 'high',
        ['Every department has signed off', 'Open snags listed'],
        ['Every department has signed off']),
      task('p7_t2', 'Management approval', 'finance', 2, 'critical',
        ['Budget variance reviewed', 'Schedule variance reviewed', 'Approval recorded'],
        ['Approval recorded']),
      task('p7_t3', 'Stage progression gate', 'projects', 1, 'high',
        ['All prior phases marked complete', 'Gate decision logged'],
        ['All prior phases marked complete']),
    ],
  },
  {
    id: 'p8',
    name: 'Store Readiness Checklist',
    description:
      'The pre-launch gate: construction, utilities, IT, hiring, training, marketing, testing, inventory and compliance.',
    ownerDepartment: 'operations',
    slaDays: 10,
    color: '#ec4899',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p8_t1', 'Construction readiness', 'construction', 1, 'high',
        ['Civil work complete', 'Snag list closed', 'Handover certificate issued'],
        ['Snag list closed']),
      task('p8_t2', 'Utilities & power', 'construction', 1, 'high',
        ['Permanent power connection live', 'DG / UPS backup tested', 'Water & drainage live', 'HVAC commissioned'],
        ['Permanent power connection live']),
      task('p8_t3', 'IT & network setup', 'it', 1, 'high',
        ['Broadband live with backup link', 'POS installed & tested', 'CCTV live', 'Wi-Fi coverage tested'],
        ['POS installed & tested', 'CCTV live']),
      task('p8_t4', 'Automation & game systems', 'automation', 1, 'high',
        ['All game props wired', 'Control panel tested', 'Emergency override tested'],
        ['Emergency override tested']),
      task('p8_t5', 'Hiring complete', 'hr', 1, 'medium',
        ['Outlet manager onboarded', 'Game masters onboarded', 'Front desk onboarded'],
        ['Outlet manager onboarded']),
      task('p8_t6', 'Training & certification', 'hr', 1, 'medium',
        ['Game master certification passed', 'Safety drill completed', 'POS training completed'],
        ['Safety drill completed']),
      task('p8_t7', 'Marketing readiness', 'marketing', 1, 'medium',
        ['Google Business listing live', 'Booking page live', 'Launch campaign scheduled'],
        ['Booking page live']),
      task('p8_t8', 'Testing & dry runs', 'operations', 1, 'critical',
        ['Full dry run completed', 'Puzzle difficulty tuned', 'Reset time measured'],
        ['Full dry run completed']),
      task('p8_t9', 'Inventory & consumables', 'procurement', 1, 'medium',
        ['Opening stock received', 'Consumables buffer in place', 'Asset register updated']),
      task('p8_t10', 'Statutory compliance', 'legal', 1, 'critical',
        ['Fire NOC received', 'Trade licence received', 'Insurance active', 'Shops & Establishment registered'],
        ['Fire NOC received', 'Trade licence received', 'Insurance active']),
    ],
  },
  {
    id: 'p9',
    name: 'Store Launch',
    description: 'Go-live approval and the public opening.',
    ownerDepartment: 'operations',
    slaDays: 5,
    color: '#e0a13a',
    requiresApproval: true,
    approverRoles: ['Management'],
    tasks: [
      task('p9_t1', 'Go-live approval', 'operations', 2, 'critical',
        ['Readiness checklist 100% complete', 'Management go-live sign-off', 'Ops handover accepted'],
        ['Readiness checklist 100% complete', 'Management go-live sign-off']),
      task('p9_t2', 'Store opening & launch event', 'marketing', 3, 'high',
        ['Launch event executed', 'Day-1 bookings tracked', 'Customer feedback captured']),
    ],
  },
  {
    id: 'p10',
    name: 'Project Closure',
    description:
      'Close the book: budget variance, delay analysis, vendor performance and lessons learned.',
    ownerDepartment: 'finance',
    slaDays: 7,
    color: '#16a79a',
    requiresApproval: false,
    approverRoles: [],
    tasks: [
      task('p10_t1', 'Budget variance analysis', 'finance', 2, 'high',
        ['Planned vs actual compiled', 'Overruns explained', 'Final cost signed off'],
        ['Final cost signed off']),
      task('p10_t2', 'Delay & schedule analysis', 'projects', 1, 'medium',
        ['Phase-wise slippage computed', 'Root causes documented']),
      task('p10_t3', 'Vendor performance review', 'procurement', 1, 'medium',
        ['Vendors scored', 'Blacklist / preferred list updated']),
      task('p10_t4', 'Lessons learned documentation', 'operations', 1, 'medium',
        ['Retrospective held', 'Playbook updated for next outlet'],
        ['Playbook updated for next outlet']),
    ],
  },
];

/** Deep clone so the module-level constant is never mutated by the builder. */
export const freshBlueprintPhases = () =>
  PMS_BLUEPRINT_PHASES.map((p) => ({
    ...p,
    approverRoles: [...p.approverRoles],
    tasks: p.tasks.map((t) => ({
      ...t,
      assignees: [...t.assignees],
      checklist: t.checklist.map((c) => ({ ...c })),
    })),
  }));

export default PMS_BLUEPRINT_PHASES;
