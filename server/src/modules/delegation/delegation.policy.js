import { ApiError } from '../../core/utils/ApiError.js';
import { ACCESS, DELEGATION_STATUS as S } from '../../core/constants/ops.js';
import { scopeService } from '../org/scope.service.js';

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

/** Everyone attached to a task: assigner, doer and the loop. */
export const involvedIds = (task) => [
  ...new Set([idOf(task.assigner), idOf(task.doer), ...(task.inLoop || []).map(idOf)].filter(Boolean)),
];

/** The caller's relationship to one task. */
export function relation(task, user) {
  const me = String(user.id);
  return {
    isAdmin: scopeService.isAdmin(user),
    isAssigner: idOf(task.assigner) === me,
    isDoer: idOf(task.doer) === me,
    isLoop: (task.inLoop || []).some((u) => idOf(u) === me),
    isViewer: scopeService.accessLevel(user) === ACCESS.VIEWER,
  };
}

/**
 * Mongo filter for the tasks a user may see.
 *
 * User-wise visibility: a task is visible only to the people officially on it
 * — its assigner, its doer and the people explicitly kept in the loop. Being
 * in the same group, managing the doer, or holding the coordinator flag does
 * NOT reveal a task; the assigner has to include you. Admins see everything.
 * (Sub-tasks stay visible up the chain because the parent's assigner and loop
 * are copied into every sub-task's loop when it is created.)
 */
export async function visibilityFilter(user) {
  if (scopeService.accessLevel(user) === ACCESS.ADMIN) return {};
  const me = user.id;
  return { $or: [{ doer: me }, { assigner: me }, { inLoop: me }] };
}

/** Throws 404 (not 403 — don't leak existence) when the task is outside the caller's view. */
export async function assertCanView(task, user) {
  const r = relation(task, user);
  if (r.isAdmin || r.isAssigner || r.isDoer || r.isLoop) return r;
  throw ApiError.notFound('Task not found');
}

const OPEN_WORK = [S.PENDING, S.ACCEPTED, S.IN_PROGRESS];

/** Capability flags the client uses to decide which buttons to show. */
export function capabilities(task, user) {
  const r = relation(task, user);
  if (r.isViewer || task.deletedAt) {
    return { canEdit: false, canDelete: false, canWork: false, canApprove: false, canReassign: false, canReopen: false, canRevise: false, canComment: false, canFollowUp: false, canRemindersEdit: false, canManagementRemark: false };
  }
  const owner = r.isAdmin || r.isAssigner;
  const worker = r.isAdmin || r.isDoer;
  const closed = task.status === S.COMPLETED || task.status === S.SHIFTED;
  return {
    ...r,
    /**
     * EDITING SURVIVES COMPLETION. It used to be `owner && !closed`, so the
     * moment a task was finished its category, description and tags froze —
     * and a task is most often found to be mis-filed AFTER it is done, when
     * somebody reads the report. The only way to fix a typo was to reopen a
     * finished task, which falsifies its status to correct its spelling.
     *
     * The server never blocked this (see delegation.service#update, which
     * checks ownership and nothing else) — only the flag that draws the
     * button did, so the rule existed in one place out of two.
     *
     * THE DUE DATE AND THE DOER STAY SHUT once closed, and that is not an
     * oversight: they are the two fields the on-time / late score is
     * computed from, so editing them after the fact silently rewrites
     * somebody's score for work already reported on. Those keep their own
     * buttons, and reopening is the honest route to them.
     */
    canEdit: owner,
    canDelete: owner,
    canWork: worker && OPEN_WORK.includes(task.status),
    canResume: worker && [S.DEPENDENT, S.BLOCKED].includes(task.status),
    canMarkDependent: (worker || r.isAssigner) && [S.PENDING, S.ACCEPTED].includes(task.status),
    canBlock: (worker || r.isAssigner) && OPEN_WORK.includes(task.status),
    canApprove: owner && task.status === S.AWAITING_VERIFICATION,
    canReassign: owner && !closed,
    canReopen: owner && task.status === S.COMPLETED,
    canRevise: (owner || r.isDoer) && !closed,
    canComment: true,
    canManagementRemark: owner || r.isLoop || scopeService.accessLevel(user) === ACCESS.LEAD,
    canFollowUp: r.isAdmin || Boolean(user.opsFlags?.coordinator),
    canRemindersEdit: owner || r.isDoer,
    canAddSubtask: (owner || r.isDoer) && !closed,
  };
}

/** Guard for mutation endpoints — viewers are read-only everywhere. */
export function assertNotViewer(user) {
  if (scopeService.accessLevel(user) === ACCESS.VIEWER) {
    throw ApiError.forbidden('Viewers have read-only access');
  }
}
