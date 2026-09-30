import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { newGameService, DONE_STEPS, ASSIGNABLE_STEPS } from './newGame.service.js';
import { config } from '../../config/index.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireAccess } from '../../core/middleware/access.js';
import { ACCESS } from '../../core/constants/access.js';
import { tz } from '../../core/utils/opsTime.js';

/**
 * /new-games — the New Games Creation FMS.
 *
 * Reading needs the module; every write needs EDIT on it, and the service
 * then checks the person is assigned to that step (or can manage the module).
 * Assigning people is MANAGE — handing out work is a manager's call.
 */
const router = Router();
router.use(authenticate);
router.use(requireAccess('module:new-games'));
const edit = requireAccess('module:new-games', ACCESS.EDIT);

const objectId = z.string().length(24);
const idParam = z.object({ id: objectId });
const file = z.object({ url: z.string().min(1).max(600), name: z.string().max(260).optional(), size: z.number().optional() });
const num = (max) => z.union([z.number().min(0).max(max), z.literal(''), z.null()]).optional();

const gameBody = z.object({
  name: z.string().trim().min(1, 'Give the game a name').max(120),
  concept: z.string().max(4000).nullable().optional(),
  playersMin: num(100),
  playersMax: num(100),
  durationMinutes: num(600),
  location: z.string().max(160).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  watchBy: z.string().max(40).optional(),
  videoLinks: z.array(z.string().trim().url('A video link must be a full web address (https://…)').max(600)).max(10).optional(),
  videoFiles: z.array(file).max(10).optional(),
  watchers: z.array(objectId).max(50).optional(),
});

const boqBody = z.object({
  name: z.string().trim().min(1, 'Name the BOQ').max(160),
  category: z.string().max(60).nullable().optional(),
  leadTimeDays: num(365),
  deadline: z.string().max(40).nullable().optional(),
  estimatedCost: num(1e10),
  items: z.string().max(4000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  files: z.array(file).max(10).optional(),
});

/* ── the indent's files — every video type and every document, up to 200 MB ──
   Larger than the general /files limit, because reference videos are. The
   list is wide on purpose (any video, office documents, PDFs, images, audio,
   archives) but still a list: a page type (.html, .svg, .js) served from the
   API's own origin would be a stored script, so those never get in. */
const VIDEO_MAX_MB = 200;
const VIDEO_EXT = new Set([
  '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv', '.wmv', '.flv', '.3gp', '.3g2', '.mpeg', '.mpg', '.ogv', '.ts', '.mts', '.m2ts', '.vob',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.odp',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tif', '.tiff',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.zip', '.rar', '.7z',
]);
const uploadRoot = path.resolve(process.cwd(), config.uploads.dir);
const videoUpload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(uploadRoot, tz().format('YYYY-MM'));
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename(_req, f, cb) {
      cb(null, `${nanoid(21)}${path.extname(f.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: VIDEO_MAX_MB * 1024 * 1024, files: 5 },
  fileFilter(_req, f, cb) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (!VIDEO_EXT.has(ext)) return cb(ApiError.badRequest(`${ext || 'That file'} is not a video or document this form takes — paste a YouTube / Drive link instead`));
    return cb(null, true);
  },
});

router.post(
  '/upload',
  edit,
  (req, res, next) => videoUpload.array('files', 5)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(ApiError.badRequest(err.code === 'LIMIT_FILE_SIZE'
        ? `The file is over ${VIDEO_MAX_MB} MB — upload it to YouTube or Drive and paste the link instead`
        : err.message));
    }
    return next(err);
  }),
  asyncHandler(async (req, res) => {
    if (!req.files?.length) throw ApiError.badRequest('No file received');
    const base = `${config.apiPrefix}/files/raw`;
    const files = req.files.map((f) => ({
      url: `${base}/${path.relative(uploadRoot, f.path).split(path.sep).join('/')}`,
      name: f.originalname,
      size: f.size,
    }));
    return ApiResponse.created(res, files, `${files.length} file(s) uploaded`);
  }),
);

/* ── reads ──────────────────────────────────────────────────────────────── */

router.get(
  '/',
  validate(z.object({
    query: z.object({
      status: z.enum(['active', 'complete', 'all']).optional(),
      q: z.string().max(120).optional(),
      location: z.string().max(160).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  })),
  asyncHandler(async (req, res) => {
    const { status = 'active', q = '', location = 'all', page = 1, limit = 25 } = req.validatedQuery || req.query;
    const data = await newGameService.list({ status, q, location, page: Number(page), limit: Number(limit) });
    return ApiResponse.ok(res, data, `${data.total} game(s)`);
  }),
);

router.get('/people', asyncHandler(async (_req, res) => ApiResponse.ok(res, await newGameService.people())));

router.get('/:id', validate(z.object({ params: idParam })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.get(req.params.id))
)));

/* ── Step 1 · the indent ────────────────────────────────────────────────── */

router.post('/', edit, validate(z.object({ body: gameBody })), asyncHandler(async (req, res) => {
  const game = await newGameService.create(req.body, req.user);
  return ApiResponse.created(res, game, `${game.code} filed — the FMS has started for ${game.name}`);
}));

router.patch('/:id', edit, validate(z.object({ params: idParam, body: gameBody.partial() })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.update(req.params.id, req.body, req.user), 'Indent updated')
)));

/* ── Step 2 · watched ───────────────────────────────────────────────────── */

router.post('/:id/watch', edit, validate(z.object({ params: idParam })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.watch(req.params.id, req.user), 'Marked as watched')
)));

/* ── Steps 3 & 4 · BOQs ─────────────────────────────────────────────────── */

router.post('/:id/boqs', edit, validate(z.object({ params: idParam, body: boqBody })), asyncHandler(async (req, res) => (
  ApiResponse.created(res, await newGameService.addBoq(req.params.id, req.body, req.user), 'BOQ added — it is waiting for the check')
)));

router.patch(
  '/:id/boqs/:boqId',
  edit,
  validate(z.object({ params: z.object({ id: objectId, boqId: objectId }), body: boqBody.partial() })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.updateBoq(req.params.id, req.params.boqId, req.body, req.user), 'BOQ saved')
  )),
);

router.delete(
  '/:id/boqs/:boqId',
  edit,
  validate(z.object({ params: z.object({ id: objectId, boqId: objectId }) })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.removeBoq(req.params.id, req.params.boqId, req.user), 'BOQ removed')
  )),
);

router.post(
  '/:id/boqs/:boqId/decision',
  edit,
  validate(z.object({
    params: z.object({ id: objectId, boqId: objectId }),
    body: z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().max(1000).optional() }),
  })),
  asyncHandler(async (req, res) => {
    const game = await newGameService.decideBoq(req.params.id, req.params.boqId, req.body, req.user);
    return ApiResponse.ok(res, game, req.body.decision === 'approve' ? 'BOQ approved' : 'BOQ rejected — sent back to the BOQ maker');
  }),
);

/* ── Steps 3, 5–9 · done, and who does them ─────────────────────────────── */

router.post(
  '/:id/steps/:step/done',
  edit,
  validate(z.object({
    params: z.object({ id: objectId, step: z.enum(DONE_STEPS) }),
    body: z.object({ note: z.string().max(2000).optional() }).optional(),
  })),
  asyncHandler(async (req, res) => {
    const game = await newGameService.completeStep(req.params.id, req.params.step, req.body || {}, req.user);
    return ApiResponse.ok(res, game, game.status === 'complete'
      ? `${game.name} is finished — added to the Games master`
      : 'Step completed');
  }),
);

/* A manager's retry, should the automatic hand-off to Purchase have failed. */
router.post(
  '/:id/send-to-purchase',
  requireAccess('module:new-games', ACCESS.MANAGE),
  validate(z.object({ params: idParam })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.sendToPurchase(req.params.id, req.user), 'Sent to the Purchase FMS — the BOQs are at Vendor finalisation')
  )),
);

router.put(
  '/:id/steps/:step/assign',
  requireAccess('module:new-games', ACCESS.MANAGE),
  validate(z.object({
    params: z.object({ id: objectId, step: z.enum(ASSIGNABLE_STEPS) }),
    body: z.object({ doers: z.array(objectId).max(50) }),
  })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.assign(req.params.id, req.params.step, req.body.doers, req.user), 'Assigned')
  )),
);

export default router;
