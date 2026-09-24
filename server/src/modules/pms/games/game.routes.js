import { Router } from 'express';
import { z } from 'zod';
import { Game } from './game.model.js';
import { asyncHandler } from '../../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../../core/utils/ApiResponse.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE } from '../../../core/constants/index.js';

/**
 * The game catalogue — a master, not project data.
 *
 * READING is open to any signed-in user, because the pickers need it: Phase 3B
 * chooses an outlet's games and Phase 10 installs them, and the people doing
 * both are ordinary doers. WRITING is manager-and-above, like every other
 * master in the system: one bad edit here changes what every future project
 * can offer.
 */
const layout = z.object({
  label: z.string().max(60).optional(),
  areaSqft: z.number().min(0).nullable().optional(),
  pdfUrl: z.string().max(600).nullable().optional(),
  dwgUrl: z.string().max(600).nullable().optional(),
});

const body = z.object({
  code: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(120),
  minAreaSqft: z.number().min(0).nullable().optional(),
  maxAreaSqft: z.number().min(0).nullable().optional(),
  layouts: z.array(layout).max(20).optional(),
  extraDrawings: z.array(z.string().max(600)).max(20).optional(),
  category: z.string().max(60).nullable().optional(),
  durationMinutes: z.number().min(0).nullable().optional(),
  playersMin: z.number().min(0).nullable().optional(),
  playersMax: z.number().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
});

const idParam = z.object({ params: z.object({ id: z.string().length(24) }) });
const createSchema = z.object({ body });
const updateSchema = z.object({ params: z.object({ id: z.string().length(24) }), body: body.partial() });

/** "School of magic" → "school-of-magic". */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const router = Router();
const canManage = authorize(...CAN_MANAGE);
router.use(authenticate);

/**
 * Every game, smallest first — the order someone fitting games into a floor
 * plan actually wants. `?all=1` includes retired ones (the Games page needs
 * them; the pickers do not).
 */
router.get('/', asyncHandler(async (req, res) => {
  const filter = req.query.all === '1' ? {} : { active: { $ne: false } };
  const games = await Game.find(filter).sort({ minAreaSqft: 1, name: 1 });
  return ApiResponse.ok(res, games, 'Games fetched');
}));

router.post('/', canManage, validate(createSchema), asyncHandler(async (req, res) => {
  const code = req.body.code || slug(req.body.name);
  if (await Game.findOne({ $or: [{ code }, { name: req.body.name.trim() }] })) {
    throw ApiError.badRequest(`A game called "${req.body.name}" already exists.`, { code: 'GAME_EXISTS' });
  }
  const game = await Game.create({ ...req.body, code, createdBy: req.user.id, updatedBy: req.user.id });
  return ApiResponse.created(res, game, 'Game added');
}));

router.patch('/:id', canManage, validate(updateSchema), asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) throw ApiError.notFound('Game not found');
  // Renaming leaves `code` alone on purpose: projects already reference the
  // game and a shifting key would orphan them. The name is what people read.
  Object.assign(game, req.body, { updatedBy: req.user.id });
  await game.save();
  return ApiResponse.ok(res, game, 'Game updated');
}));

/**
 * Retire, never delete. Projects that ran this game must keep reading
 * correctly; it simply stops being offered on new ones.
 */
router.delete('/:id', canManage, validate(idParam), asyncHandler(async (req, res) => {
  const game = await Game.findById(req.params.id);
  if (!game) throw ApiError.notFound('Game not found');
  game.active = false;
  game.updatedBy = req.user.id;
  await game.save();
  return ApiResponse.ok(res, game, 'Game retired — existing projects keep it');
}));

export default router;
