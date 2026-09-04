import { withProvider, assertAiAvailable } from '../providers/index.js';
import { Record } from '../../pms/records/record.model.js';
import { Project } from '../../pms/projects/project.model.js';
import { Template } from '../../pms/templates/template.model.js';
import { AiAnalysis } from '../ai.model.js';
import { AI_ANALYSIS_KIND } from '../ai.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Draft an assessment form for a shortlisted property, so the expert validates
 * rather than starts from a blank page (client flow document §7 Phase 2:
 * "AI prefills competitor analysis, footfall estimates, accessibility, target
 * audience and photo-based property analysis so experts validate rather than
 * start from blank").
 *
 * The output is a SUGGESTION. Every value lands in a normal, editable field and
 * nothing is saved until the expert submits — the document is equally explicit
 * that "the expert edits and owns the final recommendation", and this service
 * never writes to the Record.
 */

/**
 * Which assessments AI may draft.
 *
 * Feasibility and Operational are judgement built on public, researchable
 * context — catchment, competition, footfall, accessibility, staffing — which
 * is what the model is actually good at, and the client is happy for AI to
 * complete them.
 *
 * Financial and Technical are NOT drafted, by the client's own instruction and
 * for the reason behind it: financial numbers are a lease decision (an invented
 * ROI is worse than a blank box), and technical is a physical inspection —
 * power load, fire-NOC compliance and structural condition cannot be known from
 * a desk. Their fixed Purpose text still fills itself, because that is
 * boilerplate rather than judgement; everything else there is the expert's.
 */
export const PREFILLABLE = Object.freeze(['feasibility', 'operational']);

export const canPrefill = (assessmentType) => PREFILLABLE.includes(assessmentType);

/** Field types we can meaningfully ask a model to fill. */
const FILLABLE_TYPES = new Set(['text', 'textarea', 'number', 'select', 'multiselect', 'boolean']);

/**
 * Describe the target form to the model, field by field.
 *
 * Built from the stage's OWN masterDataSchema rather than a hardcoded list, so
 * editing the assessment form in the template builder changes what AI drafts
 * with no code change — the same data-driven contract RecordFormModal already
 * honours when it renders the form.
 */
function describeFields(fields) {
  return fields
    .filter((f) => FILLABLE_TYPES.has(f.type))
    .map((f) => {
      const bits = [`- "${f.key}" (${f.type})`, f.label || f.key];
      if (f.options?.length) bits.push(`one of: ${f.options.join(' | ')}`);
      if (f.helpText) bits.push(f.helpText);
      return bits.join(' — ');
    })
    .join('\n');
}

/** JSON Schema for the response: every fillable key, all optional, plus notes. */
function responseSchema(fields) {
  const properties = {};
  for (const f of fields) {
    if (!FILLABLE_TYPES.has(f.type)) continue;
    if (f.type === 'number') properties[f.key] = { type: ['number', 'null'] };
    else if (f.type === 'boolean') properties[f.key] = { type: ['boolean', 'null'] };
    else if (f.type === 'multiselect') properties[f.key] = { type: 'array', items: { type: 'string' } };
    else properties[f.key] = { type: ['string', 'null'] };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      values: { type: 'object', additionalProperties: true, properties },
      // Which keys the model genuinely had grounds for, so the UI can mark the
      // rest as guesses rather than presenting all fields with equal confidence.
      confident: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
    required: ['values'],
  };
}

const SYSTEM = [
  'You prepare a FIRST DRAFT of a site-assessment form for an expert to review.',
  'A human expert edits and owns the final answer — you are not deciding anything.',
  '',
  'Rules:',
  '- Fill a field only when the property context or your research supports it.',
  '- Leave a field null rather than inventing a number, a name or a certainty.',
  '- List in "confident" only the keys you had real grounds for.',
  '- For select fields, return exactly one of the listed options, verbatim.',
  '- Prose fields: 2–4 plain sentences, no jargon, no markdown.',
].join('\n');

/**
 * @returns {{ values: object, confident: string[], notes: string, source: object }}
 */
export async function draftAssessment({ recordId, stageKey, assessmentType }) {
  assertAiAvailable();

  if (!canPrefill(assessmentType)) {
    throw ApiError.badRequest(
      `The ${assessmentType} assessment is completed by a person, not drafted by AI. `
      + `Only ${PREFILLABLE.join(' and ')} can be pre-filled.`,
      { code: 'AI_PREFILL_NOT_ALLOWED' },
    );
  }

  const record = await Record.findById(recordId);
  if (!record) throw ApiError.notFound('That property no longer exists.');

  const project = await Project.findById(record.project).select('name city template');
  if (!project) throw ApiError.notFound('That project no longer exists.');

  /* The form definition lives on the TEMPLATE, not on the project's stage
     snapshot: projectStageSchema copies scheduling and status but deliberately
     not `assessmentTypes`, so the forms have a single definition. Reading them
     off `project.stages` (as this did originally) always found nothing and
     failed every request with a 400. */
  const templateId = project.template?.ref;
  if (!templateId) throw ApiError.badRequest('This project has no template, so it has no assessment forms.');

  const template = await Template.findById(templateId).select('stages');
  const stage = template?.stages?.find((s) => s.key === stageKey);
  if (!stage) {
    throw ApiError.badRequest(`This project's template has no "${stageKey}" phase.`);
  }

  const form = stage.assessmentTypes?.find((a) => a.key === assessmentType);
  if (!form) {
    const known = (stage.assessmentTypes || []).map((a) => a.key).join(', ') || 'none';
    throw ApiError.badRequest(
      `"${assessmentType}" is not an assessment on this phase (it has: ${known}).`,
    );
  }
  if (!form.masterDataSchema?.length) {
    throw ApiError.badRequest(`The ${form.name || assessmentType} form has no fields to fill.`);
  }

  // Reuse the property intelligence run if one exists — it already did the
  // grounded research (competition, footfall, catchment) with cited sources, so
  // drafting on top of it is both cheaper and more consistent than researching
  // the same property twice with two different answers.
  const priorRun = await AiAnalysis.findOne({
    record: recordId,
    kind: AI_ANALYSIS_KIND.PROPERTY_INTELLIGENCE,
    status: 'succeeded',
  }).sort({ createdAt: -1 }).lean();

  const prompt = [
    `Property: ${record.values?.property_name || record.title || 'Unnamed'}`,
    `City: ${project?.city || 'unknown'}   Locality: ${record.values?.locality || 'unknown'}`,
    '',
    'Captured property details:',
    JSON.stringify(record.values || {}, null, 1).slice(0, 4000),
    '',
    priorRun?.brief
      ? `Existing AI property research for this same site (reuse it, do not contradict it):\n${
        JSON.stringify(priorRun.brief).slice(0, 6000)}`
      : 'No prior AI research exists for this property — reason from the details above and your own knowledge of this city.',
    '',
    `Draft the "${form.name || assessmentType}" assessment. Fields:`,
    describeFields(form.masterDataSchema),
  ].join('\n');

  const result = await withProvider('synthesize', {
    system: SYSTEM,
    prompt,
    schema: responseSchema(form.masterDataSchema),
    schemaName: 'assessment_prefill',
    maxOutputTokens: 4000,
  });

  const payload = result?.json ?? result;
  const values = payload?.values || {};

  // Drop anything the model invented that the form does not actually have —
  // an unknown key would be written into the record's values on submit and
  // silently pollute the schema.
  const known = new Set(form.masterDataSchema.map((f) => f.key));
  /* A field the FORM already answers (Purpose, whose text is fixed in the
     template) is not the model's to reword. Letting it through would mean the
     same assessment reads differently depending on whether AI was used. */
  const fixed = new Set(form.masterDataSchema.filter((f) => f.defaultValue).map((f) => f.key));
  const clean = {};
  for (const [k, v] of Object.entries(values)) {
    if (known.has(k) && !fixed.has(k) && v !== null && v !== '') clean[k] = v;
  }

  logger.info(
    `AI drafted ${assessmentType} for record ${recordId}: `
    + `${Object.keys(clean).length}/${known.size} fields`,
  );

  return {
    values: clean,
    /* Only fields that actually SURVIVED into the draft. The model can list a
       key as confident and then return null for it — the financial policy makes
       that common, because it is told to leave a number out rather than guess.
       Reporting confidence in a field the expert can see is empty is the kind
       of small contradiction that makes people stop trusting the whole draft. */
    confident: (payload?.confident || []).filter((k) => k in clean),
    notes: payload?.notes || '',
    source: {
      basedOnPriorResearch: Boolean(priorRun),
      priorAnalysisId: priorRun?._id || null,
      model: result?.model || null,
    },
  };
}

export default { draftAssessment, canPrefill, PREFILLABLE };
