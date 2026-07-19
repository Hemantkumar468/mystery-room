/* eslint-disable no-console */
/**
 * Standalone enterprise seed-data generator for Phase 10 — Project Closure.
 *
 * Produces 13 relationally-consistent JSON collections for 15 fully-closed
 * projects (every project has already cleared Phases 1–9), written to
 * ./data/projectClosure/*.json. This is data only — it does NOT touch the
 * database or the Template/Record models; it's meant to seed a demo/BI
 * dataset, drive frontend mocking, or be loaded by a future importer.
 *
 * Deterministic: a fixed PRNG seed means re-running this script always
 * produces byte-identical output, so the generated files are safe to diff
 * and to check into version control.
 *
 *   node src/seed/generateProjectClosureSeedData.js
 */
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'data', 'projectClosure');
mkdirSync(OUT_DIR, { recursive: true });

/* ---------------------------------------------------------------------- */
/* Deterministic PRNG (mulberry32) — fixed seed so output is reproducible. */
/* ---------------------------------------------------------------------- */
function mulberry32(seed) {
  return function rand() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260716);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pickN = (arr, n) => {
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < n && pool.length; i += 1) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
};
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const flt = (min, max, decimals = 1) => +(rand() * (max - min) + min).toFixed(decimals);
const chance = (p) => rand() < p;

const TODAY = new Date('2026-07-16T00:00:00.000Z');
const daysAgo = (n) => new Date(TODAY.getTime() - n * 86400000);
const iso = (d) => d.toISOString();
const dateOnly = (d) => d.toISOString().slice(0, 10);

/* ---------------------------------------------------------------------- */
/* Reference pools                                                        */
/* ---------------------------------------------------------------------- */
const CITY_INFO = [
  { city: 'Lucknow', locality: 'Gomti Nagar', mall: 'Phoenix Palassio', code: 'LKO' },
  { city: 'Delhi', locality: 'Saket', mall: 'Select Citywalk', code: 'DEL' },
  { city: 'Mumbai', locality: 'Kurla', mall: 'Phoenix Marketcity', code: 'BOM' },
  { city: 'Noida', locality: 'Sector 18', mall: 'DLF Mall of India', code: 'NOI' },
  { city: 'Pune', locality: 'Magarpatta', mall: 'Seasons Mall', code: 'PUN' },
  { city: 'Indore', locality: 'MG Road', mall: 'Treasure Island Mall', code: 'IND' },
  { city: 'Ahmedabad', locality: 'Vastrapur', mall: 'Alpha One Mall', code: 'AMD' },
  { city: 'Hyderabad', locality: 'Cyberabad', mall: 'Inorbit Mall', code: 'HYD' },
  { city: 'Jaipur', locality: 'Malviya Nagar', mall: 'World Trade Park', code: 'JAI' },
  { city: 'Bangalore', locality: 'Whitefield', mall: 'Phoenix Marketcity', code: 'BLR' },
  { city: 'Mumbai', locality: 'Malad West', mall: 'Infiniti Mall', code: 'BOM' },
  { city: 'Delhi', locality: 'Tagore Garden', mall: 'Pacific Mall', code: 'DEL' },
  { city: 'Chennai', locality: 'Royapettah', mall: 'Express Avenue', code: 'MAA' },
  { city: 'Kolkata', locality: 'Prince Anwar Shah Road', mall: 'South City Mall', code: 'CCU' },
  { city: 'Bangalore', locality: 'Rajajinagar', mall: 'Orion Mall', code: 'BLR' },
];

const FULL_NAMES = [
  'Amit Sharma', 'Vikram Sahu', 'Rahul Yadav', 'Priya Menon', 'Arjun Nair', 'Neha Kapoor',
  'Vikas Jha', 'Sana Sheikh', 'Karan Gupta', 'Divya Iyer', 'Rohit Sharma', 'Ananya Das',
  'Meera Pillai', 'Suresh Reddy', 'Kavita Rao', 'Manoj Tiwari', 'Pooja Bhatt', 'Sandeep Verma',
  'Anjali Desai', 'Rajesh Kumar', 'Ritu Malhotra', 'Deepak Chawla', 'Shalini Menon', 'Nikhil Joshi',
];
const DEPARTMENTS = ['Finance', 'Projects', 'Operations', 'Procurement', 'Legal', 'Marketing'];
const ROLES = ['admin', 'manager', 'executor'];

const IP_POOL = Array.from({ length: 24 }, (_, i) => `10.20.${int(0, 254)}.${(i * 7 + 12) % 254}`);
const ipFor = () => pick(IP_POOL);

const VENDOR_POOL = {
  Civil: ['BuildRight Construction', 'Shree Balaji Constructions', 'Apex Civil Works', 'Skyline Builders & Contractors'],
  Interior: ['Apex Interiors', 'Studio Nine Design', 'Craftsmen Interiors', 'Urban Canvas Interiors'],
  Electrical: ['CoolAir HVAC & Electricals', 'Powergrid Electricals', 'Voltas Electrical Contractors', 'Bright Spark Electricals'],
  Furniture: ['BrightSign Signage & Furniture', 'Modular Spaces Furniture', 'Ergo Craft Furnishing', 'WoodWorks Fitouts'],
  Automation: ['SwiftAutomation Systems', 'NextGen Automation', 'RoboTech Integrators', 'Precision Automation Co.'],
  IT: ['NetEdge IT Solutions', 'Cognizant Retail Systems', 'ByteWorks Networking', 'PixelPoint POS Systems'],
  Marketing: ['AdSphere Media', 'BrandWave Marketing', 'Pulse Creative Agency', 'Momentum Digital'],
  Legal: ['Khanna & Associates', 'Verma Legal Chambers', 'LexPro Advisory', 'Sethi Law Partners'],
  Finance: ['Ashoka Audit & Advisory', 'ClearBooks Consulting', 'Prime Financial Services', 'Vertex Tax & Compliance'],
  Operations: ['FacilityFirst Ops', 'ProCare Facility Management', 'Streamline Ops Partners', 'Gateway FM Services'],
};
const VENDOR_CATEGORIES = Object.keys(VENDOR_POOL);

const CLOSURE_MODULES = [
  { key: 'budget_analysis', name: 'Budget Analysis' },
  { key: 'delay_analysis', name: 'Delay Analysis' },
  { key: 'vendor_performance', name: 'Vendor Performance' },
  { key: 'financial_closure', name: 'Financial Closure' },
  { key: 'asset_handover', name: 'Asset Handover' },
  { key: 'document_archive', name: 'Document Archive' },
  { key: 'lessons_learned', name: 'Lessons Learned' },
  { key: 'project_sign_off', name: 'Project Sign-Off' },
];

const DELAY_REASONS = ['Weather', 'Vendor Delay', 'Approval Delay', 'Material Delay', 'Design Revision', 'Government Approval', 'Utility Issue'];

const LESSON_TEMPLATES = {
  Planning: [
    { issue: 'Target opening date was locked before the site survey was complete.', rootCause: 'Timeline was committed during LOI stage without a structural/electrical audit.', resolution: 'Reworked the schedule after the survey and communicated the revised date to all departments.', recommendation: 'Freeze the opening date only after the technical survey sign-off, not at LOI stage.' },
    { issue: 'Department kickoff happened before Project Creation was fully approved.', rootCause: 'Department Planning was started in parallel to save time.', resolution: 'Realigned department scopes once budget/timeline were finalized.', recommendation: 'Gate Department Planning behind a fully-approved Project Creation record.' },
  ],
  Execution: [
    { issue: 'Civil handover to Interior slipped by over a week.', rootCause: 'Snag list closure took longer than the buffer allotted in the schedule.', resolution: 'Added a dedicated snag-closure sprint with daily tracking before handover.', recommendation: 'Build a mandatory 5-day snag-closure buffer into every civil-to-interior handover.' },
    { issue: 'Automation installation was blocked waiting on IT network readiness.', rootCause: 'IT and Automation vendors were scheduled without a shared dependency map.', recommendation: 'Maintain a single cross-department dependency tracker from Execution kickoff.', resolution: 'Escalated and re-sequenced IT setup ahead of automation wiring.' },
  ],
  Vendor: [
    { issue: 'Furniture vendor missed the committed delivery window twice.', rootCause: 'Vendor SLA did not carry a penalty clause for delayed delivery.', resolution: 'Escalated to procurement; vendor expedited via air freight for the balance items.', recommendation: 'Add delivery-delay penalty clauses to all furniture and fixture vendor contracts.' },
    { issue: 'Automation vendor under-quoted the integration effort.', rootCause: 'Scope of work did not clearly separate hardware supply from software integration.', resolution: 'Renegotiated a change order covering the additional integration hours.', recommendation: 'Require a line-itemised SOW (hardware vs. integration vs. support) at vendor onboarding.' },
  ],
  Budget: [
    { issue: 'Contingency budget was exhausted before final fit-out.', rootCause: 'CapEx overruns in electrical rework were absorbed entirely by contingency.', resolution: 'Raised a supplementary budget approval with Finance for the final ₹3-5L gap.', recommendation: 'Ring-fence contingency budget strictly for unforeseen items, not planned-scope overruns.' },
    { issue: 'Actual cost tracking lagged real spend by 2-3 weeks.', rootCause: 'Vendor invoices were being logged only at month-end reconciliation.', resolution: 'Moved to weekly invoice logging for the remainder of the project.', recommendation: 'Mandate weekly, not monthly, invoice logging for every active project.' },
  ],
  Quality: [
    { issue: 'Final store inspection found paint finish defects in two zones.', rootCause: 'Interior vendor moved to the next zone before the previous coat fully cured.', resolution: 'Re-painted both zones before go-live, delaying opening by one day.', recommendation: 'Add a mandatory cure-time checkpoint to the interior QC checklist.' },
    { issue: 'Signage installation quality varied between storefront and interior units.', rootCause: 'Two different sub-contractors were used without a shared quality spec.', resolution: 'Standardised on a single signage vendor for both storefront and interior.', recommendation: 'Single-source all branding/signage work per store to keep quality consistent.' },
  ],
  Operations: [
    { issue: 'POS staff were trained only two days before opening.', rootCause: 'Training was scheduled after hardware installation instead of in parallel.', resolution: 'Ran an extended dry-run over the opening weekend to close gaps.', recommendation: 'Start POS/staff training in parallel with hardware installation, not after it.' },
    { issue: 'Opening-day footfall exceeded staffing plan by ~30%.', rootCause: 'Footfall projection did not account for the marketing launch campaign reach.', resolution: 'Pulled in two staff from the nearest outlet for the opening week.', recommendation: 'Size opening-week staffing off the marketing campaign’s reach estimate, not the base plan.' },
  ],
};
const PRIORITIES = ['High', 'Medium', 'Low'];

const REPORT_TYPES = ['Closure Report', 'Budget Report', 'Vendor Performance Report', 'Lessons Learned Report', 'Audit Report', 'Financial Closure Report'];

const ATTACHMENT_KIND_BY_MODULE = {
  budget_analysis: ['Signed PDF', 'Invoice'],
  delay_analysis: ['Signed PDF'],
  vendor_performance: ['Vendor Report'],
  financial_closure: ['Invoice', 'Completion Certificate'],
  asset_handover: ['Asset Handover Document', 'Image'],
  document_archive: ['Signed PDF', 'Image'],
  lessons_learned: ['Signed PDF'],
  project_sign_off: ['Completion Certificate', 'Audit Report'],
};
const FILE_EXT_BY_KIND = {
  'Signed PDF': 'pdf', Invoice: 'pdf', 'Completion Certificate': 'pdf', 'Vendor Report': 'pdf',
  'Audit Report': 'pdf', Image: 'jpg', 'Asset Handover Document': 'pdf',
};

/* ---------------------------------------------------------------------- */
/* 1. projects.json                                                       */
/* ---------------------------------------------------------------------- */
const cityCounters = {};
const seqCounter = { n: 77 };

const projects = CITY_INFO.map((c, idx) => {
  cityCounters[c.code] = (cityCounters[c.code] || 0) + 1;
  seqCounter.n += 1;

  const budgetTier = ['Delhi', 'Mumbai', 'Bangalore'].includes(c.city) ? [12000000, 22000000] : [4500000, 11000000];
  const budget = Math.round(int(budgetTier[0], budgetTier[1]) / 5000) * 5000;
  const isOverrun = idx % 5 === 4; // 3 of 15 projects run over budget
  const variancePct = isOverrun ? -flt(1, 6) : flt(2, 14);
  const actualCost = Math.round(budget * (1 - variancePct / 100) / 500) * 500;
  const budgetVariance = budget - actualCost;
  const budgetSaved = Math.max(0, budgetVariance);

  const plannedDuration = int(120, 165);
  const delayDays = idx % 4 === 0 ? int(1, 9) : -int(0, 6); // most finish on/ahead of schedule
  const actualDuration = plannedDuration + delayDays;

  const overallScore = Math.max(58, Math.min(99, Math.round(94 - Math.abs(variancePct) * 0.6 - Math.max(0, delayDays) * 1.1 + (isOverrun ? -6 : 0) + int(-3, 3))));
  const storePerformance = overallScore >= 90 ? 'Excellent' : overallScore >= 75 ? 'Good' : overallScore >= 60 ? 'Average' : 'Poor';

  // Draw completion first, then derive opening from it (closure runs 12–28
  // days after go-live) so opening always precedes completion.
  const completionDaysAgo = int(3, 300);
  const completionDate = daysAgo(completionDaysAgo);
  const openingDate = daysAgo(completionDaysAgo + int(12, 28));

  const projectManager = pick(FULL_NAMES);
  const storeManager = pick(FULL_NAMES.filter((n) => n !== projectManager));

  return {
    id: randomUUID(),
    projectId: `PRJ-${c.code}-${String(cityCounters[c.code]).padStart(3, '0')}`,
    projectName: `${c.mall} Retail Project`,
    storeCode: `MR-${c.code}-${String(cityCounters[c.code]).padStart(3, '0')}`,
    propertyName: `${c.mall} Property`,
    propertyNumber: `PRP-2025-${String(seqCounter.n).padStart(5, '0')}`,
    city: c.city,
    locality: c.locality,
    commercialType: chance(0.7) ? 'Lease' : 'Rent',
    projectManager,
    storeManager,
    budget,
    actualCost,
    budgetSaved,
    budgetVariance,
    budgetVariancePct: +variancePct.toFixed(2),
    executionDays: actualDuration,
    plannedDuration,
    actualDuration,
    delayDays,
    overallScore,
    storePerformance,
    projectCompletion: 100,
    openingDate: dateOnly(openingDate),
    completionDate: dateOnly(completionDate),
    status: 'Completed',
  };
});

/* ---------------------------------------------------------------------- */
/* Shared counters / accumulators for cross-referenced collections        */
/* ---------------------------------------------------------------------- */
const closureModules = [];
const closureRecords = [];
const timeline = [];
const auditLogs = [];
const attachments = [];
let globalSubmissionSeq = 0;
let globalTimelineDay = 1;

const nextSubmissionNo = () => {
  globalSubmissionSeq += 1;
  return `CR-2026-${String(globalSubmissionSeq).padStart(6, '0')}`;
};

const pushAudit = ({ action, actor, projectId, targetType, targetId, timestamp }) => {
  auditLogs.push({
    id: randomUUID(),
    action, // Created | Updated | Reviewed | Approved | Archived
    targetType, // ClosureRecord | Project
    targetId,
    projectId,
    user: actor,
    role: pick(ROLES),
    department: pick(DEPARTMENTS),
    timestamp: iso(timestamp),
    ipAddress: ipFor(),
  });
};

const pushAttachments = ({ recordId, projectId, module, submittedBy, submittedOn, storeCode }) => {
  const kinds = ATTACHMENT_KIND_BY_MODULE[module] || ['Signed PDF'];
  const count = int(1, 3);
  const files = [];
  for (let i = 0; i < count; i += 1) {
    const kind = pick(kinds);
    const ext = FILE_EXT_BY_KIND[kind];
    const fileName = `${kind.replace(/\s+/g, '_')}_${storeCode}_${i + 1}.${ext}`;
    const att = {
      id: randomUUID(),
      recordId,
      projectId,
      kind,
      fileName,
      sizeKB: int(80, 4200),
      uploadedBy: submittedBy,
      uploadedAt: iso(submittedOn),
      url: `/storage/project-closure/${projectId}/${fileName}`,
    };
    attachments.push(att);
    files.push(att.id);
  }
  return files;
};

/* ---------------------------------------------------------------------- */
/* 2 & 3. closureModules.json + closureRecords.json (+ timeline/audit/attachments as we go) */
/* ---------------------------------------------------------------------- */
projects.forEach((proj) => {
  const closureStart = daysAgo(
    Math.round((TODAY.getTime() - new Date(proj.completionDate).getTime()) / 86400000) + 12,
  );

  CLOSURE_MODULES.forEach((mod, mIdx) => {
    // Vendor Performance is handled separately below (one record per vendor evaluation, 20 total).
    if (mod.key === 'vendor_performance') return;

    const wasRejectedFirst = chance(0.12);
    const submittedBy = mod.key === 'budget_analysis' || mod.key === 'financial_closure' ? proj.projectManager : pick(FULL_NAMES);
    const reviewedBy = pick(FULL_NAMES.filter((n) => n !== submittedBy));
    const approvedBy = pick(['Rahul Yadav', 'Priya Menon', 'Arjun Nair']);

    const baseDay = new Date(closureStart.getTime() + mIdx * 1.4 * 86400000);
    let submissionNo = 1;
    const records = [];

    if (wasRejectedFirst) {
      const rejSubmit = new Date(baseDay.getTime());
      const rejDecide = new Date(rejSubmit.getTime() + 86400000);
      const recId = randomUUID();
      const subNo = nextSubmissionNo();
      records.push({ id: recId, submissionNo: subNo, status: 'Rejected', submittedOn: rejSubmit, decidedOn: rejDecide, submittedBy, reviewedBy, approvedBy: null });
      closureRecords.push({
        id: recId, submissionNumber: subNo, module: mod.name, moduleKey: mod.key,
        projectId: proj.id, projectCode: proj.storeCode, projectName: proj.projectName,
        submittedBy, submittedOn: iso(rejSubmit), reviewedBy, approvedBy: null, approvedOn: null,
        status: 'Rejected', remarks: 'Returned for corrections — see reviewer notes.', attachmentCount: 0,
      });
      pushAudit({ action: 'Created', actor: submittedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recId, timestamp: rejSubmit });
      pushAudit({ action: 'Reviewed', actor: reviewedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recId, timestamp: rejDecide });
      timeline.push({
        id: randomUUID(), projectId: proj.id, timestamp: iso(rejDecide), user: reviewedBy, department: pick(DEPARTMENTS),
        description: `${mod.name} submission rejected — corrections requested.`,
      });
      submissionNo = 2;
      baseDay.setDate(baseDay.getDate() + 2);
    }

    const submittedOn = new Date(baseDay.getTime());
    const approvedOn = new Date(submittedOn.getTime() + int(1, 3) * 86400000);
    const recordId = randomUUID();
    const subNo = nextSubmissionNo();

    const remarksByModule = {
      budget_analysis: `Planned vs actual cost reconciled; net variance of ₹${Math.abs(proj.budgetVariance).toLocaleString('en-IN')} (${proj.budgetVariancePct}%) recorded and signed off by Finance.`,
      delay_analysis: proj.delayDays > 0
        ? `Project completed ${proj.delayDays} day(s) behind the planned ${proj.plannedDuration}-day schedule; root causes documented and mitigation logged.`
        : `Project completed ${Math.abs(proj.delayDays)} day(s) ahead of the planned ${proj.plannedDuration}-day schedule.`,
      financial_closure: 'All vendor invoices reconciled and final payments released; financial closure certificate issued.',
      asset_handover: 'All fixed assets, keys, warranty documents and AMC contracts formally handed over to Operations.',
      document_archive: 'Legal, financial, vendor and compliance documents archived in the central repository.',
      lessons_learned: 'Retrospective held with all department leads; key learnings and recommendations logged for the next rollout.',
      project_sign_off: `Final sign-off collected from all stakeholders; overall closure score ${proj.overallScore}/100 (${proj.storePerformance}).`,
    };

    const attachmentIds = pushAttachments({ recordId, projectId: proj.id, module: mod.key, submittedBy, submittedOn, storeCode: proj.storeCode });

    closureRecords.push({
      id: recordId, submissionNumber: subNo, module: mod.name, moduleKey: mod.key,
      projectId: proj.id, projectCode: proj.storeCode, projectName: proj.projectName,
      submittedBy, submittedOn: iso(submittedOn), reviewedBy, approvedBy, approvedOn: iso(approvedOn),
      status: 'Approved', remarks: remarksByModule[mod.key], attachmentCount: attachmentIds.length,
    });
    records.push({ id: recordId, submissionNo: subNo, status: 'Approved', submittedOn, decidedOn: approvedOn, submittedBy, reviewedBy, approvedBy });

    pushAudit({ action: 'Created', actor: submittedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recordId, timestamp: submittedOn });
    pushAudit({ action: 'Reviewed', actor: reviewedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recordId, timestamp: new Date(submittedOn.getTime() + 43200000) });
    pushAudit({ action: 'Approved', actor: approvedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recordId, timestamp: approvedOn });

    timeline.push({
      id: randomUUID(), projectId: proj.id, timestamp: iso(submittedOn), user: submittedBy, department: pick(DEPARTMENTS),
      description: `${mod.name} submitted for review (Submission ${subNo}).`,
    });
    timeline.push({
      id: randomUUID(), projectId: proj.id, timestamp: iso(approvedOn), user: approvedBy, department: pick(DEPARTMENTS),
      description: `${mod.name} Approved.`,
    });

    closureModules.push({
      id: randomUUID(), projectId: proj.id, moduleKey: mod.key, moduleName: mod.name, status: 'Completed',
      submittedBy, reviewedBy, approvedBy, approvalDate: dateOnly(approvedOn),
      submissionNumber: submissionNo, attachmentCount: attachmentIds.length,
      remarks: remarksByModule[mod.key],
      auditHistory: records.flatMap((r) => [
        { action: 'Created', actor: r.submittedBy, timestamp: iso(r.submittedOn) },
        { action: r.status === 'Approved' ? 'Approved' : 'Reviewed', actor: r.status === 'Approved' ? r.approvedBy : r.reviewedBy, timestamp: iso(r.decidedOn) },
      ]),
    });
  });

  globalTimelineDay += 1;
});

/* ---------------------------------------------------------------------- */
/* 4. vendorPerformance.json (20 total, distributed across projects)      */
/* ---------------------------------------------------------------------- */
const vendorAssignCounts = (() => {
  // Distribute exactly 20 vendor evaluations across 15 projects — every
  // project gets at least 1, five projects get a 2nd.
  const counts = projects.map(() => 1);
  pickN(counts.map((_, i) => i), 5).forEach((i) => { counts[i] += 1; });
  return counts;
})();

const vendorPerformance = [];
projects.forEach((proj, pIdx) => {
  for (let v = 0; v < vendorAssignCounts[pIdx]; v += 1) {
    const category = pick(VENDOR_CATEGORIES);
    const vendorName = pick(VENDOR_POOL[category]);
    const qualityScore = int(78, 99);
    const deliveryScore = int(72, 99);
    const supportScore = int(75, 99);
    const complianceScore = int(80, 100);
    const overallRating = +(((qualityScore + deliveryScore + supportScore + complianceScore) / 4) / 20).toFixed(1);
    const contractValue = int(180000, 3200000);
    const completionPct = 100;

    const submittedBy = pick(FULL_NAMES);
    const reviewedBy = pick(FULL_NAMES.filter((n) => n !== submittedBy));
    const approvedBy = pick(['Rahul Yadav', 'Priya Menon', 'Arjun Nair']);
    const submittedOn = daysAgo(int(20, 260));
    const approvedOn = new Date(submittedOn.getTime() + int(1, 3) * 86400000);
    const recordId = randomUUID();
    const subNo = nextSubmissionNo();

    const remarks = deliveryScore < 80
      ? `${vendorName} delivered with some schedule slippage; SLA reviewed for future engagements.`
      : `${vendorName} performed to specification with strong delivery and support scores.`;

    const attachmentIds = pushAttachments({ recordId, projectId: proj.id, module: 'vendor_performance', submittedBy, submittedOn, storeCode: proj.storeCode });

    vendorPerformance.push({
      id: recordId,
      vendorName, category, projectId: proj.id, projectCode: proj.storeCode,
      contractValue, completionPct, qualityScore, deliveryScore, supportScore, complianceScore,
      overallRating, remarks,
    });

    closureRecords.push({
      id: recordId, submissionNumber: subNo, module: 'Vendor Performance', moduleKey: 'vendor_performance',
      projectId: proj.id, projectCode: proj.storeCode, projectName: proj.projectName,
      submittedBy, submittedOn: iso(submittedOn), reviewedBy, approvedBy, approvedOn: iso(approvedOn),
      status: 'Approved', remarks, attachmentCount: attachmentIds.length,
    });

    pushAudit({ action: 'Created', actor: submittedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recordId, timestamp: submittedOn });
    pushAudit({ action: 'Approved', actor: approvedBy, projectId: proj.id, targetType: 'ClosureRecord', targetId: recordId, timestamp: approvedOn });

    timeline.push({
      id: randomUUID(), projectId: proj.id, timestamp: iso(submittedOn), user: submittedBy, department: 'Procurement',
      description: `Vendor Performance review filed for ${vendorName} (${category}).`,
    });
    timeline.push({
      id: randomUUID(), projectId: proj.id, timestamp: iso(approvedOn), user: approvedBy, department: 'Procurement',
      description: `Vendor Performance Approved for ${vendorName}.`,
    });
  }
});

// Closure module summary row for Vendor Performance (one per project, count = vendors evaluated).
projects.forEach((proj, pIdx) => {
  const projVendors = vendorPerformance.filter((v) => v.projectId === proj.id);
  const first = projVendors[0];
  const rec = closureRecords.find((r) => r.projectId === proj.id && r.moduleKey === 'vendor_performance' && r.id === first.id);
  closureModules.push({
    id: randomUUID(), projectId: proj.id, moduleKey: 'vendor_performance', moduleName: 'Vendor Performance', status: 'Completed',
    submittedBy: rec.submittedBy, reviewedBy: rec.reviewedBy, approvedBy: rec.approvedBy, approvalDate: rec.approvedOn.slice(0, 10),
    submissionNumber: vendorAssignCounts[pIdx], attachmentCount: projVendors.reduce((s) => s + int(1, 2), 0),
    remarks: `${projVendors.length} vendor(s) evaluated — average rating ${(projVendors.reduce((s, v) => s + v.overallRating, 0) / projVendors.length).toFixed(1)}/5.`,
    auditHistory: [
      { action: 'Created', actor: rec.submittedBy, timestamp: rec.submittedOn },
      { action: 'Approved', actor: rec.approvedBy, timestamp: rec.approvedOn },
    ],
  });
});

/* ---------------------------------------------------------------------- */
/* Project closed event (final timeline + audit entry per project)        */
/* ---------------------------------------------------------------------- */
projects.forEach((proj) => {
  const closedAt = new Date(`${proj.completionDate}T${String(int(14, 21)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}:00.000Z`);
  timeline.push({
    id: randomUUID(), projectId: proj.id, timestamp: iso(closedAt), user: 'Rahul Yadav', department: 'Projects',
    description: 'Project Closed Successfully — all closure modules approved and archived.',
  });
  pushAudit({ action: 'Archived', actor: 'Rahul Yadav', projectId: proj.id, targetType: 'Project', targetId: proj.id, timestamp: closedAt });
});

/* ---------------------------------------------------------------------- */
/* 5. budgetAnalysis.json                                                 */
/* ---------------------------------------------------------------------- */
const budgetAnalysis = projects.map((proj) => {
  const originalBudget = proj.budget;
  const approvedBudget = chance(0.3) ? Math.round(originalBudget * flt(1.0, 1.03, 3) / 500) * 500 : originalBudget;
  const savingsPct = proj.budgetVariance > 0 ? +((proj.budgetVariance / approvedBudget) * 100).toFixed(2) : 0;
  const overrunAmount = proj.budgetVariance < 0 ? Math.abs(proj.budgetVariance) : 0;
  const overrunPct = overrunAmount ? +((overrunAmount / approvedBudget) * 100).toFixed(2) : 0;
  return {
    id: randomUUID(),
    projectId: proj.id,
    projectCode: proj.storeCode,
    originalBudget,
    approvedBudget,
    actualCost: proj.actualCost,
    budgetSaved: proj.budgetSaved,
    budgetOverrun: overrunAmount,
    savingsPct,
    variancePct: proj.budgetVariancePct,
    budgetUtilizationPct: +((proj.actualCost / approvedBudget) * 100).toFixed(2),
  };
});

/* ---------------------------------------------------------------------- */
/* 6. delayAnalysis.json                                                  */
/* ---------------------------------------------------------------------- */
const delayAnalysis = projects.map((proj) => {
  const onSchedule = proj.delayDays <= 0;
  const primaryReason = onSchedule ? 'None — Ahead of Schedule' : pick(DELAY_REASONS);
  const contributingFactors = onSchedule ? [] : pickN(DELAY_REASONS.filter((r) => r !== primaryReason), int(0, 2));
  return {
    id: randomUUID(),
    projectId: proj.id,
    projectCode: proj.storeCode,
    plannedDays: proj.plannedDuration,
    actualDays: proj.actualDuration,
    delayDays: proj.delayDays,
    primaryReason,
    contributingFactors,
    mitigation: onSchedule
      ? 'No corrective action required — execution tracked to the baseline schedule throughout.'
      : `Recovery plan executed with ${pick(['weekend shifts', 'an additional vendor crew', 'expedited material freight', 'a revised critical-path schedule'])} to contain further slippage.`,
  };
});

/* ---------------------------------------------------------------------- */
/* 7. lessonsLearned.json                                                 */
/* ---------------------------------------------------------------------- */
const lessonsLearned = [];
projects.forEach((proj) => {
  const categories = pickN(Object.keys(LESSON_TEMPLATES), int(2, 3));
  categories.forEach((category) => {
    const tpl = pick(LESSON_TEMPLATES[category]);
    lessonsLearned.push({
      id: randomUUID(),
      projectId: proj.id,
      projectCode: proj.storeCode,
      category,
      issue: tpl.issue,
      rootCause: tpl.rootCause,
      resolution: tpl.resolution,
      recommendation: tpl.recommendation,
      priority: pick(PRIORITIES),
    });
  });
});

/* ---------------------------------------------------------------------- */
/* 8. analytics.json (per-project rollup — computed, not independently random) */
/* ---------------------------------------------------------------------- */
const analytics = projects.map((proj) => {
  const projVendors = vendorPerformance.filter((v) => v.projectId === proj.id);
  const avgVendorRating = +(projVendors.reduce((s, v) => s + v.overallRating, 0) / projVendors.length).toFixed(1);
  const docModuleRecord = closureRecords.find((r) => r.projectId === proj.id && r.moduleKey === 'document_archive' && r.status === 'Approved');
  const archivedDocuments = docModuleRecord ? int(60, 180) : 0;
  const financial = closureRecords.find((r) => r.projectId === proj.id && r.moduleKey === 'financial_closure' && r.status === 'Approved');
  const pendingPayments = financial ? (chance(0.85) ? 0 : int(5000, 45000)) : 0;

  const budgetScore = Math.max(0, Math.round(100 - Math.abs(proj.budgetVariancePct)));
  const timelineScore = Math.max(0, Math.round(100 - Math.abs(proj.delayDays) * 2));
  const vendorScore = Math.round((avgVendorRating / 5) * 100);
  const executionScore = 100;
  const qualityScore = int(88, 99);
  const complianceScore = int(90, 100);
  const overallScoreCheck = Math.round((budgetScore + timelineScore + vendorScore + executionScore + qualityScore + complianceScore) / 6);

  const projectRating = proj.overallScore >= 90 ? 'Excellent' : proj.overallScore >= 75 ? 'Good' : proj.overallScore >= 60 ? 'Average' : 'Poor';

  return {
    id: randomUUID(),
    projectId: proj.id,
    projectCode: proj.storeCode,
    totalBudget: proj.budget,
    actualCost: proj.actualCost,
    budgetSaved: proj.budgetSaved,
    budgetOverrun: proj.budgetVariance < 0 ? Math.abs(proj.budgetVariance) : 0,
    totalVendors: projVendors.length,
    averageVendorRating: avgVendorRating,
    pendingPayments,
    archivedDocuments,
    completionPct: 100,
    executionScore,
    budgetScore,
    timelineScore,
    vendorScore,
    qualityScore,
    complianceScore,
    overallScore: proj.overallScore,
    overallScoreComputedCheck: overallScoreCheck,
    projectRating,
  };
});

/* ---------------------------------------------------------------------- */
/* 9. reports.json                                                        */
/* ---------------------------------------------------------------------- */
const reports = [];
projects.forEach((proj) => {
  REPORT_TYPES.forEach((reportType) => {
    const generatedAt = daysAgo(int(1, 20));
    const slug = reportType.toLowerCase().replace(/\s+/g, '-');
    reports.push({
      id: randomUUID(),
      projectId: proj.id,
      projectCode: proj.storeCode,
      reportType,
      formats: ['PDF', 'Excel', 'Print'],
      generatedAt: iso(generatedAt),
      generatedBy: pick(['Rahul Yadav', 'Priya Menon', 'Arjun Nair', proj.projectManager]),
      fileSizeKB: int(240, 3100),
      url: `/storage/reports/${proj.storeCode}/${slug}.pdf`,
    });
  });
});

/* ---------------------------------------------------------------------- */
/* 10. dashboardSummary.json (single aggregate object, computed)          */
/* ---------------------------------------------------------------------- */
const thisMonthClosed = projects.filter((p) => p.completionDate.slice(0, 7) === '2026-07').length;
const avg = (arr) => +(arr.reduce((s, n) => s + n, 0) / arr.length).toFixed(1);

const best = [...projects].sort((a, b) => b.overallScore - a.overallScore)[0];
const highestSaved = [...projects].sort((a, b) => b.budgetSaved - a.budgetSaved)[0];
const lowestDelay = [...projects].sort((a, b) => a.delayDays - b.delayDays)[0];
const fastest = [...projects].sort((a, b) => a.actualDuration - b.actualDuration)[0];

const dashboardSummary = {
  id: randomUUID(),
  generatedAt: iso(TODAY),
  totalProjectsClosed: projects.length,
  projectsClosedThisMonth: thisMonthClosed,
  averageClosureDurationDays: avg(projects.map((p) => p.actualDuration)),
  averageBudgetSaved: Math.round(avg(projects.map((p) => p.budgetSaved))),
  averageVendorRating: avg(vendorPerformance.map((v) => v.overallRating)),
  averageOverallScore: avg(projects.map((p) => p.overallScore)),
  bestPerformingProject: { projectId: best.id, projectCode: best.storeCode, projectName: best.projectName, overallScore: best.overallScore },
  highestBudgetSaved: { projectId: highestSaved.id, projectCode: highestSaved.storeCode, projectName: highestSaved.projectName, budgetSaved: highestSaved.budgetSaved },
  lowestDelay: { projectId: lowestDelay.id, projectCode: lowestDelay.storeCode, projectName: lowestDelay.projectName, delayDays: lowestDelay.delayDays },
  fastestExecution: { projectId: fastest.id, projectCode: fastest.storeCode, projectName: fastest.projectName, actualDuration: fastest.actualDuration },
};

/* ---------------------------------------------------------------------- */
/* Write everything out                                                   */
/* ---------------------------------------------------------------------- */
const files = {
  'projects.json': projects,
  'closureModules.json': closureModules,
  'closureRecords.json': closureRecords,
  'vendorPerformance.json': vendorPerformance,
  'budgetAnalysis.json': budgetAnalysis,
  'delayAnalysis.json': delayAnalysis,
  'lessonsLearned.json': lessonsLearned,
  'timeline.json': timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
  'analytics.json': analytics,
  'auditLogs.json': auditLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
  'attachments.json': attachments,
  'reports.json': reports,
  'dashboardSummary.json': dashboardSummary,
};

for (const [name, data] of Object.entries(files)) {
  writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2));
}

console.log(`Written to ${OUT_DIR}:`);
for (const [name, data] of Object.entries(files)) {
  console.log(`  ${name.padEnd(24)} ${Array.isArray(data) ? `${data.length} records` : '1 object'}`);
}
