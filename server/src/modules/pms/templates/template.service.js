import { Template } from './template.model.js';
import { Project } from '../projects/project.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { TEMPLATE_STATUS } from '../../../core/constants/index.js';
import { getPagination, parseSort, buildMeta } from '../../../core/utils/pagination.js';

export const templateService = {
  async list(query = {}) {
    const { page, limit, skip } = getPagination(query);
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.search) filter.$or = [
      { name: new RegExp(query.search, 'i') },
      { code: new RegExp(query.search, 'i') },
    ];

    const [items, total] = await Promise.all([
      Template.find(filter).sort(parseSort(query.sort)).skip(skip).limit(limit),
      Template.countDocuments(filter),
    ]);
    return { items, meta: buildMeta({ page, limit, total }) };
  },

  async getById(id) {
    const template = await Template.findById(id).populate('createdBy', 'name role');
    if (!template) throw ApiError.notFound('Template not found');
    return template;
  },

  /** The playbook a new project starts from when the creator doesn't pick one.
   * `workflowType` is accepted but unused today — every published default is
   * global. Once multiple workflow types exist (Store Launch, Airport, Mall,
   * ...), scope this filter by type instead of changing every caller. */
  async getDefault(workflowType) { // eslint-disable-line no-unused-vars
    return Template.findOne({ isDefault: true, status: TEMPLATE_STATUS.PUBLISHED });
  },

  /** Project creation's single entry point for "which template do I start
   * from" — never a client-supplied id. Threads `workflowType` through so a
   * future multi-workflow rollout only has to change `getDefault`, not every
   * caller of this function. */
  async resolveDefaultTemplate(workflowType) {
    const template = await this.getDefault(workflowType);
    if (!template) {
      throw ApiError.badRequest(
        'No default template is configured. Please ask an administrator to configure a default template.',
      );
    }
    return template;
  },

  async create(data, userId) {
    this.assertUniqueKeys(data.stages);
    if (data.isDefault) this.assertPublishable(data.status);
    // Demote any existing default *before* creating the new one, so a crash
    // between the two writes leaves at most zero defaults, never two.
    if (data.isDefault) await this.demoteOtherDefaults(null);
    const template = await Template.create({ ...data, createdBy: userId });
    return template;
  },

  async update(id, data) {
    if (data.stages) this.assertUniqueKeys(data.stages);
    const template = await Template.findById(id);
    if (!template) throw ApiError.notFound('Template not found');

    if (data.isDefault) {
      // A template only becomes default if it will be published once this
      // update lands — `status` may be changing in the same request.
      this.assertPublishable(data.status ?? template.status);
      // Demote everyone else first — see comment in `create`.
      await this.demoteOtherDefaults(id);
    }

    if (template.status === TEMPLATE_STATUS.PUBLISHED && data.stages) {
      // Editing a published template's structure bumps the version so live
      // projects (which snapshot a version) are never mutated underneath.
      data.version = (template.version || 1) + 1;
    }
    Object.assign(template, data);
    await template.save();
    return template;
  },

  /** Promote one template to default, demoting whichever held the flag before.
   * Demote-then-promote (not the reverse) so the worst case under a crash or
   * a concurrent call is a transient *zero* defaults — never two. A momentary
   * "no default" is safe: it just means the next project creation blocks
   * with the configured error until a default is set again. */
  async setDefault(id) {
    const template = await Template.findById(id);
    if (!template) throw ApiError.notFound('Template not found');
    this.assertPublishable(template.status);
    if (!template.stages?.length) {
      throw ApiError.badRequest('Cannot default to an empty template');
    }
    await this.demoteOtherDefaults(id);
    template.isDefault = true;
    await template.save();
    return template;
  },

  /** Clear `isDefault` everywhere except `keepId`, so at most one survives.
   * Pass `null` when the template being promoted doesn't exist yet (create). */
  async demoteOtherDefaults(keepId) {
    await Template.updateMany(
      { _id: { $ne: keepId }, isDefault: true },
      { $set: { isDefault: false } },
    );
  },

  assertPublishable(status) {
    if (status !== TEMPLATE_STATUS.PUBLISHED) {
      throw ApiError.badRequest(
        'Only a published template can be the default — publish it first.',
      );
    }
  },

  async publish(id) {
    const template = await Template.findById(id);
    if (!template) throw ApiError.notFound('Template not found');
    if (!template.stages?.length) throw ApiError.badRequest('Cannot publish an empty template');
    template.status = TEMPLATE_STATUS.PUBLISHED;
    await template.save();
    return template;
  },

  async archive(id) {
    // Archiving retires the playbook, so it can no longer be the default.
    const template = await Template.findByIdAndUpdate(
      id,
      { status: TEMPLATE_STATUS.ARCHIVED, isDefault: false },
      { new: true },
    );
    if (!template) throw ApiError.notFound('Template not found');
    return template;
  },

  async clone(id, userId) {
    const source = await Template.findById(id).lean();
    if (!source) throw ApiError.notFound('Template not found');
    delete source._id;
    delete source.createdAt;
    delete source.updatedAt;
    return Template.create({
      ...source,
      name: `${source.name} (Copy)`,
      code: `${source.code}-COPY-${Date.now().toString(36).toUpperCase()}`,
      status: TEMPLATE_STATUS.DRAFT,
      version: 1,
      isDefault: false,
      createdBy: userId,
    });
  },

  async remove(id) {
    // Projects resolve their per-stage master-data schema by looking this
    // template up live (record.service.js#loadStageContext). Deleting one
    // that's still in use would leave those projects with no schema at all,
    // silently disabling required-field validation on every form they own.
    const inUse = await Project.countDocuments({ 'template.ref': id });
    if (inUse > 0) {
      throw ApiError.badRequest(
        `This template is still used by ${inUse} project${inUse === 1 ? '' : 's'} — archive it instead of deleting it.`,
      );
    }
    const template = await Template.findByIdAndDelete(id);
    if (!template) throw ApiError.notFound('Template not found');
    return template;
  },

  /** Guard: stage keys unique across template; task keys unique within a stage. */
  assertUniqueKeys(stages = []) {
    const stageKeys = new Set();
    for (const stage of stages) {
      if (stageKeys.has(stage.key)) {
        throw ApiError.badRequest(`Duplicate stage key: "${stage.key}"`);
      }
      stageKeys.add(stage.key);
      const taskKeys = new Set();
      for (const task of stage.tasks || []) {
        if (taskKeys.has(task.key)) {
          throw ApiError.badRequest(`Duplicate task key "${task.key}" in stage "${stage.key}"`);
        }
        taskKeys.add(task.key);
      }
    }
  },
};

export default templateService;
