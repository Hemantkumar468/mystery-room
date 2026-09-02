import { Record } from '../../records/record.model.js';
import { RECORD_STATUS } from '../../../../core/constants/index.js';

/**
 * How many sites were looked at, how many survived, and why the rest did not.
 *
 * Applies to Property Identification (p1). The count alone is the wrong
 * measure — "12 properties visited" says the doer was busy, not that the search
 * was sound. The rejection REASONS are the thing an approver reads: twelve
 * visits all rejected for "rent too high" says the budget is wrong, not that
 * the sourcing failed, and no other screen surfaces that.
 *
 * Deliberately scoped to the whole phase rather than to the records stamped
 * with this task. Shortlisting is a decision taken later, on the phase page,
 * against properties filed across several sittings — counting only this task's
 * own submissions would report zero shortlisted on a phase that has shortlisted
 * four. The caller labels this scope; see approval.service.js.
 */
export const propertyBlock = {
  key: 'property',
  title: 'Property identification',

  applies: (task) => task.stageKey === 'p1',

  async build(task) {
    const records = await Record.find({ project: task.project, stageKey: 'p1' })
      .select('title values status rejectReason decisionReason')
      .lean();

    if (!records.length) return null;

    const rejected = records.filter((r) => r.status === RECORD_STATUS.REJECTED);

    return {
      scope: 'phase',
      visited: records.length,
      shortlisted: records.filter((r) => r.status === RECORD_STATUS.SHORTLISTED).length,
      rejected: rejected.length,
      inProgress: records.filter(
        (r) => r.status === RECORD_STATUS.EVALUATION_IN_PROGRESS,
      ).length,
      awaiting: records.filter((r) => r.status === RECORD_STATUS.SUBMITTED).length,
      /* Named, with the reason each was turned down. A rejection with no reason
         recorded says so rather than being dropped from the list — a silent
         rejection is itself worth seeing. */
      rejections: rejected.map((r) => ({
        id: String(r._id),
        label: r.title || r.values?.property_name || r.values?.locality || 'Property',
        reason: r.rejectReason || r.decisionReason || null,
      })),
    };
  },
};

export default propertyBlock;
