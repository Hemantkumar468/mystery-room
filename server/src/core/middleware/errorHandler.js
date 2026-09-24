import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../../config/logger.js';
import { config } from '../../config/index.js';
import { routeOf } from './httpLogger.js';
import { fieldLabel, plainMongooseIssue } from '../utils/plainErrors.js';

/**
 * Convert any thrown value into an ApiError so the response shape is uniform.
 * Handles the Mongoose/JWT errors we expect at the edge.
 */
function normalizeError(err) {
  if (err instanceof ApiError) return err;

  // Mongoose validation
  if (err instanceof mongoose.Error.ValidationError) {
    const lines = [...new Set(Object.values(err.errors).map(plainMongooseIssue))];
    const technical = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest(
      lines.length === 1 ? lines[0] : `${lines.length} of the details sent were not accepted.`,
      { details: lines.length === 1 ? undefined : lines, technical, code: 'VALIDATION_ERROR' },
    );
  }

  // Bad ObjectId etc.
  if (err instanceof mongoose.Error.CastError) {
    /* Almost always a bad id in a URL - a stale bookmark, a deleted row, a
       link someone edited. "Invalid value for _id" names the column; this
       names what it means for the person looking at it. */
    return ApiError.badRequest(
      `${fieldLabel(err.path)} is not something we recognise - the link may be out of date.`,
      { code: 'CAST_ERROR', technical: { field: err.path, value: err.value } },
    );
  }

  // Duplicate key
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`That ${fieldLabel(field).toLowerCase()} is already in use.`, {
      code: 'DUPLICATE_KEY',
      technical: err.keyValue,
    });
  }

  // JWT
  if (err && err.name === 'JsonWebTokenError') {
    return ApiError.unauthorized('Your sign-in is no longer valid. Please sign in again.', { code: 'INVALID_TOKEN' });
  }
  if (err && err.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Your session has timed out. Please sign in again.', { code: 'TOKEN_EXPIRED' });
  }

  // Fallback: unexpected → 500, hide internals
  return new ApiError(
    err?.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
    err?.message || 'Internal server error',
    { isOperational: false },
  );
}

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  const error = normalizeError(err);

  // Log server-side faults with full context; client faults at a lower level.
  const logMeta = {
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    route: routeOf(req),   // the same aggregation key the access line uses
    statusCode: error.statusCode,
    code: error.code,
    userId: req.user?.id,
    user: req.user?.email,
    ip: req.ip,
  };
  if (error.statusCode >= 500 || !error.isOperational) {
    logger.error(error.message, { ...logMeta, stack: err.stack });
  } else {
    logger.warn(`${error.statusCode} ${error.message}`, logMeta);
  }

  const body = {
    success: false,
    message: error.statusCode >= 500 && config.isProd ? 'Something went wrong' : error.message,
    code: error.code,
    details: error.details,
    /* Handed back so a user reporting "it failed" can quote one short id, and
       that id finds the exact request in the log. A generic "Something went
       wrong" with nothing to trace is what makes production faults expensive. */
    requestId: req.id,
  };
  if (!config.isProd && error.statusCode >= 500) body.stack = err.stack;

  res.status(error.statusCode).json(body);
};

export default errorHandler;
