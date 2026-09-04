import { whatsappService as provider } from '../../../core/services/whatsapp.service.js';
import { config } from '../../../config/index.js';
import { logger } from '../../../config/logger.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import {
  WhatsappTemplate,
  WhatsappEventMap,
  WhatsappLog,
  WhatsappSetting,
  WHATSAPP_EVENTS,
} from './whatsapp.model.js';

/**
 * The settings module's own logic: mirroring templates, mapping events to
 * them, and reading back what happened.
 *
 * Sending itself lives in core/services/whatsapp.service.js — this layer never
 * talks to SmartWhap except through it.
 */

/** Settings are a single row; create it on first read so the UI always has
 *  something to edit, and so defaults live in one place (the schema). */
async function getSettings() {
  const existing = await WhatsappSetting.findOne();
  if (existing) return existing;
  return WhatsappSetting.create({});
}

export const whatsappAdminService = {
  /* ---------------------------------------------------------------- */
  /* Settings                                                          */
  /* ---------------------------------------------------------------- */

  async getSettings() {
    const settings = await getSettings();
    return {
      ...settings.toObject(),
      /** What the environment allows, which the database cannot widen. Shown
       *  so an admin who has switched everything on and sees nothing sent has
       *  the answer on the same screen. */
      env: {
        configured: provider.configured,
        enabled: config.whatsapp.enabled,
        baseUrl: config.whatsapp.baseUrl,
        testMode: Boolean(config.whatsapp.testNumber),
        testNumber: config.whatsapp.testNumber || null,
      },
    };
  },

  async updateSettings(payload, userId) {
    const settings = await getSettings();
    Object.assign(settings, payload, { updatedBy: userId });
    await settings.save();
    return this.getSettings();
  },

  /** Credential check that sends nothing. */
  async verify() {
    const result = await provider.verify();
    return {
      ...result,
      /** Masked, never the token itself — this response reaches the browser. */
      token: config.whatsapp.accessToken
        ? `${config.whatsapp.accessToken.slice(0, 6)}****${config.whatsapp.accessToken.slice(-4)}`
        : null,
      baseUrl: config.whatsapp.baseUrl,
    };
  },

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */

  async listTemplates({ category, status } = {}) {
    const filter = {};
    if (category) filter.category = category;
    if (status) filter.status = status;
    return WhatsappTemplate.find(filter).sort({ category: 1, name: 1 });
  },

  /**
   * Pull the provider's list into the local mirror.
   *
   * A template that has disappeared upstream is marked REMOVED rather than
   * deleted: logs reference it by name, and a log row that cannot explain what
   * was sent is worse than a stale row.
   */
  async syncTemplates() {
    const result = await provider.listTemplates();
    if (!result.ok) {
      throw new ApiError(502, result.error?.message || 'Could not reach SmartWhap');
    }

    const now = new Date();
    const seen = new Set();
    let created = 0;
    let updated = 0;

    for (const t of result.templates) {
      if (!t.name) continue;
      seen.add(`${t.name}::${t.language}`);

      const existing = await WhatsappTemplate.findOne({ name: t.name, language: t.language });
      const fields = {
        category: t.category || 'UNKNOWN',
        status: t.status || 'PENDING',
        variableCount: t.variableCount,
        bodyPreview: String(t.body || '').slice(0, 1000),
        providerId: t.providerId ? String(t.providerId) : undefined,
        lastSyncedAt: now,
      };

      if (existing) {
        // description and isActive are ours — sync must never overwrite them.
        Object.assign(existing, fields);
        await existing.save();
        updated += 1;
      } else {
        await WhatsappTemplate.create({ name: t.name, language: t.language, ...fields });
        created += 1;
      }
    }

    // DRAFT rows are excluded: a draft has never existed upstream, so it is
    // not "missing" — marking it REMOVED on the first sync would delete the
    // composing work the moment anybody pressed the button.
    const stale = await WhatsappTemplate.find({ status: { $nin: ['REMOVED', 'DRAFT'] } });
    let removed = 0;
    for (const row of stale) {
      if (seen.has(`${row.name}::${row.language}`)) continue;
      row.status = 'REMOVED';
      row.lastSyncedAt = now;
      await row.save();
      removed += 1;
    }

    const settings = await getSettings();
    settings.lastSyncedAt = now;
    await settings.save();

    return { created, updated, removed, total: result.templates.length, syncedAt: now };
  },

  /**
   * Compose a template here and try to submit it.
   *
   * Meta's rules are checked BEFORE the network call, because a rejection
   * comes back hours later attached to nothing anybody remembers writing.
   *
   * If the provider cannot create it — SmartWhap's create route is not
   * deployed — the composed template is kept as a DRAFT with everything the
   * dashboard form needs. That is a materially different answer from "it
   * failed", so it is reported as its own outcome and the row is still
   * created: the work of composing it is not thrown away.
   */
  async createTemplate(payload, userId) {
    const name = String(payload.name || '').trim().toLowerCase();
    const body = String(payload.body || '').trim();
    const language = String(payload.language || 'en').trim();
    const category = String(payload.category || 'UTILITY').toUpperCase();
    const samples = (payload.bodySampleValues || []).map((v) => String(v));

    if (!/^[a-z0-9_]+$/.test(name)) {
      throw new ApiError(400, 'Name may contain only lowercase letters, numbers and underscores, e.g. pms_task_assigned');
    }
    if (!body) throw new ApiError(400, 'The message body is required');
    if (body.length > 1024) throw new ApiError(400, 'The body must be 1024 characters or fewer');

    const placeholders = body.match(/\{\{\s*\d+\s*\}\}/g) || [];
    const numbers = placeholders.map((p) => Number(p.replace(/[^\d]/g, '')));

    // Every one of these is a rejection Meta would send back later.
    const expected = numbers.map((_, i) => i + 1);
    if ([...numbers].sort((a, b) => a - b).join(',') !== expected.join(',')) {
      throw new ApiError(400, `Placeholders must run 1..${numbers.length} with no gaps or repeats — found ${numbers.join(', ') || 'none'}`);
    }
    if (/^\s*\{\{/.test(body) || /\}\}\s*$/.test(body)) {
      throw new ApiError(400, 'A placeholder cannot be the first or last thing in the body — text must surround it');
    }
    if (/\}\}[\s]*\{\{/.test(body)) {
      throw new ApiError(400, 'Two placeholders cannot sit next to each other — put text between them');
    }
    if (samples.length !== numbers.length) {
      throw new ApiError(400, `${numbers.length} placeholder(s) need ${numbers.length} sample value(s); ${samples.length} given`);
    }
    if (samples.some((v) => !v.trim())) {
      throw new ApiError(400, 'Every sample value needs text — Meta reviews the template using them');
    }

    const existing = await WhatsappTemplate.findOne({ name, language });
    if (existing) throw new ApiError(409, `A template named "${name}" already exists in ${language}`);

    const submitted = await provider.createTemplate({
      name, category, language, body, sampleValues: samples, footer: payload.footer,
    });

    const template = await WhatsappTemplate.create({
      name,
      language,
      category,
      status: submitted.ok ? (submitted.status || 'PENDING') : 'DRAFT',
      variableCount: numbers.length,
      bodyPreview: body,
      bodySampleValues: samples,
      footer: payload.footer || '',
      description: payload.description || '',
      createdBy: userId,
      providerId: submitted.templateId ? String(submitted.templateId) : undefined,
      lastSyncedAt: submitted.ok ? new Date() : undefined,
    });

    return {
      template,
      submitted: submitted.ok,
      unsupported: Boolean(submitted.unsupported),
      reason: submitted.ok ? null : submitted.reason,
      note: submitted.ok
        ? 'Submitted to Meta. It will show as APPROVED here after the next sync.'
        : submitted.unsupported
          ? 'Saved as a draft. The SmartWhap API cannot create templates, so create this one in their dashboard — the exact text and sample values are on the draft — then press Sync.'
          : `Saved as a draft. The provider refused it: ${submitted.reason}`,
    };
  },

  /** Only the two fields that are ours. Everything else comes from sync. */
  async updateTemplate(id, { description, isActive }) {
    const template = await WhatsappTemplate.findById(id);
    if (!template) throw new ApiError(404, 'Template not found');

    if (description !== undefined) template.description = description;
    if (isActive !== undefined) template.isActive = isActive;
    await template.save();
    return template;
  },

  /**
   * Remove a row from the local mirror. MD only — see the routes.
   *
   * Refused while an enabled mapping still points at it, because the
   * alternative is a notification that silently stops working with nothing on
   * screen to explain why.
   */
  async deleteTemplate(id) {
    const template = await WhatsappTemplate.findById(id);
    if (!template) throw new ApiError(404, 'Template not found');

    const inUse = await WhatsappEventMap.findOne({ templateName: template.name, isEnabled: true });
    if (inUse) {
      throw new ApiError(
        409,
        `"${template.name}" is still mapped to ${inUse.eventKey}. Disable that event first.`,
      );
    }

    await template.deleteOne();
    return { deleted: true, name: template.name };
  },

  /* ---------------------------------------------------------------- */
  /* Event mapping                                                     */
  /* ---------------------------------------------------------------- */

  async listEventMaps() {
    const maps = await WhatsappEventMap.find().sort({ eventKey: 1 });
    // Every known event is returned, mapped or not — the UI shows the full
    // list of what CAN be wired up, not just what already is.
    const byKey = new Map(maps.map((m) => [m.eventKey, m.toObject()]));
    return Object.values(WHATSAPP_EVENTS).map(
      (eventKey) => byKey.get(eventKey) || { eventKey, isEnabled: false, paramMapping: [], unmapped: true },
    );
  },

  /**
   * Create or update one event's mapping.
   *
   * The count check is the important part: WhatsApp rejects a template whose
   * variables are not all supplied, and that rejection arrives asynchronously —
   * long after the person who saved a broken mapping has left the screen.
   */
  async upsertEventMap(payload, userId) {
    const { eventKey, templateName, language = 'en', paramMapping = [] } = payload;

    const template = await WhatsappTemplate.findOne({ name: templateName, language });
    if (!template) {
      throw new ApiError(404, `No template "${templateName}" (${language}). Run a sync first.`);
    }
    if (template.status !== 'APPROVED') {
      throw new ApiError(400, `"${templateName}" is ${template.status}. Only APPROVED templates can be used.`);
    }
    if (template.category === 'MARKETING') {
      throw new ApiError(
        400,
        `"${templateName}" is a MARKETING template. Meta throttles those — notifications need a UTILITY template.`,
      );
    }
    if (paramMapping.length !== template.variableCount) {
      throw new ApiError(
        400,
        `"${templateName}" needs exactly ${template.variableCount} value(s); ${paramMapping.length} given.`,
      );
    }

    const positions = paramMapping.map((p) => p.position).sort((a, b) => a - b);
    const expected = Array.from({ length: template.variableCount }, (_, i) => i + 1);
    if (positions.join(',') !== expected.join(',')) {
      throw new ApiError(400, `Values must fill positions ${expected.join(', ')} exactly once each.`);
    }

    const update = { ...payload, language, updatedBy: userId };
    return WhatsappEventMap.findOneAndUpdate({ eventKey }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    });
  },

  async deleteEventMap(id) {
    const map = await WhatsappEventMap.findById(id);
    if (!map) throw new ApiError(404, 'Event mapping not found');
    await map.deleteOne();
    return { deleted: true, eventKey: map.eventKey };
  },

  /* ---------------------------------------------------------------- */
  /* Logs                                                              */
  /* ---------------------------------------------------------------- */

  async listLogs({ status, eventKey, from, to, page = 1, limit = 25 } = {}) {
    const filter = {};
    if (status) filter.status = status;
    if (eventKey) filter.eventKey = eventKey;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const [items, total] = await Promise.all([
      WhatsappLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('recipient', 'name email')
        .populate('task', 'title'),
      WhatsappLog.countDocuments(filter),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
  },

  /** Counts for the tiles. Today only — the question being answered is
   *  "is the channel healthy right now". */
  async logSummary() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const rows = await WhatsappLog.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const summary = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
    rows.forEach((r) => {
      if (r._id in summary) summary[r._id] = r.count;
    });
    return summary;
  },

  /**
   * Ask the provider what became of one message and write it back.
   * Template sends carry no chatMessageId, so those cannot be refreshed
   * individually — the scheduled sweep reads them from the conversation.
   */
  async refreshLogStatus(id) {
    const log = await WhatsappLog.findById(id);
    if (!log) throw new ApiError(404, 'Log entry not found');
    if (!log.chatMessageId) {
      throw new ApiError(400, 'This message has no provider id — template sends report status through the sweep.');
    }

    const result = await provider.getMessageStatus(log.chatMessageId);
    if (!result.ok) {
      throw new ApiError(502, result.error?.message || 'Could not read status');
    }

    log.status = result.status || log.status;
    log.statusMessage = result.statusMessage || null;
    if (result.status === 'delivered' || result.status === 'read') log.deliveredAt = new Date();
    await log.save();
    return log;
  },

  /* ---------------------------------------------------------------- */
  /* Test send                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Send one template by hand, from the settings screen.
   *
   * Deliberately bypasses the event map (there may not be one yet) but NOT the
   * global switch: an admin who has turned WhatsApp off must not be able to
   * send from a corner of the UI.
   */
  async testSend({ phone, templateName, language = 'en', params = [] }, userId) {
    const settings = await getSettings();
    if (!settings.isEnabled) {
      throw new ApiError(400, 'WhatsApp is switched off in settings. Turn it on before sending.');
    }
    if (!provider.enabled) {
      throw new ApiError(
        400,
        provider.configured
          ? 'WHATSAPP_ENABLED is false in the server environment.'
          : 'WHATSAPP_ACCESS_TOKEN is not set on the server.',
      );
    }

    const template = await WhatsappTemplate.findOne({ name: templateName, language });
    if (template && template.variableCount !== params.length) {
      throw new ApiError(
        400,
        `"${templateName}" needs exactly ${template.variableCount} value(s); ${params.length} given.`,
      );
    }

    const log = await WhatsappLog.create({
      eventKey: 'TEST',
      templateName,
      language,
      phone,
      params,
      status: 'queued',
      triggeredBy: userId,
    });

    const result = await provider.sendTemplate({ phone, templateName, languageCode: language, params });

    if (result.sent) {
      log.status = 'sent';
      log.messageId = result.messageId;
      log.chatMessageId = result.chatMessageId;
      log.chatId = result.chatId;
      log.redirected = Boolean(result.redirected);
      log.sentAt = new Date();
    } else {
      log.status = result.skipped ? 'skipped' : 'failed';
      log.statusMessage = result.skipped || result.error?.message;
      log.error = result.error;
    }
    await log.save();

    if (!result.sent) {
      logger.warn('WhatsApp test send did not go out', { templateName, reason: log.statusMessage });
    }

    return {
      log,
      // Said plainly, because "sent" reads as success and is not.
      note: result.sent
        ? 'Accepted by the provider. This is not delivery — refresh the status in a few seconds.'
        : 'Not sent.',
    };
  },
};

export default whatsappAdminService;
