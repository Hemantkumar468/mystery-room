const whatsappService = require('../services/whatsapp.service');
const { resolveCredentials, maskToken } = require('../services/credentials.service');

/** Wraps an async handler so thrown errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const health = (req, res) => {
  res.json({
    success: true,
    service: 'WhatsApp Check',
    status: 'up',
    time: new Date().toISOString(),
    supportedTypes: whatsappService.SUPPORTED_TYPES,
    providers: Object.keys(whatsappService.PROVIDERS),
  });
};

const verify = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const data = await whatsappService.verifyCredentials(credentials);

  res.json({
    success: true,
    message: 'Credentials are valid',
    credentials: {
      provider: credentials.provider,
      baseUrl: credentials.baseUrl,
      phoneNumberId: credentials.phoneNumberId || null,
      accessToken: maskToken(credentials.accessToken),
    },
    account: whatsappService.describeAccount(credentials, data),
  });
});

/** Builds one handler for a fixed message type (or for the generic /send route). */
const sendAs = (type) =>
  asyncHandler(async (req, res) => {
    const credentials = resolveCredentials(req);
    const result = await whatsappService.sendMessage(credentials, req.body || {}, type);

    res.status(201).json({
      success: true,
      message: `WhatsApp ${result.type} message accepted by ${credentials.provider}`,
      data: {
        messageId: result.messageId,
        messageStatus: result.messageStatus,
        to: result.to,
        waId: result.waId,
        type: result.type,
        provider: credentials.provider,
        chatMessageId: result.chatMessageId,
      },
      meta: result.raw,
    });
  });

const sendBulk = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const summary = await whatsappService.sendBulk(credentials, req.body || {});

  res.status(summary.failed === summary.total ? 400 : 201).json({
    success: summary.sent > 0,
    message: `${summary.sent} of ${summary.total} messages accepted by ${credentials.provider}`,
    data: summary,
  });
});

/** Escape hatch: send any raw provider payload untouched. */
const sendRaw = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const payload = (req.body && req.body.payload) || {};

  // messaging_product is a Meta-only field; SmartWhap takes plain fields.
  if (credentials.provider === 'meta' && !payload.messaging_product) payload.messaging_product = 'whatsapp';
  const result = await whatsappService.sendPayload(credentials, payload);

  res.status(201).json({ success: true, message: 'Raw payload sent', data: result });
});

/** Delivery status of a message already sent (SmartWhap: GET /messages/{id}). */
const messageStatus = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const data = await whatsappService.getMessageStatus(credentials, req.params.id);

  res.json({
    success: true,
    message: `Message is "${data.status}"`,
    data,
  });
});

/** Recent message history with delivery status (SmartWhap: GET /messages). */
const messageHistory = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const data = await whatsappService.listMessages(credentials, {
    chatId: req.query.chatId,
    status: req.query.status,
    type: req.query.type,
    direction: req.query.direction,
    search: req.query.search,
    limit: req.query.limit,
  });

  res.json({ success: true, ...data });
});

/** Create a template and submit it to Meta for approval. */
const createTemplate = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const result = await whatsappService.createTemplate(credentials, req.body || {});

  res.status(201).json({
    success: true,
    message: `Template "${result.name}" submitted for approval (status: ${result.status})`,
    data: result,
  });
});

const templates = asyncHandler(async (req, res) => {
  const credentials = resolveCredentials(req);
  const wabaId = (req.body && req.body.businessAccountId) || req.query.businessAccountId;
  const data = await whatsappService.listTemplates(credentials, wabaId);

  res.json({
    success: true,
    count: (data.data || []).length,
    templates: (data.data || []).map((t) => ({
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
    })),
  });
});

module.exports = {
  health,
  verify,
  sendBulk,
  sendRaw,
  templates,
  createTemplate,
  messageStatus,
  messageHistory,
  sendGeneric: sendAs(null),
  sendText: sendAs('text'),
  sendTemplate: sendAs('template'),
  sendImage: sendAs('image'),
  sendVideo: sendAs('video'),
  sendAudio: sendAs('audio'),
  sendDocument: sendAs('document'),
  sendSticker: sendAs('sticker'),
  sendLocation: sendAs('location'),
  sendButtons: sendAs('button'),
  sendList: sendAs('list'),
  sendContacts: sendAs('contacts'),
  sendReaction: sendAs('reaction'),
  sendCta: sendAs('cta'),
};
