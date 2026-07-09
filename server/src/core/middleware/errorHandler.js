import mongoose from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../../config/logger.js';
import { config } from '../../config/index.js';

/**
 * Convert any thrown value into an ApiError so the response shape is uniform.
 * Handles the Mongoose/JWT errors we expect at the edge.
 */
function normalizeError(err) {
  if (err instanceof ApiError) return err;

  // Mongoose validation
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest('Validation failed', { details, code: 'VALIDATION_ERROR' });
  }

  // Bad ObjectId etc.
  if (err instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`Invalid value for "${err.path}"`, { code: 'CAST_ERROR' });
  }

  // Duplicate key
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return ApiError.conflict(`Duplicate value for "${field}"`, {
      code: 'DUPLICATE_KEY',
      details: err.keyValue,
    });
  }

  // JWT
  if (err && err.name === 'JsonWebTokenError') {
    return ApiError.unauthorized('Invalid token', { code: 'INVALID_TOKEN' });
  }
  if (err && err.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Token expired', { code: 'TOKEN_EXPIRED' });
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
  const logMeta = { method: req.method, url: req.originalUrl, statusCode: error.statusCode };
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
  };
  if (!config.isProd && error.statusCode >= 500) body.stack = err.stack;

  res.status(error.statusCode).json(body);
};

export default errorHandler;
