import { ApiError } from '../../../core/utils/ApiError.js';
import { assertAiAvailable, withProvider } from '../providers/index.js';

/**
 * Layout advice for a Phase 3B outlet plan.
 *
 * DELIBERATE DIVISION OF LABOUR: the AI never draws. The client computes the
 * floor geometry exactly — the confirmed area, each game's real square
 * footage from the Games master, reception/washrooms/corridor carved out
 * arithmetically — so the picture can never lie about sizes. What the AI
 * contributes is what arithmetic cannot: WHICH game goes where (walk order,
 * front to back) and the operator's notes — noise adjacency, theming flow,
 * where the control room wants to sit, what to watch in fit-out. An
 * escape-room floor plan drawn by a language model would be fiction; an
 * arrangement ORDER reasoned by one is judgement, checked by a human.
 */

const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    order: {
      type: 'array',
      items: { type: 'string' },
      description: 'EXACTLY the given game names, reordered front-of-house to deepest — the walk order the floor should follow',
    },
    entrance_note: { type: 'string', description: 'One sentence: what belongs at the entrance and why' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: '4-6 sharp fit-out notes for THIS mix: noise adjacency, theming flow, control room placement, corridor and emergency-exit reality, washroom position',
    },
  },
  required: ['order', 'entrance_note', 'notes'],
};

const SYSTEM = [
  'You are the fit-out planner for Mystery Rooms, India\'s largest escape-room chain.',
  'You know how their centres actually run: reception and briefing at the front,',
  'loud or scare-heavy games deepest, themed games not clashing wall-to-wall,',
  'the control room needing sight of corridors, washrooms off reception, minimum',
  '1.2 m corridors and a clear emergency route. Given a site area, its shape',
  'notes and the chosen games with their real square footage, return the walk',
  'ORDER (front to back) using exactly the given names, and sharp notes. Never',
  'invent games or change their areas. No markdown.',
].join(' ');

export async function layoutAdvice({ areaSqft, shapeNotes, games }) {
  assertAiAvailable();
  if (!Array.isArray(games) || !games.length) throw ApiError.badRequest('Pick the games first — the layout is arranged around them.');

  const result = await withProvider('synthesize', {
    system: SYSTEM,
    prompt: [
      `SITE: ${areaSqft} sq ft confirmed.${shapeNotes ? ` Shape/layout notes: ${shapeNotes}` : ''}`,
      `GAMES (name — area they need): ${games.map((g) => `${g.name} — ${g.sqft} sq ft`).join('; ')}`,
      'Arrange them front to back and give the fit-out notes.',
    ].join('\n'),
    schema: ADVICE_SCHEMA,
    schemaName: 'layout_advice',
    maxOutputTokens: 900,
  });
  const payload = result?.json ?? result;

  // The order must be a permutation of what was given — anything the model
  // dropped is appended, anything invented is discarded.
  const given = games.map((g) => g.name);
  const seen = new Set();
  const order = (payload.order || [])
    .filter((n) => given.includes(n) && !seen.has(n) && seen.add(n))
    .concat(given.filter((n) => !seen.has(n)));

  return { order, entranceNote: payload.entrance_note || '', notes: payload.notes || [] };
}

export default layoutAdvice;
