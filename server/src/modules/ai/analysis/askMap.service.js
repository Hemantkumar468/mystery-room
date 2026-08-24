import { Project } from '../../pms/projects/project.model.js';
import { Record } from '../../pms/records/record.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { assertAiAvailable, withProvider } from '../providers/index.js';

/**
 * Ask the Map — a researched answer to any question asked over the network map.
 *
 * Two sources, used for what each is actually good for:
 *
 *   COMPANY DATA  — every project and scouted property, with GPS where the
 *                   consultant captured one. Questions about OUR OWN network
 *                   (distances between our sites, rents we were quoted,
 *                   statuses) are answered from this and only this.
 *   WEB SEARCH    — the world around the network: competitors, escape-room
 *                   and similar game concepts near a point, malls, metro
 *                   stations. Providers run with search on, so these claims
 *                   are grounded in the live web, not model memory.
 *
 * The answer comes back with FINDINGS — the concrete named things it is made
 * of, each carrying coordinates when they are honestly known — so the map can
 * plot what the answer talks about. `approx: true` marks a researched
 * location as approximate; company locations are exact. The `caveat` field
 * exists because "I could not verify X" belongs in the answer, not hidden.
 */

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answer: { type: 'string', description: 'The direct answer, 2-6 sentences, plain text. Lead with the answer itself, then the evidence.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high = computed from company data or clearly verified on the web; medium = strongly indicated; low = best-effort research' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['our_centre', 'our_property', 'competitor', 'place', 'area'] },
          detail: { type: 'string', description: 'One sentence: what this is and why it answers the question, including distance when relevant' },
          city: { type: 'string' },
          lat: { type: ['number', 'null'], description: 'Latitude when reasonably known, else null. For our_centre / our_property use EXACTLY the coordinates given in the company data.' },
          lng: { type: ['number', 'null'] },
          approx: { type: 'boolean', description: 'true when the location is researched/approximate rather than from company data' },
        },
        required: ['name', 'kind', 'detail', 'city', 'lat', 'lng', 'approx'],
      },
      description: 'The concrete things the answer is made of — each becomes a pin or a list row. Empty when the question has no locatable subjects.',
    },
    caveat: { type: 'string', description: 'One honest sentence on what could not be verified, or empty string' },
  },
  required: ['answer', 'confidence', 'findings', 'caveat'],
};

const num6 = (v) => (Number.isFinite(v) ? Number(v.toFixed(5)) : null);

/** The whole network as compact facts the model can compute distances over. */
async function askContext() {
  const [projects, properties] = await Promise.all([
    Project.find({}).select('name code city status').lean(),
    Record.find({ stageKey: 'p1' })
      .select('title status values.city values.locality values.rent values.carpet_area values.live_location')
      .limit(150)
      .lean(),
  ]);
  const props = properties.map((r) => {
    const g = r.values?.live_location;
    const gps = g && Number.isFinite(g.lat) && Number.isFinite(g.lng) && !(g.lat === 0 && g.lng === 0)
      ? { lat: num6(g.lat), lng: num6(g.lng) }
      : null;
    return {
      name: r.title,
      status: r.status,
      city: r.values?.city,
      locality: r.values?.locality,
      rent: r.values?.rent ?? null,
      sqft: r.values?.carpet_area ?? null,
      gps,
    };
  });
  return {
    projects: projects.map((p) => ({ name: p.name, code: p.code, city: p.city, status: p.status })),
    properties: props,
  };
}

const ASK_SYSTEM = [
  "You are the network analyst for Mystery Rooms, India's largest escape-room chain,",
  'answering a question asked over their live franchise map. You have TWO sources and',
  'must use both correctly:',
  '1. COMPANY DATA (in the prompt): their projects and scouted properties, with GPS',
  '   where captured. Anything about their OWN network — distances between their',
  '   sites, rents they were quoted, statuses — comes ONLY from here, computed',
  '   carefully. Never invent company facts; if the data does not contain it, say so.',
  '2. WEB SEARCH: for the world around them — competitors, escape rooms and similar',
  '   game concepts near a point, malls, metro stations, market facts. Ground every',
  '   external claim in search; name real places with their locality.',
  'Distance questions (within 5 km / 10 km): compute from coordinates when both ends',
  'have them; when the web gives only a locality, estimate honestly and mark the',
  'finding approx=true. Be direct and specific. State what you could NOT verify in',
  'the caveat rather than padding the answer. In an ongoing conversation, resolve',
  'pronouns and follow-ups ("and within 10 km?") against the previous turns. No markdown.',
].join(' ');

export async function askMap({ question, focus, history }) {
  assertAiAvailable();
  const q = String(question || '').trim();
  if (!q) throw ApiError.badRequest('Ask something first.');

  const context = await askContext();
  const result = await withProvider('synthesize', {
    system: ASK_SYSTEM,
    prompt: [
      `QUESTION: ${q}`,
      focus ? `THE USER IS LOOKING AT: ${JSON.stringify(focus)} — treat the question as about this unless it clearly is not.` : null,
      history?.length
        ? 'CONVERSATION SO FAR (each assistant turn lists its established_facts — facts already researched '
          + 'and answered in this thread. REUSE them: a follow-up about something already established is '
          + 'answered from the record, and search is spent only on what is genuinely new): '
          + JSON.stringify(history)
        : null,
      `COMPANY DATA: ${JSON.stringify(context)}`,
    ].filter(Boolean).join('\n\n'),
    schema: ASK_SCHEMA,
    schemaName: 'ask_map',
    maxOutputTokens: 2000,
  });
  const payload = result?.json ?? result;
  // Findings without usable coordinates stay in the list but cannot be pins.
  const findings = (payload.findings || []).map((f) => ({
    ...f,
    lat: Number.isFinite(f.lat) ? f.lat : null,
    lng: Number.isFinite(f.lng) ? f.lng : null,
  }));
  return { question: q, ...payload, findings, generatedAt: new Date().toISOString() };
}

export default askMap;
