import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One approved layout of a game: the area it needs and its drawings.
 *
 * A game is not one fixed size. "Forgotten" has an approved 532 sq ft plan and
 * a 716 sq ft plan, each with its own PDF and DWG, so a site with an awkward
 * shell can still take the game on the layout that fits. Modelling only a
 * single area would have thrown that away and made the master less useful than
 * the spreadsheet it came from.
 */
const layoutSchema = new Schema({
  label: { type: String, default: 'Option 1' },
  areaSqft: { type: Number, min: 0 },
  // Links are stored as given (Google Drive today). One DWG in the source is a
  // bare filename rather than a URL; it is kept as-is and shown as plain text.
  pdfUrl: { type: String },
  dwgUrl: { type: String },
}, { _id: false });

/**
 * A game in the Mystery Rooms catalogue — the master Phase 3B picks from and
 * Phase 10 installs. Seeded from SHEET/Games list with area requirement.xlsx
 * (see seed/gamesMaster.js) and maintained on the Games page thereafter.
 */
const gameSchema = new Schema(
  {
    // Stable machine key ("school-of-magic"). Projects store the game's NAME,
    // which people read and can correct; the code is for joins and imports.
    code: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, unique: true, trim: true, maxlength: 120 },

    /** The smallest approved layout — what space planning asks for. */
    minAreaSqft: { type: Number, min: 0 },
    /** The sheet's stated maximum for the game. */
    maxAreaSqft: { type: Number, min: 0 },

    layouts: [layoutSchema],
    /** Drawings the sheet lists under a game without their own area. */
    extraDrawings: [{ type: String }],

    /** Free grouping ("Horror", "Adventure") — unused by the flow, for filtering. */
    category: { type: String, trim: true },
    durationMinutes: { type: Number, min: 0 },
    playersMin: { type: Number, min: 0 },
    playersMax: { type: Number, min: 0 },
    notes: { type: String },

    /* Retired games stay in the database so old projects still read correctly;
       they simply stop being offered on new ones. Deleting would rewrite
       history — a launch that ran "Mummy" in 2024 still ran it. */
    active: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/** "444 – 450 sq ft", or a single figure when both ends agree. */
gameSchema.virtual('areaLabel').get(function areaLabel() {
  const { minAreaSqft: min, maxAreaSqft: max } = this;
  if (min == null && max == null) return '';
  if (min == null || max == null || min === max) return `${(max ?? min).toLocaleString('en-IN')} sq ft`;
  return `${min.toLocaleString('en-IN')} – ${max.toLocaleString('en-IN')} sq ft`;
});

export const Game = model('Game', gameSchema);
export default Game;
