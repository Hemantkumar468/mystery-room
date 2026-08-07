/**
 * Site Evaluation scoring engine — the single source of truth for turning
 * raw Feasibility/Financial/Technical/Operational assessment values into the
 * weighted scorecard both the Shortlisted Properties table's Recommendation
 * Score column and the Property Comparison page rank properties by. Pure,
 * dependency-free functions only, so they're trivially unit-testable and
 * reusable anywhere a property's score is needed without recomputing or
 * duplicating the model in more than one place.
 *
 * Everything here is a *derived* calculation over data the backend already
 * returns (Record.values from p2's four assessmentTypes) — no new API, no
 * new persisted field. Only an Approved record counts, matching the
 * established "progress counts only Approved assessments" rule used
 * everywhere else in Site Evaluation.
 */

/** Section weights out of a 100-point Overall Score. Must sum to 100. */
export const SECTION_WEIGHTS = {
  feasibility: 25,
  financial: 35,
  technical: 20,
  operational: 20,
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const avg = (nums) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null);

/** Map a categorical field value to a normalized 0–1 quality score. Unknown/missing → null (excluded from the average, not treated as 0). */
const scale = (map) => (value) => (value in map ? map[value] : null);

const FEASIBILITY_SCALES = {
  market_potential: scale({ Low: 0.2, Medium: 0.6, High: 1 }),
  accessibility: scale({ Poor: 0.1, Average: 0.45, Good: 0.75, Excellent: 1 }),
  expansion_potential: scale({ Low: 0.2, Medium: 0.6, High: 1 }),
};
const TECHNICAL_SCALES = {
  building_condition: scale({ Poor: 0.1, Average: 0.45, Good: 0.75, Excellent: 1 }),
  water_supply: scale({ 'Not Available': 0, Available: 0.6, Abundant: 1 }),
  internet_availability: scale({ 'Not Available': 0, Available: 1 }),
  fire_safety: scale({ 'Not Compliant': 0, Compliant: 1 }),
  parking: scale({ 'Not Available': 0, Limited: 0.4, Adequate: 0.7, Ample: 1 }),
};
const OPERATIONAL_SCALES = {
  utility_availability: scale({ Poor: 0.2, Adequate: 0.6, Good: 1 }),
  vendor_availability: scale({ Poor: 0.2, Adequate: 0.6, Good: 1 }),
};

/** 0–100 quality score for a section's approved values, or null if nothing scorable was submitted. */
function sectionPercent(values, scales) {
  if (!values) return null;
  const parts = Object.entries(scales)
    .map(([key, fn]) => fn(values[key]))
    .filter((v) => v != null);
  const a = avg(parts);
  return a == null ? null : Math.round(a * 100);
}

/** Feasibility's footfall_assessment is a direct /10 rating, not a category — folded in alongside the categorical fields. */
export function feasibilityPercent(values) {
  if (!values) return null;
  const parts = Object.entries(FEASIBILITY_SCALES)
    .map(([key, fn]) => fn(values[key]))
    .filter((v) => v != null);
  if (typeof values.footfall_assessment === 'number') {
    parts.push(clamp01(values.footfall_assessment / 10));
  }
  const a = avg(parts);
  return a == null ? null : Math.round(a * 100);
}

/**
 * Financial scores off the two fields that most directly signal viability —
 * ROI and payback period — both already captured verbatim on the form, so
 * this reuses submitted data rather than inventing a new formula input.
 * ROI: 0% → 0, 30%+ → 100 (linear). Payback: ≤12mo → 100, ≥48mo → 0 (linear).
 */
export function financialPercent(values) {
  if (!values) return null;
  const parts = [];
  if (typeof values.roi === 'number') parts.push(clamp01(values.roi / 30));
  if (typeof values.payback_period === 'number') parts.push(clamp01(1 - (values.payback_period - 12) / 36));
  const a = avg(parts);
  return a == null ? null : Math.round(a * 100);
}

export function technicalPercent(values) {
  return sectionPercent(values, TECHNICAL_SCALES);
}

/** Operational's schema has few gradable (vs. free-text) fields — utility/vendor availability are the only two reliable quality signals it currently captures. */
export function operationalPercent(values) {
  return sectionPercent(values, OPERATIONAL_SCALES);
}

const SECTION_SCORERS = {
  feasibility: feasibilityPercent,
  financial: financialPercent,
  technical: technicalPercent,
  operational: operationalPercent,
};

/** The latest record of `assessmentType` for this property, if any. */
function latestOf(records, propertyId, assessmentType) {
  const matches = records.filter(
    (r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === assessmentType,
  );
  if (!matches.length) return null;
  return [...matches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

/** The latest *Approved* record of `assessmentType` for this property, if any — only Approved values ever contribute to a score. */
function latestApprovedOf(records, propertyId, assessmentType) {
  const approved = records.filter(
    (r) => String(r.parentRecordId) === String(propertyId) && r.assessmentType === assessmentType && r.status === 'approved',
  );
  if (!approved.length) return null;
  return [...approved].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

/**
 * Recommendation label for an Overall Score (0–100 scale, only meaningful
 * once every section is Approved — see isFullyApproved on the scorecard).
 */
export function recommendationFor(overallScore) {
  if (overallScore == null) return 'Evaluation Incomplete';
  if (overallScore >= 85) return 'Highly Recommended';
  if (overallScore >= 70) return 'Recommended';
  if (overallScore >= 50) return 'Consider';
  return 'Low Priority';
}

/**
 * Risk Level is deliberately tied to the same Overall Score rather than a
 * separate, harder-to-defend model built off free-text fields (risk_factors/
 * operational_risks aren't gradable) — a low score already means weak
 * fundamentals across the four sections, which *is* the risk. Bands mirror
 * trafficForPercent so Risk and the traffic-light read consistently for the
 * same score.
 */
export function riskLevelFor(overallScore) {
  if (overallScore == null) return 'Unknown';
  if (overallScore >= 85) return 'Low';
  if (overallScore >= 60) return 'Medium';
  return 'High';
}

/** Generic three-tier traffic light for any 0–100 percentage score. */
export function trafficForPercent(pct) {
  if (pct == null) return 'unknown';
  if (pct >= 85) return 'green';
  if (pct >= 60) return 'yellow';
  return 'red';
}

/** ROI has its own real-world thresholds (a %, not a normalized score). */
export function trafficForRoi(roi) {
  if (roi == null) return 'unknown';
  if (roi >= 20) return 'green';
  if (roi >= 10) return 'yellow';
  return 'red';
}

export const TRAFFIC_META = {
  green: { label: 'Excellent', color: 'var(--success)', emoji: '🟢' },
  yellow: { label: 'Average', color: 'var(--gold-500)', emoji: '🟡' },
  red: { label: 'Poor', color: 'var(--danger)', emoji: '🔴' },
  unknown: { label: '—', color: 'var(--text-subtle)', emoji: '⚪' },
};

/**
 * Four-tier Score Grade for the KPI management pages (Excellent 90+ / Good
 * 75-89 / Average 60-74 / Poor <60) — a different band than the 3-tier
 * TRAFFIC_META (85/60 cutoffs) used elsewhere, so it's a separate function
 * rather than a change to trafficForPercent's existing callers.
 */
export function scoreGradeFor(score) {
  if (score == null) return { label: '—', color: 'var(--text-subtle)' };
  if (score >= 90) return { label: 'Excellent', color: 'var(--success)' };
  if (score >= 75) return { label: 'Good', color: 'var(--info)' };
  if (score >= 60) return { label: 'Average', color: 'var(--warning)' };
  return { label: 'Poor', color: 'var(--danger)' };
}

/** Color per recommendationFor()'s four labels, for a consistent Recommendation badge across every KPI page. */
export const RECOMMENDATION_META = {
  'Highly Recommended': { color: 'var(--success)' },
  Recommended: { color: 'var(--info)' },
  Consider: { color: 'var(--warning)' },
  'Low Priority': { color: 'var(--danger)' },
  'Evaluation Incomplete': { color: 'var(--text-subtle)' },
};

/** A section's percent (0–100) converted to weighted points out of its own weight, e.g. 96% of Feasibility's 25 → 24 — the "24/25" the Property Analysis table displays per section. */
export function weightedPoints(percent, sectionKey) {
  if (percent == null) return null;
  return Math.round((percent / 100) * (SECTION_WEIGHTS[sectionKey] || 0));
}

export const RISK_META = {
  Low: { label: 'Low', color: 'var(--success)' },
  Medium: { label: 'Medium', color: 'var(--gold-500)' },
  High: { label: 'High', color: 'var(--danger)' },
  Unknown: { label: '—', color: 'var(--text-subtle)' },
};

/** Presentation map for a property's aggregate evaluation status (see assessmentStatusOf). */
export const PROPERTY_STATUS_META = {
  pending: { label: 'Pending', color: '#7c7784' },
  in_progress: { label: 'In Progress', color: '#38bdf8' },
  approved: { label: 'Completed', color: 'var(--success)' },
  rejected: { label: 'Rejected', color: 'var(--danger)' },
};

/**
 * A property's single aggregate Assessment Status across its four sections
 * — used for the comparison dashboard's status filter and Status column.
 * Rejected takes priority (something needs attention even if other
 * sections are further along); otherwise it's Approved/Completed only once
 * every section has an Approved record; Pending only if nothing has been
 * filed at all; everything else in between reads as In Progress.
 */
export function assessmentStatusOf(scorecard) {
  const latestStatuses = Object.values(scorecard.sections).map((s) => s.status);
  if (latestStatuses.some((s) => s === 'rejected')) return 'rejected';
  if (scorecard.isFullyApproved) return 'approved';
  if (latestStatuses.every((s) => s == null)) return 'pending';
  return 'in_progress';
}

/**
 * Build one property's full scorecard: per-section percentages (each 0–100,
 * from that section's latest Approved record only), the weighted Overall
 * Score, financial facts read straight off the approved Financial record,
 * and the recommendation/risk/traffic-light labels derived from those
 * numbers.
 *
 * `assessmentRecords` is every p2 record for the whole project (already
 * fetched once by the page) — filtered down to this property's here, so the
 * expensive per-property work stays O(records for this property) even
 * though the caller passes the full project-wide list in.
 */
export function computeScorecard(property, assessmentRecords, assessmentTypeKeys = ['feasibility', 'financial', 'technical', 'operational']) {
  const sections = {};
  let weightedSum = 0;
  let approvedCount = 0;

  for (const key of assessmentTypeKeys) {
    const approved = latestApprovedOf(assessmentRecords, property._id, key);
    const latest = latestOf(assessmentRecords, property._id, key);
    const pct = approved ? SECTION_SCORERS[key]?.(approved.values) : null;
    if (approved) approvedCount += 1;
    if (pct != null) weightedSum += (pct / 100) * (SECTION_WEIGHTS[key] || 0);
    sections[key] = {
      percent: pct,
      approvedRecord: approved,
      latestRecord: latest,
      status: latest ? latest.status : null,
    };
  }

  const isFullyApproved = approvedCount === assessmentTypeKeys.length;
  const overallScore = isFullyApproved ? Math.round(weightedSum) : null;

  const financialValues = sections.financial?.approvedRecord?.values || null;
  const roi = typeof financialValues?.roi === 'number' ? financialValues.roi : null;
  const investment = typeof financialValues?.estimated_investment === 'number' ? financialValues.estimated_investment : null;
  const monthlyRevenue = typeof financialValues?.monthly_revenue === 'number' ? financialValues.monthly_revenue : null;
  const paybackMonths = typeof financialValues?.payback_period === 'number' ? financialValues.payback_period : null;

  return {
    property,
    sections,
    approvedCount,
    totalSections: assessmentTypeKeys.length,
    isFullyApproved,
    overallScore,
    roi,
    investment,
    monthlyRevenue,
    paybackMonths,
    recommendation: recommendationFor(overallScore),
    riskLevel: riskLevelFor(overallScore),
    trafficOverall: trafficForPercent(overallScore),
    trafficRoi: trafficForRoi(roi),
    stageApproved: isPropertyApprovedAtStage(property, sections),
  };
}

/**
 * Whether *this property's own decision* (its p1 record's Approve/Reject —
 * the Site Evaluation dashboard's Decision column) has been made, as
 * distinct from the Phase-1 shortlist decision that got it here in the
 * first place. Both decisions reuse the same `decide('shortlist')` call
 * (see SiteEvaluationPage.jsx), so `shortlistedBy` alone can't tell them
 * apart — it's set by *either* one. What can: chronology. The original
 * Phase-1 shortlist necessarily happened before any of this property's
 * assessments could even be submitted, so a decision timestamp (`decidedAt`,
 * updated by every decide() call regardless of type) at or after every
 * section's most recent *submission* can only be a fresh decision made here,
 * once evaluation was actually complete — matching exactly when the
 * dashboard's Approve/Reject buttons become available (every section has a
 * record). This deliberately does NOT require each section's record to be
 * individually Approved: the manager's Approve click on the property itself
 * is the final decision, not a summary of four separate approvals — that
 * would leave "Approve" silently doing nothing from the user's point of
 * view whenever a section was merely submitted rather than approved.
 */
function isPropertyApprovedAtStage(property, sections) {
  if (!property.decidedAt || property.status !== 'shortlisted') return false;
  const sectionValues = Object.values(sections);
  if (!sectionValues.length || sectionValues.some((s) => !s.latestRecord)) return false;
  const submittedTimestamps = sectionValues.map((s) => new Date(s.latestRecord.createdAt).getTime());
  const evaluationCompletedAt = Math.max(0, ...submittedTimestamps);
  return new Date(property.decidedAt).getTime() >= evaluationCompletedAt;
}

/**
 * Multi-criteria comparator implementing the spec'd recommendation
 * priority: primarily Overall Score (higher first); for an exact tie,
 * Lower Investment → Higher ROI → Lower Payback, in that order. Used both
 * to assign Rank and to order every ranked list on the comparison page, so
 * "who's #1" can never disagree between the recommendation card, the other-
 * properties list and the comparison table — they all sort with this same
 * function.
 */
export function compareScorecards(a, b) {
  const aScore = a.overallScore ?? -Infinity;
  const bScore = b.overallScore ?? -Infinity;
  if (bScore !== aScore) return bScore - aScore;

  const aInv = a.investment ?? Infinity;
  const bInv = b.investment ?? Infinity;
  if (aInv !== bInv) return aInv - bInv;

  const aRoi = a.roi ?? -Infinity;
  const bRoi = b.roi ?? -Infinity;
  if (bRoi !== aRoi) return bRoi - aRoi;

  const aPb = a.paybackMonths ?? Infinity;
  const bPb = b.paybackMonths ?? Infinity;
  return aPb - bPb;
}

/**
 * Assign 1-based Rank by compareScorecards — only fully-approved scorecards
 * are ranked (an incomplete evaluation isn't comparable), so ranks are
 * dense (1, 2, 3, …) among the ranked subset regardless of how many
 * incomplete ones are interleaved in the full list.
 */
export function rankScorecards(scorecards) {
  const ranked = scorecards.filter((s) => s.isFullyApproved).sort(compareScorecards);
  const rankById = new Map(ranked.map((s, i) => [String(s.property._id), i + 1]));
  return scorecards.map((s) => ({ ...s, rank: rankById.get(String(s.property._id)) || null }));
}

/**
 * Dynamic "why this one" reasons for a scorecard, purely by comparing its
 * own derived numbers against the rest of a pool — no hardcoded property
 * names or canned text, so a different top property in a different project
 * gets genuinely different reasons.
 */
export function reasonsFor(top, pool) {
  const scores = pool.map((s) => s.overallScore).filter((v) => v != null);
  const rois = pool.map((s) => s.roi).filter((v) => v != null);
  const investments = pool.map((s) => s.investment).filter((v) => v != null);
  const revenues = pool.map((s) => s.monthlyRevenue).filter((v) => v != null);
  const paybacks = pool.map((s) => s.paybackMonths).filter((v) => v != null);
  const reasons = [];

  if (top.overallScore != null && scores.length && top.overallScore === Math.max(...scores)) reasons.push('Highest Overall Score');
  if (top.roi != null && rois.length && top.roi === Math.max(...rois)) reasons.push('Highest Return on Investment');
  if (top.investment != null && investments.length && top.investment === Math.min(...investments)) reasons.push('Lowest Investment');
  if (top.monthlyRevenue != null && revenues.length && top.monthlyRevenue === Math.max(...revenues)) reasons.push('Highest Revenue');
  if (top.paybackMonths != null && paybacks.length && top.paybackMonths === Math.min(...paybacks)) reasons.push('Fastest Investment Recovery');
  if (top.sections.technical?.status === 'approved') reasons.push('Technical Approved');
  if (top.sections.financial?.status === 'approved') reasons.push('Financial Approved');
  if (top.sections.operational?.status === 'approved') reasons.push('Operational Approved');
  if (top.sections.feasibility?.status === 'approved') reasons.push('Feasibility Approved');
  if (top.riskLevel === 'Low') reasons.push('Lowest Risk');

  return reasons;
}

/**
 * Percentile-relative traffic light for a metric where "good" only makes
 * sense relative to the other properties being compared (Investment and
 * Payback Period: there's no universal "₹2Cr is expensive" line, but the
 * cheapest third of *this* comparison set clearly reads better than the
 * priciest third). `lowerIsBetter` flips which end is green.
 *
 * Split into sortNumeric (once per pool) + toneFromSorted (once per row) —
 * a comparison table calls this once per row per render, and the naive
 * "filter+sort inside the function" version would re-sort the *entire*
 * pool on every single row (O(n² log n) for an n-row table). Callers doing
 * that once per row should use sortNumeric+toneFromSorted directly;
 * relativeTraffic stays as the convenience one-shot wrapper for anywhere
 * that only needs a single lookup.
 */
export function sortNumeric(values) {
  return values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
}

function percentileRank(value, sortedNums) {
  if (value == null || sortedNums.length < 2) return null;
  // Binary search for the first index whose value is >= `value`.
  let lo = 0;
  let hi = sortedNums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedNums[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / (sortedNums.length - 1); // 0 = lowest value in the pool, 1 = highest
}

export function toneFromSorted(value, sortedNums, lowerIsBetter = true) {
  const percentile = percentileRank(value, sortedNums);
  if (percentile == null) return 'unknown';
  const goodness = lowerIsBetter ? 1 - percentile : percentile;
  if (goodness >= 0.66) return 'green';
  if (goodness >= 0.33) return 'yellow';
  return 'red';
}

export function relativeTraffic(value, allValues, lowerIsBetter = true) {
  return toneFromSorted(value, sortNumeric(allValues), lowerIsBetter);
}
