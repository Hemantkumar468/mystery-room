import { Pipeline } from './pipeline.model.js';
import { Deal } from '../deals/deal.model.js';
import { canManageCrm } from '../shared/scope.js';
import { BOARD_ORDER_STEP } from '../crm.constants.js';
import { ApiError } from '../../../core/utils/ApiError.js';

/**
 * Pipelines and their stages.
 *
 * Reading is open to anyone who can see the CRM — the board needs the stages
 * to render. Writing is managers only: reordering stages or marking a
 * different one as "won" changes what every existing deal means.
 */

/** The stages a franchise business starts with. Seeded, not hardcoded — the
 *  point of the collection is that this list is a starting position rather
 *  than a rule. Probabilities follow the spec's table. */
export const DEFAULT_STAGES = Object.freeze([
  { name: 'New Lead', order: 100, probability: 10, exitCriteria: 'First contact attempted' },
  { name: 'Contacted', order: 200, probability: 20, exitCriteria: 'Conversation happened, interest confirmed' },
  { name: 'Requirement Understood', order: 300, probability: 40, exitCriteria: 'Needs documented, budget indicated' },
  { name: 'Demo Done', order: 400, probability: 60, exitCriteria: 'Demo delivered, feedback captured' },
  { name: 'Negotiation', order: 500, probability: 80, exitCriteria: 'Proposal sent, terms under discussion' },
  { name: 'Closed Won', order: 600, probability: 100, isWon: true, exitCriteria: 'Agreement signed' },
  { name: 'Closed Lost', order: 700, probability: 0, isLost: true, exitCriteria: 'Lost reason recorded' },
]);

export const pipelineService = {
  async list() {
    const pipelines = await Pipeline.find({ isActive: true }).sort({ isDefault: -1, name: 1 });
    return pipelines.map((p) => ({
      _id: p._id,
      name: p.name,
      description: p.description,
      isDefault: p.isDefault,
      stages: p.orderedStages(),
    }));
  },

  /**
   * The default pipeline, creating the starter one if none exists.
   *
   * A CRM whose board says "no pipeline is set up" on first open is a CRM
   * nobody gets past — the first thing a new user should see is a board they
   * can put a deal on, not a configuration screen.
   */
  async ensureDefault(user) {
    const existing = await Pipeline.findOne({ isDefault: true, isActive: true });
    if (existing) return existing;

    return Pipeline.create({
      name: 'Franchise Sales',
      description: 'The default path a franchise enquiry follows.',
      isDefault: true,
      stages: DEFAULT_STAGES,
      createdBy: user?._id || user?.id,
    });
  },

  async create(body, user) {
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can create a pipeline', { code: 'PIPELINE_FORBIDDEN' });
    }
    const pipeline = await Pipeline.create({
      name: String(body.name || '').trim(),
      description: body.description,
      stages: body.stages?.length ? body.stages : DEFAULT_STAGES,
      isDefault: false,
      createdBy: user._id || user.id,
    });
    return pipeline;
  },

  /**
   * Replace a pipeline's stages.
   *
   * REFUSES to remove a stage that still holds deals. Deleting it would leave
   * those deals pointing at a stage id that no longer resolves — they would
   * vanish from the board entirely while still counting in every total, which
   * is the worst of both outcomes. Move them first, deliberately.
   */
  async updateStages(id, stages, user) {
    if (!canManageCrm(user)) {
      throw ApiError.forbidden('Only a manager can change stages', { code: 'PIPELINE_FORBIDDEN' });
    }
    const pipeline = await Pipeline.findById(id);
    if (!pipeline) throw ApiError.notFound('Pipeline not found');

    const keptIds = new Set(stages.map((s) => String(s._id)).filter(Boolean));
    const removed = pipeline.stages.filter((s) => !keptIds.has(String(s._id)));

    for (const stage of removed) {
      // eslint-disable-next-line no-await-in-loop
      const held = await Deal.countDocuments({ pipeline: pipeline._id, stage: stage._id });
      if (held) {
        throw ApiError.badRequest(
          `"${stage.name}" still holds ${held} deal${held === 1 ? '' : 's'}. Move them before removing it.`,
          { code: 'STAGE_NOT_EMPTY', details: { stage: stage.name, deals: held } },
        );
      }
    }

    // Re-gapped on save, so an admin screen can hand over plain 1..n ordering
    // and still get the spacing the board relies on.
    pipeline.stages = stages.map((s, i) => ({ ...s, order: (i + 1) * BOARD_ORDER_STEP }));
    await pipeline.save();
    return { _id: pipeline._id, name: pipeline.name, stages: pipeline.orderedStages() };
  },
};

export default pipelineService;
