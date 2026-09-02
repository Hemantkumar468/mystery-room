const { badRequest } = require('../utils/ApiError');
const meta = require('../providers/meta.provider');
const smartwhap = require('../providers/smartwhap.provider');

const PROVIDERS = { meta, smartwhap };

/**
 * Picks the provider for a request. `credentials.provider` is resolved in
 * credentials.service.js (explicit setting first, then token-shape detection).
 */
function providerFor(credentials) {
  const provider = PROVIDERS[(credentials && credentials.provider) || 'meta'];
  if (!provider) {
    throw badRequest(`Unknown provider "${credentials.provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

const sendMessage = (credentials, body, forcedType) =>
  providerFor(credentials).sendMessage(credentials, body, forcedType);

const sendPayload = (credentials, payload) => providerFor(credentials).sendPayload(credentials, payload);

const verifyCredentials = (credentials) => providerFor(credentials).verifyCredentials(credentials);

const listTemplates = (credentials, businessAccountId) =>
  providerFor(credentials).listTemplates(credentials, businessAccountId);

const describeAccount = (credentials, data) => providerFor(credentials).describeAccount(data);

const getMessageStatus = (credentials, id) => providerFor(credentials).getMessageStatus(credentials, id);

const listMessages = (credentials, options) => providerFor(credentials).listMessages(credentials, options);

const createTemplate = (credentials, body) => providerFor(credentials).createTemplate(credentials, body);

const supportedTypes = (credentials) => providerFor(credentials).SUPPORTED_TYPES;

/**
 * Fan-out helper: same message to many numbers, sent sequentially so a bad
 * number never aborts the rest of the batch. Provider-agnostic.
 */
async function sendBulk(credentials, body) {
  const list = body.phones || body.numbers || body.recipients;
  if (!Array.isArray(list) || !list.length) throw badRequest('phones must be a non-empty array');
  if (list.length > 50) throw badRequest('phones is limited to 50 numbers per request');

  const results = [];
  for (const phone of list) {
    try {
      const sent = await sendMessage(credentials, { ...body, phone });
      results.push({ phone, success: true, messageId: sent.messageId, waId: sent.waId, to: sent.to });
    } catch (error) {
      results.push({ phone, success: false, error: error.message, details: error.details });
    }
  }

  const sentCount = results.filter((r) => r.success).length;
  return { total: results.length, sent: sentCount, failed: results.length - sentCount, results };
}

module.exports = {
  PROVIDERS,
  providerFor,
  sendMessage,
  sendBulk,
  sendPayload,
  verifyCredentials,
  listTemplates,
  describeAccount,
  getMessageStatus,
  listMessages,
  createTemplate,
  supportedTypes,
  // Union of everything any provider can send — used by the endpoint directory.
  SUPPORTED_TYPES: Array.from(new Set([...meta.SUPPORTED_TYPES, ...smartwhap.SUPPORTED_TYPES])),
};
