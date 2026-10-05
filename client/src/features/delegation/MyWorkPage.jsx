import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Plus, PlayCircle, CheckCircle2, ShieldCheck, Inbox, ClipboardCheck, Radio, Users, Stamp, Sun, AlertTriangle, Clock, Paperclip,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { Kpi, Segmented, DlgStatusBadge, ChkStatusBadge } from '../../components/ops/common.jsx';
import { PriorityBadge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useDelegations, useDelegationSummary, useChecklistSummary, useChecklistTasks, useDelegationAction, useChecklistAction,
} from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { isDlgOverdue, errMsg, FREQ_LABEL } from '../../lib/opsUi.js';
import { fmtDateShort, daysUntil } from '../../lib/format.js';
import { TaskDetailDrawer } from './TaskDetailDrawer.jsx';
import { drawers } from '../../store/drawerStore.js';
import { TaskFormModal } from './TaskFormModal.jsx';
import { CompleteModal } from './ActionModals.jsx';
import { TaskList } from './TaskViews.jsx';
import { DateRangeFilter } from '../../components/ops/DateRangeFilter.jsx';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

function DueText({ date, overdue }) {
  if (!date) return <span className="tiny subtle">No date</span>;
  const d = daysUntil(date);
  return (
    <span className="row gap-1 tiny" style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)', fontWeight: overdue ? 650 : 500 }}>
      {overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
      {fmtDateShort(date)} · {d < 0 ? `${-d}d late` : d === 0 ? 'today' : `in ${d}d`}
    </span>
  );
}

/** My open delegations with one-tap Start / Complete. */
function MyTasks({ branch, onOpen, date, onDateChange }) {
  const act = useDelegationAction();
  const [completing, setCompleting] = useState(null);
  const { data, isLoading } = useDelegations({
    view: 'mine', status: 'incomplete', branch,
    dueFrom: date?.from, dueTo: date?.to, sort: 'due', limit: 300,
  });
  const tasks = data?.data || [];

  const start = async (t) => {
    try {
      await act.mutateAsync({ id: t._id, action: 'status', body: { status: 'in_progress' } });
      toast.success('Work started');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (isLoading) return <><DateRangeFilter label="Due date" value={date} onChange={onDateChange} /><SkTable rows={6} /></>;
  if (!tasks.length) return <><DateRangeFilter label="Due date" value={date} onChange={onDateChange} /><div className="card"><EmptyState icon={Sun} title="Nothing on your plate" hint="New tasks assigned to you will appear here." /></div></>;

  return (
    <>
      <DateRangeFilter label="Due date" value={date} onChange={onDateChange} />
      <div className="card" style={{ overflow: 'hidden' }}>
        {tasks.map((t) => {
          const overdue = isDlgOverdue(t);
          const workable = ['pending', 'accepted', 'in_progress'].includes(t.status);
          return (
            <div key={t._id} className="task-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} onClick={() => onOpen(t._id)}>
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2">
                  <span className="task-title truncate">{t.title}</span>
                  <DlgStatusBadge value={t.status} />
                  <PriorityBadge value={t.priority} />
                </div>
                <div className="task-meta">
                  <span className="mono">{t.code}</span>
                  <DueText date={t.dueDate} overdue={overdue} />
                  <span>from {t.assigner?.name}</span>
                  {t.group && <span style={{ color: t.group.color }}>● {t.group.name}</span>}
                  {t.checklistItems?.length > 0 && <span>{t.checklistItems.filter((c) => c.completed).length}/{t.checklistItems.length} steps</span>}
                  {t.verificationRequired && <span><ShieldCheck size={11} /> needs verification</span>}
                </div>
              </div>
              <div className="row gap-2" onClick={(e) => e.stopPropagation()}>
                {workable && t.status !== 'in_progress' && (
                  <button className="btn btn-subtle btn-sm" onClick={() => start(t)} disabled={act.isPending}><PlayCircle size={14} /> Start</button>
                )}
                {workable && (
                  <button className="btn btn-primary btn-sm" onClick={() => setCompleting(t)}>
                    {t.verificationRequired ? <><ShieldCheck size={14} /> Submit</> : <><CheckCircle2 size={14} /> Done</>}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <CompleteModal task={completing} open={Boolean(completing)} onClose={() => setCompleting(null)} />
      </div>
    </>
  );
}

/** Today's checklist occurrences (plus anything carried over). */
function ChecklistToday({ branch, me }) {
  const act = useChecklistAction();
  const { data, isLoading } = useChecklistTasks({ status: 'pending_today', doer: me, branch, limit: 300 });
  const rows = data?.data || [];
  const today = dayjs().format('YYYY-MM-DD');

  const done = async (t) => {
    if (t.proofRequired) {
      // Needs an upload — open the full occurrence where Complete asks for proof.
      drawers.checklistTask(t._id);
      return;
    }
    try {
      await act.mutateAsync({ id: t._id, action: 'complete', body: {} });
      toast.success(`${t.code} done`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (isLoading) return <SkTable rows={5} />;
  if (!rows.length) return <div className="card"><EmptyState icon={ClipboardCheck} title="Checklist clear for today" hint="Nothing due today or carried over." /></div>;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {rows.map((t) => {
        const late = t.plannedKey < today;
        return (
          <div key={t._id} className="task-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} onClick={() => drawers.checklistTask(t._id)}>
            <div style={{ minWidth: 0 }}>
              <div className="row gap-2">
                <span className="task-title truncate">{t.taskName}</span>
                <ChkStatusBadge value={late ? 'overdue' : 'pending'} />
              </div>
              <div className="task-meta">
                <span className="mono">{t.code}</span>
                <span>{FREQ_LABEL[t.frequency] || 'One-off'}</span>
                <DueText date={t.plannedDate} overdue={late} />
                {t.site && <span>{t.site}</span>}
                {t.proofRequired && <span><Paperclip size={11} /> proof needed</span>}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); done(t); }} disabled={act.isPending}><CheckCircle2 size={14} /> Done</button>
          </div>
        );
      })}
    </div>
  );
}

function SimpleList({ params, onOpen, empty, icon, show }) {
  const { data, isLoading } = useDelegations({ ...params, limit: 300, sort: 'due' });
  const tasks = data?.data || [];
  if (isLoading) return <SkTable rows={5} />;
  if (!tasks.length) return <div className="card"><EmptyState icon={icon} title={empty} /></div>;
  return <TaskList tasks={tasks} onOpen={onOpen} show={show} />;
}

export function MyWorkPage() {
  const branch = useOpsStore((s) => s.branch) || undefined;
  const user = useAppSelector(selectCurrentUser);
  const me = user?.id || user?._id;
  const { taskId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState(params.get('tab') || 'mine');
  const [date, setDate] = useState({ preset: 'all' });
  const [creating, setCreating] = useState(false);
  const openId = params.get('task') || taskId;

  const { data: s } = useDelegationSummary({ branch });
  const { data: c } = useChecklistSummary({ branch, doer: me });

  useEffect(() => {
    if (params.get('tab')) setTab(params.get('tab'));
  }, [params]);

  const openTask = (id) => {
    const next = new URLSearchParams(params);
    next.set('task', id);
    setParams(next);
  };
  /** KPI card → the exact tasks behind its number (NIA drill-down). */
  const dlgDrill = (label, params, description, showTab) =>
    drawers.drill({
      kind: 'delegation',
      label,
      description,
      params: { ...params, branch },
      onShowInList: showTab ? () => setTab(showTab) : undefined,
    });

  const closeTask = () => {
    if (taskId) navigate('/delegation/my-work', { replace: true });
    else {
      const next = new URLSearchParams(params);
      next.delete('task');
      setParams(next);
    }
  };

  const tabs = useMemo(
    () => [
      { value: 'mine', label: 'My pending tasks', icon: Inbox, count: s?.totalPending },
      { value: 'checklist', label: 'Checklist today', icon: ClipboardCheck, count: c?.pendingToday },
      { value: 'approvals', label: 'Awaiting my approval', icon: Stamp, count: s?.awaitingMyApproval },
      { value: 'loop', label: 'In the loop', icon: Radio, count: s?.loop },
      { value: 'group', label: 'Group tasks', icon: Users },
    ],
    [s, c],
  );

  return (
    <>
      <Topbar
        title="My Work"
        subtitle={`${greeting()}, ${user?.name?.split(' ')[0] || ''} — here's what needs you today`}
        actions={
          <div className="row gap-2">
            <BranchSwitcher />
            {user?.role !== 'viewer' && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Assign task</button>}
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <div className="kpi-row my-work-kpis">
            <Kpi label="Total assigned to me" value={s?.totalAssigned ?? s?.totalPending ?? 0} color="var(--primary)" active={tab === 'mine'} hint="All tasks assigned to you" onClick={() => dlgDrill('Tasks assigned to me', { view: 'mine', status: 'all' }, 'All tasks assigned to you, across their current statuses.')} />
            <Kpi label="Pending" value={s?.totalPending} color="#8b5cf6" hint="Assigned tasks not yet completed" onClick={() => dlgDrill('My pending tasks', { view: 'mine', status: 'incomplete' }, 'Your unfinished tasks, including work waiting for approval.', 'mine')} />
            <Kpi label="Overdue" value={s?.overdue} color="var(--danger)" onClick={() => dlgDrill('My overdue tasks', { view: 'mine', status: 'overdue' }, 'Past their due date and still open.')} />
            <Kpi label="Submitted for approval" value={s?.submittedByMe} color="#6366f1" hint="Waiting for your task to be verified" onClick={() => dlgDrill('Submitted for approval', { view: 'mine', status: 'awaiting_verification' }, 'Tasks you submitted and that are waiting for approval.', 'mine')} />
            <Kpi label="In the loop" value={s?.loop} color="#0e8f9e" hint="Open tasks you follow" active={tab === 'loop'} onClick={() => dlgDrill('In the loop', { view: 'loop', status: 'open' }, 'Open tasks you follow but do not own.', 'loop')} />
          </div>

          <Segmented value={tab} onChange={setTab} options={tabs} />

          {tab === 'mine' && <MyTasks branch={branch} onOpen={openTask} date={date} onDateChange={setDate} />}
          {tab === 'checklist' && <ChecklistToday branch={branch} me={me} />}
          {tab === 'approvals' && (
            <SimpleList params={{ view: 'delegated', status: 'awaiting_verification', branch }} onOpen={openTask} empty="Nothing waiting for your approval" icon={Stamp} show={{ doer: true, assigner: false }} />
          )}
          {tab === 'loop' && (
            <SimpleList params={{ view: 'loop', status: 'open', branch }} onOpen={openTask} empty="Nothing in your loop right now" icon={Radio} />
          )}
          {tab === 'group' && (
            <SimpleList params={{ view: 'group', doer: me, status: 'open', branch }} onOpen={openTask} empty="No open group tasks for you" icon={Users} />
          )}
        </div>
      </div>

      <TaskDetailDrawer taskId={openId} onClose={closeTask} onOpenTask={openTask} />
      <TaskFormModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export default MyWorkPage;
