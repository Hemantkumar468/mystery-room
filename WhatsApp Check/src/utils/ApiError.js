class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isApiError = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const badRequest = (message, details) => new ApiError(400, message, details);

module.exports = { ApiError, badRequest };
