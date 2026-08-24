import mongoose from 'mongoose';
import { ApiError } from '../../../core/utils/ApiError.js';
import { logger } from '../../../config/logger.js';
import { recordAudit } from '../../../core/audit/audit.js';
import { AuditLog } from '../../../core/audit/audit.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { ROLES } from '../../../core/constants/index.js';
import { ExportRequest } from './export.model.js';
import { Lead } from '../leads/lead.model.js';
import { Contact } from '../contacts/contact.model.js';
import { Deal } from '../deals/deal.model.js';

/**
 * Taking customer data out of the system, deliberately and on the record.
 *
 * THE THRESHOLDS ARE ABOUT INTENT, not about bytes. Fifty rows is somebody
 * building a call list for the afternoon. A thousand is somebody taking the
 * customer base. The same button producing both, with no friction between
 * them, is how a CRM leaks — usually on the last day of somebody's notice
 * period, and usually without anybody noticing for months.
 *
 *   ≤ 50      an agent may, and it is logged
 *   51–1000   a manager approves
 *   > 1000    an admin approves, and a reason is compulsory
 *
 * Logged either way. The small exports are not the risk, but they are the
 * pattern that makes an unusual one visible.
 */

/** Who has to say yes, for a given number of rows. */
export function approvalFor(rowCount) {
  if (rowCount <= 50) return { level: 'self', needsReason: false };
  if (rowCount <= 1000) return { level: 'manager', needsReason: false };
  return { level: 'admin', needsReason: true };
}

const DATASETS = {
  leads: {
    model: () => Lead,
    scopeField: 'assignedTo',
    columns: ['name', 'phone', 'email', 'city', 'company', 'source', 'status', 'createdAt'],
  },
  contacts: {
    model: () => Contact,
    scopeField: 'owner',
    columns: ['name', 'phone', 'email', 'city', 'designation', 'createdAt'],
  },
  deals: {
    model: () => Deal,
    scopeField: 'assignedTo',
    columns: ['title', 'value', 'currency', 'lostReason', 'lostAtStageName', 'createdAt'],
  },
};

/** A CSV cell that cannot break the row, or the spreadsheet that opens it. */
function cell(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  /* A leading =, +, - or @ makes Excel treat the cell as a FORMULA. An exported
     customer name of `=cmd|...` is a live attack on whoever opens the file, and
     it arrives looking like our own export. Prefixed with a quote, which Excel
     shows as text and every other reader ignores. */
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const exportService = {
  approvalFor,

  /**
   * Ask for an export. Counts the rows first, because the count decides who
   * has to approve it and the requester should learn that before they wait.
   */
  async request(body, user) {
    const spec = DATASETS[body?.dataset];
    if (!spec) {
      throw ApiError.badRequest(
        `Unknown dataset. Exportable: ${Object.keys(DATASETS).join(', ')}`,
        { code: 'EXPORT_UNKNOWN_DATASET' },
      );
    }

    const scope = buildScope(user, { field: spec.scopeField });
    const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
    /* THE FILTER IS NOT PASSED THROUGH. Only fields this dataset declares can
       be filtered on — an arbitrary object from a request body reaching a
       Mongo query is the same hole as an unvalidated `$where`. */
    const safeFilters = Object.fromEntries(
      Object.entries(filters).filter(([k]) => spec.columns.includes(k)),
    );

    const where = { ...scope, ...safeFilters };
    const rowCount = await spec.model().countDocuments(where);

    const rule = approvalFor(rowCount);
    if (rule.needsReason && !String(body.reason || '').trim()) {
      throw ApiError.badRequest(
        `An export of ${rowCount} rows needs a written reason.`,
        { code: 'EXPORT_REASON_REQUIRED', details: { rowCount } },
      );
    }
    if (rule.level === 'admin' && !canManageCrm(user) && user.role !== ROLES.MD) {
      // Requesting is still allowed — approving is not. Said here so the
      // requester knows it is going to somebody else rather than wondering.
      logger.info(`Export of ${rowCount} rows requested by ${user.name} — needs an admin.`);
    }

    const request = await ExportRequest.create({
      dataset: body.dataset,
      filters: safeFilters,
      rowCount,
      reason: String(body.reason || '').trim() || undefined,
      requestedBy: user._id || user.id,
      requestedByName: user.name,
      // A small export by the person who owns the records needs nobody's
      // permission — but it is still a row in this collection.
      status: rule.level === 'self' ? 'approved' : 'pending',
      approvedBy: rule.level === 'self' ? (user._id || user.id) : undefined,
      approvedAt: rule.level === 'self' ? new Date() : undefined,
    });

    await recordAudit({
      entity: 'ExportRequest',
      entityId: request._id,
      label: `${body.dataset} × ${rowCount}`,
      action: 'export',
      detail: `Requested ${rowCount} ${body.dataset}. Approval: ${rule.level}.`
        + (request.reason ? ` Reason: ${request.reason}` : ''),
    });

    if (rule.level === 'self') await exportService.build(String(request._id));
    return ExportRequest.findById(request._id).lean();
  },

  async list(query, user) {
    const where = canManageCrm(user) ? {} : { requestedBy: user._id || user.id };
    if (query?.status) where.status = query.status;
    const [items, total] = await Promise.all([
      ExportRequest.find(where).sort({ createdAt: -1 }).limit(100).lean(),
      ExportRequest.countDocuments(where),
    ]);
    return { total, items };
  },

  /**
   * Approve, and build. Refused when the approver is not senior enough for the
   * size — the whole point of the tiers.
   */
  async approve(id, user) {
    if (!mongoose.isValidObjectId(id)) return null;
    const request = await ExportRequest.findById(id);
    if (!request || request.status !== 'pending') return null;

    const rule = approvalFor(request.rowCount);
    const isAdmin = user.role === ROLES.MD || user.role === ROLES.EA;
    if (rule.level === 'admin' && !isAdmin) {
      throw ApiError.forbidden(
        `${request.rowCount} rows needs an admin to approve, not a manager.`,
        { code: 'EXPORT_NEEDS_ADMIN' },
      );
    }
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can approve an export', { code: 'EXPORT_FORBIDDEN' });
    }
    if (String(request.requestedBy) === String(user._id || user.id) && rule.level !== 'self') {
      /* NOBODY APPROVES THEIR OWN. The tier exists to put a second person in
         the room; letting the requester be that person removes the only thing
         it was for. */
      throw ApiError.forbidden(
        'An export this size has to be approved by somebody else.',
        { code: 'EXPORT_SELF_APPROVAL' },
      );
    }

    request.status = 'approved';
    request.approvedBy = user._id || user.id;
    request.approvedAt = new Date();
    await request.save();

    await recordAudit({
      entity: 'ExportRequest',
      entityId: request._id,
      label: `${request.dataset} × ${request.rowCount}`,
      action: 'export',
      detail: `Approved for ${request.requestedByName}.`,
    });

    await exportService.build(String(request._id));
    return ExportRequest.findById(request._id).lean();
  },

  async reject(id, body, user) {
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can reject an export', { code: 'EXPORT_FORBIDDEN' });
    }
    const request = await ExportRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          rejectedReason: String(body?.reason || '').trim() || 'No reason given',
          approvedBy: user._id || user.id,
          approvedAt: new Date(),
        },
      },
      { new: true },
    ).lean();
    return request;
  },

  /**
   * Build the file and put it in S3.
   *
   * WATERMARKED WITH WHO ASKED AND WHEN. A CSV that escapes has no context —
   * it is just a list of customers. A first line naming the person it was
   * produced for, and the moment, means a leaked file identifies its own
   * source. It does not prevent anything; it makes the question answerable.
   */
  async build(id) {
    const request = await ExportRequest.findById(id);
    if (!request || request.status !== 'approved') return null;

    try {
      const spec = DATASETS[request.dataset];
      const rows = await spec.model()
        .find(request.filters || {})
        .select(spec.columns.join(' '))
        .limit(50_000)
        .lean();

      const stamp = new Date();
      const header = [
        `# Exported for ${request.requestedByName} on ${stamp.toISOString()}`,
        `# ${rows.length} ${request.dataset}. This file identifies its origin — treat it as customer data.`,
        spec.columns.join(','),
      ];
      const body = rows.map((r) => spec.columns.map((c) => cell(r[c])).join(','));
      const csv = [...header, ...body].join('\n');

      const { isS3Configured, uploadBuffer } = await import('../../../config/s3.js');
      if (!isS3Configured) {
        /* Refused rather than handed back inline. An export that bypasses
           storage also bypasses the expiry, and a link that never dies is the
           thing this whole flow exists to avoid. */
        request.status = 'failed';
        request.error = 'File storage (S3) is not configured on this server.';
        await request.save();
        return request.toObject();
      }

      const uploaded = await uploadBuffer(Buffer.from(csv, 'utf8'), {
        folder: 'crm/exports',
        filename: `${request.dataset}-${stamp.getTime()}.csv`,
        contentType: 'text/csv',
      });

      // `public_id`, which is what uploadBuffer actually returns — the key.
      // Guessing `key` here would have stored undefined and produced a link to
      // nothing, with the request still cheerfully marked ready.
      request.s3Key = uploaded.public_id;
      request.builtAt = stamp;
      // One hour, and then it is gone whether or not anybody fetched it.
      request.expiresAt = new Date(stamp.getTime() + 3600_000);
      request.status = 'ready';
      await request.save();
      return request.toObject();
    } catch (err) {
      logger.error(`Export ${id} failed to build: ${err.message}`);
      request.status = 'failed';
      request.error = err.message.slice(0, 500);
      await request.save();
      return request.toObject();
    }
  },

  /**
   * Mint a download link. Short-lived, minted on demand, counted.
   */
  async link(id, user) {
    const request = await ExportRequest.findById(id);
    if (!request || request.status !== 'ready') return null;

    const mine = String(request.requestedBy) === String(user._id || user.id);
    if (!mine && !canManageCrm(user)) return null;

    if (!request.expiresAt || request.expiresAt < new Date()) {
      request.status = 'expired';
      await request.save();
      throw ApiError.badRequest(
        'That export has expired. Request it again — links last an hour on purpose.',
        { code: 'EXPORT_EXPIRED' },
      );
    }

    const { getPresignedUrl } = await import('../../../config/s3.js');
    const url = await getPresignedUrl(request.s3Key, 3600);

    request.downloads += 1;
    await request.save();

    await recordAudit({
      entity: 'ExportRequest',
      entityId: request._id,
      label: `${request.dataset} × ${request.rowCount}`,
      action: 'export',
      detail: `Downloaded (${request.downloads} time${request.downloads === 1 ? '' : 's'}).`,
    });

    return { url, expiresAt: request.expiresAt, downloads: request.downloads };
  },

  /**
   * Is somebody reading records one at a time, at machine pace?
   *
   * FOUR HUNDRED RECORDS IN AN HOUR IS NOT READING, it is copying. An export
   * has a threshold and an approver; opening records one by one has neither,
   * which makes it the obvious way around this whole flow. Recorded as an
   * audit row so it sits in the same place somebody already looks.
   */
  async noteAccess(entity, entityId, user) {
    await recordAudit({
      entity, entityId, action: 'access',
    });

    const since = new Date(Date.now() - 3600_000);
    const seen = await AuditLog.countDocuments({
      actor: user._id || user.id, action: 'access', createdAt: { $gte: since },
    });

    if (seen === 400) {
      /* EXACTLY at the threshold, not above it — otherwise every subsequent
         view raises the alarm again and the signal drowns in its own noise. */
      logger.warn(
        `${user.name} has opened ${seen} customer records in the last hour. `
        + 'That is the pace of a script, not a person — worth a look.',
      );
      await recordAudit({
        entity: 'User',
        entityId: user._id || user.id,
        label: user.name,
        action: 'access',
        detail: `Opened ${seen} records in an hour — possible bulk copying.`,
      });
    }
    return seen;
  },
};

export default exportService;
