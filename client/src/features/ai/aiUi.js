/**
 * Presentation vocabulary for the AI module.
 *
 * The server owns the *model* — pillar weights, band thresholds, the score
 * itself — and ships it on every report. This file owns only how that model is
 * dressed: which token colours a band wears, which icon rides alongside it,
 * how a decision enum reads in English.
 *
 * Colour is never the sole carrier of meaning here. Every band and impact
 * level pairs its tone with a label and an icon, so the report stays readable
 * in greyscale, under colour-vision deficiency, and in forced-colours mode.
 * Tones resolve to the app's own semantic tokens, so light and dark themes are
 * handled by the existing theme rather than by a second palette.
 */

import { ShieldCheck, ThumbsUp, AlertTriangle, ShieldX, HelpCircle, Minus } from 'lucide-react';

/** Semantic tone → the app's own CSS custom properties. */
export const TONE_COLOR = {
  success: 'var(--success)',
  info: 'var(--info)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--text-subtle)',
};

export const toneColor = (tone) => TONE_COLOR[tone] || TONE_COLOR.muted;

/**
 * Verdict bands. Thresholds live on the server (ai.constants.js) and arrive on
 * the report as `score.band`; this only supplies the icon and tone per key, so
 * the two can never disagree about *where* a boundary sits.
 */
export const BAND_META = {
  strong: { label: 'Strong Fit', tone: 'success', icon: ShieldCheck },
  viable: { label: 'Viable', tone: 'info', icon: ThumbsUp },
  conditional: { label: 'Conditional', tone: 'warning', icon: AlertTriangle },
  weak: { label: 'Not Recommended', tone: 'danger', icon: ShieldX },
  unknown: { label: 'Not Scored', tone: 'muted', icon: HelpCircle },
};

export const bandMeta = (score) => {
  const key = score?.band || 'unknown';
  const meta = BAND_META[key] || BAND_META.unknown;
  // Prefer the server's label — it is the authority if the two ever drift.
  return { ...meta, label: score?.bandLabel || meta.label, color: toneColor(meta.tone) };
};

/** The model's recommended Phase-1 decision. */
export const DECISION_META = {
  shortlist: { label: 'Shortlist', tone: 'success', icon: ThumbsUp },
  shortlist_with_conditions: { label: 'Shortlist with conditions', tone: 'info', icon: AlertTriangle },
  hold: { label: 'Hold', tone: 'warning', icon: Minus },
  reject: { label: 'Reject', tone: 'danger', icon: ShieldX },
};

export const decisionMeta = (decision) => {
  const meta = DECISION_META[decision] || { label: decision || 'No recommendation', tone: 'muted', icon: HelpCircle };
  return { ...meta, color: toneColor(meta.tone) };
};

/** Impact of a strength, concern or risk. */
export const IMPACT_META = {
  critical: { label: 'Critical', tone: 'danger' },
  high: { label: 'High', tone: 'warning' },
  medium: { label: 'Medium', tone: 'info' },
  low: { label: 'Low', tone: 'muted' },
};

export const impactMeta = (impact) => {
  const meta = IMPACT_META[impact] || IMPACT_META.low;
  return { ...meta, color: toneColor(meta.tone) };
};

export const LIKELIHOOD_LABEL = {
  unlikely: 'Unlikely',
  possible: 'Possible',
  likely: 'Likely',
  almost_certain: 'Almost certain',
};

/**
 * How well-evidenced a pillar is. Shown as an explicit chip rather than being
 * folded silently into the score — a reader deserves to know which parts of a
 * verdict rest on located facts and which on inference.
 */
export const DATA_QUALITY_META = {
  strong: { label: 'Well evidenced', tone: 'success' },
  moderate: { label: 'Reasonably evidenced', tone: 'info' },
  weak: { label: 'Thin evidence', tone: 'warning' },
  assumed: { label: 'Inferred, not verified', tone: 'danger' },
};

export const dataQualityMeta = (q) => {
  const meta = DATA_QUALITY_META[q] || DATA_QUALITY_META.assumed;
  return { ...meta, color: toneColor(meta.tone) };
};

/**
 * Tone for a bare 0–100 pillar score. Bands here intentionally match the
 * server's verdict thresholds (78 / 65 / 50) so a pillar bar and the overall
 * verdict read on one consistent scale.
 */
export function scoreTone(score) {
  if (score == null) return 'muted';
  if (score >= 78) return 'success';
  if (score >= 65) return 'info';
  if (score >= 50) return 'warning';
  return 'danger';
}

export const scoreColor = (score) => toneColor(scoreTone(score));

export const AFFLUENCE_LABEL = {
  budget: 'Budget',
  mid: 'Mid',
  upper_mid: 'Upper-mid',
  premium: 'Premium',
  mixed: 'Mixed',
  unknown: 'Unknown',
};

export const RENT_VERDICT_META = {
  well_below_market: { label: 'Well below market', tone: 'success' },
  below_market: { label: 'Below market', tone: 'success' },
  at_market: { label: 'At market', tone: 'info' },
  above_market: { label: 'Above market', tone: 'warning' },
  well_above_market: { label: 'Well above market', tone: 'danger' },
  unknown: { label: 'Not established', tone: 'muted' },
};

export const rentVerdictMeta = (v) => {
  const meta = RENT_VERDICT_META[v] || RENT_VERDICT_META.unknown;
  return { ...meta, color: toneColor(meta.tone) };
};

export const RISK_CATEGORY_LABEL = {
  market: 'Market',
  financial: 'Financial',
  regulatory: 'Regulatory',
  safety: 'Safety',
  operational: 'Operational',
  infrastructure: 'Infrastructure',
  reputational: 'Reputational',
};

export const ASSESSMENT_LABEL = {
  feasibility: 'Feasibility',
  financial: 'Financial',
  technical: 'Technical',
  operational: 'Operational',
};

/**
 * Order risks the way a committee reads them — worst first. Impact leads
 * likelihood: a critical-but-possible risk deserves attention above a
 * low-but-certain one.
 */
const IMPACT_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const LIKELIHOOD_RANK = { almost_certain: 4, likely: 3, possible: 2, unlikely: 1 };

export function sortRisks(risks = []) {
  return [...risks].sort((a, b) => {
    const impact = (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0);
    if (impact) return impact;
    return (LIKELIHOOD_RANK[b.likelihood] || 0) - (LIKELIHOOD_RANK[a.likelihood] || 0);
  });
}

/** Sort findings by impact, worst first, without mutating the input. */
export const sortByImpact = (items = []) =>
  [...items].sort((a, b) => (IMPACT_RANK[b.impact] || 0) - (IMPACT_RANK[a.impact] || 0));

/** "1.2 km" / "450 m" — distance is only ever an estimate, so keep it coarse. */
export function fmtDistance(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return '';
  return n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1)} km`;
}

/** "1m 24s" — how long a run took. */
export function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const secs = Math.round(n / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** Bare hostname, for labelling a citation compactly. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

export const isRunning = (analysis) =>
  analysis?.status === 'queued' || analysis?.status === 'running';
