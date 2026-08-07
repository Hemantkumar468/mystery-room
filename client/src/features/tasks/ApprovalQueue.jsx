import { useMemo, useState } from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { useTaskDecision } from '../../app/api/tasksApi.js';
import { fmtDateTime } from '../../lib/format.js';
import { deptMeta, canApprove, canManagementApprove, isOwnTaskWork } from '../../lib/ui.js';
import { ClampText } from '../../components/ui/ClampText.jsx';

/**
 * Shared two-tier approval queue — Execution's (P6) department-manager tier
 * and Approval Workflow's (P7) management tier are the same list/decide UI
 * over a different task status and a different eligibility check. Previously
 * duplicated as ApprovalQueueView (ExecutionPage.jsx) and
 * ManagementApprovalQueue (ApprovalWorkflowPage.jsx); this is now the single
 * copy both pages render, config-driven by `tier`.
 */
const TIER_CONFIG = {
  department: {
    filterStatus: 'waiting_approval',
    sortKey: 'submittedForApprovalAt',
    canDecide: (user, t) => canApprove(user, t),
    approveLabel: 'Approve',
    subLabel: (t) => `${t.assignee?.name ? `Submitted by ${t.assignee.name}` : 'Submitted'}${t.submittedForApprovalAt ? ` · ${fmtDateTime(t.submittedForApprovalAt)}` : ''}`,
    disabledTitle: "Only that task's department manager (or an Admin) can decide it",
    emptyIcon: ShieldCheck,
    emptyTitle: 'Nothing waiting for approval',
    emptyHint: 'Tasks show up here once an assignee submits a Completed task for sign-off.',
  },
  management: {
    filterStatus: 'waiting_management_approval',
    sortKey: 'approvedAt',
    canDecide: (user) => canManagementApprove(user),
    approveLabel: 'Give Management Approval',
    subLabel: (t) => `${t.approvedBy?.name ? `Approved by ${t.approvedBy.name}` : 'Department approved'}${t.approvedAt ? ` · ${fmtDateTime(t.approvedAt)}` : ''}`,
    disabledTitle: 'Only a Manager or Admin can decide it',
    emptyIcon: CheckCircle2,
    emptyTitle: 'Nothing waiting for management approval',
    emptyHint: 'Tasks show up here once their department manager approves them in Execution.',
  },
};

const selfWorkTitleFor = (tier, task, currentUser) => {
  if (tier === 'management' && String(task.approvedBy?._id || task.approvedBy || '') === String(currentUser?.id || currentUser?._id || '')) {
    return 'You already cleared this task at the department tier — management approval needs a different approver.';
  }
  return "You can't approve or reject your own task — it needs a second person to sign off.";
};

export function ApprovalQueue({ tier, tasks, projectId, currentUser, onOpenTask }) {
  const cfg = TIER_CONFIG[tier];
  const decide = useTaskDecision(projectId);
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');

  const queue = useMemo(() => tasks
    .filter((t) => t.status === cfg.filterStatus)
    .sort((a, b) => new Date(a[cfg.sortKey] || 0) - new Date(b[cfg.sortKey] || 0)), [tasks, cfg.filterStatus, cfg.sortKey]);

  if (queue.length === 0) {
    return <EmptyState icon={cfg.emptyIcon} title={cfg.emptyTitle} hint={cfg.emptyHint} />;
  }

  const confirmReject = (t) => {
    if (!reason.trim()) return;
    decide.mutate(
      { taskId: t._id, decision: 'reject', reason: reason.trim() },
      { onSuccess: () => { setRejectingId(null); setReason(''); } },
    );
  };

  return (
    <div className="col gap-2">
      {queue.map((t) => {
        const selfWork = isOwnTaskWork(currentUser, t, tier);
        const canDecide = cfg.canDecide(currentUser, t) && !selfWork;
        const dm = deptMeta(t.department);
        const title = selfWork ? selfWorkTitleFor(tier, t, currentUser) : !canDecide ? cfg.disabledTitle : '';
        return (
          <div key={t._id} className="col gap-2" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div className="row gap-3 wrap" style={{ alignItems: 'center' }}>
              {/* Clamped: these are free-text titles and the queue is a row of
                  inline controls, so one pasted paragraph pushed the decide
                  buttons off the card entirely. */}
              <ClampText
                lines={2}
                as="span"
                className="task-title-text"
                style={{ flex: '1 1 220px', minWidth: 0 }}
                title={t.title}
                onMore={() => onOpenTask?.(t)}
              >
                {t.title}
              </ClampText>
              <span className="tiny muted">{t.code}</span>
              {t.department && <Badge color={dm.color}>{dm.label}</Badge>}
              <span className="tiny muted grow">{cfg.subLabel(t)}</span>
              <button
                type="button" className="btn btn-subtle btn-sm" style={{ color: 'var(--danger)' }}
                disabled={!canDecide} title={title}
                onClick={() => setRejectingId(t._id)}
              >
                <XCircle size={13} style={{ marginRight: 4 }} /> Reject
              </button>
              <button
                type="button" className="btn btn-primary btn-sm"
                disabled={!canDecide || decide.isPending}
                title={title}
                onClick={() => decide.mutate({ taskId: t._id, decision: 'approve' })}
              >
                <CheckCircle2 size={13} style={{ marginRight: 4 }} /> {cfg.approveLabel}
              </button>
            </div>
            {rejectingId === t._id && (
              <div className="col gap-2">
                <textarea
                  className="textarea" rows={2} placeholder="Reason for rejection…"
                  value={reason} onChange={(e) => setReason(e.target.value)}
                />
                <div className="row gap-2">
                  <button type="button" className="btn btn-primary btn-sm" style={{ background: 'var(--danger)' }} disabled={!reason.trim() || decide.isPending} onClick={() => confirmReject(t)}>
                    Confirm Reject
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRejectingId(null); setReason(''); }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ApprovalQueue;
