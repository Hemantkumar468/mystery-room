import multer from 'multer';
import { ApiError } from '../utils/ApiError.js';

/**
 * In-memory upload middleware. Files are held as buffers (never written to
 * local disk) and streamed straight to S3 by the service layer.
 *
 * Size policy (no prior convention beyond a flat 10 MB): videos up to 50 MB,
 * audio up to 20 MB, everything else (images/documents/archives) up to 10 MB.
 * Multer's own limit is the largest of the three; the tighter per-type caps
 * are enforced afterwards by `enforceTypeSizeLimits` once size is known.
 */
const MB = 1024 * 1024;
const DEFAULT_MAX = 10 * MB; // images, documents, archives
const AUDIO_MAX = 20 * MB;
const VIDEO_MAX = 50 * MB;

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska',
]); // .mp4 .mov .webm .avi .mkv
const AUDIO_MIME = new Set([
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
  'audio/webm', // MediaRecorder's default output in Chrome/Firefox (in-browser mic recording)
]); // .mp3 .wav .m4a .aac .ogg .webm
const DOC_MIME = new Set([
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-powerpoint', // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'text/plain', // .txt
  'text/csv', // .csv
]);
const ARCHIVE_MIME = new Set([
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.rar', 'application/x-rar-compressed',
]); // .zip .rar
const ALLOWED_MIME = new Set([
  ...IMAGE_MIME, ...VIDEO_MIME, ...AUDIO_MIME, ...DOC_MIME, ...ARCHIVE_MIME,
]);

const isVideo = (mimetype) => VIDEO_MIME.has(mimetype);
const isAudio = (mimetype) => AUDIO_MIME.has(mimetype);

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    return cb(ApiError.badRequest(`Unsupported file type: ${file.mimetype}`));
  },
});

/**
 * Wrap a multer handler so its errors become ApiErrors — keeping the global
 * error handler's response shape uniform (e.g. file-too-large → 400, not 500).
 */
function withMulterErrors(handler) {
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE'
            ? `File is too large (max ${VIDEO_MAX / MB} MB)`
            : err.message;
        return next(ApiError.badRequest(message, { code: err.code }));
      }
      return next(err); // already an ApiError (from fileFilter) or unknown
    });
}

/**
 * Enforce the per-type cap after multer has the file: videos up to 50 MB,
 * audio up to 20 MB, everything else up to 10 MB. Runs right after `uploadSingle`.
 */
export const enforceTypeSizeLimits = (req, _res, next) => {
  const file = req.file;
  if (!file) return next();
  const max = isVideo(file.mimetype) ? VIDEO_MAX : isAudio(file.mimetype) ? AUDIO_MAX : DEFAULT_MAX;
  if (file.size > max) {
    const kind = isVideo(file.mimetype) ? 'videos' : isAudio(file.mimetype) ? 'audio' : 'this file type';
    return next(ApiError.badRequest(`File is too large (max ${max / MB} MB for ${kind})`));
  }
  return next();
};

/** Same per-type cap as `enforceTypeSizeLimits`, applied to every file in `req.files` (array upload). */
export const enforceTypeSizeLimitsMulti = (req, _res, next) => {
  const files = req.files;
  if (!files?.length) return next();
  for (const file of files) {
    const max = isVideo(file.mimetype) ? VIDEO_MAX : isAudio(file.mimetype) ? AUDIO_MAX : DEFAULT_MAX;
    if (file.size > max) {
      const kind = isVideo(file.mimetype) ? 'videos' : isAudio(file.mimetype) ? 'audio' : 'this file type';
      return next(ApiError.badRequest(`"${file.originalname}" is too large (max ${max / MB} MB for ${kind})`));
    }
  }
  return next();
};

/** Accept a single file under the given form field name. */
export const uploadSingle = (field) => withMulterErrors(multerUpload.single(field));

/** Accept up to `maxCount` files under the given form field name. */
export const uploadMultiple = (field, maxCount) => withMulterErrors(multerUpload.array(field, maxCount));

export default multerUpload;
