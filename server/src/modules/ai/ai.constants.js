/**
 * AI module vocabulary and the location-intelligence rubric.
 *
 * Everything the model is asked to judge, and everything the server derives
 * from that judgement, is declared here — one place to tune the model of
 * "what makes a good Mystery Rooms site" without touching prompts, services
 * or UI. The client reads the same pillar list back off the API, so a weight
 * change here reaches the report with no frontend edit.
 */

export const AI_ANALYSIS_KIND = Object.freeze({
  /** Deep single-property location intelligence (Phase 1 → shortlisting). */
  PROPERTY_INTELLIGENCE: 'property_intelligence',
  /** Cross-property ranking over an existing set of analyses (Phase 1 → 2). */
  SITE_COMPARISON: 'site_comparison',
});

export const AI_ANALYSIS_KIND_VALUES = Object.values(AI_ANALYSIS_KIND);

export const AI_RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
});

export const AI_RUN_STATUS_VALUES = Object.values(AI_RUN_STATUS);

/**
 * Provider names. These are the values `AI_PROVIDER` accepts and the values
 * stored on every analysis document (`provider`), so a report always says which
 * vendor produced it even after the deployment has switched away.
 *
 * Adding a vendor is: one adapter file under `providers/`, one entry here, one
 * line in `providers/index.js`'s ADAPTERS list, one config block. Nothing in
 * the analysis pipeline, the model or the UI knows these names.
 */
export const AI_PROVIDER = Object.freeze({
  GROK: 'grok',
  /**
   * Distinct vendor from GROK, one letter apart. `grok` is xAI's model family
   * (api.x.ai); `groq` is an inference host running open models (api.groq.com).
   * Both are supported and neither aliases the other.
   */
  GROQ: 'groq',
  GEMINI: 'gemini',
  OPENAI: 'openai',
});

export const AI_PROVIDER_VALUES = Object.values(AI_PROVIDER);

/**
 * Bumped whenever a prompt or the rubric changes shape. Cached analyses carry
 * the version they were produced under, so a rubric change automatically
 * invalidates stale reports instead of silently mixing two scoring models in
 * one comparison table.
 */
// pi-2026.08-1: research split from one nine-area call into three concurrent
// focused tracks, and grounding made enforceable per provider.
export const PROMPT_VERSION = 'pi-2026.08-1';
export const RUBRIC_VERSION = 'mr-escape-room-v1';

/**
 * The eight pillars of the 100-point site score.
 *
 * Weights encode how an escape-room / location-based-entertainment venue
 * actually succeeds, which is materially different from retail or F&B:
 *
 *  • Demand is *destination* demand. Guests book online days ahead and travel
 *    to the venue, so raw passing footfall matters far less than the size and
 *    profile of the surrounding catchment. Hence Catchment outweighs Footfall.
 *  • Revenue is group-driven — colleges, IT parks, corporate team outings and
 *    birthday parties are the bread and butter, which is why group-demand
 *    sources are scored separately from generic footfall.
 *  • The built form is unusually forgiving: no shopfront window is needed,
 *    and upper floors or basements that retail rejects are often ideal (cheap
 *    rent, column-free depth, no daylight to block out). But it is unusually
 *    demanding on ceiling height, power load and — critically — fire egress,
 *    because guests are behind closed doors in themed rooms.
 *  • Competition is asymmetric: another escape room in the same catchment
 *    cannibalises, while nearby cinemas, cafés and gaming zones *help* by
 *    supplying trip-chaining traffic.
 *
 * `weight` values must sum to 100 — asserted at import time below.
 */
export const SCORE_PILLARS = Object.freeze([
  {
    key: 'catchment',
    label: 'Catchment & Demographics',
    weight: 18,
    description:
      'Size and profile of the 5–8 km drawable population: share aged 15–34, student and young-professional density, household affluence, and how many people can realistically reach the venue for a 60–90 minute booked activity.',
  },
  {
    key: 'demand_drivers',
    label: 'Group Demand Drivers',
    weight: 16,
    description:
      'Density of the sources that actually fill escape rooms — colleges and coaching hubs, IT parks and corporate offices (team outings), schools, co-living and PG clusters, and event/party demand. Weekday-evening and weekend demand are assessed separately.',
  },
  {
    key: 'footfall_anchors',
    label: 'Footfall & Trip-Chaining Anchors',
    weight: 12,
    description:
      'Proximity to malls, multiplexes, food courts, cafés, bowling/gaming zones and high streets that make the venue part of a larger outing. Also covers evening and weekend liveliness, since this is a leisure business with an evening peak.',
  },
  {
    key: 'accessibility',
    label: 'Accessibility & Connectivity',
    weight: 14,
    description:
      'Metro, bus and main-road connectivity, drive time from the core catchment, ride-hailing availability, and parking — with two-wheeler parking weighted heavily for the Indian youth segment. Evening parking availability matters more than daytime.',
  },
  {
    key: 'competition',
    label: 'Competition & Cannibalisation',
    weight: 10,
    description:
      'Directly competing escape rooms and their scale/quality, plus substitute experiences. Scored asymmetrically: nearby escape rooms reduce the score, while nearby complementary leisure raises it.',
  },
  {
    key: 'site_suitability',
    label: 'Site & Built-Form Suitability',
    weight: 14,
    description:
      'Fit of the physical unit for themed room construction: usable carpet area against the number of rooms planned, column-free depth, floor-to-ceiling height, sanctioned power load for lighting/AV/HVAC, water and washrooms, lift access for upper floors, and the practicality of the floor level chosen.',
  },
  {
    key: 'commercial',
    label: 'Commercial Viability',
    weight: 10,
    description:
      'Quoted rent or lease cost per sq.ft against the local benchmark for comparable non-prime leisure space, implied rent-to-revenue ratio at a realistic occupancy, deposit and lock-in exposure, and fit-out cost implied by the unit\'s bare condition.',
  },
  {
    key: 'risk_compliance',
    label: 'Regulatory, Safety & Environment Risk',
    weight: 6,
    description:
      'Fire NOC feasibility and egress for a venue where guests occupy enclosed themed rooms, occupancy and change-of-use permissions, basement restrictions, entertainment/trade licensing, waterlogging and infrastructure reliability, plus neighbourhood factors such as residential noise sensitivity or night-time safety.',
  },
]);

export const PILLAR_KEYS = SCORE_PILLARS.map((p) => p.key);

const weightTotal = SCORE_PILLARS.reduce((sum, p) => sum + p.weight, 0);
if (weightTotal !== 100) {
  throw new Error(
    `SCORE_PILLARS weights must sum to 100, got ${weightTotal}. Fix ai.constants.js.`,
  );
}

/**
 * Verdict bands for the composite 0–100 score. Deliberately more demanding at
 * the top than the Site Evaluation scorecard's bands (scoring.js) — this is a
 * pre-shortlist screen where a false positive costs a wasted site visit and a
 * false "Strong" costs a wasted lease.
 */
export const VERDICT_BANDS = Object.freeze([
  { key: 'strong', label: 'Strong Fit', min: 78, tone: 'success', advice: 'Prioritise for site visit and full assessment.' },
  { key: 'viable', label: 'Viable', min: 65, tone: 'info', advice: 'Worth shortlisting; resolve the flagged gaps during assessment.' },
  { key: 'conditional', label: 'Conditional', min: 50, tone: 'warning', advice: 'Only pursue if the blocking conditions below can be met.' },
  { key: 'weak', label: 'Not Recommended', min: 0, tone: 'danger', advice: 'Fundamentals are weak; keep sourcing unless commercials change materially.' },
]);

export function bandFor(score) {
  if (score == null || Number.isNaN(score)) {
    return { key: 'unknown', label: 'Not Scored', min: 0, tone: 'muted', advice: '' };
  }
  return VERDICT_BANDS.find((b) => score >= b.min) || VERDICT_BANDS[VERDICT_BANDS.length - 1];
}

/** Confidence bands for how much evidence stood behind the score. */
export const CONFIDENCE_BANDS = Object.freeze([
  { key: 'high', label: 'High', min: 75 },
  { key: 'medium', label: 'Medium', min: 50 },
  { key: 'low', label: 'Low', min: 0 },
]);

export function confidenceBandFor(confidence) {
  if (confidence == null) return CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1];
  return (
    CONFIDENCE_BANDS.find((b) => confidence >= b.min) ||
    CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1]
  );
}

export const IMPACT_LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);
export const RISK_LIKELIHOODS = Object.freeze(['unlikely', 'possible', 'likely', 'almost_certain']);

/**
 * Which of Site Evaluation's four assessment forms each AI-suggested input
 * maps onto. Used to route the model's pre-fill suggestions to the right
 * expert without hardcoding the mapping in the UI.
 */
export const ASSESSMENT_TYPES = Object.freeze(['feasibility', 'financial', 'technical', 'operational']);

/**
 * Indicative per-million-token pricing, USD, used only to show an approximate
 * spend next to each report. Not billing-grade — a rough operator-facing
 * signal so nobody is surprised by their provider invoice. Unknown models
 * fall through to `default`.
 */
export const TOKEN_PRICES_USD_PER_MILLION = Object.freeze({
  default: { input: 1.25, output: 10 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  // xAI. Longest-prefix matching below means the `-fast` tiers are picked up
  // for their dated/suffixed ids (grok-4-fast-reasoning, …) rather than
  // falling through to the full-size price.
  'grok-4-fast': { input: 0.2, output: 0.5 },
  'grok-4': { input: 3, output: 15 },
  'grok-3-mini': { input: 0.3, output: 0.5 },
  'grok-3': { input: 3, output: 15 },
  // Groq (inference host, not xAI). Model ids are vendor-prefixed, which the
  // longest-prefix match below handles without extra cases.
  'groq/compound': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.75 },
  'openai/gpt-oss-20b': { input: 0.1, output: 0.5 },
  'llama-3.3-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
});

export function estimateCostUsd(model, inputTokens = 0, outputTokens = 0) {
  const price =
    TOKEN_PRICES_USD_PER_MILLION[model] ||
    // Tolerate dated/suffixed ids like "gpt-5-2025-08-07" by longest-prefix match.
    TOKEN_PRICES_USD_PER_MILLION[
      Object.keys(TOKEN_PRICES_USD_PER_MILLION)
        .filter((k) => k !== 'default' && String(model || '').startsWith(k))
        .sort((a, b) => b.length - a.length)[0]
    ] ||
    TOKEN_PRICES_USD_PER_MILLION.default;
  const cost = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
  return Math.round(cost * 10000) / 10000;
}

/** Progress steps surfaced while an analysis runs, so the UI can narrate it. */
export const RUN_STEPS = Object.freeze([
  { key: 'context', label: 'Reading property record', pct: 8 },
  { key: 'research', label: 'Researching the catchment on the web', pct: 30 },
  { key: 'synthesis', label: 'Scoring the site against the rubric', pct: 75 },
  { key: 'scoring', label: 'Computing weighted score', pct: 92 },
  { key: 'done', label: 'Report ready', pct: 100 },
]);

export const stepFor = (key) => RUN_STEPS.find((s) => s.key === key) || RUN_STEPS[0];
