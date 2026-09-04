const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const config = {
  port: Number(process.env.PORT) || 5055,
  graphVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  // Empty means "use the selected provider's own default host".
  baseUrl: (process.env.WHATSAPP_BASE_URL || '').trim().replace(/\/+$/, ''),
  graphBaseUrl: (process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com').trim().replace(/\/+$/, ''),
  provider: (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase(),
  phoneNumberId: (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
  accessToken: (process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
  businessAccountId: (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '').trim(),
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE || '91').trim(),
  apiKey: (process.env.API_KEY || '').trim(),
};

module.exports = config;
