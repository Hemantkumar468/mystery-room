import { Router } from 'express';
import { whatsappController } from './whatsapp.controller.js';
import { validate } from '../../../core/middleware/validate.js';
import { authenticate, authorize } from '../../../core/middleware/auth.js';
import { CAN_MANAGE, CAN_ADMINISTER } from '../../../core/constants/index.js';
import {
  createTemplateSchema,
  updateSettingsSchema,
  listTemplatesSchema,
  updateTemplateSchema,
  upsertEventMapSchema,
  listLogsSchema,
  testSendSchema,
  idParamSchema,
} from './whatsapp.validation.js';

/**
 * WhatsApp notification settings.
 *
 * TWO PERMISSION TIERS, matching the rest of the app: managers run the channel
 * day to day (sync, map events, read logs, send a test), while anything
 * destructive or account-level is the MD's alone. Enforced here rather than in
 * the UI, because a hidden button is not a permission.
 */
const router = Router();
const canManage = authorize(...CAN_MANAGE);
const mdOnly = authorize(...CAN_ADMINISTER);

router.use(authenticate);

/* Settings ---------------------------------------------------------- */
router.get('/settings', canManage, whatsappController.getSettings);
router.patch('/settings', mdOnly, validate(updateSettingsSchema), whatsappController.updateSettings);
router.get('/verify', canManage, whatsappController.verify);

/* Templates — mirrored from SmartWhap, never authored here ----------- */
router.get('/templates', canManage, validate(listTemplatesSchema), whatsappController.listTemplates);
router.post('/templates/sync', canManage, whatsappController.syncTemplates);
// Composes a template and submits it. Falls back to a local DRAFT when the
// provider has no create endpoint — see the service for why that is not an error.
router.post('/templates', canManage, validate(createTemplateSchema), whatsappController.createTemplate);
router.patch('/templates/:id', canManage, validate(updateTemplateSchema), whatsappController.updateTemplate);
router.delete('/templates/:id', mdOnly, validate(idParamSchema), whatsappController.deleteTemplate);

/* Event mapping ----------------------------------------------------- */
router.get('/event-map', canManage, whatsappController.listEventMaps);
router.post('/event-map', canManage, validate(upsertEventMapSchema), whatsappController.upsertEventMap);
router.delete('/event-map/:id', mdOnly, validate(idParamSchema), whatsappController.deleteEventMap);

/* Logs — the only honest answer to "did the doer get it?" ------------ */
router.get('/logs', canManage, validate(listLogsSchema), whatsappController.listLogs);
router.get('/logs/summary', canManage, whatsappController.logSummary);
router.post('/logs/:id/refresh-status', canManage, validate(idParamSchema), whatsappController.refreshLogStatus);

/* Test send --------------------------------------------------------- */
router.post('/test-send', canManage, validate(testSendSchema), whatsappController.testSend);

export default router;
