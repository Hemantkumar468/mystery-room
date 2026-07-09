/**
 * Wraps an async route handler so rejected promises flow to the Express error
 * middleware instead of hanging the request. Lets controllers stay try/catch-free.
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
