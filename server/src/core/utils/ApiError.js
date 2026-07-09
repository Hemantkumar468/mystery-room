import { StatusCodes, ReasonPhrases } from 'http-status-codes';

/**
 * Operational error with an HTTP status. Anything thrown as an ApiError is
 * "expected" and safe to surface to the client; everything else is treated as
 * an unexpected 500 by the global error handler.
 */
export class ApiError extends Error {
  constructor(statusCode, message, { details, code, isOperational = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details; // e.g. field-level validation issues
    this.code = code; // optional machine-readable code
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = ReasonPhrases.BAD_REQUEST, opts) {
    return new ApiError(StatusCodes.BAD_REQUEST, message, opts);
  }
  static unauthorized(message = ReasonPhrases.UNAUTHORIZED, opts) {
    return new ApiError(StatusCodes.UNAUTHORIZED, message, opts);
  }
  static forbidden(message = ReasonPhrases.FORBIDDEN, opts) {
    return new ApiError(StatusCodes.FORBIDDEN, message, opts);
  }
  static notFound(message = ReasonPhrases.NOT_FOUND, opts) {
    return new ApiError(StatusCodes.NOT_FOUND, message, opts);
  }
  static conflict(message = ReasonPhrases.CONFLICT, opts) {
    return new ApiError(StatusCodes.CONFLICT, message, opts);
  }
  static unprocessable(message = ReasonPhrases.UNPROCESSABLE_ENTITY, opts) {
    return new ApiError(StatusCodes.UNPROCESSABLE_ENTITY, message, opts);
  }
  static internal(message = ReasonPhrases.INTERNAL_SERVER_ERROR, opts) {
    return new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, message, {
      ...opts,
      isOperational: false,
    });
  }
}

export default ApiError;
