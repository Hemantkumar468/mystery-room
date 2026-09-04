import { Task } from '../tasks/task.model.js';
import { Record } from '../records/record.model.js';
import { Project } from '../projects/project.model.js';
import { Template } from '../templates/template.model.js';
import { Activity } from '../activity/activity.model.js';
import { ApiError } from '../../../core/utils/ApiError.js';
import { ACTIVITY_ACTIONS } from '../../../core/constants/index.js';
import { buildAnalysis } from './analysis/index.js';

/**
 * The read model behind approval level 3: what was asked, what came back, and
 * what the numbers say about it.
 *
 * Deliberately read-only. Approve and reject already work — two tiers,
 * separation of duties, activity logging — in task.service.js#decide, and
 * forking that logic so one more screen could have its own buttons is how the
 * two versions start disagreeing about who is allowed to sign what.
 */

/** Fields the doer never fills — they are the form's plumbing, not an answer. */
const NON_ANSWER_KEYS = new Set(['id', '_id', 'createdAt', 'updatedAt']);

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === ''
  || (Array.isArray(v) && v.length === 0);

/**
 * The form definition behind a record, so the approver reads "Carpet Area"
 * rather than `carpet_area`.
 *
 * Comes from the Template document, not the project's stage snapshot, because
 * that is where record.service.js#loadStageContext reads it from — if the two
 * ever diverge, the labels here must match the form the doer actually filled.
 */
async function schemaFor(project, stageKey, assessmentType) {
  const tmpl = project?.template?.ref
    ? await Template.findById(project.template.ref).select('stages').lean()
    : null;
  const stage = tmpl?.stages?.find((s) => s.key === stageKey);
  if (!stage) return [];
  if (assessmentType) {
    const type = (stage.assessmentTypes || []).find((a) => a.key === assessmentType);
    return type?.masterDataSchema || [];
  }
  return stage.masterDataSchema || [];
}

/** One record, rendered as labelled answers in the form's own field order. */
function presentRecord(record, schema) {
  const values = record.values || {};
  const byKey = new Map(schema.map((f) => [f.key, f]));

  const ordered = [...schema]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((f) => !isEmpty(values[f.key]))
    .map((f) => ({
      key: f.key,
      label: f.label || f.key,
      type: f.type,
      section: f.section || null,
      value: values[f.key],
    }));

  /* Anything the doer submitted that the CURRENT schema no longer describes.
     A field removed from the template after this was filed would otherwise
     vanish from the evidence, which is the one thing this screen must not do. */
  const orphans = Object.entries(values)
    .filter(([k, v]) => !byKey.has(k) && !NON_ANSWER_KEYS.has(k) && !isEmpty(v))
    .map(([k, v]) => ({ key: k, label: k, type: 'unknown', section: null, value: v, orphaned: true }));

  return {
    id: String(record._id),
    title: record.title || null,
    seq: record.seq ?? null,
    status: record.status,
    assessmentType: record.assessmentType || null,
    submittedAt: record.submittedAt || record.createdAt,
    submittedBy: record.submittedBy || null,
    fields: [...ordered, ...orphans],
    attachments: (record.attachments || []).map((a) => ({
      id: String(a._id),
      name: a.name || 'File',
      url: a.url,
      kind: a.kind || 'raw',
      fieldKey: a.fieldKey || null,
    })),
  };
}

export const approvalService = {
  /**
   * Everything an approver needs to judge one task.
   *
   * The `scope` on the returned records is the honest part. Records filed from
   * a task carry `Record.task` and come back as `scope: 'task'` — those ARE the
   * submission. Records predating that field, or filed straight from a phase
   * page, cannot be attributed to a task at all, so they come back as
   * `scope: 'phase'` and the client labels them as context rather than
   * evidence. Showing them unlabelled would be a lie; hiding them would leave
   * every historical task looking like nothing was submitted.
   */
  async submissionFor(taskId) {
    const task = await Task.findById(taskId)
      .populate('project', 'name code city')
      .populate('assignee', 'name role avatarColor title')
      .populate('completedBy', 'name role avatarColor title')
      .populate('submittedForApprovalBy', 'name role avatarColor title')
      .populate('comments.author', 'name role avatarColor title')
      .lean();
    if (!task) throw ApiError.notFound('Task not found');

    const project = await Project.findById(task.project?._id || task.project)
      .select('template').lean();

    const own = await Record.find({ task: task._id })
      .populate('submittedBy', 'name role avatarColor title')
      .sort({ seq: 1 }).lean();

    /* Only reach for phase-scoped context when the task has none of its own —
       a task with real linked records does not need the rest of the phase
       dragged in beside it. */
    let phaseRecords = [];
    if (own.length === 0 && task.stageKey) {
      phaseRecords = await Record.find({
        project: task.project?._id || task.project,
        stageKey: task.stageKey,
        ...(task.formKey ? { assessmentType: task.formKey } : {}),
        task: { $exists: false },
      })
        .populate('submittedBy', 'name role avatarColor title')
        .sort({ seq: 1 }).limit(50).lean();
    }

    const present = async (rows, scope) => Promise.all(rows.map(async (r) => ({
      ...presentRecord(r, await schemaFor(project, r.stageKey, r.assessmentType)),
      scope,
    })));

    const records = [
      ...(await present(own, 'task')),
      ...(await present(phaseRecords, 'phase')),
    ];

    /* Updates are the doer's narration with photos; plain comments are
       discussion. Both are evidence, but only the first is the submission. */
    const comments = task.comments || [];

    return {
      task: {
        id: String(task._id),
        code: task.code,
        title: task.title,
        description: task.description || null,
        stageKey: task.stageKey,
        stageName: task.stageName,
        department: task.department || null,
        status: task.status,
        /* Sign-off is its own axis since the three-state migration — `status`
           is only pending/processing/complete. Whether a decision is pending,
           and which tier it sits at, is this field alone. */
        approvalState: task.approvalState || 'none',
        project: task.project,
        assignee: task.assignee || null,
        completedBy: task.completedBy || null,
        submittedForApprovalBy: task.submittedForApprovalBy || null,
        submittedForApprovalAt: task.submittedForApprovalAt || null,
        actualEnd: task.actualEnd || null,
        plannedEnd: task.plannedEnd || null,
      },
      /* WHAT WAS ASKED. The brief is the doer's own What/Who/When/How,
         snapshotted from the template at project creation, and the checklist
         carries a `required` flag per item — together they are the definition
         of done. No separate "expected deliverable" field exists. */
      asked: {
        brief: task.brief || null,
        description: task.description || null,
        checklist: (task.checklist || []).map((c) => ({
          id: String(c._id),
          label: c.label,
          done: !!c.done,
          required: !!c.required,
        })),
        requiredOutstanding: (task.checklist || [])
          .filter((c) => c.required && !c.done)
          .map((c) => c.label),
        approver: task.approval?.approver || null,
      },
      submitted: {
        records,
        hasTaskScopedRecords: own.length > 0,
        updates: comments.filter((c) => c.kind === 'update').map((c) => ({
          id: String(c._id),
          body: c.body,
          author: c.author || null,
          createdAt: c.createdAt,
          photos: (c.photos || []).map((p) => ({
            id: String(p._id), url: p.url, name: p.originalName || 'Photo', mimetype: p.mimetype,
          })),
        })),
        comments: comments.filter((c) => c.kind !== 'update').map((c) => ({
          id: String(c._id), body: c.body, author: c.author || null, createdAt: c.createdAt,
        })),
        attachments: (task.attachments || []).map((a) => ({
          id: String(a._id),
          url: a.url,
          name: a.originalName || 'File',
          mimetype: a.mimetype || null,
          resourceType: a.resourceType || 'raw',
          bytes: a.bytes ?? null,
        })),
        links: (task.links || []).map((l) => ({
          id: String(l._id), label: l.label || l.url, url: l.url,
        })),
      },
    };
  },

  /**
   * Every previous round on this task.
   *
   * The Task document keeps only the LAST decision (rejectedBy/At/reason), so a
   * task rejected twice would show its second rejection and silently lose the
   * first — exactly the history a resubmission needs. The full trail is in the
   * shared Activity collection, which is why this reads from there.
   */
  async historyFor(taskId) {
    const rows = await Activity.find({
      entityType: 'task',
      entityId: taskId,
      action: {
        $in: [
          ACTIVITY_ACTIONS.REJECTED,
          ACTIVITY_ACTIONS.APPROVED,
          ACTIVITY_ACTIONS.SUBMITTED_FOR_APPROVAL,
          ACTIVITY_ACTIONS.COMPLETED,
        ],
      },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('actor', 'name role avatarColor title')
      .lean();

    return rows.map((a) => ({
      id: String(a._id),
      action: a.action,
      message: a.message || null,
      actor: a.actor || null,
      at: a.createdAt,
    }));
  },

  /** The pluggable analysis blocks that apply to this task. */
  async analysisFor(taskId) {
    const task = await Task.findById(taskId).lean();
    if (!task) throw ApiError.notFound('Task not found');

    // Commercial reads the submission's own line items, so hand it the records
    // rather than making every block re-query them.
    const records = await Record.find({ task: task._id }).select('title values').lean();
    const fallback = records.length === 0 && task.stageKey
      ? await Record.find({
        project: task.project, stageKey: task.stageKey, task: { $exists: false },
      }).select('title values').limit(200).lean()
      : [];

    return buildAnalysis(task, { records: records.length ? records : fallback });
  },
};

export default approvalService;
