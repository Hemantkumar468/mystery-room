import { ApiError } from '../utils/ApiError.js';
import { plainZodError } from '../utils/plainErrors.js';

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
    /**
     * TWO AUDIENCES, TWO TEXTS.
     *
     * `message` and `details` are what reaches the screen, so they are
     * sentences. `technical` carries Zod's own wording and the raw field
     * paths, which is what somebody debugging actually needs - it rides along
     * in the payload and into the log, and the client never renders it.
     *
     * The headline used to be the literal string "Validation failed", with
     * the library's "Invalid enum value. Expected 'franchise' | 'broker' ..."
     * underneath it. That told the reader a type-system fact about a request
     * they did not know they had made.
     */
    const { message, details } = plainZodError(result.error.issues);
    const technical = result.error.issues.map((issue) => ({
      field: issue.path.slice(1).join('.') || issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest(message, { details, technical, code: 'VALIDATION_ERROR' }));
  }

  if (result.data.body !== undefined) req.body = result.data.body;
  if (result.data.query !== undefined) req.validatedQuery = result.data.query;
  if (result.data.params !== undefined) req.params = result.data.params;
  return next();
};

export default validate;
