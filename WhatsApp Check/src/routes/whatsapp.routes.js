const express = require('express');
const controller = require('../controllers/whatsapp.controller');

const router = express.Router();

// --- diagnostics -----------------------------------------------------------
router.get('/health', controller.health);
router.get('/verify', controller.verify);
router.post('/verify', controller.verify);
router.get('/templates', controller.templates);
router.get('/status/:id', controller.messageStatus); // delivery status by chatMessageId
router.get('/messages', controller.messageHistory); // recent history + real delivery status
router.post('/templates', controller.templates);
router.post('/templates/create', controller.createTemplate); // submit a new template for approval

// --- generic sender: { phone, message, type? } -----------------------------
router.post('/send', controller.sendGeneric);

// --- one route per message type -------------------------------------------
router.post('/send/text', controller.sendText);
router.post('/send/template', controller.sendTemplate);
router.post('/send/image', controller.sendImage);
router.post('/send/video', controller.sendVideo);
router.post('/send/audio', controller.sendAudio);
router.post('/send/document', controller.sendDocument);
router.post('/send/sticker', controller.sendSticker);
router.post('/send/location', controller.sendLocation);
router.post('/send/buttons', controller.sendButtons);
router.post('/send/list', controller.sendList);
router.post('/send/contacts', controller.sendContacts);
router.post('/send/reaction', controller.sendReaction);
router.post('/send/cta', controller.sendCta); // SmartWhap only: message + link button

// --- bulk + raw passthrough ------------------------------------------------
router.post('/send/bulk', controller.sendBulk);
router.post('/send/raw', controller.sendRaw);

module.exports = router;
