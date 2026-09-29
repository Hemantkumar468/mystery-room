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
    canEdit: owner && !closed,
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
