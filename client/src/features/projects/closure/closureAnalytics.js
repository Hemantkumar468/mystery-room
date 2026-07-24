/**
 * Every figure the Project Closure Command Center (Phase 10) shows, derived in
 * one place from the same real data the rest of the app already stores:
 *
 *   • `project.stages[]`     — the 10-phase timeline, plan vs. actual dates.
 *   • `project.budget`       — the plan of record set at project creation.
 *   • p10 `Record`s          — the eight closure modules' submitted figures.
 *   • p1/p4/p9 `Record`s     — property, manager and go-live facts.
 *   • every project `Task`   — department performance, delays, open issues.
 *   • `Activity`             — the audit trail.
 *
 * Nothing here invents a number. A metric with no underlying submission
 * returns `null`, and every consumer renders `null` as "—" rather than a zero
 * that would read as a real measurement. That's the whole contract of this
 * file: no dummy data, ever.
 */
import {
  TASK_WORK_DONE_STATUSES, isReworkStatus, isTaskDelayed, deptMeta,
} from '../../../lib/ui.js';

/* ─────────────────────────── small shared helpers ─────────────────────────── */

export const clampPct = (n) => Math.max(0, Math.min(100, n));

/** Mean of the values that actually exist; null when none do. */
export const meanOf = (values) => {
  const nums = values.filter((v) => v != null && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
};

/** Numeric read of a stored form value — null (not 0) when it was never filled in. */
export const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBetween = (from, to) => {
  if (!from || !to) return null;
  return Math.round((new Date(to) - new Date(from)) / DAY_MS);
};

/** 0–100 score → the four-tier vocabulary every closure surface shares. */
export const scoreTone = (score) => (
  score == null ? '#6B7280'
    : score >= 90 ? '#059669'
      : score >= 75 ? '#2563EB'
        : score >= 60 ? '#D97706' : '#DC2626'
);

export const scoreLabel = (score) => (
  score == null ? '—'
    : score >= 90 ? 'Excellent'
      : score >= 75 ? 'Good'
        : score >= 60 ? 'Average' : 'Needs Improvement'
);

/** A–D performance grade for the vendor / department scorecards. */
export const gradeOf = (score) => (
  score == null ? '—'
    : score >= 90 ? 'A+'
      : score >= 80 ? 'A'
        : score >= 70 ? 'B'
          : score >= 60 ? 'C' : 'D'
);

/* ───────────────────────────── record selectors ───────────────────────────── */

/** Every p10 record filed against this property, newest first. */
export const closureRecordsOf = (records, propertyId) => (records || [])
  .filter((r) => String(r.parentRecordId) === String(propertyId))
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

/** Approved records of one module, oldest first (submission order). */
export const approvedOf = (records, moduleKey) => (records || [])
  .filter((r) => r.assessmentType === moduleKey && r.status === 'approved')
  .sort((a, b) => new Date(a.approvedAt || a.createdAt) - new Date(b.approvedAt || b.createdAt));

/** The single most recently approved record of one module (or null). */
export const latestApprovedOf = (records, moduleKey) => approvedOf(records, moduleKey).at(-1) || null;

/**
 * One module's own display status. Mirrors the four-word vocabulary every
 * module-based workspace page in this app uses, so a closure module reads the
 * same as a Store Launch or Store Readiness one.
 */
export function moduleStatusKey(records, moduleKey) {
  const own = (records || []).filter((r) => r.assessmentType === moduleKey);
  if (own.some((r) => r.status === 'approved')) return 'approved';
  if (!own.length) return 'pending';
  const latest = [...own].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (latest.status === 'rejected') return 'rejected';
  return 'in_progress';
}

export const MODULE_STATUS_META = {
  pending: { label: 'Pending', color: '#6B7280', soft: '#F3F4F6' },
  in_progress: { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' },
  approved: { label: 'Completed', color: '#059669', soft: '#DCFCE7' },
  rejected: { label: 'Rejected', color: '#DC2626', soft: '#FEE2E2' },
};

/**
 * A module's boolean-checklist completion (0–100) across its latest approved
 * record — null when that module's schema has no checklist at all.
 */
export function checklistPct(type, records) {
  if (!type) return null;
  const boolFields = (type.masterDataSchema || []).filter((f) => f.type === 'boolean');
  if (!boolFields.length) return null;
  const record = latestApprovedOf(records, type.key);
  const done = record ? boolFields.filter((f) => record.values?.[f.key] === true).length : 0;
  return (done / boolFields.length) * 100;
}

/* ──────────────────────────────── budget ──────────────────────────────────── */

/**
 * Budget closure figures. `planned` prefers the Budget Analysis submission
 * (the closed-out plan of record) and falls back to the project's own budget
 * envelope set at creation — both are real stored values, never a guess.
 */
export function buildBudget(records, project) {
  const rec = latestApprovedOf(records, 'budget_analysis');
  const planned = num(rec?.values?.planned_budget) ?? num(project?.budget?.planned) ?? null;
  const actual = num(rec?.values?.actual_cost) ?? num(project?.budget?.actual) ?? null;

  const variance = planned != null && actual != null ? planned - actual : null;
  const variancePct = variance != null && planned ? (variance / planned) * 100 : null;
  const utilizationPct = planned && actual != null ? (actual / planned) * 100 : null;
  const overrun = variance != null ? Math.max(0, -variance) : null;
  const savings = variance != null ? Math.max(0, variance) : null;

  // 100 at plan, degrading with the size of the miss in either direction.
  const score = variancePct != null ? clampPct(100 - Math.abs(variancePct)) : null;

  return {
    record: rec,
    planned,
    actual,
    variance,
    variancePct,
    utilizationPct,
    overrun,
    savings,
    score,
    notes: rec?.values?.variance_notes || '',
  };
}

/* ──────────────────────────────── schedule ────────────────────────────────── */

/**
 * Schedule closure figures. Planned/actual duration come from the Delay
 * Analysis submission where one exists; otherwise they're measured off the
 * project's own plan dates and the phase timeline, both of which are real.
 */
export function buildSchedule(records, project, phases) {
  const rec = latestApprovedOf(records, 'delay_analysis');

  const plannedFromProject = daysBetween(project?.plannedStartDate, project?.targetEndDate);
  const lastCompletedAt = phases
    .map((p) => p.completedAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0];
  const actualFromProject = daysBetween(
    project?.actualStartDate || project?.plannedStartDate,
    project?.actualEndDate || project?.archivedAt || lastCompletedAt,
  );

  const planned = num(rec?.values?.planned_duration_days) ?? plannedFromProject;
  const actual = num(rec?.values?.actual_duration_days) ?? actualFromProject;
  const delayDays = planned != null && actual != null ? actual - planned : null;
  // >100% means finished ahead of plan; the KPI card caps its ring at 100.
  const efficiencyPct = planned && actual ? (planned / actual) * 100 : null;
  const score = delayDays != null ? clampPct(100 - Math.abs(delayDays) * 2) : null;

  return {
    record: rec,
    planned,
    actual,
    delayDays,
    efficiencyPct,
    score,
    reason: rec?.values?.delay_reason || '',
    rootCause: rec?.values?.root_cause_category || '',
    recovery: rec?.values?.recovery_actions || '',
  };
}

/**
 * The 10-phase timeline. Duration is the real elapsed time between a phase's
 * `startedAt` and `completedAt`; slippage compares that to its planned window.
 * A phase never started reports nulls rather than zeros.
 */
export function buildPhases(project) {
  return [...(project?.stages || [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => {
      const plannedDays = daysBetween(s.plannedStart, s.plannedEnd);
      const actualDays = daysBetween(s.startedAt, s.completedAt);
      return {
        key: s.key,
        index: i + 1,
        name: s.name,
        status: s.status,
        color: s.color,
        ownerDepartment: s.ownerDepartment,
        plannedStart: s.plannedStart,
        plannedEnd: s.plannedEnd,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        completedBy: s.completedBy,
        plannedDays,
        actualDays,
        slippageDays: plannedDays != null && actualDays != null ? actualDays - plannedDays : null,
        onTime: plannedDays != null && actualDays != null ? actualDays <= plannedDays : null,
      };
    });
}

/* ──────────────────────────────── vendors ─────────────────────────────────── */

/**
 * One row per approved Vendor Performance submission. Every column is a
 * captured figure; `overall` is the weighted blend of the three scores that
 * were actually filled in (rating, quality, SLA) — never padded with defaults.
 */
export function buildVendors(records) {
  return approvedOf(records, 'vendor_performance').map((r) => {
    const v = r.values || {};
    const rating = num(v.rating);
    const quality = num(v.quality_score);
    const sla = num(v.sla_compliance);
    const assigned = num(v.assigned_tasks);
    const completed = num(v.completed_tasks);
    const delayed = num(v.delayed_tasks);
    const cost = num(v.total_cost);

    const overall = meanOf([
      rating != null ? clampPct((rating / 5) * 100) : null,
      quality != null ? clampPct(quality) : null,
      sla != null ? clampPct(sla) : null,
    ]);

    return {
      id: r._id,
      record: r,
      name: v.vendor_name || r.title || 'Unnamed vendor',
      category: v.vendor_category || '—',
      assigned,
      completed,
      delayed,
      quality,
      sla,
      rating,
      cost,
      onTimeDelivery: v.on_time_delivery || '—',
      paymentStatus: v.payment_status || '—',
      completionPct: assigned ? clampPct((completed / assigned) * 100) : null,
      overall,
      grade: gradeOf(overall),
    };
  });
}

/* ─────────────────────────── department performance ───────────────────────── */

/**
 * A scorecard per department that actually owns work on this project, built
 * entirely from that department's Tasks:
 *
 *   completion  — approved / total.
 *   delay       — tasks that missed their planned end date.
 *   quality     — share of tasks that cleared approval without rework.
 *   productivity— share of tasks whose own work is finished (either approval
 *                 tier or approved), i.e. throughput independent of sign-off.
 *   overall     — the mean of those four.
 *
 * Departments with no tasks are omitted rather than shown as an empty 0% card.
 */
export function buildDepartments(tasks) {
  const keys = [...new Set((tasks || []).map((t) => t.department).filter(Boolean))];
  return keys
    .map((key) => {
      const own = tasks.filter((t) => t.department === key);
      const total = own.length;
      const completed = own.filter((t) => t.status === 'approved').length;
      const delayed = own.filter((t) => isTaskDelayed(t)).length;
      const reworked = own.filter((t) => isReworkStatus(t.status)).length;
      const blocked = own.filter((t) => t.status === 'blocked').length;
      const workDone = own.filter((t) => TASK_WORK_DONE_STATUSES.includes(t.status)).length;

      const completionPct = total ? (completed / total) * 100 : null;
      const delayPct = total ? (delayed / total) * 100 : null;
      const qualityPct = total ? ((total - reworked) / total) * 100 : null;
      const productivityPct = total ? (workDone / total) * 100 : null;
      const overall = meanOf([
        completionPct,
        delayPct != null ? 100 - delayPct : null,
        qualityPct,
        productivityPct,
      ]);

      return {
        key,
        ...deptMeta(key),
        total,
        completed,
        delayed,
        reworked,
        blocked,
        completionPct,
        delayPct,
        qualityPct,
        productivityPct,
        overall,
        grade: gradeOf(overall),
      };
    })
    .sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
}

/** Per-department delay rollup for the Timeline Analysis tab. */
export function buildDepartmentDelays(tasks) {
  return buildDepartments(tasks)
    .filter((d) => d.delayed > 0)
    .map((d) => ({ key: d.key, label: d.label, color: d.color, delayed: d.delayed, total: d.total, delayPct: d.delayPct }))
    .sort((a, b) => b.delayed - a.delayed);
}

/* ──────────────────────── lessons, documents, sign-offs ───────────────────── */

export const LESSON_CATEGORIES = [
  { key: 'Success', color: '#059669' },
  { key: 'Failure', color: '#DC2626' },
  { key: 'Risk', color: '#D97706' },
  { key: 'Recommendation', color: '#2563EB' },
  { key: 'Future Improvement', color: '#7C3AED' },
  { key: 'Best Practice', color: '#0D9488' },
];

/** Approved Lessons Learned submissions, bucketed by their captured category. */
export function buildLessons(records) {
  const rows = approvedOf(records, 'lessons_learned').map((r) => ({
    id: r._id,
    record: r,
    category: r.values?.lesson_category || 'Recommendation',
    title: r.values?.lesson_title || r.title || 'Untitled learning',
    learnings: r.values?.key_learnings || '',
    challenges: r.values?.challenges || '',
    recommendations: r.values?.recommendations || '',
    impactArea: r.values?.impact_area || '',
    meetingNotes: r.values?.meeting_notes || '',
    attachments: r.attachments || [],
    capturedBy: r.submittedBy?.name || r.createdBy?.name || '—',
    capturedAt: r.approvedAt || r.createdAt,
  }));
  const byCategory = LESSON_CATEGORIES.map((c) => ({
    ...c,
    items: rows.filter((l) => l.category === c.key),
  }));
  return { rows, byCategory };
}

/**
 * Every file attached to any closure submission, tagged with the module and
 * (for Document Archive) the captured document category. The Documents tab
 * groups on `category`, so a Vendor Performance invoice files itself.
 */
export function buildDocuments(records, assessmentTypes) {
  const typeName = (key) => assessmentTypes.find((t) => t.key === key)?.name || key;
  return (records || []).flatMap((r) => (r.attachments || []).map((a) => ({
    id: a._id || `${r._id}-${a.name}`,
    name: a.name || 'Attachment',
    url: a.url,
    kind: a.kind,
    module: typeName(r.assessmentType),
    moduleKey: r.assessmentType,
    category: r.assessmentType === 'document_archive'
      ? (r.values?.document_category || 'Other')
      : typeName(r.assessmentType),
    uploadedBy: r.submittedBy?.name || r.createdBy?.name || '—',
    uploadedAt: a.createdAt || r.createdAt,
    status: r.status,
  })));
}

/** Fixed order the Final Approvals panel reads in — lowest authority first. */
export const SIGN_OFF_ROLES = [
  'Department Head', 'Finance', 'Operations', 'Regional Manager', 'Management', 'CEO',
];

/**
 * One row per sign-off authority. `record` is that authority's own approved
 * Project Sign-Off submission where it exists — authorities nobody has signed
 * for yet stay in the list as Pending rather than being hidden, because a
 * missing signature is exactly what a closure reviewer needs to see.
 */
export function buildSignOffs(records) {
  const filed = approvedOf(records, 'project_sign_off');
  const rows = SIGN_OFF_ROLES.map((role) => {
    const rec = filed.filter((r) => r.values?.sign_off_role === role).at(-1) || null;
    return {
      role,
      record: rec,
      signedBy: rec?.values?.signed_off_by || null,
      signedAt: rec?.values?.sign_off_date || rec?.approvedAt || null,
      signature: rec?.values?.digital_signature || null,
      remarks: rec?.values?.remarks || '',
      approvedBy: rec?.approvedBy?.name || rec?.decidedBy?.name || null,
      status: rec ? 'approved' : 'pending',
    };
  });
  // Submissions that predate the sign_off_role field (or use a custom value)
  // still count as real sign-offs — surface them rather than dropping them.
  const unroled = filed.filter((r) => !SIGN_OFF_ROLES.includes(r.values?.sign_off_role));
  const extras = unroled.map((rec) => ({
    role: rec.values?.sign_off_role || 'Project Sign-Off',
    record: rec,
    signedBy: rec.values?.signed_off_by || null,
    signedAt: rec.values?.sign_off_date || rec.approvedAt || null,
    signature: rec.values?.digital_signature || null,
    remarks: rec.values?.remarks || '',
    approvedBy: rec.approvedBy?.name || rec.decidedBy?.name || null,
    status: 'approved',
  }));
  return [...rows, ...extras];
}

/* ───────────────────────────── financial closure ──────────────────────────── */

export function buildFinancials(records) {
  const rec = latestApprovedOf(records, 'financial_closure');
  const invoiced = num(rec?.values?.total_invoiced);
  const paid = num(rec?.values?.total_paid);
  const pending = num(rec?.values?.pending_payment);
  return {
    record: rec,
    invoiced,
    paid,
    pending,
    certificateNo: rec?.values?.closure_certificate_no || null,
    settledPct: invoiced && paid != null ? clampPct((paid / invoiced) * 100) : null,
  };
}

/* ────────────────────────────── health & scores ───────────────────────────── */

/**
 * The eight-axis Project Health Report. Each axis is null unless its own
 * underlying data exists, and the overall score is the mean of the axes that
 * do — so a half-closed project reports an honest partial score instead of
 * being dragged toward zero by axes nobody has filled in yet.
 */
export function buildHealth({
  budget, schedule, vendors, departments, modulesPct, quality, compliance, customerReadiness,
}) {
  const vendorScore = meanOf(vendors.map((v) => v.overall));
  const departmentScore = meanOf(departments.map((d) => d.overall));

  const axes = [
    { key: 'financial', label: 'Financial', value: budget.score },
    { key: 'timeline', label: 'Timeline', value: schedule.score },
    { key: 'vendor', label: 'Vendor', value: vendorScore },
    { key: 'department', label: 'Department', value: departmentScore },
    { key: 'quality', label: 'Quality', value: quality },
    { key: 'compliance', label: 'Compliance', value: compliance },
    { key: 'execution', label: 'Execution', value: modulesPct },
    { key: 'readiness', label: 'Customer Readiness', value: customerReadiness },
  ];

  const overall = meanOf(axes.map((a) => a.value));
  // Risk is the inverse of health — how far the project sits from a clean close.
  const riskIndex = overall != null ? clampPct(100 - overall) : null;

  return { axes, vendorScore, departmentScore, overall, riskIndex };
}

/* ───────────────────────────────── activity ───────────────────────────────── */

/**
 * The closure audit trail: every activity entry that touches Phase 10 — its
 * stage events, its records, and the archive/export events the Command Center
 * itself raises.
 */
export function buildAuditTrail(activities, closureRecordIds, propertyId) {
  const ids = new Set([
    ...(closureRecordIds || []).map(String),
    ...(propertyId ? [String(propertyId)] : []),
  ]);
  return (activities || [])
    .filter((a) => a.meta?.stageKey === 'p10'
      || ids.has(String(a.meta?.recordId))
      || ids.has(String(a.entityId)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Broad category for an audit row, read off the activity's own action/message. */
export function auditCategory(activity) {
  const action = activity.action;
  const msg = (activity.message || '').toLowerCase();
  if (action === 'archived') return 'Archive';
  if (action === 'exported') return 'Export';
  if (action === 'approved' || msg.includes('approved')) return 'Approval';
  if (action === 'rejected' || msg.includes('rejected')) return 'Approval';
  if (activity.entityType === 'stage') return 'Phase';
  if (msg.includes('attachment') || msg.includes('upload')) return 'Document';
  if (msg.includes('budget')) return 'Budget';
  return 'Record';
}
