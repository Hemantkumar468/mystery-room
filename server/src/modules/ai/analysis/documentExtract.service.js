import { withProvider, assertAiAvailable } from '../providers/index.js';
import { Project } from '../../pms/projects/project.model.js';
import { Template } from '../../pms/templates/template.model.js';
import { downloadBuffer, isS3Configured } from '../../../config/s3.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * Read an uploaded commercial document and fill in the form it belongs to.
 *
 * Phase 3 is six folders of paperwork — LOI, lease agreement, legal
 * verification, deposit proof, NOCs, approvals — and every one of them was
 * being typed twice: once by the lawyer who drafted it, once by whoever
 * re-keyed the rent, the dates and the deposit into this system. This reads
 * the document and proposes the values.
 *
 * THE WHOLE DESIGN IS ABOUT NOT BEING WRONG. These are lease deeds; a
 * misread deposit is a real financial error, and a confidently wrong date is
 * worse than an empty box. So:
 *
 *  1. EVERY value must be quoted. The model returns the exact source text it
 *     read each value from, and a value with no quote is dropped before the
 *     user ever sees it. Nothing is "inferred" — if the document does not say
 *     it, the field stays empty.
 *  2. EVERY value is re-validated here, in code, against the field's real
 *     type: a date must parse, a currency must be a number, a dropdown must
 *     match one of its options exactly. Anything that fails is dropped and
 *     reported, not coerced into something that looks plausible.
 *  3. NOTHING IS SAVED. The values open in the form with their quotes beside
 *     them, and a person submits. The document remains the source of truth and
 *     the reviewer checks the quote, not the whole PDF.
 *  4. The document itself is never re-hosted — it is already in S3, private,
 *     and is read back from there for the one call.
 */

/** Fields no document can answer — they are this company's own workflow. */
const NEVER_EXTRACT = new Set(['remarks', 'notes', 'documents', 'lease_document', 'payment_proof', 'noc_document', 'approval_document']);

/** What the model may be asked to read. Files and free notes are excluded above. */
const READABLE_TYPES = new Set(['text', 'textarea', 'number', 'currency', 'date', 'select']);

const SYSTEM = [
  'You transcribe facts from a commercial property document into a form.',
  'You are reading a real legal or financial document for an Indian retail lease.',
  '',
  'ABSOLUTE RULES:',
  '- Only state what the document itself says. Never infer, estimate or complete a pattern.',
  '- For EVERY value you return, quote the exact text you read it from, verbatim,',
  '  in "evidence". A value you cannot quote must be omitted entirely.',
  '- If a field is not in the document, omit it. An empty field is correct and expected;',
  '  a guess is a serious error in a document like this.',
  '- Amounts: digits only, no currency symbol, separators or words. "Rs. 1,50,000/-" is 150000.',
  '  Indian numbering: "1.5 lakh" is 150000, "1 crore" is 10000000. If the document writes an',
  '  amount in words and figures and they DISAGREE, omit the field and say so in "warnings".',
  '- Dates: strict YYYY-MM-DD. Indian documents are usually DD/MM/YYYY — read 03/04/2026 as',
  '  2026-04-03. If a date is genuinely ambiguous, omit it and say so in "warnings".',
  '- Dropdowns: return one of the listed options, copied exactly, or omit the field.',
  '- "confidence": "high" only when the document states the value plainly and unambiguously;',
  '  "medium" when you had to interpret layout or wording; "low" when you are unsure.',
  '- Put anything the reviewer must check — a disagreement, an unclear scan, a term that',
  '  contradicts another — in "warnings", in plain words.',
].join('\n');

/** Ask for values, and for the proof of each one. */
function responseSchema(fields) {
  const props = {};
  for (const f of fields) props[f.key] = { type: ['string', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Every value arrives as a STRING and is parsed here. Letting the model
      // emit a JSON number invites "1,50,000" to arrive as 1.5, and a silent
      // factor-of-100000 error on a deposit is exactly the failure to design out.
      values: { type: 'object', additionalProperties: false, properties: props },
      evidence: { type: 'object', additionalProperties: false, properties: props },
      confidence: { type: 'object', additionalProperties: false, properties: props },
      documentType: { type: ['string', 'null'] },
      warnings: { type: 'array', items: { type: 'string' } },
    },
    required: ['values', 'evidence', 'confidence', 'documentType', 'warnings'],
  };
}

/** Describe each field the way the document would express it. */
function describeFields(fields) {
  return fields.map((f) => {
    const bits = [`- ${f.key} (${f.label || f.key})`, `type: ${f.type}`];
    if (f.type === 'select' && f.options?.length) bits.push(`one of: ${f.options.join(' | ')}`);
    if (f.type === 'currency') bits.push('amount in rupees, digits only');
    if (f.type === 'date') bits.push('YYYY-MM-DD');
    if (f.type === 'number') bits.push('a plain number');
    if (f.helpText) bits.push(f.helpText);
    return bits.join(' — ');
  }).join('\n');
}

/* ── Parsing, done here rather than trusted from the model ─────────────── */

const WORD_MULTIPLIER = [
  [/\bcrores?\b|\bcr\b/i, 10000000],
  [/\blakhs?\b|\blacs?\b|\blakh\b/i, 100000],
  [/\bthousand\b|\bk\b/i, 1000],
];

/** "Rs. 1,50,000/-" → 150000. "2.5 lakh" → 250000. Anything unclear → null. */
export function parseAmount(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const digits = text.replace(/[^\d.]/g, '');
  if (!digits || !/\d/.test(digits)) return null;
  let n = Number(digits);
  if (!Number.isFinite(n)) return null;
  for (const [re, mult] of WORD_MULTIPLIER) {
    if (re.test(text)) { n *= mult; break; }
  }
  // A negative or absurd amount is a misread, not a value.
  if (n < 0 || n > 1e12) return null;
  return n;
}

/** Strict YYYY-MM-DD only — the prompt asks for it and anything else is a misread. */
export function parseDate(raw) {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  // A lease dated 1890 or 2190 is a misread of a smudged scan.
  if (y < 1990 || y > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function parseNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Match a dropdown option exactly, then case-insensitively. Never fuzzily. */
export function matchOption(raw, options = []) {
  if (!raw) return null;
  const text = String(raw).trim();
  const exact = options.find((o) => o === text);
  if (exact) return exact;
  const loose = options.find((o) => o.toLowerCase() === text.toLowerCase());
  return loose || null;
}

/**
 * Turn what the model said into what the form can hold — dropping anything
 * that does not survive the trip.
 */
export function coerceValues(fields, raw = {}, evidence = {}, confidence = {}) {
  const values = {};
  const kept = {};
  const rejected = [];

  for (const f of fields) {
    const given = raw[f.key];
    if (given == null || String(given).trim() === '') continue;

    // Rule 1: no quote, no value. Applied before parsing, so a well-formed
    // number the model could not point to in the document is still dropped.
    const quote = evidence[f.key];
    if (!quote || !String(quote).trim()) {
      rejected.push(`${f.label || f.key}: dropped — the reader could not quote it from the document`);
      continue;
    }

    let parsed = null;
    if (f.type === 'currency') parsed = parseAmount(given);
    else if (f.type === 'date') parsed = parseDate(given);
    else if (f.type === 'number') parsed = parseNumber(given);
    else if (f.type === 'select') parsed = matchOption(given, f.options);
    else parsed = String(given).trim();

    if (parsed === null || parsed === '') {
      rejected.push(`${f.label || f.key}: dropped — "${String(given).slice(0, 40)}" is not a valid ${f.type}`);
      continue;
    }
    values[f.key] = parsed;
    kept[f.key] = {
      evidence: String(quote).trim().slice(0, 400),
      confidence: ['high', 'medium', 'low'].includes(confidence[f.key]) ? confidence[f.key] : 'low',
    };
  }
  return { values, kept, rejected };
}

/* ── The call ───────────────────────────────────────────────────────────── */

const IMAGE = /^image\//;
const SUPPORTED = /^(application\/pdf|image\/(png|jpe?g|webp|gif|heic))/i;

/**
 * @param {object}  a
 * @param {string}  a.projectId     which project's template defines the form
 * @param {string}  a.assessmentType  one of the six p3 modules
 * @param {Array}   a.files         [{ publicId, name, mimetype }] already in S3
 */
export async function extractFromDocument({ projectId, stageKey = 'p3', assessmentType = null, files = [] }) {
  assertAiAvailable();
  if (!files.length) throw ApiError.badRequest('Attach the document first, then read it.');
  if (!isS3Configured) {
    throw ApiError.badRequest(
      'File storage is not configured, so the document cannot be read back. Set S3_BUCKET and the AWS keys.',
      { code: 'S3_NOT_CONFIGURED' },
    );
  }

  const project = await Project.findById(projectId).select('name city template');
  if (!project) throw ApiError.notFound('Project not found');

  /* The form lives on the TEMPLATE — a project stage snapshots scheduling and
     status, never the field definitions. Reading it from the project stage
     returns an empty schema and an unhelpful "no fields" error. */
  const templateId = project.template?.ref || project.template;
  const template = await Template.findById(templateId).select('stages');
  const stage = template?.stages?.find((s) => s.key === stageKey);
  if (!stage) throw ApiError.badRequest(`"${stageKey}" is not a phase on this project.`);

  /* Two shapes of form, both readable. A phase like Commercial Closure holds
     several named modules (assessmentTypes); one like Property Research or the
     BOQ has a single flat form. Supporting both is what lets the same reader
     serve every form in the app rather than Phase 3 alone. */
  const form = assessmentType
    ? stage.assessmentTypes?.find((a) => a.key === assessmentType)
    : { name: stage.name, masterDataSchema: stage.masterDataSchema };
  if (!form) {
    const known = (stage.assessmentTypes || []).map((a) => a.key).join(', ') || 'none';
    throw ApiError.badRequest(`"${assessmentType}" is not a module on this phase (it has: ${known}).`);
  }

  const fields = (form.masterDataSchema || []).filter(
    (f) => READABLE_TYPES.has(f.type) && !NEVER_EXTRACT.has(f.key),
  );
  if (!fields.length) throw ApiError.badRequest(`The ${form.name} form has nothing a document can fill.`);

  // Read the files back out of S3 and hand them to the model as they are.
  const payload = [];
  for (const f of files.slice(0, 3)) {
    if (!f?.publicId) continue;
    if (!SUPPORTED.test(f.mimetype || '')) {
      throw ApiError.badRequest(
        `"${f.name || 'That file'}" is a ${f.mimetype || 'file'} — I can read PDFs and photographs. `
        + 'For a Word file, save it as PDF and upload that.',
        { code: 'UNSUPPORTED_DOCUMENT' },
      );
    }
    const { buffer, contentType } = await downloadBuffer(f.publicId);
    payload.push({
      filename: f.name || 'document.pdf',
      mimetype: IMAGE.test(f.mimetype) ? f.mimetype : (contentType || 'application/pdf'),
      base64: buffer.toString('base64'),
    });
  }
  if (!payload.length) throw ApiError.badRequest('None of those files could be read back from storage.');

  const prompt = [
    `This is the "${form.name}" document for a Mystery Rooms outlet in ${project.city || 'India'}`,
    `(project: ${project.name}).`,
    '',
    'Read the attached document and fill in these fields:',
    describeFields(fields),
    '',
    'Return a value ONLY where the document states it, with the exact quote in "evidence".',
    'Omit everything else. Say what the document is in "documentType".',
  ].join('\n');

  const result = await withProvider('readDocument', {
    system: SYSTEM,
    prompt,
    schema: responseSchema(fields),
    schemaName: 'document_extract',
    files: payload,
    maxOutputTokens: 6000,
  });

  const out = result?.json ?? result;
  const { values, kept, rejected } = coerceValues(fields, out?.values, out?.evidence, out?.confidence);

  logger.info(
    `Document read for ${assessmentType}: ${Object.keys(values).length}/${fields.length} fields filled`,
    { projectId, assessmentType, rejected: rejected.length, files: payload.length, model: result?.model },
  );

  return {
    values,
    fields: kept,                       // evidence + confidence, per field
    documentType: out?.documentType || null,
    warnings: [...(out?.warnings || []), ...rejected],
    source: {
      files: payload.map((f) => f.filename),
      model: result?.model || null,
      // Said plainly so the UI can be honest: this is a reading, not a ruling.
      reviewRequired: true,
    },
  };
}

export default { extractFromDocument, parseAmount, parseDate, matchOption, coerceValues };
