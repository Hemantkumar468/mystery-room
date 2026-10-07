import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  newGameService, myStepsOn, DONE_STEPS, ASSIGNABLE_STEPS,
} from './newGame.service.js';
import { config } from '../../config/index.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { validate } from '../../core/middleware/validate.js';
import { authenticate } from '../../core/middleware/auth.js';
import { requireAccess } from '../../core/middleware/access.js';
import { accessService } from '../access/access.service.js';
import { ACCESS } from '../../core/constants/access.js';
import { tz } from '../../core/utils/opsTime.js';

/**
 * /new-games — the New Games Creation FMS.
 *
 * THREE GATES, ASKING THREE DIFFERENT QUESTIONS, and a write has to pass all
 * of them:
 *
 *   module  — may this person open New Games at all?
 *   step    — may their seat ever do THIS job? Pricing a BOQ and approving
 *             one are deliberately different jobs; before the step surfaces
 *             existed they were one grant, so anybody who could file a BOQ
 *             could also sign it off. Set on Settings → Access Control.
 *   doer    — is it their turn? `newGame.service`'s `mustBeDoer` checks the
 *             person is assigned to that step, or manages the module.
 *
 * The step gate is the one that is a decision of the BUSINESS; the doer check
 * is a property of the workflow. Neither substitutes for the other: assigning
 * somebody cannot grant them a job their seat is not allowed to hold, and
 * holding the job does not put someone else's task on your desk.
 *
 * Assigning people stays MANAGE on the module — handing out work is a
 * manager's call whichever step it is for.
 *
 * …OR HOLDING THE TASK. Somebody a manager assigned to a step passes the
 * first two gates for THAT step of THAT game, whatever their seat says —
 * the rule a project doer already works under (access.catalog.js, the
 * DOER_FLOOR note). A seatless Employee's access is their own queue and
 * nothing else; this step is in that queue, and refusing it sent the task's
 * link from My Tasks straight back to My Tasks. The doer check still runs,
 * and the board, the indent and the assigning stay behind the module.
 */
const router = Router();
router.use(authenticate);
const MODULE = 'module:new-games';
const edit = requireAccess(MODULE, ACCESS.EDIT);

/** Work on one step of the flow. `ng-boq`, `ng-check`, … — see access.catalog.js. */
const onStep = (key, level = ACCESS.EDIT) => requireAccess(`step:ng-${key}`, level);

/**
 * Every grant in `keys`, or one of `held` among the steps this person holds
 * on the game in the URL (or `?game=`). `held` is a list of step keys, a
 * function of the request, or 'any'. Refused in the access gate's own words.
 */
const accessOrHeld = (keys, held) => async (req, res, next) => {
  try {
    const ok = await Promise.all(keys.map(([key, level]) => accessService.allows(req.user, key, level)));
    if (ok.every(Boolean)) return next();
    const gameId = req.params.id || req.query?.game;
    if (gameId) {
      const want = typeof held === 'function' ? held(req) : held;
      const mine = await myStepsOn(gameId, req.user);
      if (mine.some((k) => want === 'any' || want.includes(k))) return next();
    }
    const [key, level] = keys[ok.indexOf(false)];
    return requireAccess(key, level)(req, res, next);
  } catch (err) {
    return next(err);
  }
};

/** Read one game: the module, or any step of it. */
const readGame = accessOrHeld([[MODULE, ACCESS.VIEW]], 'any');
/** Work one step: the module and the step at Can work, or holding that step. */
const workStep = (key) => accessOrHeld([[MODULE, ACCESS.EDIT], [`step:ng-${key}`, ACCESS.EDIT]], [key]);

/**
 * The same gate for a route whose step is in the URL (`/steps/:step/done`).
 *
 * Built per request because the surface is not known until the path is read.
 * The step name is validated by zod on the way through, but this runs BEFORE
 * validation, so it checks the name against the catalogue itself rather than
 * trusting the parameter — an unknown surface resolves to ALLOWED, so passing
 * `step:ng-../../whatever` to the resolver would be a way to skip the gate.
 */
const onUrlStep = () => (req, res, next) => {
  const key = String(req.params.step || '');
  if (!DONE_STEPS.includes(key)) return next(ApiError.badRequest('That step is not finished by hand.'));
  return workStep(key)(req, res, next);
};

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
  /* A task's own game (`?game=`) opens for whoever holds a step of it; the
     whole board is the module's. */
  readGame,
  validate(z.object({
    query: z.object({
      status: z.enum(['active', 'complete', 'all']).optional(),
      q: z.string().max(120).optional(),
      location: z.string().max(160).optional(),
      /* The filters: the step the table shows (its states and people are
         what `state` and `person` are read against), and one game for the
         task views that open the FMS on a single game. */
      step: z.enum(['indent', 'video', 'boq', 'check', 'order', 'assemble', 'testing']).optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      state: z.enum(['ready', 'late', 'waiting', 'done']).optional(),
      person: objectId.optional(),
      game: objectId.optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  })),
  asyncHandler(async (req, res) => {
    const {
      status = 'active', q = '', location = 'all', page = 1, limit = 25, step, priority, state, person, game,
    } = req.validatedQuery || req.query;
    const data = await newGameService.list({
      status, q, location, page: Number(page), limit: Number(limit), step, priority, state, person, game,
    }, req.user);
    return ApiResponse.ok(res, data, `${data.total} game(s)`);
  }),
);

router.get('/people', requireAccess(MODULE), asyncHandler(async (_req, res) => ApiResponse.ok(res, await newGameService.people())));

router.get('/:id', readGame, validate(z.object({ params: idParam })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.get(req.params.id, req.user))
)));

/* ── Step 1 · the indent ────────────────────────────────────────────────── */

router.post('/', edit, onStep('indent'), validate(z.object({ body: gameBody })), asyncHandler(async (req, res) => {
  const game = await newGameService.create(req.body, req.user);
  return ApiResponse.created(res, game, `${game.code} filed — the FMS has started for ${game.name}`);
}));

router.patch('/:id', edit, onStep('indent'), validate(z.object({ params: idParam, body: gameBody.partial() })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.update(req.params.id, req.body, req.user), 'Indent updated')
)));

/* ── Step 2 · watched ───────────────────────────────────────────────────── */

router.post('/:id/watch', workStep('video'), validate(z.object({ params: idParam })), asyncHandler(async (req, res) => (
  ApiResponse.ok(res, await newGameService.watch(req.params.id, req.user), 'Marked as watched')
)));

/* ── Steps 3 & 4 · BOQs ─────────────────────────────────────────────────── */

router.post('/:id/boqs', workStep('boq'), validate(z.object({ params: idParam, body: boqBody })), asyncHandler(async (req, res) => (
  ApiResponse.created(res, await newGameService.addBoq(req.params.id, req.body, req.user), 'BOQ added — it is waiting for the check')
)));

router.patch(
  '/:id/boqs/:boqId',
  workStep('boq'),
  validate(z.object({ params: z.object({ id: objectId, boqId: objectId }), body: boqBody.partial() })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.updateBoq(req.params.id, req.params.boqId, req.body, req.user), 'BOQ saved')
  )),
);

router.delete(
  '/:id/boqs/:boqId',
  workStep('boq'),
  validate(z.object({ params: z.object({ id: objectId, boqId: objectId }) })),
  asyncHandler(async (req, res) => (
    ApiResponse.ok(res, await newGameService.removeBoq(req.params.id, req.params.boqId, req.user), 'BOQ removed')
  )),
);

router.post(
  '/:id/boqs/:boqId/decision',
  /* Can-work on Step 4, not Full control. The step row is what keeps the BOQ
     maker and the BOQ checker apart (they are separate surfaces), and
     `mustBeDoer` in the service keeps the decision to the checker assigned to
     the game or a manager. Asking for Full control here could never be met by
     an employee checker: a step is clamped to its module, so it would mean
     handing them management of the whole FMS to let them approve a BOQ. */
  workStep('check'),
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
  onUrlStep(),
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
  onStep('order', ACCESS.MANAGE),
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
