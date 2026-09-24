import dayjs from 'dayjs';
import { withProvider } from '../providers/index.js';
import { Record } from '../../pms/records/record.model.js';
import { Project } from '../../pms/projects/project.model.js';
import { AiAnalysis } from '../ai.model.js';
import { AI_ANALYSIS_KIND } from '../ai.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';

/**
 * The procurement coordinator's morning brief, for the Phase 6 order tracker.
 *
 * Reads the project's Phase 5 BOQ lines — each one a purchase order with its
 * own tracking fields — and answers three questions in plain language: what
 * to chase today (with a ready-to-send message for each), what is at risk,
 * and what is going fine. It is ADVICE over facts the tracker already holds;
 * it never changes an order, and every date or number it quotes comes from
 * the rows below — the prompt forbids inventing any.
 *
 * Saved as an AiAnalysis run (kind: procurement_brief) so the page can show
 * the last brief instantly and only pay for a fresh one on request.
 */

/** Order statuses after which nothing is owed by the vendor any more. */
const CLOSED = new Set(['Received (GRN)', 'Cancelled']);
/** Statuses meaning the goods have left the vendor. */
const MOVED = new Set(['Dispatched', 'Delivered', 'Partly Received', 'Received (GRN)', 'Short / Damaged']);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    chaseToday: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          po: { type: 'string' },
          vendor: { type: 'string' },
          why: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['po', 'why'],
      },
    },
    risks: { type: 'array', items: { type: 'string' } },
    goingWell: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary'],
};

const SYSTEM = [
  'You help a non-technical store-launch team at Mystery Rooms (an escape-room franchise in India)',
  'keep purchase orders on track. Write in short, plain English — no jargon, no headings, no markdown.',
  'Use ONLY the order facts you are given. Never invent a date, quantity, vendor or PO number; if a fact',
  'is missing, say it is missing. Quote dates as given (e.g. "25 Aug") and money as given.',
  'chaseToday: only orders that are late, not yet sent, or ordered with no promised date — each with a',
  'polite 2–3 sentence WhatsApp-ready message to the vendor, in English, that names the PO and asks one',
  'clear question (a dispatch date, a confirmation, or the pending quantity). Nothing to chase → empty list.',
  'risks: at most 4 one-line items. goingWell: at most 3. summary: at most 3 sentences, starting with the',
  'overall picture (how many orders, how many received, how many late).',
].join(' ');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const poNo = (r) => r.values?.po_number || `PO-${String(r.seq ?? 0).padStart(3, '0')}`;

/**
 * One plain row of facts per order — shared by the prompt and (mirrored on the
 * client) by the tracker's own delay and status logic, so the brief and the
 * screen never disagree about what "late" means.
 */
export function orderFacts(records, today = dayjs()) {
  return records.map((r) => {
    const v = r.values || {};
    const sent = v.sent_whatsapp_at || v.sent_email_at;
    const status = v.order_status || (sent ? 'Ordered' : 'Not sent yet');
    const due = v.promised_delivery || v.planned_end || null;
    const qty = num(v.quantity);
    const received = v.received_quantity === '' || v.received_quantity == null ? null : num(v.received_quantity);
    const late = due && !CLOSED.has(status) && dayjs(due).isBefore(today, 'day');
    return {
      po: poNo(r),
      item: r.title || v.item,
      category: v.category,
      vendor: v.vendor,
      quantity: qty ? `${qty} ${v.unit || ''}`.trim() : null,
      amount: v.amount != null && v.amount !== '' ? `₹${num(v.amount).toLocaleString('en-IN')}` : null,
      status,
      sentVia: [v.sent_whatsapp_at && 'WhatsApp', v.sent_email_at && 'email'].filter(Boolean).join(' + ') || null,
      sentOn: sent ? dayjs(sent).format('DD MMM') : null,
      dueOn: due ? dayjs(due).format('DD MMM') : null,
      daysLate: late ? today.diff(dayjs(due), 'day') : 0,
      dispatchedOn: v.dispatch_date ? dayjs(v.dispatch_date).format('DD MMM') : null,
      received: received == null ? null : `${received} of ${qty || '?'}`,
      pending: received != null && qty ? Math.max(qty - received, 0) : null,
      moved: MOVED.has(status),
      closed: CLOSED.has(status),
    };
  });
}

async function findSaved(projectId) {
  return AiAnalysis.findOne({ project: projectId, kind: AI_ANALYSIS_KIND.PROCUREMENT_BRIEF, status: 'succeeded' })
    .sort({ createdAt: -1 });
}

const present = (doc) => ({
  ...doc.result,
  saved: true,
  savedAt: doc.completedAt || doc.createdAt,
  analysisId: doc._id,
});

export async function savedProcurementBrief(projectId) {
  const saved = await findSaved(projectId);
  return saved ? present(saved) : null;
}

export async function procurementBrief({ projectId, user, force = false }) {
  const project = await Project.findById(projectId).select('name code city targetEndDate');
  if (!project) throw ApiError.notFound('Project not found');

  if (!force) {
    const saved = await findSaved(projectId);
    if (saved) return present(saved);
  }

  const records = await Record.find({
    project: projectId, stageKey: 'p13', status: { $nin: ['rejected', 'archived'] },
  }).sort({ seq: 1 });
  if (!records.length) {
    throw ApiError.badRequest('There are no BOQ lines to brief on yet — add them in Phase 5 first.', { code: 'NO_ORDERS' });
  }

  const today = dayjs();
  const facts = orderFacts(records, today);
  const prompt = [
    `Project: ${project.name} (${project.code})${project.city ? `, ${project.city}` : ''}.`,
    project.targetEndDate ? `Target opening: ${dayjs(project.targetEndDate).format('DD MMM YYYY')}.` : null,
    `Today: ${today.format('DD MMM YYYY')}.`,
    '',
    `Purchase orders (${facts.length}):`,
    JSON.stringify(facts, null, 1),
  ].filter((l) => l !== null).join('\n');

  const result = await withProvider('synthesize', {
    system: SYSTEM,
    prompt,
    schema: SCHEMA,
    schemaName: 'procurement_brief',
    maxOutputTokens: 2500,
  });
  logger.info(`AI procurement brief generated for project ${project.code} (${facts.length} orders)`);

  const payload = {
    ...(result?.json ?? result),
    counts: {
      orders: facts.length,
      notSent: facts.filter((f) => f.status === 'Not sent yet').length,
      late: facts.filter((f) => f.daysLate > 0).length,
      received: facts.filter((f) => f.status === 'Received (GRN)').length,
    },
    source: { basedOn: 'Phase 5 BOQ lines and their tracking fields', model: result?.model || null },
  };

  const doc = await AiAnalysis.create({
    project: projectId,
    kind: AI_ANALYSIS_KIND.PROCUREMENT_BRIEF,
    status: 'succeeded',
    subject: { orders: facts.length, asOf: today.toDate() },
    provider: result?.provider || null,
    model: result?.model || null,
    result: payload,
    requestedBy: user?.id || null,
    completedAt: new Date(),
  });
  return { ...payload, saved: false, savedAt: doc.completedAt, analysisId: doc._id };
}

export default { procurementBrief, savedProcurementBrief, orderFacts };
