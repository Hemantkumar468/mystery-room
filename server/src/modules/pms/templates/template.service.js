import { Template } from './template.model.js';
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

  async create(data, userId) {
    this.assertUniqueKeys(data.stages);
    const template = await Template.create({ ...data, createdBy: userId });
    return template;
  },

  async update(id, data) {
    if (data.stages) this.assertUniqueKeys(data.stages);
    const template = await Template.findById(id);
    if (!template) throw ApiError.notFound('Template not found');
    if (template.status === TEMPLATE_STATUS.PUBLISHED && data.stages) {
      // Editing a published template's structure bumps the version so live
      // projects (which snapshot a version) are never mutated underneath.
      data.version = (template.version || 1) + 1;
    }
    Object.assign(template, data);
    await template.save();
    return template;
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
    const template = await Template.findByIdAndUpdate(
      id,
      { status: TEMPLATE_STATUS.ARCHIVED },
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
