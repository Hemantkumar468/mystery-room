import mongoose from 'mongoose';
import { attachTenancy } from '../../core/tenancy/tenancy.js';

const { Schema, model } = mongoose;

/**
 * NEW GAMES CREATION FMS — one document per game being built.
 *
 * A franchise is sold on its games: people come for rooms they cannot play
 * anywhere else. When the MD (or anyone) finds an idea worth building, it is
 * filed here as an INDENT and walks nine steps — video, BOQ, check, order,
 * hardware & software, assemble, testing, quality — until it joins the Games
 * master (pms/games) and any franchise, new or existing, can add it.
 *
 * It is not project data: a game is built once, centrally, and outlives every
 * launch that installs it. So it has its own collection rather than riding on
 * a project, and its work reaches My Tasks through newGame.service#tasksFor
 * (task.service merges it in) instead of through the Task model, which is
 * bound to a project.
 *
 * Step state is stored as facts (who watched when, which BOQ was approved when,
 * when a step was marked done and by whom). Plan dates and statuses are
 * DERIVED from those facts on every read (newGame.service#shape), so they can
 * never disagree with them.
 */

const fileSchema = new Schema({
  url: { type: String, required: true },
  name: { type: String, trim: true },
  size: { type: Number },
}, { _id: false });

/** One person's "I have watched it" — a row of Step 2. */
const watchSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, required: true },
}, { _id: false });

/**
 * One BOQ. A game has several — electronics, furniture, props — each with its
 * own lead time, because the longest lead time is what dates Step 5.
 */
const boqSchema = new Schema({
  seq: { type: Number, required: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  category: { type: String, trim: true, maxlength: 60 },
  leadTimeDays: { type: Number, min: 0, max: 365 },
  deadline: { type: Date },
  estimatedCost: { type: Number, min: 0 },
  items: { type: String, trim: true, maxlength: 4000 },
  notes: { type: String, trim: true, maxlength: 2000 },
  files: [fileSchema],
  status: { type: String, enum: ['submitted', 'approved', 'rejected'], default: 'submitted' },
  reason: { type: String, trim: true, maxlength: 1000 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  decidedAt: { type: Date },
}, { timestamps: true });

/** A step's own facts: who it is assigned to for THIS game, and when it was done. */
const stepSchema = new Schema({
  /* Empty means "whoever FMS · Assign Work names for the step" — resolved on
     read, so assigning the job there reaches games already running. */
  doers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  assignedAt: { type: Date },
  doneAt: { type: Date },
  doneBy: { type: Schema.Types.ObjectId, ref: 'User' },
  note: { type: String, trim: true, maxlength: 2000 },
}, { _id: false });

const newGameSchema = new Schema(
  {
    seq: { type: Number, required: true },
    code: { type: String, required: true, trim: true },

    /* ── Step 1 · the indent form — kept to what the flow needs ─────── */
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, trim: true, maxlength: 60 },
    concept: { type: String, trim: true, maxlength: 4000 },
    playersMin: { type: Number, min: 0, max: 100 },
    playersMax: { type: Number, min: 0, max: 100 },
    durationMinutes: { type: Number, min: 0, max: 600 },
    location: { type: String, trim: true, maxlength: 160 },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'high' },
    indentDate: { type: Date, required: true },
    /** The watch-by date and time — Step 2's plan, chosen on the indent. */
    watchBy: { type: Date },
    videoLinks: [{ type: String, trim: true, maxlength: 600 }],
    videoFiles: [fileSchema],

    /* ── Step 2 · the people who must watch, and who has ───────────────── */
    watchers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    watched: [watchSchema],

    /* ── Steps 3–7 ────────────────────────────────────────────────────── */
    boqs: [boqSchema],
    steps: {
      boq: { type: stepSchema, default: () => ({}) },
      check: { type: stepSchema, default: () => ({}) },
      order: { type: stepSchema, default: () => ({}) }, // assignedAt only; the lines live in the Purchase FMS
      assemble: { type: stepSchema, default: () => ({}) },
      testing: { type: stepSchema, default: () => ({}) },
      video: { type: stepSchema, default: () => ({}) }, // assignedAt only; the rows are `watched`
    },

    /* ── Step 5 · the host project the Purchase FMS runs this game's lines on ── */
    purchaseProject: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    /** Set for the moment the purchasing is being opened — the claim that stops a double open. */
    purchaseOpening: { type: Boolean },

    status: { type: String, enum: ['active', 'complete', 'cancelled'], default: 'active', index: true },
    completedAt: { type: Date },
    /** The Games master row this game became, once Quality test is done. */
    masterGame: { type: Schema.Types.ObjectId, ref: 'Game' },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

newGameSchema.index({ status: 1, indentDate: -1 });
newGameSchema.index({ watchers: 1, status: 1 });

attachTenancy(newGameSchema, { modelName: 'NewGame' });

/* Numbered per company: NG-001, NG-002 … Declared after the tenancy plugin so
   it carries `tenant` explicitly (the plugin leaves unique indexes alone). */
newGameSchema.index({ tenant: 1, seq: 1 }, { unique: true });

export const NewGame = model('NewGame', newGameSchema);
export default NewGame;
