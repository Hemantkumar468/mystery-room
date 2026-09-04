const axios = require('axios');
const { ApiError, badRequest } = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');

/**
 * SmartWhap API v2 — https://app.smartwhap.com/api-docs/
 *
 * Unlike Meta's Cloud API, SmartWhap is a tenant-scoped API: the token itself
 * identifies which WhatsApp number sends the message, so no Phone Number ID
 * appears in the URL. Auth is `Authorization: Bearer wm_...`.
 *
 *   POST {baseUrl}/messages/text          { phone, message }
 *   POST {baseUrl}/messages/template      { phone, template_name, language, field_1.. }
 *   POST {baseUrl}/messages/media         multipart: phone, media_type, media_url|media_file
 *   POST {baseUrl}/messages/interactive   { phone, type, body_text, buttons[] | sections[] }
 *   POST {baseUrl}/messages/cta           { phone, message, button_text, button_url }
 *   GET  {baseUrl}/account                account / credential check
 *   GET  {baseUrl}/templates              approved templates
 */

const DEFAULT_BASE_URL = 'https://app.smartwhap.com/api/v2';
const MEDIA_TYPES = ['image', 'video', 'audio', 'document'];
const SUPPORTED_TYPES = ['text', 'template', 'image', 'video', 'audio', 'document', 'media', 'interactive', 'button', 'list', 'cta'];

function url(credentials, pathSuffix) {
  return `${credentials.baseUrl || DEFAULT_BASE_URL}/${pathSuffix}`;
}

function authHeaders(credentials) {
  return { Authorization: `Bearer ${credentials.accessToken}`, Accept: 'application/json' };
}

/** Turns a SmartWhap failure into a readable ApiError. */
function toApiError(error, fallbackMessage) {
  if (error && error.isApiError) return error;

  const response = error && error.response;
  if (response) {
    const data = response.data || {};
    const nested = typeof data.error === 'object' && data.error ? data.error : {};
    const message = nested.message || (typeof data.error === 'string' ? data.error : null) || data.message || fallbackMessage;

    return new ApiError(response.status === 401 || response.status === 403 ? response.status : 400, message, {
      provider: 'smartwhap',
      status: response.status,
      code: nested.code || data.error_code || data.code,
      errors: nested.errors || data.errors,
      requestId: data.meta && data.meta.request_id,
      hint: hintFor(response.status, { ...data, ...nested }),
    });
  }

  if (error && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
    return new ApiError(504, 'Request to SmartWhap timed out');
  }

  return new ApiError(502, `${fallbackMessage}: ${error && error.message ? error.message : 'unknown error'}`);
}

function hintFor(status, data) {
  const code = String(data.error_code || data.code || '').toUpperCase();

  if (status === 401) return 'The API token is invalid, revoked, or belongs to a different SmartWhap tenant.';
  if (code === 'INSUFFICIENT_SCOPE' || status === 403) {
    return 'The token is valid (SmartWhap recognised it) but lacks the scope this endpoint needs. Add the scope to the token in SmartWhap, or use an endpoint the token already covers.';
  }
  if (status === 422) return 'SmartWhap rejected a field — see "errors" for the exact validation failure.';
  if (status === 429) return 'Rate limit or plan message quota reached.';
  return undefined;
}

/** SmartWhap wraps the payload in { message, data: {...} } — read either shape. */
function unwrap(data) {
  const payload = data && data.data ? data.data : data || {};
  return {
    messageId: payload.message_id || payload.id || null,
    messageStatus: payload.status || 'sent',
    waId: payload.phone || null,
    to: payload.phone || null,
    contactId: payload.contact_id,
    // SmartWhap's own record id — the handle for GET /messages/{id}, unlike the wamid.
    chatMessageId: payload.chat_message_id,
    chatId: payload.chat_id,
    sentAt: payload.sent_at,
    raw: data,
  };
}

async function post(credentials, pathSuffix, body, isMultipart = false) {
  try {
    const { data } = await axios.post(url(credentials, pathSuffix), body, {
      headers: isMultipart
        ? authHeaders(credentials)
        : { ...authHeaders(credentials), 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return unwrap(data);
  } catch (error) {
    throw toApiError(error, 'Failed to send WhatsApp message');
  }
}

/* ------------------------------------------------------------------ */
/* Per-type senders                                                    */
/* ------------------------------------------------------------------ */

function sendText(credentials, to, body) {
  const { message } = body;
  if (!message || !String(message).trim()) throw badRequest('message is required');
  if (String(message).length > 4096) throw badRequest('message must be 4096 characters or fewer');

  const payload = { phone: to, message: String(message) };
  if (body.contactId || body.contact_id) payload.contact_id = Number(body.contactId || body.contact_id);

  return post(credentials, 'messages/text', payload);
}

function sendTemplate(credentials, to, body) {
  const templateName = body.templateName || body.template_name || body.template;
  if (!templateName) throw badRequest('templateName is required');

  const payload = {
    phone: to,
    template_name: String(templateName),
    language: String(body.language || body.languageCode || body.language_code || 'en'),
  };

  // bodyParams: ["Hemant", "MR-1042"] -> field_1, field_2 (SmartWhap allows field_1..field_10)
  const bodyParams = body.bodyParams || body.body_params;
  if (Array.isArray(bodyParams)) {
    if (bodyParams.length > 10) throw badRequest('bodyParams supports at most 10 values (field_1 to field_10)');
    bodyParams.forEach((value, i) => {
      payload[`field_${i + 1}`] = String(value);
    });
  }
  // Pass through any field_N / button_N / header_* the caller set explicitly.
  Object.keys(body)
    .filter((key) => /^(field_\d+|button_[0-2]|header_(image|video|document)_url|header_document_name|header_field_1)$/.test(key))
    .forEach((key) => {
      payload[key] = body[key];
    });

  if (body.headerImageUrl) payload.header_image_url = String(body.headerImageUrl);
  if (body.headerVideoUrl) payload.header_video_url = String(body.headerVideoUrl);
  if (body.headerDocumentUrl) payload.header_document_url = String(body.headerDocumentUrl);
  if (body.contactId || body.contact_id) payload.contact_id = Number(body.contactId || body.contact_id);

  return post(credentials, 'messages/template', payload);
}

function sendMedia(credentials, to, body, forcedType) {
  const mediaType = String(forcedType || body.mediaType || body.media_type || 'image').toLowerCase();
  if (!MEDIA_TYPES.includes(mediaType)) {
    throw badRequest(`mediaType must be one of: ${MEDIA_TYPES.join(', ')}`);
  }

  const mediaUrl = body.link || body.mediaUrl || body.media_url || body.url;
  if (!mediaUrl) throw badRequest('link (public https URL of the file) is required');
  if (!/^https?:\/\//i.test(String(mediaUrl))) throw badRequest('link must be an http(s) URL');

  // The endpoint is documented as multipart/form-data; FormData is global in Node 18+.
  const form = new FormData();
  form.append('phone', to);
  form.append('media_type', mediaType);
  form.append('media_url', String(mediaUrl));
  if (body.caption && mediaType !== 'audio') form.append('caption', String(body.caption));
  if (body.filename || body.fileName) form.append('filename', String(body.filename || body.fileName));
  if (body.contactId || body.contact_id) form.append('contact_id', String(body.contactId || body.contact_id));

  return post(credentials, 'messages/media', form, true);
}

function sendInteractive(credentials, to, body, forcedKind) {
  const kind = String(forcedKind || body.interactiveType || body.type || 'button').toLowerCase();
  const bodyText = body.bodyText || body.body_text || body.message;
  if (!bodyText) throw badRequest('message (body text) is required for interactive messages');

  const payload = {
    phone: to,
    type: kind === 'list' ? 'list' : 'button',
    body_text: String(bodyText).slice(0, 1024),
  };
  if (body.header || body.headerText) payload.header_text = String(body.header || body.headerText).slice(0, 60);
  if (body.footer || body.footerText) payload.footer_text = String(body.footer || body.footerText).slice(0, 60);

  if (payload.type === 'list') {
    const sections = body.sections;
    if (!Array.isArray(sections) || !sections.length) {
      throw badRequest('sections is required for a list message: [{ title, rows: [{ id, title, description }] }]');
    }
    if (sections.length > 10) throw badRequest('SmartWhap allows a maximum of 10 sections');
    payload.list_button_text = String(body.buttonText || body.list_button_text || 'Choose').slice(0, 20);
    payload.sections = sections.map((section, i) => ({
      title: String(section.title || `Section ${i + 1}`),
      rows: (section.rows || []).map((row, j) => ({
        id: String(row.id || `row_${i}_${j}`),
        title: String(row.title || `Option ${j + 1}`),
        ...(row.description ? { description: String(row.description) } : {}),
      })),
    }));
  } else {
    const buttons = body.buttons;
    if (!Array.isArray(buttons) || !buttons.length) {
      throw badRequest('buttons is required: ["Yes", "No"] or [{ id, title }] (max 3)');
    }
    if (buttons.length > 3) throw badRequest('WhatsApp allows a maximum of 3 reply buttons');
    payload.buttons = buttons.map((button, i) => {
      const title = typeof button === 'string' ? button : button.title;
      if (!title) throw badRequest(`buttons[${i}].title is required`);
      return {
        id: String((typeof button === 'object' && button.id) || `btn_${i + 1}`),
        title: String(title).slice(0, 20),
      };
    });
  }

  return post(credentials, 'messages/interactive', payload);
}

function sendCta(credentials, to, body) {
  const message = body.message || body.bodyText;
  const buttonText = body.buttonText || body.button_text;
  const buttonUrl = body.buttonUrl || body.button_url || body.url;

  if (!message) throw badRequest('message is required');
  if (!buttonText) throw badRequest('buttonText is required');
  if (!buttonUrl) throw badRequest('buttonUrl is required');
  if (!/^https?:\/\//i.test(String(buttonUrl))) throw badRequest('buttonUrl must be an http(s) URL');

  const payload = {
    phone: to,
    message: String(message).slice(0, 1024),
    button_text: String(buttonText).slice(0, 25),
    button_url: String(buttonUrl),
  };
  if (body.header || body.headerText) payload.header_text = String(body.header || body.headerText).slice(0, 60);
  if (body.footer || body.footerText) payload.footer_text = String(body.footer || body.footerText).slice(0, 60);

  return post(credentials, 'messages/cta', payload);
}

/* ------------------------------------------------------------------ */
/* Provider interface                                                  */
/* ------------------------------------------------------------------ */

async function sendMessage(credentials, body, forcedType) {
  const type = String(forcedType || body.type || 'text').toLowerCase();
  if (!SUPPORTED_TYPES.includes(type)) {
    throw badRequest(
      `SmartWhap does not support message type "${type}". Supported: ${SUPPORTED_TYPES.join(', ')}`
    );
  }

  const to = normalizePhone(body.phone || body.to || body.mobile || body.number, body.countryCode);

  let result;
  if (type === 'text') result = await sendText(credentials, to, body);
  else if (type === 'template') result = await sendTemplate(credentials, to, body);
  else if (type === 'media' || MEDIA_TYPES.includes(type)) {
    result = await sendMedia(credentials, to, body, type === 'media' ? null : type);
  } else if (type === 'cta') result = await sendCta(credentials, to, body);
  else result = await sendInteractive(credentials, to, body, type === 'interactive' ? null : type);

  return { ...result, to: result.to || to, type };
}

/** Raw passthrough: { endpoint: "messages/text", payload: {...} } */
async function sendPayload(credentials, payload) {
  const endpoint = String((payload && payload.endpoint) || 'messages/text').replace(/^\/+/, '');
  const body = (payload && payload.payload) || payload || {};
  delete body.endpoint;
  return post(credentials, endpoint, body);
}

async function verifyCredentials(credentials) {
  try {
    const { data } = await axios.get(url(credentials, 'account'), {
      headers: authHeaders(credentials),
      timeout: 20000,
    });
    return data && data.data ? data.data : data;
  } catch (error) {
    const status = error && error.response && error.response.status;
    const code = String(
      (error.response && error.response.data && error.response.data.error && error.response.data.error.code) || ''
    ).toUpperCase();

    // A token scoped only for messaging still cannot read /account. Prove it is
    // a working token via an endpoint it does cover instead of failing the check.
    if (status === 403 || code === 'INSUFFICIENT_SCOPE') {
      const templates = await listTemplates(credentials);
      return {
        scopeLimited: true,
        note: 'Token accepted by SmartWhap, but it lacks the account:read scope, so account details are unavailable. Messaging scopes were confirmed instead.',
        approvedTemplates: (templates.data || []).length,
      };
    }

    throw toApiError(error, 'Credential verification failed');
  }
}

async function listTemplates(credentials) {
  try {
    const { data } = await axios.get(url(credentials, 'templates'), {
      headers: authHeaders(credentials),
      timeout: 20000,
    });
    const list = (data && data.data) || data || [];
    return { data: Array.isArray(list) ? list : list.data || [] };
  } catch (error) {
    throw toApiError(error, 'Failed to fetch message templates');
  }
}

/**
 * Delivery status for one message. Takes SmartWhap's internal id
 * (`chatMessageId` from a send response), not the wamid.
 */
async function getMessageStatus(credentials, id) {
  if (!/^\d+$/.test(String(id))) {
    throw badRequest('Message id must be the numeric chatMessageId from a send response (not the wamid).');
  }
  try {
    const { data } = await axios.get(url(credentials, `messages/${id}`), {
      headers: authHeaders(credentials),
      timeout: 20000,
    });
    const m = (data && data.data) || data || {};
    return {
      id: m.id,
      messageId: m.message_id,
      type: m.type,
      status: m.status,
      statusMessage: m.status_message,
      isRead: m.is_read,
      sentAt: m.sent_at,
      raw: data,
    };
  } catch (error) {
    throw toApiError(error, 'Failed to read message status');
  }
}

/**
 * Recent message history with real delivery status. Template sends return no
 * chat_message_id, so this conversation-level view is the only way to see
 * whether they actually landed.
 */
async function listMessages(credentials, options = {}) {
  const params = { per_page: Math.min(Number(options.limit) || 20, 100), sort: '-created_at' };
  if (options.chatId) params['filter[interaction_id]'] = Number(options.chatId);
  if (options.status) params['filter[status]'] = String(options.status);
  if (options.type) params['filter[type]'] = String(options.type);
  if (options.direction) params['filter[direction]'] = String(options.direction);
  if (options.search) params.search = String(options.search);

  try {
    const { data } = await axios.get(url(credentials, 'messages'), {
      headers: authHeaders(credentials),
      params,
      timeout: 20000,
    });
    const rows = (data && data.data) || [];
    return {
      count: rows.length,
      messages: rows.map((m) => ({
        id: m.id,
        type: m.type,
        status: m.status,
        statusMessage: m.status_message,
        direction: m.direction,
        sender: m.sender_id,
        message: typeof m.message === 'string' ? m.message.slice(0, 120) : m.message,
        messageId: m.message_id,
        sentAt: m.sent_at || m.created_at,
      })),
    };
  } catch (error) {
    throw toApiError(error, 'Failed to list messages');
  }
}

/**
 * Creates a template and submits it to Meta for approval.
 * SmartWhap: POST /whatsapp-template
 */
async function createTemplate(credentials, body) {
  const name = String(body.name || body.templateName || '').trim().toLowerCase();
  if (!name) throw badRequest('name is required (lowercase letters, numbers and underscores only)');
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw badRequest(`name "${name}" is invalid. Use lowercase letters, numbers and underscores only, e.g. task_assigned`);
  }

  const text = String(body.body || body.text || '').trim();
  if (!text) throw badRequest('body is required — the message text, with {{1}}, {{2}} for the parts that change');

  const category = String(body.category || 'UTILITY').toUpperCase();
  if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category)) {
    throw badRequest('category must be UTILITY, MARKETING or AUTHENTICATION');
  }

  // Meta rejects a template whose placeholders have no sample values, and the
  // count must match exactly — catch that here rather than after a round trip.
  const placeholders = (text.match(/\{\{\s*\d+\s*\}\}/g) || []).length;
  const samples = body.bodySampleValues || body.body_sample_values || body.sampleValues;
  const sampleList = Array.isArray(samples) ? samples.map((v) => String(v)) : [];

  if (placeholders && sampleList.length !== placeholders) {
    throw badRequest(
      `body has ${placeholders} placeholder(s) but ${sampleList.length} sample value(s). Send bodySampleValues with exactly ${placeholders} example(s) — Meta needs them to review the template.`
    );
  }

  const payload = {
    name,
    category,
    language: String(body.language || body.languageCode || 'en'),
    body: text,
  };
  if (sampleList.length) payload.body_sample_values = sampleList;
  if (body.footer) payload.footer = String(body.footer).slice(0, 60);
  if (body.header) payload.header = body.header;
  if (Array.isArray(body.buttons) && body.buttons.length) payload.buttons = body.buttons;
  if (body.phoneNumberId || body.phone_number_id) {
    payload.phone_number_id = String(body.phoneNumberId || body.phone_number_id);
  }
  if (category === 'AUTHENTICATION') {
    if (body.codeExpirationMinutes) payload.code_expiration_minutes = Number(body.codeExpirationMinutes);
    if (body.addSecurityRecommendation !== undefined) {
      payload.add_security_recommendation = Boolean(body.addSecurityRecommendation);
    }
  }

  try {
    const { data } = await axios.post(url(credentials, 'whatsapp-template'), payload, {
      headers: { ...authHeaders(credentials), 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const created = (data && data.data) || data || {};
    return {
      name: created.name || name,
      category: created.category || category,
      language: created.language || payload.language,
      status: created.status || 'PENDING',
      templateId: created.template_id || created.id,
      submitted: payload,
      raw: data,
    };
  } catch (error) {
    throw toApiError(error, 'Failed to create template');
  }
}

function describeAccount(data) {
  if (data && data.scopeLimited) {
    return {
      tokenValid: true,
      scopeLimited: true,
      note: data.note,
      approvedTemplates: data.approvedTemplates,
    };
  }

  const subscription = data.subscription || {};
  return {
    tenantId: data.id,
    name: data.name,
    subdomain: data.subdomain,
    status: data.status,
    plan: subscription.plan_name,
    planStatus: subscription.status,
    createdAt: data.created_at,
  };
}

module.exports = {
  name: 'smartwhap',
  requiresPhoneNumberId: false,
  defaultBaseUrl: DEFAULT_BASE_URL,
  sendMessage,
  sendPayload,
  verifyCredentials,
  listTemplates,
  describeAccount,
  getMessageStatus,
  listMessages,
  createTemplate,
  SUPPORTED_TYPES,
  MEDIA_TYPES,
};
