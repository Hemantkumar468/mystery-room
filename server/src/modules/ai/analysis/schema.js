/**
 * Canonical JSON Schema for a property-intelligence report.
 *
 * Written in the intersection of what OpenAI strict structured outputs and
 * Gemini `responseSchema` both accept, so one definition drives both (the
 * per-dialect adjustments live in providers/base.js):
 *
 *   • Every property is required — there are no optional fields. "Unknown" is
 *     an empty string / empty array / an explicit `unknown` enum member. This
 *     is what lets OpenAI's strict mode (which demands all keys in `required`)
 *     and Gemini's looser dialect share a schema.
 *   • No `format`, `$ref`, `oneOf` or `additionalProperties` — Gemini rejects
 *     or ignores them.
 *   • Free-text fields carry their guidance in `description`; the model reads
 *     these, so they are working prompt surface, not documentation.
 */

import { PILLAR_KEYS, IMPACT_LEVELS, RISK_LIKELIHOODS, ASSESSMENT_TYPES } from '../ai.constants.js';

const str = (description) => ({ type: 'string', description });

const enumStr = (values, description) => ({ type: 'string', enum: [...values], description });

const arrayOf = (items, description) => ({ type: 'array', items, description });

const score100 = (description) => ({
  type: 'integer',
  minimum: 0,
  maximum: 100,
  description,
});

/** A named place found near the site, with its distance and why it matters. */
const placeItem = {
  type: 'object',
  properties: {
    name: str('Specific name of the place. Never a generic label like "a mall" — if you cannot name it, omit the entry entirely.'),
    type: str('Short category, e.g. "Mall", "Multiplex", "Engineering college", "IT park", "Metro station", "Escape room".'),
    distance_km: {
      type: 'number',
      description: 'Straight-line distance in km from the subject property. Use your best estimate; 0 if unknown.',
    },
    note: str('One line on why this matters to an escape-room venue at this site — footfall it supplies, crowd profile, or the threat it poses.'),
  },
};

const findingItem = (kind) => ({
  type: 'object',
  properties: {
    title: str(`Six words or fewer naming the ${kind}.`),
    detail: str(`Two or three sentences of specifics. Cite the concrete fact behind it — a named place, a distance, a number. No generic business-school language.`),
    impact: enumStr(IMPACT_LEVELS, 'How materially this affects the go/no-go decision.'),
  },
});

export const propertyIntelligenceSchema = {
  type: 'object',
  description: 'A site-selection intelligence report for a proposed Mystery Rooms escape-room venue.',
  properties: {
    executive_summary: str(
      'Three to five sentences a Managing Director could read alone and decide from. Lead with the verdict, then the single strongest reason for it and the single biggest reservation. Name real places.',
    ),

    location_profile: {
      type: 'object',
      properties: {
        resolved_location: str('The location as you understood it — locality, city, and the landmark or road it sits on. State plainly if the address was too vague to place precisely.'),
        micro_market: str('Name and characterise the micro-market, e.g. "Vijay Nagar — Indore\'s primary youth retail and F&B high street".'),
        position_quality: str('Where the unit sits within that micro-market: main road vs interior lane, high-street vs standalone, and what that means for discoverability and last-mile.'),
        catchment_summary: str('Who lives and works within a realistic 5–8 km drive, and how many. Be concrete about localities by name.'),
        estimated_catchment_population: str('Best estimate of the drawable population with the radius it assumes, e.g. "~9–11 lakh within 7 km". Say "insufficient data" rather than inventing precision.'),
        dominant_age_profile: str('The age and life-stage mix that dominates the catchment, and whether it matches the 15–34 escape-room core.'),
        affluence_band: enumStr(
          ['budget', 'mid', 'upper_mid', 'premium', 'mixed', 'unknown'],
          'Spending power of the dominant catchment, which sets the achievable ticket price.',
        ),
        weekday_evening_character: str('What this area is like on a weekday evening — the primary escape-room booking slot. Offices that empty at 7pm are a real weakness.'),
        weekend_character: str('What this area is like on a weekend, the peak revenue window.'),
      },
    },

    pillars: arrayOf(
      {
        type: 'object',
        properties: {
          key: enumStr(PILLAR_KEYS, 'Which rubric pillar this scores. Return each key exactly once.'),
          score: score100('0–100 for this pillar alone. Use the full range: 50 is genuinely average, not a hedge. Reserve 85+ for a site that is exceptional on this dimension.'),
          verdict: str('Under ten words summarising this pillar, e.g. "Dense student catchment, weak weekday-evening pull".'),
          rationale: str('Three to five sentences justifying the score with specific, checkable facts — named places, distances, counts, prices. This is the paragraph a Regional Manager will challenge, so it must survive scrutiny.'),
          evidence: arrayOf(str('One concrete fact drawn from the research brief that supports the score.'), 'Two to five supporting facts. Empty only if the research genuinely found nothing on this dimension.'),
          data_quality: enumStr(
            ['strong', 'moderate', 'weak', 'assumed'],
            'How well-evidenced this pillar is. Use "assumed" when you scored on general reasoning rather than located facts — this lowers the report\'s stated confidence, which is correct and expected.',
          ),
        },
      },
      'Exactly one entry per rubric pillar, in the order the pillars were given.',
    ),

    strengths: arrayOf(findingItem('strength'), 'Three to six genuine advantages of this specific site. No filler — if there are only three real ones, return three.'),
    concerns: arrayOf(findingItem('concern'), 'Three to six real weaknesses. A report with no concerns is not credible; find them.'),

    risks: arrayOf(
      {
        type: 'object',
        properties: {
          title: str('Six words or fewer naming the risk.'),
          category: enumStr(
            ['market', 'financial', 'regulatory', 'safety', 'operational', 'infrastructure', 'reputational'],
            'Which function owns this risk.',
          ),
          detail: str('What specifically could go wrong here, and the mechanism by which it would hurt the venue.'),
          likelihood: enumStr(RISK_LIKELIHOODS, 'How likely this is to materialise at this specific site.'),
          impact: enumStr(IMPACT_LEVELS, 'Severity if it does materialise.'),
          mitigation: str('A concrete, actionable mitigation — something a person can be assigned to do, not "monitor closely".'),
        },
      },
      'Three to seven risks. Prioritise ones specific to this site over generic business risks. Always consider fire NOC and emergency egress: guests occupy enclosed themed rooms, which makes this the single most common cause of an escape-room venue being blocked or shut down.',
    ),

    nearby: {
      type: 'object',
      properties: {
        anchors: arrayOf(placeItem, 'Malls, multiplexes, food courts, cafés, gaming/bowling zones and high streets that create trip-chaining traffic. Up to eight, nearest first.'),
        demand_sources: arrayOf(placeItem, 'Colleges, coaching hubs, schools, IT parks, corporate offices, co-living/PG clusters — the sources of group bookings. Up to eight, nearest first.'),
        competitors: arrayOf(placeItem, 'Existing escape rooms first, then substitute experiences (VR arcades, bowling, trampoline parks, gaming cafés). Up to eight, nearest first.'),
        transport: arrayOf(placeItem, 'Metro stations, major bus stops, railway stations and arterial roads serving the site. Up to six, nearest first.'),
      },
    },

    commercial_read: {
      type: 'object',
      properties: {
        rent_verdict: enumStr(
          ['well_below_market', 'below_market', 'at_market', 'above_market', 'well_above_market', 'unknown'],
          'The quoted rent or lease cost judged against comparable NON-PRIME leisure/upper-floor space in this micro-market — not against prime ground-floor retail, which an escape room never needs.',
        ),
        rent_benchmark_comment: str('State the local benchmark you are comparing against in ₹/sq.ft/month with its basis, then place this property against it. If no rent was supplied, say so plainly.'),
        rent_to_revenue_read: str('At a realistic ramped occupancy for this catchment, what rent-to-revenue ratio does this rent imply? Entertainment venues target 12–18%; state where this lands and what that means.'),
        revenue_potential_read: str('Qualitative read on achievable monthly revenue for this catchment — sessions per week, group sizes and the ticket price the affluence band supports. Be explicit that this is an indicative range, not a forecast.'),
        fitout_read: str('What the unit\'s described condition, floor level and services imply for fit-out cost and timeline relative to a typical outlet.'),
      },
    },

    recommendation: {
      type: 'object',
      properties: {
        decision: enumStr(
          ['shortlist', 'shortlist_with_conditions', 'hold', 'reject'],
          'Your recommended Phase-1 decision on this property.',
        ),
        headline: str('One sentence a decision-maker can act on immediately.'),
        rationale: str('Four to six sentences tying the pillar scores to the decision. Explicitly name the factor that decided it.'),
        conditions: arrayOf(str('A condition that must be satisfied before committing.'), 'Conditions gating a positive decision. Empty for a clear reject.'),
        next_steps: arrayOf(str('A specific next action, phrased as an instruction to a named function, e.g. "Expansion team to obtain the sanctioned electrical load certificate from the landlord."'), 'Three to six concrete next actions.'),
        deal_breakers: arrayOf(str('A finding that would kill the deal outright if confirmed on site.'), 'Zero to three. Empty if none exist — do not manufacture one.'),
      },
    },

    assessment_inputs: arrayOf(
      {
        type: 'object',
        properties: {
          assessment_type: enumStr(ASSESSMENT_TYPES, 'Which Site Evaluation form this belongs to.'),
          field_label: str('The human label of the field being suggested, e.g. "Market Potential", "Footfall Assessment (Score /10)", "Accessibility".'),
          suggested_value: str('The value to pre-fill, exactly as the form expects it, e.g. "High", "7", "Good".'),
          basis: str('One sentence on why — this is shown to the expert who decides whether to accept the suggestion.'),
        },
      },
      'Six to twelve suggested starting values for the Phase-2 Feasibility / Financial / Technical / Operational forms. These are drafts for a human expert to accept or overrule, never final answers — only suggest values your research actually supports.',
    ),

    site_visit_questions: arrayOf(
      str('A specific question to answer physically on site.'),
      'Five to eight questions that only a site visit can settle, targeted at the weakest-evidenced parts of this analysis. Nothing answerable from a desk.',
    ),

    confidence: {
      type: 'object',
      properties: {
        score: score100('How confident you are in this report overall. Be honest: a vague address with no verifiable local data deserves a score below 40, and saying so is more valuable than false precision.'),
        rationale: str('What drives that confidence level, in two or three sentences.'),
        gaps: arrayOf(str('A specific piece of missing information that would most improve this analysis.'), 'Two to five gaps, most consequential first.'),
      },
    },
  },
};

/**
 * Comparison report over several already-analysed properties. Much smaller —
 * every underlying fact was established by the individual reports, so this
 * call only ranks and contrasts them.
 */
export const siteComparisonSchema = {
  type: 'object',
  description: 'A comparative ranking of candidate properties for one franchise launch.',
  properties: {
    executive_summary: str('Four to six sentences: which property to take forward, why it beat the others, and what would change the answer.'),
    ranking: arrayOf(
      {
        type: 'object',
        properties: {
          property_ref: str('The exact `ref` string given for this property in the input. Copy it verbatim.'),
          rank: { type: 'integer', minimum: 1, description: '1 is best. Ranks must be unique and consecutive.' },
          verdict: str('Under twelve words on this property\'s standing in this set.'),
          decisive_factor: str('The single factor that most determined this property\'s rank relative to the others.'),
          trade_off: str('What is being given up by choosing this one — every site has a cost. State it plainly.'),
        },
      },
      'Every input property, ranked. Do not omit any.',
    ),
    head_to_head: arrayOf(
      {
        type: 'object',
        properties: {
          dimension: str('The dimension being contrasted, e.g. "Weekday-evening demand", "Rent efficiency", "Fire compliance risk".'),
          finding: str('How the properties actually differ on this dimension, naming them. Two or three sentences.'),
        },
      },
      'Four to seven dimensions on which these properties genuinely differ. Skip dimensions where they are equivalent — those tell the reader nothing.',
    ),
    portfolio_advice: str('Advice on the set as a whole: whether the shortlist is strong enough to commit to, or whether sourcing should continue, and what a better option would look like.'),
    recommended_property_ref: str('The `ref` of the property to take forward. Empty string if none is good enough to recommend — say so rather than picking the least-bad by default.'),
  },
};
