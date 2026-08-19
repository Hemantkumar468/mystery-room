import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A sales pipeline and its stages.
 *
 * STAGES ARE DOCUMENTS, NOT AN ENUM. This is the whole point of the
 * collection. "Add a Site Visit step between Demo and Negotiation" is a
 * Tuesday-morning request from a sales manager, and behind an enum it is a
 * code change, a review, a deploy and a migration of every existing deal. Here
 * it is a row.
 *
 * MULTI-PIPELINE FROM DAY ONE. Corporate bookings and walk-in bookings do not
 * follow the same path, and retrofitting a second pipeline later means finding
 * every query that assumed one — the deal list, the board, the funnel, the
 * forecast — and threading a pipeline id through all of them. The cost of
 * supporting two on day one is one extra field; the cost of adding the second
 * later is a week.
 *
 * Stages are SUBDOCUMENTS rather than their own collection because they are
 * never queried independently of their pipeline: every read is "give me this
 * pipeline and its stages", which is one document.
 */
const stageSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 60 },

  /**
   * Display order. GAPPED — 100, 200, 300 — not 1, 2, 3.
   *
   * Inserting a stage between two others then needs one write (the new stage
   * at 150) instead of renumbering every stage after it. The same reasoning
   * applies to `boardOrder` on a deal, where it matters far more: dragging one
   * card must not rewrite the whole column.
   */
  order: { type: Number, required: true },

  /**
   * The odds a deal in this stage closes, as a percentage.
   *
   * This is what makes a weighted forecast arithmetic rather than guesswork:
   * pipeline value is Σ(value × probability). It lives on the stage, not on
   * the deal, so changing "Negotiation means 80%" reprices the forecast
   * without touching a single deal.
   */
  probability: { type: Number, min: 0, max: 100, default: 0 },

  /**
   * Terminal flags. A stage is open, won or lost — never two of them.
   *
   * Booleans rather than one `type` enum because the questions asked of them
   * are independent: "is this deal still live" (neither flag), "what did we
   * win this quarter" (isWon), "why are we losing" (isLost). Validated below
   * so a stage cannot be both.
   */
  isWon: { type: Boolean, default: false },
  isLost: { type: Boolean, default: false },

  /** Shown on the board's column header, so a new rep knows what the stage
   *  actually requires before a deal may leave it. */
  exitCriteria: { type: String, trim: true, maxlength: 200 },
});

stageSchema.pre('validate', function oneTerminalFlag(next) {
  if (this.isWon && this.isLost) {
    next(new Error(`Stage "${this.name}" cannot be both won and lost`));
    return;
  }
  next();
});

const pipelineSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },

    /** The one new deals land in when none is named. Exactly one pipeline
     *  carries this — enforced by the service, which clears it elsewhere. */
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },

    stages: {
      type: [stageSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2,
        message: 'A pipeline needs at least two stages',
      },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/**
 * A pipeline with no way to finish is a trap: deals enter it and can never be
 * closed, so they sit in the forecast forever. Checked here rather than left
 * to whoever builds the admin screen.
 */
pipelineSchema.pre('validate', function needsTerminalStages(next) {
  if (!this.stages?.length) { next(); return; }
  if (!this.stages.some((s) => s.isWon)) {
    next(new Error('A pipeline needs a stage marked as won'));
    return;
  }
  if (!this.stages.some((s) => s.isLost)) {
    next(new Error('A pipeline needs a stage marked as lost'));
    return;
  }
  next();
});

/** Stages in display order — the board's column order, resolved once here so
 *  no caller has to remember to sort. */
pipelineSchema.methods.orderedStages = function orderedStages() {
  return [...this.stages].sort((a, b) => a.order - b.order);
};

export const Pipeline = model('Pipeline', pipelineSchema);
export default Pipeline;
