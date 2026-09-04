const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const whatsappRoutes = require('./routes/whatsapp.routes');
const apiKeyGuard = require('./middlewares/apiKey');
const { notFound, errorHandler } = require('./middlewares/error');
const { SUPPORTED_TYPES } = require('./services/whatsapp.service');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(apiKeyGuard);

app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'WhatsApp Check',
    description: 'Send WhatsApp messages through the Meta Cloud API to verify a Phone Number ID + Access Token pair',
    supportedTypes: SUPPORTED_TYPES,
    endpoints: {
      health: 'GET  /api/whatsapp/health',
      verify: 'POST /api/whatsapp/verify',
      templatesList: 'POST /api/whatsapp/templates',
      templateCreate: 'POST /api/whatsapp/templates/create   { name, category, language, body, bodySampleValues[] }',
      messageStatus: 'GET  /api/whatsapp/status/:chatMessageId   (was it actually delivered?)',
      messageHistory: 'GET  /api/whatsapp/messages?chatId=&status=&limit=   (history + delivery status)',
      send: 'POST /api/whatsapp/send            { phone, message, type? }',
      sendText: 'POST /api/whatsapp/send/text       { phone, message }',
      sendTemplate: 'POST /api/whatsapp/send/template   { phone, templateName, languageCode, bodyParams[] }',
      sendImage: 'POST /api/whatsapp/send/image      { phone, link, caption }',
      sendDocument: 'POST /api/whatsapp/send/document   { phone, link, filename, caption }',
      sendVideo: 'POST /api/whatsapp/send/video      { phone, link, caption }',
      sendAudio: 'POST /api/whatsapp/send/audio      { phone, link }',
      sendSticker: 'POST /api/whatsapp/send/sticker    { phone, link }',
      sendLocation: 'POST /api/whatsapp/send/location   { phone, latitude, longitude, name, address }',
      sendButtons: 'POST /api/whatsapp/send/buttons    { phone, message, buttons[] }',
      sendList: 'POST /api/whatsapp/send/list       { phone, message, buttonText, sections[] }',
      sendContacts: 'POST /api/whatsapp/send/contacts   { phone, contacts[] }',
      sendReaction: 'POST /api/whatsapp/send/reaction   { phone, messageId, emoji }',
      sendCta: 'POST /api/whatsapp/send/cta        { phone, message, buttonText, buttonUrl }  (SmartWhap)',
      sendBulk: 'POST /api/whatsapp/send/bulk       { phones[], message }',
      sendRaw: 'POST /api/whatsapp/send/raw        { payload }',
    },
    providers: ['meta', 'smartwhap'],
    credentials:
      'phoneNumberId / accessToken may be sent in the JSON body, as x-wa-phone-number-id / x-wa-access-token headers, or read from .env. The provider is auto-detected from the token shape (wm_ = smartwhap, EAA = meta) unless WHATSAPP_PROVIDER is set.',
  });
});

app.use('/api/whatsapp', whatsappRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
