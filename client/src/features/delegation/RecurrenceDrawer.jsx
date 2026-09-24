import { Repeat, Pause, Play, AlertTriangle, Users, Send, Building2, FolderKanban, Tag, CalendarRange, ListChecks } from 'lucide-react';
import { Drawer } from '../../components/ops/Drawer.jsx';
import { Kpi, Meta } from '../../components/ops/common.jsx';
import { Avatar, AvatarStack, PriorityBadge, Spinner, EmptyState } from '../../components/ui/primitives.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useRecurrence, useUpdateRecurrence, useDelegations } from '../../lib/opsQueries.js';
import { drawers } from '../../store/drawerStore.js';
import { errMsg } from '../../lib/opsUi.js';
import { fmtDate } from '../../lib/format.js';
import { describeRule } from './RepeatsPage.jsx';
import { TaskList } from './TaskViews.jsx';

/** A repeat rule in full: schedule, blueprint, and every task it has produced. */
export function RecurrenceDrawer({ id, onClose }) {
  const { data: rule, isLoading, error } = useRecurrence(id);
  const update = useUpdateRecurrence();
  const branch = rule?.blueprint?.branch?._id;
  const { data: inst } = useDelegations({ recurrence: id, branch, status: 'all', sort: '-due', limit: 60 }, { enabled: Boolean(branch) });
  const counts = inst?.meta?.counts || {};

  const drill = (label, status, description) =>
    drawers.drill({ kind: 'delegation', label: `${rule.blueprint.title} · ${label}`, description, params: { recurrence: id, branch, status } });

  const toggle = async () => {
    try {
      await update.mutateAsync({ id, isActive: !rule.isActive });
      toast.success(rule.isActive ? 'Paused — no new instances will be created' : 'Resumed');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const b = rule?.blueprint || {};
  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={b.title || 'Repeat rule'}
      subtitle={rule ? `${describeRule(rule)} · ${rule.isActive ? 'active' : 'paused'}` : ''}
      actions={
        rule?.canEdit ? (
          <button className="btn btn-subtle btn-sm" onClick={toggle} disabled={update.isPending}>
            {rule.isActive ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}
          </button>
        ) : null
      }
    >
      {isLoading && <Spinner label="Loading repeat rule…" />}
      {error && <EmptyState icon={AlertTriangle} title="This repeat rule isn't available" />}
      {rule && (
        <div className="col gap-5">
          <div className="kpi-row">
            <Kpi label="Instances" value={counts.all} onClick={() => drill('All instances', 'all', 'Every task this rule has created.')} />
            <Kpi label="Open" value={counts.open} color="var(--warning)" onClick={() => drill('Open', 'open', 'Instances not yet closed.')} />
            <Kpi label="Overdue" value={counts.overdue} color="var(--danger)" onClick={() => drill('Overdue', 'overdue', 'Open and past their due date.')} />
            <Kpi label="Completed" value={counts.completed} color="var(--success)" onClick={() => drill('Completed', 'completed', 'Finished and approved.')} />
            <Kpi label="On time" value={counts.on_time} color="var(--secondary)" onClick={() => drill('On time', 'on_time', 'Completed on or before the due date.')} />
            <Kpi label="Late" value={counts.completed_late} color="#ea8a2b" onClick={() => drill('Completed late', 'completed_late', 'Completed after the due date.')} />
          </div>

          <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 var(--space-6)' }}>
            <div>
              <Meta icon={Repeat} label="Schedule">{describeRule(rule)}</Meta>
              <Meta icon={CalendarRange} label="Window">{fmtDate(rule.startDate)} → {rule.endDate ? fmtDate(rule.endDate) : 'ongoing'}</Meta>
              <Meta icon={CalendarRange} label="Last generated for">{rule.lastGeneratedFor ? fmtDate(rule.lastGeneratedFor) : '—'}</Meta>
              <Meta icon={Tag} label="Category">{b.category}</Meta>
              <Meta icon={Tag} label="Priority"><PriorityBadge value={b.priority} /></Meta>
            </div>
            <div>
              <Meta icon={Users} label="Doer"><span className="row gap-2" style={{ justifyContent: 'flex-end' }}><Avatar name={b.doer?.name} color={b.doer?.avatarColor} size={20} />{b.doer?.name}</span></Meta>
              <Meta icon={Send} label="Assigned by">{b.assigner?.name}</Meta>
              <Meta icon={Building2} label="Branch">{b.branch ? `${b.branch.name} (${b.branch.code})` : null}</Meta>
              <Meta icon={FolderKanban} label="Group">{b.group?.name}</Meta>
              <Meta icon={ListChecks} label="Checklist steps">{b.checklistItems?.length || 0}</Meta>
            </div>
          </div>

          {b.description && <p className="sm" style={{ whiteSpace: 'pre-wrap' }}>{b.description}</p>}

          <div className="row between wrap gap-3">
            {b.inLoop?.length > 0 && <span className="row gap-2 sm muted">In the loop <AvatarStack people={b.inLoop} /></span>}
            <span className="row gap-1 wrap">
              {b.verificationRequired && <span className="chip chip-sm">Verification</span>}
              {b.evidenceRequired && <span className="chip chip-sm">Proof required</span>}
              {(b.tags || []).map((t) => <span key={t} className="chip chip-sm">#{t}</span>)}
            </span>
          </div>

          <div className="drawer-section">
            <span className="eyebrow">Next dates</span>
            <div className="preview-dates">
              {rule.nextDates?.length ? rule.nextDates.map((d) => <span key={d} className="chip chip-sm">{fmtDate(d)}</span>) : <span className="tiny muted">{rule.isActive ? 'No more dates in the window' : 'Paused'}</span>}
            </div>
          </div>

          <div className="drawer-section">
            <span className="eyebrow">Recent instances</span>
            {inst?.data?.length ? <TaskList tasks={inst.data} onOpen={(tid) => drawers.task(tid)} /> : <div className="tiny muted">No instances yet</div>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

export default RecurrenceDrawer;
