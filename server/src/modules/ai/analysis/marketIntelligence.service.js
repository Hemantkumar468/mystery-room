import { Project } from '../../pms/projects/project.model.js';
import { Record } from '../../pms/records/record.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { assertAiAvailable, withProvider } from '../providers/index.js';

/**
 * The Network Map's business brain: two grounded analyses the MD triggers
 * from the map itself.
 *
 *   marketScout(city)  — a research dossier on ONE city: demand, competitors,
 *                        micro-markets worth walking, rent reality, a verdict.
 *   expansionRadar()   — ranks the NEXT cities to open, judged against the
 *                        centres the network already has.
 *
 * Both are grounded two ways: the prompt carries what the PMS actually knows
 * (our projects and captured properties in that market), and the provider
 * runs with web search on, so competitor names and rent figures come from the
 * live web rather than the model's memory. Everything returns as structured
 * JSON the map renders directly — no markdown to parse.
 *
 * Radar results are cached in-process for six hours keyed by the network's
 * own shape, because the answer only moves when the network does — and a
 * fresh grounded run is slow and costs real tokens.
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** What the PMS knows about one city, folded into prompt-sized facts. */
async function cityContext(city) {
  const rx = new RegExp(`^${city.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const [projects, properties] = await Promise.all([
    Project.find({ city: rx }).select('name code status health').lean(),
    Record.find({ stageKey: 'p1', 'values.city': rx }).select('title status values.rent values.carpet_area values.locality').limit(30).lean(),
  ]);
  const rents = properties.map((p) => num(p.values?.rent)).filter((r) => r > 0);
  return {
    our_projects: projects.map((p) => ({ name: p.name, status: p.status, health: p.health })),
    properties_scouted: properties.length,
    rent_quotes_seen: rents.length ? { min: Math.min(...rents), max: Math.max(...rents) } : null,
  };
}

/** The whole network, folded the same way for the radar. */
async function networkContext() {
  const projects = await Project.find({}).select('city status').lean();
  const byCity = {};
  for (const p of projects) {
    const c = (p.city || 'unknown').trim().toLowerCase();
    byCity[c] = byCity[c] || { live: 0, opening: 0 };
    if (['store_live', 'completed', 'archived'].includes(p.status)) byCity[c].live += 1;
    else byCity[c].opening += 1;
  }
  return byCity;
}

const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'One sentence: the market in a nutshell' },
    rating: { type: 'string', enum: ['strong', 'promising', 'cautious', 'avoid'] },
    demand: { type: 'string', description: 'Who the customers are here and how much of them: malls, IT parks, colleges, tourism, weekend economy. 2-4 sentences.' },
    competitors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          note: { type: 'string', description: 'Where, roughly how established, what that means for us' },
        },
        required: ['name', 'note'],
      },
    },
    micro_markets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          area: { type: 'string' },
          why: { type: 'string', description: 'Footfall driver + audience fit in one sentence' },
        },
        required: ['area', 'why'],
      },
      description: 'The 3-5 localities actually worth sending the property consultant to',
    },
    rent_reality: { type: 'string', description: 'Realistic commercial rent range for 2500-4000 sq ft in the good micro-markets, per sq ft per month, with any sharp differences between areas' },
    risks: { type: 'array', items: { type: 'string' }, description: '2-4 sharp, specific risks' },
    verdict: { type: 'string', description: '2-3 sentences: should Mystery Rooms open here, at what pace, and what to check first on the ground' },
  },
  required: ['headline', 'rating', 'demand', 'competitors', 'micro_markets', 'rent_reality', 'risks', 'verdict'],
};

const SCOUT_SYSTEM = [
  'You are the expansion analyst for Mystery Rooms, India\'s largest escape-room chain.',
  'A centre needs 2,500-4,000 sq ft, works best beside malls, high-street F&B,',
  'IT parks and college catchments, peaks evenings and weekends, and sells',
  'group experiences (friends, corporate team outings, families, birthdays).',
  'Use web search to ground competitor names, mall/locality facts and rent',
  'figures in the live web — never invent a competitor or a number. Where the',
  'company\'s own data (given in the prompt) says something, weigh it: cities',
  'where we already scouted properties have real rent quotes. Be specific and',
  'decisive; a hedge on every line helps nobody. No markdown.',
].join(' ');

export async function marketScout({ city }) {
  assertAiAvailable();
  const clean = String(city || '').trim();
  if (!clean) throw ApiError.badRequest('Which city should the scout research?');

  const ours = await cityContext(clean);
  const result = await withProvider('synthesize', {
    system: SCOUT_SYSTEM,
    prompt: [
      `Research ${clean}, India as a market for a new Mystery Rooms escape-room centre.`,
      `What our PMS already knows about ${clean}: ${JSON.stringify(ours)}.`,
      'Cover: demand drivers, every named escape-room competitor you can verify,',
      'the 3-5 micro-markets worth physically scouting, the realistic rent range,',
      'the sharp risks, and a decisive verdict.',
    ].join('\n'),
    schema: SCOUT_SCHEMA,
    schemaName: 'market_scout',
    maxOutputTokens: 2200,
  });
  const payload = result?.json ?? result;
  return { city: clean, ours, ...payload, generatedAt: new Date().toISOString() };
}

const RADAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reading: { type: 'string', description: '2-3 sentences on the shape of the current network: where it is strong, where it is thin' },
    cities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
          state: { type: 'string' },
          score: { type: 'number', description: '0-100 attractiveness for the NEXT opening' },
          why: { type: 'string', description: '1-2 sentences: the demand story' },
          watch_out: { type: 'string', description: 'The one thing most likely to make this city disappoint' },
          anchor_areas: { type: 'array', items: { type: 'string' }, description: '2-3 localities to scout first' },
        },
        required: ['city', 'state', 'score', 'why', 'watch_out', 'anchor_areas'],
      },
      description: 'Exactly 6 candidate cities, best first, NONE of which the network is already strong in',
    },
  },
  required: ['reading', 'cities'],
};

/** { key, expiresAt, value } — one slot; the radar is one answer per network shape. */
let radarCache = null;
const RADAR_TTL_MS = 6 * 60 * 60 * 1000;

export async function expansionRadar({ force = false } = {}) {
  assertAiAvailable();
  const network = await networkContext();
  const key = JSON.stringify(network);
  if (!force && radarCache && radarCache.key === key && radarCache.expiresAt > Date.now()) {
    return { ...radarCache.value, cached: true };
  }

  const result = await withProvider('synthesize', {
    system: SCOUT_SYSTEM,
    prompt: [
      'Rank the next cities Mystery Rooms should open in.',
      `Current network by city (live centres / centres being opened): ${key}.`,
      'Use web search to ground your picks in real mall pipelines, IT/office growth,',
      'tourism and competitor saturation. Skip cities the network is already strong',
      'in. Prefer a mix: 2-3 obvious metro moves and 2-3 sharp tier-2 opportunities',
      'a competitor would miss. Exactly 6 cities, best first.',
    ].join('\n'),
    schema: RADAR_SCHEMA,
    schemaName: 'expansion_radar',
    maxOutputTokens: 2200,
  });
  const payload = result?.json ?? result;
  const value = { ...payload, network, generatedAt: new Date().toISOString() };
  radarCache = { key, expiresAt: Date.now() + RADAR_TTL_MS, value };
  return { ...value, cached: false };
}
