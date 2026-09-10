// import axios from 'axios';
// import { config } from '../../config/index.js';
// import { logger } from '../../config/logger.js';

// /**
//  * Outbound WhatsApp, through SmartWhap (https://app.smartwhap.com/api/v2).
//  *
//  * DEGRADES, NEVER CRASHES. Same contract as mail.service.js: with no token the
//  * service reports itself unconfigured and every send is skipped with a log
//  * line. A notification that cannot go out on WhatsApp is still delivered
// //  * in-app, and the caller's flow must never fail because a provider had a bad
//  * minute.
//  *
//  * WHY TEMPLATES AND NOT PLAIN TEXT. WhatsApp only delivers a free-form message
//  * to someone who replied to the business number in the last 24 hours. ERP
//  * notifications go out whenever the work happens — almost always outside that
//  * window — so they must be approved templates. sendText() exists for the
//  * support-conversation case only; nothing in the notification path may use it.
//  *
//  * WHY "sent" IS NOT DELIVERED. The provider accepts a message and answers
//  * immediately with `status: "sent"`; WhatsApp then decides separately whether
//  * to deliver it. A message rejected for the 24-hour rule still comes back as
//  * "sent" here and turns into "failed" a few seconds later. Delivery is only
//  * known from getMessageStatus() — never treat a send result as proof.
//  *
//  * Full background, verified against the live account: docs/WHATSAPP_SETTINGS_SPEC.md
//  */

// /** Logged once, not once per send — a minute-ly sweep would otherwise fill
//  *  the log with the same line forever. */
// let warned = false;

// function skip(reason) {
//   if (!warned) {
//     logger.warn(`WhatsApp disabled: ${reason}. Messages will be skipped.`);
//     warned = true;
//   }
//   return { sent: false, skipped: reason };
// }

// function url(path) {
//   return `${config.whatsapp.baseUrl}/${path.replace(/^\/+/, '')}`;
// }

// function headers() {
//   return {
//     Authorization: `Bearer ${config.whatsapp.accessToken}`,
//     Accept: 'application/json',
//   };
// }

// /**
//  * Digits-only E.164, the form WhatsApp expects (no +, spaces or dashes).
//  *
//  *   9876543210      -> 919876543210
//  *   09876543210     -> 919876543210
//  *   +91 98765-43210 -> 919876543210
//  *   14155550123     -> 14155550123   (already has a country code)
//  *
//  * @returns {string|null} null when the input cannot be a phone number, so the
//  *   caller can skip the recipient instead of sending into the void. A bad
//  *   number does not throw — one stale row must not break a batch of twenty.
//  */
// export function normalizePhone(input, countryCode = config.whatsapp.countryCode) {
//   if (input === undefined || input === null) return null;

//   let digits = String(input).replace(/[^\d]/g, '');
//   if (!digits) return null;

//   if (digits.startsWith('00')) digits = digits.slice(2);
//   if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
//   if (digits.length === 10) digits = `${countryCode}${digits}`;

//   if (digits.length < 10 || digits.length > 15) return null;

//   // An Indian mobile always starts 6-9. Catches landlines and truncated rows
//   // before they cost a message and a silent failure.
//   if (countryCode === '91' && digits.startsWith('91') && digits.length === 12) {
//     if (!/^[6-9]/.test(digits.slice(2))) return null;
//   }

//   return digits;
// }

// /** Reads the provider's error shape ({ success, error: { code, message } })
//  *  rather than dumping an axios object into the log. */
// function describeError(error, fallback) {
//   const response = error?.response;
//   if (!response) {
//     if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') {
//       return { message: 'SmartWhap request timed out', code: 'TIMEOUT', status: 504 };
//     }
//     return { message: error?.message || fallback, code: 'NETWORK', status: 502 };
//   }

//   const data = response.data || {};
//   const nested = typeof data.error === 'object' && data.error ? data.error : {};
//   return {
//     message: nested.message || (typeof data.error === 'string' ? data.error : null) || data.message || fallback,
//     code: nested.code || data.error_code || null,
//     status: response.status,
//     requestId: data.meta?.request_id,
//   };
// }

// /** SmartWhap answers { success, data: {...}, meta: {...} } — flatten the part
//  *  callers actually store. */
// function unwrapSend(data, to) {
//   const payload = data?.data || data || {};
//   return {
//     sent: true,
//     to,
//     messageId: payload.message_id || null,
//     /** The provider's own row id — the handle for getMessageStatus(). Null on
//      *  template sends, which is why delivery there is read from listMessages()
//      *  by conversation instead. */
//     chatMessageId: payload.chat_message_id ?? null,
//     chatId: payload.chat_id ?? null,
//     contactId: payload.contact_id ?? null,
//     status: payload.status || 'sent',
//     sentAt: payload.sent_at || new Date().toISOString(),
//   };
// }

// async function post(path, body) {
//   const { data } = await axios.post(url(path), body, {
//     headers: { ...headers(), 'Content-Type': 'application/json' },
//     timeout: 30000,
//   });
//   return data;
// }

// export const whatsappService = {
//   get configured() {
//     return config.whatsapp.configured;
//   },

//   /** Master switch: env kill switch AND a token. The database setting is
//    *  checked separately by the notification path — it can narrow this, not
//    *  widen it. */
//   get enabled() {
//     return config.whatsapp.configured && config.whatsapp.enabled;
//   },

//   normalizePhone,

//   /**
//    * Send an approved template. This is the only send the notification path
//    * may use.
//    *
//    * @param {object}   args
//    * @param {string}   args.phone         recipient, any format
//    * @param {string}   args.templateName  must be APPROVED on the account
//    * @param {string}   [args.languageCode] must match the approved template's language
//    * @param {string[]} [args.params]      values for {{1}}..{{10}}, in order
//    * @returns {Promise<{sent: boolean, skipped?: string, messageId?: string, chatMessageId?: number, error?: object}>}
//    *   Resolves either way — one failed notification must not take down the
//    *   sweep delivering the other twenty.
//    */
//   async sendTemplate({ phone, templateName, languageCode = 'en', params = [] }) {
//     if (!this.enabled) {
//       return skip(config.whatsapp.configured ? 'WHATSAPP_ENABLED=false' : 'WHATSAPP_ACCESS_TOKEN not set');
//     }
//     if (!templateName) return { sent: false, skipped: 'no template name' };

//     // Test mode: never let a rehearsal reach a real employee.
//     const target = config.whatsapp.testNumber || phone;
//     const to = normalizePhone(target);
//     if (!to) return { sent: false, skipped: `unusable phone number: ${phone}` };

//     const body = {
//       phone: to,
//       template_name: templateName,
//       language: languageCode,
//     };
//     params.forEach((value, i) => {
//       body[`field_${i + 1}`] = String(value ?? '');
//     });

//     try {
//       const data = await post('messages/template', body);
//       return {
//         ...unwrapSend(data, to),
//         templateName,
//         redirected: Boolean(config.whatsapp.testNumber) && to !== normalizePhone(phone),
//       };
//     } catch (error) {
//       const described = describeError(error, 'Failed to send WhatsApp template');
//       logger.warn('WhatsApp template send failed', { templateName, to, ...described });
//       return { sent: false, to, templateName, error: described };
//     }
//   },

//   /**
//    * Free-form text. Only reaches someone who replied within 24 hours —
//    * outside that window WhatsApp accepts it and never delivers it.
//    * For support conversations only; notifications must use sendTemplate().
//    */
//   async sendText({ phone, message }) {
//     if (!this.enabled) {
//       return skip(config.whatsapp.configured ? 'WHATSAPP_ENABLED=false' : 'WHATSAPP_ACCESS_TOKEN not set');
//     }
//     if (!message?.trim()) return { sent: false, skipped: 'empty message' };

//     const to = normalizePhone(config.whatsapp.testNumber || phone);
//     if (!to) return { sent: false, skipped: `unusable phone number: ${phone}` };

//     try {
//       const data = await post('messages/text', { phone: to, message: String(message) });
//       return unwrapSend(data, to);
//     } catch (error) {
//       const described = describeError(error, 'Failed to send WhatsApp message');
//       logger.warn('WhatsApp text send failed', { to, ...described });
//       return { sent: false, to, error: described };
//     }
//   },

//   /**
//    * Templates as the provider sees them. The source of truth for what may be
//    * sent — a name missing here, or not APPROVED, will fail at send time.
//    */
//   async listTemplates() {
//     if (!this.configured) return skip('WHATSAPP_ACCESS_TOKEN not set');

//     try {
//       const { data } = await axios.get(url('templates'), { headers: headers(), timeout: 20000 });
//       const rows = data?.data || [];
//       return {
//         ok: true,
//         templates: rows.map((t) => ({
//           name: t.template_name || t.name,
//           language: t.language,
//           category: t.category,
//           status: t.status,
//           body: t.body_data || '',
//           // What the caller must supply as `params`. Counted from the body so
//           // a mapping can be validated before anyone sends anything.
//           variableCount: (String(t.body_data || '').match(/\{\{\s*\d+\s*\}\}/g) || []).length,
//           providerId: t.id,
//           templateId: t.template_id,
//         })),
//       };
//     } catch (error) {
//       const described = describeError(error, 'Failed to list WhatsApp templates');
//       logger.warn('WhatsApp template list failed', described);
//       return { ok: false, templates: [], error: described };
//     }
//   },

//   /**
//    * Real delivery status for one message, by the provider's row id
//    * (`chatMessageId` from a send). Returns `failed` with the provider's own
//    * wording, e.g. "more than 24 hours have passed since the customer last
//    * replied to this number".
//    */
//   async getMessageStatus(chatMessageId) {
//     if (!this.configured) return skip('WHATSAPP_ACCESS_TOKEN not set');
//     if (!/^\d+$/.test(String(chatMessageId))) {
//       return { ok: false, error: { message: 'chatMessageId must be numeric' } };
//     }

//     try {
//       const { data } = await axios.get(url(`messages/${chatMessageId}`), { headers: headers(), timeout: 20000 });
//       const m = data?.data || {};
//       return {
//         ok: true,
//         id: m.id,
//         messageId: m.message_id,
//         type: m.type,
//         status: m.status,
//         statusMessage: m.status_message || null,
//         sentAt: m.sent_at,
//       };
//     } catch (error) {
//       const described = describeError(error, 'Failed to read message status');
//       return { ok: false, error: described };
//     }
//   },

//   /**
//    * Recent history with delivery status. Needed because template sends come
//    * back with no chatMessageId — their outcome is read from the conversation.
//    *
//    * @param {object} [opts]
//    * @param {number} [opts.chatId]  conversation to scope to
//    * @param {string} [opts.status]  sent | delivered | read | failed
//    * @param {number} [opts.limit]
//    */
//   async listMessages({ chatId, status, limit = 20 } = {}) {
//     if (!this.configured) return skip('WHATSAPP_ACCESS_TOKEN not set');

//     const params = { per_page: Math.min(limit, 100), sort: '-created_at' };
//     if (chatId) params['filter[interaction_id]'] = chatId;
//     if (status) params['filter[status]'] = status;

//     try {
//       const { data } = await axios.get(url('messages'), { headers: headers(), params, timeout: 20000 });
//       const rows = data?.data || [];
//       return {
//         ok: true,
//         messages: rows.map((m) => ({
//           id: m.id,
//           type: m.type,
//           status: m.status,
//           statusMessage: m.status_message || null,
//           messageId: m.message_id,
//           sender: m.sender_id,
//           sentAt: m.sent_at || m.created_at,
//         })),
//       };
//     } catch (error) {
//       const described = describeError(error, 'Failed to list WhatsApp messages');
//       return { ok: false, messages: [], error: described };
//     }
//   },

//   /**
//    * Submit a new template to the provider for Meta's approval.
//    *
//    * SmartWhap documents POST /whatsapp-template but does not deploy it — the
//    * live route answers 405, and so does a nonsense path, so it is a catch-all
//    * rather than a permissions problem. That is reported as
//    * `{ ok: false, unsupported: true }` rather than an error, because the
//    * caller's answer to it is different: keep the composed template as a local
//    * draft for someone to paste into the dashboard, instead of telling the user
//    * something broke.
//    */
//   async createTemplate({ name, category, language, body, sampleValues = [], footer }) {
//     if (!this.configured) return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN not set' };

//     const payload = { name, category, language, body };
//     if (sampleValues.length) payload.body_sample_values = sampleValues;
//     if (footer) payload.footer = footer;

//     try {
//       const { data } = await axios.post(url('whatsapp-template'), payload, {
//         headers: { ...headers(), 'Content-Type': 'application/json' },
//         timeout: 30000,
//       });
//       const created = data?.data || data || {};
//       return {
//         ok: true,
//         name: created.name || name,
//         status: created.status || 'PENDING',
//         templateId: created.template_id || created.id,
//         raw: data,
//       };
//     } catch (error) {
//       const described = describeError(error, 'Could not submit the template');
//       // 405/404 = the route is not there. 501 for completeness.
//       if ([404, 405, 501].includes(described.status)) {
//         return { ok: false, unsupported: true, reason: described.message, payload };
//       }
//       return { ok: false, reason: described.message, error: described, payload };
//     }
//   },

//   /**
//    * Credential check that sends nothing. Falls back to the template list when
//    * the token has no `account:read` scope, which is the current state of this
//    * account — a scope gap must not read as "credentials broken".
//    */
//   async verify() {
//     if (!this.configured) return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN not set' };

//     try {
//       const { data } = await axios.get(url('account'), { headers: headers(), timeout: 20000 });
//       const account = data?.data || data || {};
//       return { ok: true, scopeLimited: false, account };
//     } catch (error) {
//       const described = describeError(error, 'Credential verification failed');
//       if (described.status === 403 || described.code === 'INSUFFICIENT_SCOPE') {
//         const templates = await this.listTemplates();
//         return templates.ok
//           ? { ok: true, scopeLimited: true, approvedTemplates: templates.templates.length }
//           : { ok: false, reason: templates.error?.message || described.message };
//       }
//       return { ok: false, reason: described.message, error: described };
//     }
//   },
// };

// export default whatsappService;
