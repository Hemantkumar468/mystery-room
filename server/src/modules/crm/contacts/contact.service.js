import mongoose from 'mongoose';
import { Contact } from './contact.model.js';
import { Company } from '../companies/company.model.js';
import { Lead } from '../leads/lead.model.js';
import { Deal } from '../deals/deal.model.js';
import { CrmActivity } from '../activities/crmActivity.model.js';
import { CrmTask } from '../tasks/task.model.js';
import { buildScope, canManageCrm } from '../shared/scope.js';
import { resolveAssignee } from '../shared/ownership.js';
import { User } from '../../auth/auth.model.js';
import { normalisePhone, maskPhone } from '../intake/phone.js';
import { ENTITY_TYPE, TASK_STATUS } from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * Contacts and companies — the records that outlive an enquiry.
 *
 * Both entities live in one service because they are one screen's worth of
 * behaviour: list, open, edit, and see what is attached. Splitting them would
 * duplicate the scoping and the masking rather than clarify anything.
 *
 * Phone numbers are masked in LISTS and real in DETAIL, exactly as leads are.
 * A list is where a customer database gets copied one screenshot at a time;
 * opening a record is the deliberate act.
 */

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const contactService = {
  async list(query, user) {
    const scope = buildScope(user, { field: 'owner' });
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where = { ...scope };
    if (query.company && mongoose.isValidObjectId(query.company)) where.company = query.company;
    if (query.status) where.status = query.status;
    if (query.search) {
      const rx = new RegExp(escape(query.search), 'i');
      where.$or = [{ name: rx }, { email: rx }, { phone: rx }, { designation: rx }, { city: rx }];
    }

    const [total, items] = await Promise.all([
      Contact.countDocuments(where),
      Contact.find(where)
        .populate('company', 'name')
        .populate('owner', 'name avatarColor')
        .sort(query.sort === 'name' ? { name: 1 } : { updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return {
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: items.map((c) => ({ ...c, phone: maskPhone(c.phone), phoneMasked: true })),
    };
  },

  /** One contact with everything hanging off them. */
  async detail(id, user) {
    const scope = buildScope(user, { field: 'owner' });
    const contact = await Contact.findOne({ _id: id, ...scope })
      .populate('company', 'name industry city website')
      .populate('owner', 'name avatarColor')
      .lean();
    if (!contact) return null;

    const [timeline, deals, tasks, sourceLead] = await Promise.all([
      CrmActivity.find({ entityType: ENTITY_TYPE.CONTACT, entityId: id })
        .populate('actor', 'name avatarColor').sort({ occurredAt: -1 }).limit(100)
        .lean(),
      Deal.find({ contact: id }).select('title value stage pipeline stageEnteredAt closedAt').lean(),
      CrmTask.find({ entityType: ENTITY_TYPE.CONTACT, entityId: id, status: TASK_STATUS.OPEN })
        .sort({ dueAt: 1 }).lean(),
      // Where the relationship started. Never cleared, so it stays answerable.
      contact.lead ? Lead.findById(contact.lead).select('name source createdAt').lean() : null,
    ]);

    return { contact, timeline, deals, tasks, sourceLead };
  },

  async create(body, user) {
    const name = String(body.name || '').trim();
    if (!name) throw ApiError.badRequest('A contact needs a name');

    const phone = normalisePhone(body.phone);
    if (!phone && !body.email) {
      throw ApiError.badRequest('A contact needs a phone number or an email address');
    }

    const contact = await Contact.create({
      name,
      phone,
      phoneRaw: body.phone || undefined,
      altPhone: body.altPhone,
      email: body.email,
      company: body.company && mongoose.isValidObjectId(body.company) ? body.company : undefined,
      designation: body.designation,
      city: body.city,
      region: body.region,
      address: body.address,
      pincode: body.pincode,
      // Consent is recorded with WHEN and HOW, never as a bare boolean — see
      // the model. Meta's policy and the DPDP Act both make it evidence.
      whatsappOptIn: Boolean(body.whatsappOptIn),
      whatsappOptInAt: body.whatsappOptIn ? new Date() : undefined,
      whatsappOptInSource: body.whatsappOptIn ? (body.whatsappOptInSource || 'manual entry') : undefined,
      doNotDisturb: Boolean(body.doNotDisturb),
      notes: body.notes,
      owner: await resolveAssignee(body.owner, user, {
        User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
      }),
      createdBy: user._id || user.id,
    });
    return contact.toObject();
  },

  async update(id, body, user) {
    const scope = buildScope(user, { field: 'owner' });
    const contact = await Contact.findOne({ _id: id, ...scope });
    if (!contact) throw ApiError.notFound('Contact not found');

    // An allow-list, not a spread: `owner`, `lead` and the consent stamps are
    // the system's to set, and a form that could write them would let an agent
    // hand themselves someone else's contact or forge a consent date.
    for (const key of [
      'name', 'altPhone', 'email', 'designation', 'city', 'region',
      'address', 'pincode', 'notes', 'doNotDisturb',
    ]) {
      if (body[key] !== undefined) contact[key] = body[key];
    }
    if (body.phone !== undefined) {
      contact.phone = normalisePhone(body.phone);
      contact.phoneRaw = body.phone;
    }
    if (body.company !== undefined) {
      contact.company = body.company && mongoose.isValidObjectId(body.company) ? body.company : undefined;
    }
    if (body.whatsappOptIn !== undefined && Boolean(body.whatsappOptIn) !== contact.whatsappOptIn) {
      contact.whatsappOptIn = Boolean(body.whatsappOptIn);
      contact.whatsappOptInAt = contact.whatsappOptIn ? new Date() : undefined;
      contact.whatsappOptInSource = contact.whatsappOptIn
        ? (body.whatsappOptInSource || 'edited by an agent') : undefined;
    }

    await contact.save();
    return contact.toObject();
  },
};

export const companyService = {
  async list(query, user) {
    const scope = buildScope(user, { field: 'owner' });
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));

    const where = { ...scope };
    if (query.search) {
      const rx = new RegExp(escape(query.search), 'i');
      where.$or = [{ name: rx }, { city: rx }, { email: rx }, { website: rx }];
    }

    const [total, items] = await Promise.all([
      Company.countDocuments(where),
      Company.find(where).populate('owner', 'name avatarColor')
        .sort(query.sort === 'name' ? { name: 1 } : { updatedAt: -1 })
        .skip((page - 1) * limit).limit(limit)
        .lean(),
    ]);

    // How many people at each — the number that makes a company row useful
    // rather than a name with nothing behind it. One query, not one per row.
    const counts = await Contact.aggregate([
      { $match: { company: { $in: items.map((c) => c._id) } } },
      { $group: { _id: '$company', n: { $sum: 1 } } },
    ]);
    const byId = new Map(counts.map((c) => [String(c._id), c.n]));

    return {
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      items: items.map((c) => ({ ...c, contactCount: byId.get(String(c._id)) || 0 })),
    };
  },

  async detail(id, user) {
    const scope = buildScope(user, { field: 'owner' });
    const company = await Company.findOne({ _id: id, ...scope })
      .populate('owner', 'name avatarColor').lean();
    if (!company) return null;

    const [contacts, deals] = await Promise.all([
      Contact.find({ company: id }).select('name designation email phone').sort({ name: 1 }).lean(),
      Deal.find({ company: id }).select('title value stage closedAt').lean(),
    ]);
    return {
      company,
      contacts: contacts.map((c) => ({ ...c, phone: maskPhone(c.phone) })),
      deals,
    };
  },

  async create(body, user) {
    const name = String(body.name || '').trim();
    if (!name) throw ApiError.badRequest('A company needs a name');

    const company = await Company.create({
      name,
      website: body.website,
      phone: body.phone,
      email: body.email,
      city: body.city,
      region: body.region,
      address: body.address,
      pincode: body.pincode,
      owner: await resolveAssignee(body.owner, user, {
        User, canManage: canManageCrm, badRequest: ApiError.badRequest, forbidden: ApiError.forbidden,
      }),
      createdBy: user._id || user.id,
    });
    return company.toObject();
  },

  async update(id, body, user) {
    const scope = buildScope(user, { field: 'owner' });
    const company = await Company.findOne({ _id: id, ...scope });
    if (!company) throw ApiError.notFound('Company not found');
    for (const key of ['name', 'website', 'phone', 'email', 'city', 'region', 'address', 'pincode']) {
      if (body[key] !== undefined) company[key] = body[key];
    }
    await company.save();
    return company.toObject();
  },
};

export default contactService;
