/**
 * Deterministic scoring over the model's pillar judgements.
 *
 * The model is asked for eight independent 0–100 pillar scores and nothing
 * else numeric. Every aggregate — the weighted composite, the verdict band,
 * the confidence figure — is computed here, in code.
 *
 * That split is deliberate and load-bearing:
 *   • Language models are unreliable at arithmetic. A weighted average they
 *     compute cannot be trusted, and a wrong total silently corrupts every
 *     downstream ranking.
 *   • The score becomes reproducible and auditable. Re-running this function
 *     on a stored report yields the same number, so a report from six months
 *     ago can be re-scored under a new rubric without re-querying a provider.
 *   • Tuning the business model (weights, bands) becomes a code change with a
 *     diff and a review, not a prompt edit whose effect nobody can predict.
 */

import {
  SCORE_PILLARS,
  PILLAR_KEYS,
  bandFor,
  confidenceBandFor,
} from '../ai.constants.js';

const clampScore = (n) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
};

/** How much each data_quality level is worth when rating evidence strength. */
const DATA_QUALITY_WEIGHT = { strong: 1, moderate: 0.75, weak: 0.45, assumed: 0.2 };

/**
 * Normalise the model's `pillars` array against the rubric.
 *
 * Defensive by design — this is the boundary where non-deterministic output
 * becomes trusted data. It tolerates a missing pillar, a duplicated one, an
 * unknown key or an out-of-range score without failing the whole run, and
 * reports what was missing so the UI can be honest about coverage.
 */
export function normalizePillars(rawPillars = []) {
  const byKey = new Map();
  for (const p of Array.isArray(rawPillars) ? rawPillars : []) {
    const key = String(p?.key || '').trim();
    // First occurrence wins: a duplicated key is the model repeating itself,
    // and its first answer is the considered one.
    if (!PILLAR_KEYS.includes(key) || byKey.has(key)) continue;
    byKey.set(key, p);
  }

  const missing = [];
  const pillars = SCORE_PILLARS.map((def) => {
    const raw = byKey.get(def.key);
    const score = clampScore(raw?.score);
    if (score == null) missing.push(def.key);

    const evidence = Array.isArray(raw?.evidence)
      ? raw.evidence.map((e) => String(e || '').trim()).filter(Boolean)
      : [];

    return {
      key: def.key,
      label: def.label,
      weight: def.weight,
      description: def.description,
      score,
      verdict: String(raw?.verdict || '').trim(),
      rationale: String(raw?.rationale || '').trim(),
      evidence,
      dataQuality: DATA_QUALITY_WEIGHT[raw?.data_quality] ? raw.data_quality : 'assumed',
      // Points this pillar actually contributed, e.g. 14/18 — the figure the
      // report shows beside each bar.
      points: score == null ? null : Math.round((score / 100) * def.weight * 10) / 10,
    };
  });

  return { pillars, missing };
}

/**
 * Weighted composite over the pillars that were actually scored.
 *
 * Weights are renormalised across the scored subset rather than treating a
 * missing pillar as zero — a model that failed to return one pillar has told
 * us nothing about it, and scoring it zero would be a fabricated penalty.
 * `coverage` records how much of the rubric the number rests on so the report
 * can flag a partial score instead of presenting it as complete.
 */
export function computeComposite(pillars) {
  const scored = pillars.filter((p) => p.score != null);
  if (!scored.length) return { overall: null, coverage: 0 };

  const weightSum = scored.reduce((sum, p) => sum + p.weight, 0);
  const weighted = scored.reduce((sum, p) => sum + p.score * p.weight, 0);

  return {
    overall: Math.round(weighted / weightSum),
    coverage: Math.round((weightSum / 100) * 100),
  };
}

/**
 * Blend the model's self-reported confidence with objective evidence signals,
 * so a model that is merely fluent cannot talk its own confidence up.
 *
 *   50%  the model's stated confidence
 *   30%  evidence quality — the weighted mean of per-pillar data_quality
 *   20%  research breadth — citation count, saturating at 12 sources
 *
 * Then a hard ceiling: whatever the model claims, a report resting on two
 * citations cannot be presented as high-confidence.
 */
export function computeConfidence({ modelConfidence, pillars, citationCount = 0, coverage = 100 }) {
  const stated = clampScore(modelConfidence) ?? 50;

  const scored = pillars.filter((p) => p.score != null);
  const qualityMean = scored.length
    ? scored.reduce((sum, p) => sum + (DATA_QUALITY_WEIGHT[p.dataQuality] ?? 0.2) * p.weight, 0) /
      scored.reduce((sum, p) => sum + p.weight, 0)
    : 0.2;

  const breadth = Math.min(1, citationCount / 12);

  let confidence = Math.round(stated * 0.5 + qualityMean * 100 * 0.3 + breadth * 100 * 0.2);

  // Thin evidence caps the claim regardless of how sure the model sounds.
  if (citationCount < 3) confidence = Math.min(confidence, 45);
  else if (citationCount < 6) confidence = Math.min(confidence, 70);

  // A partially-scored rubric cannot yield a high-confidence verdict.
  if (coverage < 100) confidence = Math.min(confidence, Math.round(coverage * 0.8));

  return Math.max(0, Math.min(100, confidence));
}

/**
 * Build the complete, persisted score object from a raw model result.
 * Pure and side-effect free, so it can be re-run over stored reports.
 */
export function buildScore(result, { citationCount = 0 } = {}) {
  const { pillars, missing } = normalizePillars(result?.pillars);
  const { overall, coverage } = computeComposite(pillars);

  const confidence = computeConfidence({
    modelConfidence: result?.confidence?.score,
    pillars,
    citationCount,
    coverage,
  });

  const band = bandFor(overall);
  const confidenceBand = confidenceBandFor(confidence);

  return {
    overall,
    band: band.key,
    bandLabel: band.label,
    bandTone: band.tone,
    bandAdvice: band.advice,
    confidence,
    confidenceBand: confidenceBand.key,
    confidenceLabel: confidenceBand.label,
    coverage,
    missingPillars: missing,
    pillars,
    // Surfaced as "what carried the score" / "what dragged it down" — computed
    // from contribution against the pillar's own ceiling, so a heavy pillar
    // scoring adequately doesn't crowd out a light pillar scoring terribly.
    topDrivers: rankDrivers(pillars, 'best'),
    topDrags: rankDrivers(pillars, 'worst'),
  };
}

function rankDrivers(pillars, direction, limit = 3) {
  const scored = pillars.filter((p) => p.score != null);
  const sorted = [...scored].sort((a, b) =>
    direction === 'best'
      ? b.score * b.weight - a.score * a.weight
      : (100 - b.score) * b.weight - (100 - a.score) * a.weight,
  );
  return sorted.slice(0, limit).map((p) => ({ key: p.key, label: p.label, score: p.score }));
}

/**
 * Ranking comparator for the comparison view. Mirrors the intent of the Site
 * Evaluation scorecard's comparator (client scoring.js): score first, then
 * deterministic tie-breaks so two equal properties never swap order between
 * renders.
 *
 * Confidence breaks a score tie because, between two equally attractive
 * sites, the better-evidenced one is the safer commitment.
 */
export function compareAnalyses(a, b) {
  const aScore = a?.score?.overall ?? -Infinity;
  const bScore = b?.score?.overall ?? -Infinity;
  if (bScore !== aScore) return bScore - aScore;

  const aConf = a?.score?.confidence ?? -Infinity;
  const bConf = b?.score?.confidence ?? -Infinity;
  if (bConf !== aConf) return bConf - aConf;

  return String(a?.propertyTitle || '').localeCompare(String(b?.propertyTitle || ''));
}
