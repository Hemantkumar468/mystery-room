import { withProvider, assertAiAvailable } from '../providers/index.js';
import { Record } from '../../pms/records/record.model.js';
import { Project } from '../../pms/projects/project.model.js';
import { AiAnalysis } from '../ai.model.js';
import { AI_ANALYSIS_KIND } from '../ai.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Design assistance for the drawings phase, in two modes.
 *
 *   ideas   — before anything is drawn: what could go in this space, given its
 *             real area, shape, frontage, floor and the photos taken on site.
 *   review  — after a drawing is uploaded: what reads well, what looks risky,
 *             what to check before it goes for approval.
 *
 * Both are ADVICE. Nothing here approves a drawing, changes a record, or
 * blocks a phase — an architect owns the design and a reviewer owns the
 * sign-off. The client document is consistent on this ("AI as an assistant,
 * not a decision maker": AI prepares, a human always approves), and the
 * failure to avoid is a model's confident geometry being mistaken for a
 * checked layout.
 *
 * Grounded in the property's own captured data rather than generic best
 * practice — the area, ceiling height, frontage and technical assessment are
 * what make a suggestion usable instead of a brochure paragraph.
 */

export const DESIGN_MODES = Object.freeze(['ideas', 'review']);

/** Space-planning norms from the client document §7 Phase 4 / §10.28 of the MOM. */
const CAPACITY_GUIDE = [
  '3,000–5,000 sq.ft typically supports 4–5 games',
  '~12,000 sq.ft supported 12 games (Chennai)',
  '22,000 sq.ft is the largest format run so far (Gurgaon)',
].join('; ');

const IDEAS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    gameCapacity: {
      type: 'object',
      additionalProperties: false,
      properties: {
        suggested: { type: ['number', 'null'] },
        reasoning: { type: 'string' },
      },
    },
    zoning: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          zone: { type: 'string' },
          placement: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['zone', 'placement'],
      },
    },
    watchOuts: { type: 'array', items: { type: 'string' } },
    questionsForSite: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary'],
};

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    working: { type: 'array', items: { type: 'string' } },
    improve: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          point: { type: 'string' },
          suggestion: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'worth checking', 'important'] },
        },
        required: ['point', 'suggestion'],
      },
    },
    checkBeforeApproval: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary'],
};

const SYSTEM = [
  'You advise an architect designing an escape-room / experiential games centre.',
  'You are an assistant. The architect decides; a reviewer approves. Never state a',
  'layout as settled fact, and never imply anything has been checked or approved.',
  '',
  'Rules:',
  '- Reason from THIS site\'s numbers — area, frontage, floor, ceiling height.',
  '- Say plainly when the captured data is not enough to judge something, and put',
  '  it in questionsForSite rather than guessing.',
  '- No markdown, no headings. Short plain sentences a non-architect can follow.',
  '- Never claim to have seen a drawing file you were not given the contents of.',
].join('\n');

/** Everything known about the site, in the order a designer would ask for it. */
function siteContext(property, priorRun) {
  const v = property?.values || {};
  const media = [
    Array.isArray(v.documents) && v.documents.length ? `${v.documents.length} photo/document upload(s)` : null,
    Array.isArray(v.audio) && v.audio.length ? `${v.audio.length} voice note(s)` : null,
  ].filter(Boolean).join(', ');

  return [
    `Property: ${v.property_name || property?.title || 'Unnamed'}`,
    `Locality: ${v.locality || 'unknown'}`,
    `Carpet area: ${v.carpet_area ? `${v.carpet_area} sq.ft` : 'NOT CAPTURED'}`,
    `Frontage: ${v.frontage_ft ? `${v.frontage_ft} ft` : 'not captured'}`,
    `Floor: ${v.floor || 'not captured'}`,
    `Commercial type: ${v.commercial_type || 'not captured'}`,
    media ? `Site media on file: ${media}` : 'No site media uploaded.',
    v.notes ? `Site notes: ${v.notes}` : null,
    '',
    `Company norms — ${CAPACITY_GUIDE}.`,
    priorRun?.brief
      ? `\nAI location research already done for this site (do not contradict):\n${
        JSON.stringify(priorRun.brief).slice(0, 3500)}`
      : '',
  ].filter(Boolean).join('\n');
}

/**
 * @param mode 'ideas' | 'review'
 * @param drawingRecordId required for 'review' — the uploaded drawing record
 * @returns structured guidance; never persisted against the drawing
 */
export async function designGuidance({ propertyRecordId, mode, drawingRecordId, force = false, user }) {
  assertAiAvailable();

  if (!DESIGN_MODES.includes(mode)) {
    throw ApiError.badRequest(`Unknown mode "${mode}". Use one of: ${DESIGN_MODES.join(', ')}.`);
  }

  const property = await Record.findById(propertyRecordId);
  if (!property) throw ApiError.notFound('That property no longer exists.');

  /* Return what was already produced unless the caller explicitly asked for a
     fresh run. Regenerating on every page view costs money per view, takes
     30–60s each time, and — worse — quietly gives a different answer than the
     one the team discussed yesterday. `force` is the "Generate again" button. */
  if (!force) {
    const saved = await findSaved({ propertyRecordId, mode, drawingRecordId });
    if (saved) return { ...saved.result, saved: true, savedAt: saved.completedAt || saved.createdAt, analysisId: saved._id };
  }

  const project = await Project.findById(property.project).select('name city');

  // Reuse the location research already done for this site rather than
  // re-reasoning about the same catchment with a different answer.
  const priorRun = await AiAnalysis.findOne({
    record: propertyRecordId,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: 'succeeded',
  }).sort({ createdAt: -1 }).lean();

  let drawing = null;
  if (mode === 'review') {
    if (!drawingRecordId) throw ApiError.badRequest('Which drawing should I review? None was given.');
    drawing = await Record.findById(drawingRecordId);
    if (!drawing) throw ApiError.notFound('That drawing no longer exists.');
  }

  const prompt = mode === 'ideas'
    ? [
      `City: ${project?.city || 'unknown'}`,
      siteContext(property, priorRun),
      '',
      'Suggest how this space could be laid out: roughly how many games it supports and why,',
      'what belongs where (entry, waiting/queue, briefing, game zones, control room,',
      'back-of-house, washrooms), what to watch out for given the floor and frontage,',
      'and what you would need to confirm on site before drawing.',
    ].join('\n')
    : [
      `City: ${project?.city || 'unknown'}`,
      siteContext(property, priorRun),
      '',
      'A drawing has been uploaded for this site. Its recorded details:',
      JSON.stringify({
        name: drawing.values?.drawing_name,
        type: drawing.values?.drawing_type,
        revision: drawing.values?.revision_no,
        notes: drawing.values?.remarks,
        files: (drawing.values?.drawing_file || []).map((f) => f?.name || f?.url).filter(Boolean),
      }, null, 1),
      '',
      'You can see its NAME, TYPE, REVISION and the designer\'s notes — not the file contents.',
      'On that basis: what looks sound for this site, what is worth questioning given the',
      'area/floor/frontage, and what the reviewer should verify against the drawing before',
      'approving. Be explicit that you have not opened the file.',
    ].join('\n');

  const result = await withProvider('synthesize', {
    system: SYSTEM,
    prompt,
    schema: mode === 'ideas' ? IDEAS_SCHEMA : REVIEW_SCHEMA,
    schemaName: `design_${mode}`,
    maxOutputTokens: 3500,
  });

  logger.info(`AI design ${mode} generated for property ${propertyRecordId}`);

  const payload = {
    mode,
    ...(result?.json ?? result),
    source: {
      basedOnPriorResearch: Boolean(priorRun),
      // Stated so the UI can be honest about it: the model reasons from the
      // drawing's metadata, not its geometry. Claiming otherwise would be the
      // single most misleading thing this feature could do.
      readDrawingFile: false,
      model: result?.model || null,
    },
  };

  // Saved as an ordinary AiAnalysis run, so it shares the history, audit and
  // presentation the other AI outputs already have rather than inventing a
  // second place AI results can live.
  const doc = await AiAnalysis.create({
    project: property.project,
    record: propertyRecordId,
    kind: AI_ANALYSIS_KIND.DESIGN_GUIDANCE,
    status: 'succeeded',
    subject: { mode, drawingRecordId: drawingRecordId || null },
    provider: result?.provider || null,
    model: result?.model || null,
    result: payload,
    requestedBy: user?.id || null,
    completedAt: new Date(),
  });

  return { ...payload, saved: false, savedAt: doc.completedAt, analysisId: doc._id };
}

/**
 * The most recent stored run for this exact request.
 *
 * Keyed on mode AND the drawing it was about — feedback on revision 1 must not
 * be served as feedback on revision 2, which is the one way a cache here could
 * actively mislead someone.
 */
async function findSaved({ propertyRecordId, mode, drawingRecordId }) {
  return AiAnalysis.findOne({
    record: propertyRecordId,
    kind: AI_ANALYSIS_KIND.DESIGN_GUIDANCE,
    status: 'succeeded',
    'subject.mode': mode,
    'subject.drawingRecordId': drawingRecordId || null,
  }).sort({ createdAt: -1 }).lean();
}

/** Latest saved guidance without calling a provider — what the UI loads on open. */
export async function savedDesignGuidance({ propertyRecordId, mode, drawingRecordId }) {
  const saved = await findSaved({ propertyRecordId, mode, drawingRecordId });
  if (!saved) return null;
  return {
    ...saved.result,
    saved: true,
    savedAt: saved.completedAt || saved.createdAt,
    analysisId: saved._id,
  };
}

export default { designGuidance, DESIGN_MODES };
