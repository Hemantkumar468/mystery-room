import mongoose from 'mongoose';
import {
  AI_ANALYSIS_KIND_VALUES,
  AI_RUN_STATUS,
  AI_RUN_STATUS_VALUES,
} from './ai.constants.js';

const { Schema, model } = mongoose;

/**
 * One AI run — queued, running, or finished.
 *
 * Every run is persisted rather than being a transient response, because an
 * analysis that informs a multi-year lease decision has to be auditable: who
 * asked for it, which model answered, what evidence it cited, what it cost,
 * and what the property looked like at the time. Re-running later produces a
 * new document, so the history of a property's assessment stays intact.
 */

const citationSchema = new Schema(
  { url: { type: String }, title: { type: String } },
  { _id: false },
);

/** One rubric pillar as normalised by analysis/scoring.js. */
const pillarScoreSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String },
    weight: { type: Number },
    score: { type: Number, min: 0, max: 100, default: null },
    points: { type: Number, default: null },
    verdict: { type: String },
    rationale: { type: String },
    evidence: [{ type: String }],
    dataQuality: { type: String, enum: ['strong', 'moderate', 'weak', 'assumed'], default: 'assumed' },
  },
  { _id: false },
);

const scoreSchema = new Schema(
  {
    overall: { type: Number, min: 0, max: 100, default: null },
    band: { type: String },
    bandLabel: { type: String },
    bandTone: { type: String },
    bandAdvice: { type: String },
    confidence: { type: Number, min: 0, max: 100, default: null },
    confidenceBand: { type: String },
    confidenceLabel: { type: String },
    // Share of the rubric's weight that was actually scored (<100 if the model
    // skipped a pillar) — lets the UI flag a partial score honestly.
    coverage: { type: Number, default: 100 },
    missingPillars: [{ type: String }],
    pillars: [pillarScoreSchema],
    topDrivers: [{ key: String, label: String, score: Number, _id: false }],
    topDrags: [{ key: String, label: String, score: Number, _id: false }],
  },
  { _id: false },
);

const usageSchema = new Schema(
  {
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    calls: { type: Number, default: 0 },
    searchCount: { type: Number, default: 0 },
    estimatedCostUsd: { type: Number, default: 0 },
  },
  { _id: false },
);

const aiAnalysisSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    // Set for property_intelligence; unset for project-wide kinds like
    // site_comparison, which span many records.
    record: { type: Schema.Types.ObjectId, ref: 'Record', index: true },
    kind: { type: String, enum: AI_ANALYSIS_KIND_VALUES, required: true, index: true },

    status: {
      type: String,
      enum: AI_RUN_STATUS_VALUES,
      default: AI_RUN_STATUS.QUEUED,
      index: true,
    },
    // Narrates the run to a polling client, e.g. "Researching the catchment".
    progress: {
      step: { type: String, default: 'context' },
      label: { type: String, default: 'Preparing' },
      pct: { type: Number, default: 0 },
    },

    // Hash of the property's decision-relevant fields + prompt/rubric versions.
    // Identical fingerprint ⇒ a cached report is still valid.
    fingerprint: { type: String, index: true },
    promptVersion: { type: String },
    rubricVersion: { type: String },

    provider: { type: String },
    model: { type: String },

    // What the property looked like when analysed — so a report stays readable
    // and defensible even after the record is edited underneath it.
    subject: { type: Object },

    research: {
      brief: { type: String },
      citations: [citationSchema],
      searchQueries: [{ type: String }],
      provider: { type: String },
      model: { type: String },
      /**
       * Whether the research call actually reached the web. False when the
       * provider ran without its search tool — an adapter may fall back to an
       * ungrounded call (see grok.provider.js) rather than fail the run, and a
       * report built on desk reasoning alone must say so rather than look
       * identical to a grounded one with unlucky citations.
       */
      grounded: { type: Boolean, default: true },
    },

    /** The model's structured output, verbatim, matching analysis/schema.js. */
    result: { type: Object },
    /** Server-computed aggregates over `result.pillars`. */
    score: scoreSchema,

    usage: usageSchema,
    durationMs: { type: Number },
    error: { message: { type: String }, code: { type: String } },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    completedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

// The dominant read: "latest analysis for this record".
aiAnalysisSchema.index({ record: 1, kind: 1, createdAt: -1 });
// Cache lookup: "a successful run of this exact subject already exists".
aiAnalysisSchema.index({ record: 1, fingerprint: 1, status: 1 });
// Project-wide reads for the comparison view and the records table's score column.
aiAnalysisSchema.index({ project: 1, kind: 1, status: 1, createdAt: -1 });

/** True once the report is older than the configured freshness window. */
aiAnalysisSchema.methods.isStale = function isStale(ttlHours) {
  if (!this.completedAt) return false;
  return Date.now() - this.completedAt.getTime() > ttlHours * 3600 * 1000;
};

export const AiAnalysis = model('AiAnalysis', aiAnalysisSchema);
export default AiAnalysis;
