const axios = require('axios');
const config = require('../config/env');
const { ApiError, badRequest } = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'];

function graphUrl(credentials, pathSuffix) {
  return `${credentials.baseUrl || config.graphBaseUrl}/${credentials.graphVersion}/${pathSuffix}`;
}

/**
 * Turns a Graph API failure into a readable ApiError instead of a raw axios dump.
 */
function toApiError(error, fallbackMessage, credentials) {
  if (error && error.isApiError) return error;

  const response = error && error.response;
  if (response) {
    const metaError = (response.data && response.data.error) || {};
    const message = metaError.error_user_msg || metaError.message || fallbackMessage;
    return new ApiError(response.status === 401 || response.status === 403 ? response.status : 400, message, {
      type: metaError.type,
      code: metaError.code,
      subcode: metaError.error_subcode,
      details: metaError.error_data && metaError.error_data.details,
      fbtrace_id: metaError.fbtrace_id,
      hint: hintFor(metaError, credentials),
    });
  }

  if (error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
    return new ApiError(504, 'Request to WhatsApp Cloud API timed out');
  }

  return new ApiError(502, `${fallbackMessage}: ${error && error.message ? error.message : 'unknown error'}`);
}

function hintFor(metaError, credentials) {
  switch (metaError.code) {
    case 190: {
      // A Meta-issued token always starts with EAA. Anything else being sent to
      // graph.facebook.com is a wrong-host problem, not an expired-token problem.
      const token = (credentials && credentials.accessToken) || '';
      const onMetaHost = /graph\.facebook\.com/i.test((credentials && credentials.baseUrl) || config.graphBaseUrl);

      if (token && !token.startsWith('EAA') && onMetaHost) {
        const prefix = token.slice(0, 3);
        return `This token does not look like a Meta token (it starts with "${prefix}", Meta tokens start with "EAA"), but the request went to graph.facebook.com. Either use a token from Meta > WhatsApp > API Setup, or set WHATSAPP_BASE_URL to the panel that issued this token.`;
      }
      return 'Access token is invalid or expired. Generate a new one in Meta > WhatsApp > API Setup (temporary tokens last 24h).';
    }
    case 100:
      return 'Check the Phone Number ID and the request payload. A wrong Phone Number ID gives "Unsupported get/post request".';
    case 131030:
      return 'The recipient is not in the allowed list. On a test number, add the recipient under Meta > WhatsApp > API Setup > To.';
    case 131047:
      return 'The 24-hour customer service window is closed. Send an approved template message instead of a free-form text.';
    case 131026:
      return 'The number is not a valid WhatsApp user or cannot receive messages.';
    case 10:
    case 200:
      return 'The token lacks whatsapp_business_messaging permission for this phone number.';
    default:
      return undefined;
  }
}

/**
 * Single low-level call to POST /{phone-number-id}/messages.
 */
async function sendPayload(credentials, payload) {
  try {
    const { data } = await axios.post(graphUrl(credentials, `${credentials.phoneNumberId}/messages`), payload, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    });

    const contact = (data.contacts && data.contacts[0]) || {};
    const message = (data.messages && data.messages[0]) || {};

    return {
      messageId: message.id || null,
      messageStatus: message.message_status || 'accepted',
      waId: contact.wa_id || null,
      to: payload.to,
      raw: data,
    };
  } catch (error) {
    throw toApiError(error, 'Failed to send WhatsApp message', credentials);
  }
}

/* ------------------------------------------------------------------ */
/* Payload builders — one per supported message type                   */
/* ------------------------------------------------------------------ */

const base = (to) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to });

function buildTextPayload(to, body) {
  const { message, previewUrl = false } = body;
  if (!message || !String(message).trim()) throw badRequest('message is required');
  if (String(message).length > 4096) throw badRequest('message must be 4096 characters or fewer');

  return {
    ...base(to),
    type: 'text',
    text: { preview_url: Boolean(previewUrl), body: String(message) },
  };
}

function buildTemplatePayload(to, body) {
  const templateName = body.templateName || body.template_name || body.template;
  if (!templateName) throw badRequest('templateName is required');

  const languageCode = body.languageCode || body.language_code || 'en_US';

  // Either pass ready-made "components", or the simpler bodyParams / headerParams shortcut.
  let components = body.components;
  if (!components) {
    components = [];
    const headerParams = body.headerParams || body.header_params;
    const bodyParams = body.bodyParams || body.body_params;

    if (Array.isArray(headerParams) && headerParams.length) {
      components.push({
        type: 'header',
        parameters: headerParams.map((text) => ({ type: 'text', text: String(text) })),
      });
    }
    if (Array.isArray(bodyParams) && bodyParams.length) {
      components.push({
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) })),
      });
    }
  }

  const template = { name: String(templateName), language: { code: String(languageCode) } };
  if (Array.isArray(components) && components.length) template.components = components;

  return { ...base(to), type: 'template', template };
}

function buildMediaPayload(to, body) {
  const type = String(body.mediaType || body.type || 'image').toLowerCase();
  if (!MEDIA_TYPES.includes(type)) {
    throw badRequest(`mediaType must be one of: ${MEDIA_TYPES.join(', ')}`);
  }

  const link = body.link || body.mediaUrl || body.url;
  const mediaId = body.mediaId || body.media_id;
  if (!link && !mediaId) throw badRequest('Provide either link (public https URL) or mediaId');
  if (link && !/^https:\/\//i.test(String(link))) throw badRequest('link must be a public https:// URL');

  const media = mediaId ? { id: String(mediaId) } : { link: String(link) };

  // Captions are allowed on image / video / document only.
  if (body.caption && type !== 'audio' && type !== 'sticker') media.caption = String(body.caption);
  if (type === 'document' && (body.filename || body.fileName)) {
    media.filename = String(body.filename || body.fileName);
  }

  return { ...base(to), type, [type]: media };
}

function buildLocationPayload(to, body) {
  const { latitude, longitude } = body;
  if (latitude === undefined || longitude === undefined) {
    throw badRequest('latitude and longitude are required');
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) throw badRequest('latitude must be a number between -90 and 90');
  if (Number.isNaN(lng) || lng < -180 || lng > 180) throw badRequest('longitude must be a number between -180 and 180');

  const location = { latitude: lat, longitude: lng };
  if (body.name) location.name = String(body.name);
  if (body.address) location.address = String(body.address);

  return { ...base(to), type: 'location', location };
}

function buildInteractivePayload(to, body) {
  const kind = String(body.interactiveType || 'button').toLowerCase();
  const bodyText = body.message || body.bodyText;
  if (!bodyText) throw badRequest('message (body text) is required for interactive messages');

  const interactive = {
    type: kind === 'list' ? 'list' : 'button',
    body: { text: String(bodyText) },
  };
  if (body.header) interactive.header = { type: 'text', text: String(body.header) };
  if (body.footer) interactive.footer = { text: String(body.footer) };

  if (kind === 'list') {
    const sections = body.sections;
    if (!Array.isArray(sections) || !sections.length) {
      throw badRequest('sections is required for a list message: [{ title, rows: [{ id, title, description }] }]');
    }
    interactive.action = {
      button: String(body.buttonText || 'Choose'),
      sections: sections.map((section, i) => ({
        title: String(section.title || `Section ${i + 1}`),
        rows: (section.rows || []).map((row, j) => ({
          id: String(row.id || `row_${i}_${j}`),
          title: String(row.title || `Option ${j + 1}`),
          ...(row.description ? { description: String(row.description) } : {}),
        })),
      })),
    };
  } else {
    const buttons = body.buttons;
    if (!Array.isArray(buttons) || !buttons.length) {
      throw badRequest('buttons is required for a button message: ["Yes", "No"] or [{ id, title }] (max 3)');
    }
    if (buttons.length > 3) throw badRequest('WhatsApp allows a maximum of 3 reply buttons');
    interactive.action = {
      buttons: buttons.map((button, i) => {
        const title = typeof button === 'string' ? button : button.title;
        if (!title) throw badRequest(`buttons[${i}].title is required`);
        return {
          type: 'reply',
          reply: {
            id: String((typeof button === 'object' && button.id) || `btn_${i + 1}`),
            title: String(title).slice(0, 20),
          },
        };
      }),
    };
  }

  return { ...base(to), type: 'interactive', interactive };
}

function buildContactsPayload(to, body) {
  const contacts = body.contacts;
  if (!Array.isArray(contacts) || !contacts.length) {
    throw badRequest('contacts array is required');
  }
  return { ...base(to), type: 'contacts', contacts };
}

function buildReactionPayload(to, body) {
  const messageId = body.messageId || body.message_id;
  if (!messageId) throw badRequest('messageId of the message to react to is required');
  return {
    ...base(to),
    type: 'reaction',
    reaction: { message_id: String(messageId), emoji: body.emoji === undefined ? '👍' : String(body.emoji) },
  };
}

const BUILDERS = {
  text: buildTextPayload,
  template: buildTemplatePayload,
  image: buildMediaPayload,
  video: buildMediaPayload,
  audio: buildMediaPayload,
  document: buildMediaPayload,
  sticker: buildMediaPayload,
  media: buildMediaPayload,
  location: buildLocationPayload,
  interactive: buildInteractivePayload,
  button: (to, body) => buildInteractivePayload(to, { ...body, interactiveType: 'button' }),
  list: (to, body) => buildInteractivePayload(to, { ...body, interactiveType: 'list' }),
  contacts: buildContactsPayload,
  reaction: buildReactionPayload,
};

const SUPPORTED_TYPES = Object.keys(BUILDERS);

/**
 * Builds the payload for any supported type and sends it.
 * `type` defaults to "text" so the simplest Postman body just needs phone + message.
 */
async function sendMessage(credentials, body, forcedType) {
  const type = String(forcedType || body.type || 'text').toLowerCase();
  const builder = BUILDERS[type];
  if (!builder) {
    throw badRequest(`Unsupported message type "${type}". Supported: ${SUPPORTED_TYPES.join(', ')}`);
  }

  const to = normalizePhone(body.phone || body.to || body.mobile || body.number, body.countryCode);

  // media/image/video/... all share one builder — tell it which one was asked for.
  const payloadBody = type === 'media' ? body : { ...body, mediaType: MEDIA_TYPES.includes(type) ? type : body.mediaType };
  const payload = builder(to, payloadBody);

  if (body.replyToMessageId) payload.context = { message_id: String(body.replyToMessageId) };

  const result = await sendPayload(credentials, payload);
  return { ...result, type: payload.type, request: payload };
}

/**
 * Credential check that does not send anything: reads the phone number object.
 */
async function verifyCredentials(credentials) {
  try {
    const { data } = await axios.get(graphUrl(credentials, credentials.phoneNumberId), {
      params: {
        fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type',
      },
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      timeout: 15000,
    });
    return data;
  } catch (error) {
    throw toApiError(error, 'Credential verification failed', credentials);
  }
}

/**
 * Lists approved templates. Needs the WhatsApp Business Account ID (not the phone number ID).
 */
async function listTemplates(credentials, businessAccountId) {
  const wabaId = String(businessAccountId || config.businessAccountId || '').trim();
  if (!wabaId) {
    throw badRequest(
      'businessAccountId is required. Send it in the body/query or set WHATSAPP_BUSINESS_ACCOUNT_ID in .env'
    );
  }
  try {
    const { data } = await axios.get(graphUrl(credentials, `${wabaId}/message_templates`), {
      params: { fields: 'name,status,category,language,components', limit: 100 },
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      timeout: 15000,
    });
    return data;
  } catch (error) {
    throw toApiError(error, 'Failed to fetch message templates', credentials);
  }
}

/** Shapes Meta's phone-number object into the response the controller returns. */
function describeAccount(data) {
  return {
    id: data.id,
    displayPhoneNumber: data.display_phone_number,
    verifiedName: data.verified_name,
    qualityRating: data.quality_rating,
    codeVerificationStatus: data.code_verification_status,
    platformType: data.platform_type,
  };
}

/** Meta has no read-by-id endpoint — delivery status arrives via webhooks only. */
async function getMessageStatus() {
  throw new ApiError(
    400,
    'Meta Cloud API cannot be queried for message status. Delivery status is delivered to your webhook (statuses: sent, delivered, read, failed).'
  );
}

/** Meta keeps no readable message history — webhooks only. */
async function listMessages() {
  throw new ApiError(400, 'Meta Cloud API has no message history endpoint. Delivery status arrives via webhooks.');
}

/** Template creation on Meta goes through the WABA endpoint — not wired up here. */
async function createTemplate() {
  throw new ApiError(
    400,
    'Template creation is not implemented for the Meta provider. Create it in Meta Business Manager > WhatsApp Manager > Message Templates.'
  );
}

module.exports = {
  name: 'meta',
  getMessageStatus,
  listMessages,
  createTemplate,
  requiresPhoneNumberId: true,
  defaultBaseUrl: 'https://graph.facebook.com',
  sendMessage,
  sendPayload,
  verifyCredentials,
  listTemplates,
  describeAccount,
  SUPPORTED_TYPES,
  MEDIA_TYPES,
};
