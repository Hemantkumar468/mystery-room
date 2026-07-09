import { ApiError } from '../utils/ApiError.js';

/**
 * Validate `req` against a Zod schema shaped like `{ body, query, params }`.
 * On success, replaces each part with the parsed (coerced, stripped) value.
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  });

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.slice(1).join('.') || issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest('Validation failed', { details, code: 'VALIDATION_ERROR' }));
  }

  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.query !== undefined) req.validatedQuery = result.data.query;
  if (result.data.params !== undefined) req.params = result.data.params;
  return next();
};

export default validate;
