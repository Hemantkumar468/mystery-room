import { ArrowRight, Inbox, List } from 'lucide-react';
import { Drawer } from '../../components/ops/Drawer.jsx';
import { DlgStatusBadge, ChkStatusBadge } from '../../components/ops/common.jsx';
import { Avatar, PriorityBadge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { useDelegations, useChecklistTasks } from '../../lib/opsQueries.js';
import { drawers } from '../../store/drawerStore.js';
import { FREQ_LABEL, isDlgOverdue, chkState, lateDays } from '../../lib/opsUi.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const LIMIT = 500;

function DelegationRow({ t }) {
  const late = isDlgOverdue(t) ? lateDays(t.dueDate) : 0;
  const steps = t.checklistItems?.length || 0;
  return (
    <button type="button" className="drill-row" onClick={() => drawers.task(t._id)}>
      <div className="row between gap-3">
        <span className="drill-title">{t.title}</span>
        <ArrowRight size={15} className="drill-arrow" />
      </div>
      <div className="row gap-2 wrap" style={{ marginTop: 8 }}>
        <DlgStatusBadge value={t.status} />
        <PriorityBadge value={t.priority} />
        {late > 0 && <span className="late-pill">{late}d late</span>}
        {t.escalationTier > 0 && <span className="escalation-pill">Escalated · tier {t.escalationTier}</span>}
        {t.recurrence && <span className="chip chip-sm">{FREQ_LABEL[t.recurrence.frequency]}</span>}
      </div>
      <div className="drill-meta">
        <span className="row gap-1"><Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={18} /> <b>{t.doer?.name}</b></span>
        <span>by {t.assigner?.name}</span>
        <span className="mono">{t.code}</span>
        <span>Due {t.dueDate ? fmtDateTime(t.dueDate) : '—'}</span>
        {t.completedAt && <span>Done {fmtDate(t.completedAt)}</span>}
        {t.category && <span>{t.category}</span>}
        {t.branch && <span>{t.branch.code}</span>}
        {t.group && <span style={{ color: t.group.color }}>● {t.group.name}</span>}
        {steps > 0 && <span>{t.checklistItems.filter((c) => c.completed).length}/{steps} steps</span>}
        {t.followUpCount > 0 && <span className="danger-text">{t.followUpCount} follow-up(s)</span>}
        {t.parent && <span>sub-task of {t.parent.code}</span>}
      </div>
    </button>
  );
}

function ChecklistRow({ t }) {
  const state = chkState(t);
  const late = state === 'overdue' ? lateDays(t.plannedDate) : 0;
  return (
    <button type="button" className="drill-row" onClick={() => drawers.checklistTask(t._id)}>
      <div className="row between gap-3">
        <span className="drill-title">{t.taskName}</span>
        <ArrowRight size={15} className="drill-arrow" />
      </div>
      <div className="row gap-2 wrap" style={{ marginTop: 8 }}>
        <ChkStatusBadge value={state} />
        {late > 0 && <span className="late-pill">{late}d late</span>}
        {t.proofRequired && <span className="chip chip-sm">{t.documentUrl ? 'Proof attached' : 'Proof required'}</span>}
        {t.followUpCount > 0 && <span className="chip chip-sm danger-text">{t.followUpCount} follow-up(s)</span>}
      </div>
      <div className="drill-meta">
        <span className="row gap-1"><Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={18} /> <b>{t.doer?.name}</b></span>
        <span className="mono">{t.code}</span>
        <span>{FREQ_LABEL[t.frequency] || 'One-off'}</span>
        <span>Planned {fmtDate(t.plannedDate)}</span>
        {t.actualDate && <span>Done {fmtDateTime(t.actualDate)}</span>}
        {t.site && <span>{t.site}</span>}
        {t.department && <span className="upper tiny">{t.department}</span>}
        {t.reassignedFrom && <span>from {t.reassignedFrom.name}</span>}
      </div>
    </button>
  );
}

/**
 * The list behind a KPI number. `drill.params` are the exact query the number
 * was counted with, so the drawer always shows the same set; every row opens
 * the full record, and "Show in list" applies the bucket to the page's list.
 */
export function DrilldownDrawer({ drill, onClose }) {
  const isChecklist = drill.kind === 'checklist';
  const dlg = useDelegations({ ...drill.params, limit: LIMIT, sort: 'due' }, { enabled: !isChecklist });
  const chk = useChecklistTasks({ ...drill.params, limit: LIMIT }, { enabled: isChecklist });
  const q = isChecklist ? chk : dlg;
  const rows = q.data?.data || [];
  const total = q.data?.meta?.total ?? rows.length;

  return (
    <Drawer
      open
      onClose={onClose}
      width={640}
      title={`${drill.label} — ${q.isLoading ? '…' : total}`}
      subtitle={drill.description}
      actions={
        drill.onShowInList ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              drill.onShowInList();
              onClose();
            }}
          >
            <List size={14} /> Show in list
          </button>
        ) : null
      }
    >
      {q.isLoading ? (
        <div className="col gap-3">{Array.from({ length: 5 }).map((_, i) => <SkBlock key={i} h={84} />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={Inbox} title={isChecklist ? 'No occurrences in this bucket' : 'No tasks in this bucket right now'} />
      ) : (
        <div className="col gap-2">
          {rows.map((t) => (isChecklist ? <ChecklistRow key={t._id} t={t} /> : <DelegationRow key={t._id} t={t} />))}
          {total > rows.length && <div className="tiny muted center" style={{ padding: 8 }}>Showing the first {rows.length} of {total}.</div>}
        </div>
      )}
    </Drawer>
  );
}

export default DrilldownDrawer;
