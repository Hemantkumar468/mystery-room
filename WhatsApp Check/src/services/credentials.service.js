const config = require('../config/env');
const { badRequest } = require('../utils/ApiError');

const PROVIDER_DEFAULTS = {
  meta: { baseUrl: 'https://graph.facebook.com', requiresPhoneNumberId: true },
  smartwhap: { baseUrl: 'https://app.smartwhap.com/api/v2', requiresPhoneNumberId: false },
};

/**
 * Credentials can arrive three ways (first one wins):
 *   1. Request body    -> { phoneNumberId, accessToken, provider, baseUrl }
 *   2. Request headers -> x-wa-phone-number-id, x-wa-access-token, x-wa-provider, x-wa-base-url
 *   3. .env file       -> WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PROVIDER, WHATSAPP_BASE_URL
 *
 * This lets a client hand over their own credentials per request so we can
 * verify whether that pair actually works, without touching the server config.
 */
function resolveCredentials(req) {
  const body = req.body || {};
  const headers = req.headers || {};

  const phoneNumberId = String(
    body.phoneNumberId || body.phone_number_id || headers['x-wa-phone-number-id'] || config.phoneNumberId || ''
  ).trim();

  const accessToken = String(
    body.accessToken || body.access_token || headers['x-wa-access-token'] || config.accessToken || ''
  ).trim();

  const graphVersion = String(body.graphVersion || headers['x-wa-graph-version'] || config.graphVersion).trim();

  assertNotPlaceholder('phoneNumberId', phoneNumberId);
  assertNotPlaceholder('accessToken', accessToken);

  if (!accessToken) {
    throw badRequest(
      'accessToken is missing. Send it in the body, in the x-wa-access-token header, or set WHATSAPP_ACCESS_TOKEN in .env'
    );
  }

  const provider = resolveProvider(body, headers, accessToken);
  const defaults = PROVIDER_DEFAULTS[provider];

  const baseUrl = String(body.baseUrl || headers['x-wa-base-url'] || config.baseUrl || defaults.baseUrl)
    .trim()
    .replace(/\/+$/, '');

  if (!/^https?:\/\//i.test(baseUrl)) {
    throw badRequest(`baseUrl must start with http:// or https://, received: ${baseUrl}`);
  }

  // Meta puts the Phone Number ID in the URL; SmartWhap infers the sender from
  // the token, so the ID is informational there and never required.
  if (defaults.requiresPhoneNumberId) {
    if (!phoneNumberId) {
      throw badRequest(
        'phoneNumberId is missing. Send it in the body, in the x-wa-phone-number-id header, or set WHATSAPP_PHONE_NUMBER_ID in .env'
      );
    }
    if (!/^\d+$/.test(phoneNumberId)) {
      throw badRequest('phoneNumberId must contain digits only (Meta Phone Number ID, normally 15 digits)');
    }
    if (phoneNumberId.length < 10 || phoneNumberId.length > 20) {
      throw badRequest(
        `phoneNumberId looks wrong (${phoneNumberId.length} digits). A Meta Phone Number ID is normally 15 digits.`
      );
    }
    if (!/^v\d+\.\d+$/.test(graphVersion)) {
      throw badRequest(`graphVersion must look like v21.0, received: ${graphVersion}`);
    }
  }

  return { provider, phoneNumberId, accessToken, graphVersion, baseUrl };
}

/**
 * Explicit setting wins; otherwise the token shape decides. A Meta token always
 * starts with EAA, a SmartWhap API token with wm_ — sending one to the other's
 * host only ever produces a confusing 401.
 */
function resolveProvider(body, headers, accessToken) {
  const explicit = String(body.provider || headers['x-wa-provider'] || config.provider || '')
    .trim()
    .toLowerCase();

  if (explicit) {
    if (!PROVIDER_DEFAULTS[explicit]) {
      throw badRequest(`Unknown provider "${explicit}". Supported: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`);
    }
    return explicit;
  }

  if (accessToken.startsWith('wm_')) return 'smartwhap';
  return 'meta';
}

/**
 * The sample values in README.md / .env.example are a common copy-paste trap:
 * pasting them produces a confusing 401 from the provider instead of a clear
 * "you did not fill this in" message. Catch them before any network call.
 */
const PLACEHOLDERS = ['123456789012345', 'eaag...replace_me', 'replace_me', 'your_token', 'your_access_token'];

function assertNotPlaceholder(field, value) {
  if (!value) return;
  const normalized = value.toLowerCase();
  const looksLikeSample = PLACEHOLDERS.includes(normalized) || normalized.endsWith('...') || normalized.includes('replace_me');

  if (looksLikeSample) {
    throw badRequest(
      `${field} is still the sample value ("${value}"). Put your real credentials in .env and remove phoneNumberId/accessToken from the request body, or paste the real values into the body.`
    );
  }
}

/** Never echo a full token back to the caller. */
function maskToken(token) {
  if (!token) return '';
  if (token.length <= 12) return `${token.slice(0, 2)}****`;
  return `${token.slice(0, 6)}****${token.slice(-4)}`;
}

module.exports = { resolveCredentials, maskToken, PROVIDER_DEFAULTS };
