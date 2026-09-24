import path from 'node:path';
import fs from 'node:fs';
import express, { Router } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { config } from '../../config/index.js';
import { authenticate, authorize } from '../../core/middleware/auth.js';
import { asyncHandler } from '../../core/utils/asyncHandler.js';
import { ApiResponse } from '../../core/utils/ApiResponse.js';
import { ApiError } from '../../core/utils/ApiError.js';
import { ROLES } from '../../core/constants/index.js';
import { tz } from '../../core/utils/opsTime.js';

/**
 * Evidence, proof-of-completion, reference documents and voice notes.
 *
 * Files land on local disk under UPLOAD_DIR/<yyyy-mm>/ with an unguessable
 * name and are served back read-only from /files/raw. Only document, image,
 * audio and video types are accepted — nothing a browser would execute.
 */
const uploadRoot = path.resolve(process.cwd(), config.uploads.dir);
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

const ALLOWED_EXT = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic',
  '.mp3', '.m4a', '.wav', '.ogg', '.webm', '.aac',
  '.mp4', '.mov',
  '.zip',
]);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(uploadRoot, tz().format('YYYY-MM'));
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${nanoid(21)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 10 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(ApiError.badRequest(`File type ${ext || '(none)'} is not allowed`));
    return cb(null, true);
  },
});

const router = Router();

// Stored files are public-by-link (the name is a 21-char random id), which lets
// <img>/<audio>/<a> tags load them without an auth header.
router.use(
  '/raw',
  express.static(uploadRoot, {
    index: false,
    fallthrough: false,
    maxAge: '7d',
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

router.post(
  '/',
  authenticate,
  authorize(ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTOR),
  (req, res, next) =>
    upload.array('files', 10)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `File exceeds ${Math.round(config.uploads.maxBytes / 1048576)} MB` : err.message;
        return next(ApiError.badRequest(msg));
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
      mimeType: f.mimetype,
    }));
    return ApiResponse.created(res, files, `${files.length} file(s) uploaded`);
  }),
);

export default router;
