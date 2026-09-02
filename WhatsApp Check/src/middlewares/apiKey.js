const config = require('../config/env');
const { ApiError } = require('../utils/ApiError');

/**
 * Optional gate: active only when API_KEY is set in .env.
 * Keeps the tester from being called by anyone who finds the port open.
 */
module.exports = function apiKeyGuard(req, res, next) {
  if (!config.apiKey) return next();
  if (req.path === '/api/whatsapp/health') return next();

  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== config.apiKey) {
    return next(new ApiError(401, 'Invalid or missing x-api-key header'));
  }
  return next();
};
