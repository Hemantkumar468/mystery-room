import { Delegation } from '../../delegation/delegation.model.js';
import { ChecklistTask } from '../../checklist/checklist.model.js';
import { logger } from '../../../config/logger.js';

/**
 * DELEGATION AND CHECKLIST WORK, on My Tasks.
 *
 * My Tasks is the one list of everything on a person's desk. Project and New
 * Games work arrive as FMS tasks; this adds the other two sources in the same
 * Task shape, each tagged with `source` so the page can filter by it and each
 * carrying the `link` to its own page:
 *
 *   delegation — a job somebody delegated to this person (they are the doer).
 *   checklist  — a routine due today or earlier. Routines are generated a
 *                year ahead, so only what is due now is shown, not 365 rows.
 *
 * Best effort: a failure here must not take the rest of My Tasks with it.
 */
const DONE_DLG = ['completed', 'shifted'];

const dayEnd = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

export async function opsTasksFor(userId, { doneWithinDays = 7 } = {}) {
  const since = new Date(Date.now() - doneWithinDays * 86_400_000);
  const open = [];
  const done = [];
  try {
    const [dlgs, chks] = await Promise.all([
      Delegation.find({
        doer: userId,
        deletedAt: null,
        $or: [{ status: { $nin: DONE_DLG } }, { completedAt: { $gte: since } }],
      })
        .select('code title status priority dueDate createdAt completedAt assigner branch category')
        .populate('assigner', 'name')
        .populate('branch', 'name city')
        .lean(),
      ChecklistTask.find({
        doer: userId,
        plannedDate: { $lte: dayEnd(new Date()) },
        $or: [{ status: 'pending' }, { actualDate: { $gte: since } }],
      })
        .select('code taskName status plannedDate actualDate site department master')
        .populate({ path: 'master', select: 'createdBy', populate: { path: 'createdBy', select: 'name' } })
        .sort({ plannedDate: -1 })
        .limit(200)
        .lean(),
    ]);

    for (const d of dlgs) {
      const finished = DONE_DLG.includes(d.status);
      const row = {
        _id: `dlg-${d._id}`,
        code: d.code,
        title: d.title,
        source: 'delegation',
        status: finished ? 'complete' : d.status === 'in_progress' ? 'processing' : 'pending',
        approvalState: d.status === 'awaiting_verification' ? 'waiting_department' : 'none',
        priority: d.priority,
        plannedEnd: d.dueDate,
        createdAt: d.createdAt,
        completedAt: d.completedAt,
        createdBy: d.assigner ? { _id: d.assigner._id, name: d.assigner.name } : null,
        project: { _id: 'delegation', name: d.category || 'Delegation', city: d.branch?.city || d.branch?.name || '' },
        link: `/delegation/tasks/${d._id}`,
      };
      (finished ? done : open).push(row);
    }

    for (const c of chks) {
      const finished = c.status !== 'pending';
      const by = c.master?.createdBy;
      const row = {
        _id: `chk-${c._id}`,
        code: c.code,
        title: c.taskName,
        source: 'checklist',
        status: finished ? 'complete' : 'pending',
        approvalState: 'none',
        priority: 'medium',
        plannedEnd: c.plannedDate,
        createdAt: c.plannedDate,
        completedAt: c.actualDate,
        createdBy: by ? { _id: by._id, name: by.name } : null,
        project: { _id: 'checklist', name: c.department || 'Checklist', city: c.site || '' },
        /* THE OCCURRENCE, not the page. A routine row that lands on the
           checklist and leaves the reader to find today's item among a
           branch's worth of them is the search My Tasks exists to save.
           ChecklistPage opens this id on arrival. */
        link: `/checklist?task=${c._id}`,
      };
      (finished ? done : open).push(row);
    }
  } catch (err) {
    logger.warn(`Delegation/checklist tasks unavailable for ${userId}: ${err.message}`);
  }
  return { open, done };
}

export default opsTasksFor;
