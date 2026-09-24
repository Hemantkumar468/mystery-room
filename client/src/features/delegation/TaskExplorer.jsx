import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { List, KanbanSquare, CalendarDays, Inbox, X } from 'lucide-react';
import { Segmented, Kpi, ReasonModal } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { drawers } from '../../store/drawerStore.js';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useDelegations, useDelegationAction } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { DLG_STATUS_META, DLG_STATUS_TABS, errMsg } from '../../lib/opsUi.js';
import { TaskList, TaskBoard, TaskCalendar, TaskFilters } from './TaskViews.jsx';
import { TaskDetailDrawer } from './TaskDetailDrawer.jsx';

const useDebounced = (value, ms = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

/**
 * The reusable task workspace: status tabs with live counts, filters, and
 * list / board / calendar views, with the detail drawer driven by `?task=`
 * so any task view is linkable.
 *
 * @param {object} baseParams   fixed query params for this view (e.g. { view: 'delegated' } or { group })
 * @param {string[]} hideFilters  filters that don't apply to this view
 */
export function TaskExplorer({ baseParams = {}, hideFilters = [], defaultStatus = 'all', show, emptyHint, showAssignedBy = true }) {
  const user = useAuthStore((s) => s.user);
  const me = String(user?.id || user?._id || '');
  const isAdmin = user?.role === 'admin';
  const canSwitchAssigner = showAssignedBy && ['admin', 'manager'].includes(user?.role);
  const reopenAct = useDelegationAction();
  const [reopening, setReopening] = useState(null);
  const branch = useOpsStore((s) => s.branch);
  const { taskView, setTaskView } = useOpsStore();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({});
  const status = params.get('status') || defaultStatus;
  const assignedBy = canSwitchAssigner ? params.get('by') || '' : '';
  const openId = params.get('task');
  const search = useDebounced(filters.search || '');

  // The single date filter ({ preset, from, to }) applies to the due date.
  const { date, ...plainFilters } = filters;
  const dueRange = { dueFrom: date?.from, dueTo: date?.to, assignedBy: assignedBy || undefined };

  const query = useMemo(
    () => ({
      ...baseParams,
      ...plainFilters,
      ...dueRange,
      search: search || undefined,
      branch: branch || undefined,
      // Board and calendar always show every status.
      status: taskView === 'list' ? status : 'all',
      sort: taskView === 'list' && ['completed', 'shifted'].includes(status) ? 'updated' : 'due',
      limit: 500,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseParams, filters, search, branch, status, taskView, assignedBy],
  );
  const { data, isLoading, isFetching } = useDelegations(query);
  const tasks = data?.data || [];
  const counts = data?.meta?.counts || {};

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: k === 'status' });
  };

  // The scope every number on this page was counted in — drill-downs reuse it
  // so the list behind a card always matches the card.
  const scope = useMemo(
    () => ({ ...baseParams, ...plainFilters, ...dueRange, search: search || undefined, branch: branch || undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseParams, filters, search, branch, assignedBy],
  );
  const TAB_STATUSES = new Set(DLG_STATUS_TABS);
  const drill = (label, status, description) =>
    drawers.drill({
      kind: 'delegation',
      label,
      description,
      params: { ...scope, status },
      onShowInList: () => {
        setTaskView('list');
        setParam('status', status === defaultStatus ? '' : status);
      },
    });
  const cards = [
    { label: 'Total', status: 'all', color: 'var(--primary)', desc: 'Every task in this view.' },
    { label: 'Total pending', status: 'incomplete', color: '#8b5cf6', desc: 'Every task not yet completed, irrespective of its due date (includes work awaiting approval).' },
    { label: 'Pending today', status: 'pending_today', color: '#0e8f9e', desc: 'Open and due today or already past their due date.' },
    { label: 'Overdue', status: 'overdue', color: 'var(--danger)', desc: 'Past their due date and not yet closed.' },
    { label: 'Due today', status: 'due_today', color: 'var(--warning)', desc: 'Open and due by the end of today.' },
    { label: 'Not accepted', status: 'pending', color: '#7c7784', desc: 'Status "Pending" — assigned but not yet accepted by the doer.' },
    { label: 'Accepted', status: 'accepted', color: '#38bdf8', desc: 'Accepted by the doer, work not started.' },
    { label: 'In progress', status: 'in_progress', color: '#ea8a2b', desc: 'Actively being worked on.' },
    { label: 'Dependent', status: 'dependent', color: '#d97706', desc: 'Waiting on another person, team or approval.' },
    { label: 'Blocked', status: 'blocked', color: '#f43f5e', desc: 'Held up by a person, department, vendor or consultant.' },
    { label: 'Verification', status: 'awaiting_verification', color: '#6366f1', desc: "Submitted and awaiting the assigner's approval." },
    { label: 'Completed', status: 'completed', color: 'var(--success)', desc: 'Finished and approved.' },
    { label: 'On time', status: 'on_time', color: 'var(--secondary)', desc: 'Completed on or before the due date.' },
    { label: 'Completed late', status: 'completed_late', color: '#ea8a2b', desc: 'Completed after the due date.' },
    { label: 'Shifted', status: 'shifted', color: '#8b5cf6', desc: 'Moved to another week — a fresh task replaced each one.' },
  ];

  return (
    <div className="col gap-4">
      {canSwitchAssigner && (
        <div className="row gap-3 wrap">
          <span className="tiny subtle upper">Assigned by</span>
          <Segmented
            value={assignedBy}
            onChange={(v) => setParam('by', v)}
            options={[
              { value: '', label: 'Everyone' },
              { value: 'me', label: isAdmin ? 'Me (my admin login)' : 'Me' },
              { value: 'admins', label: 'Any admin' },
            ]}
          />
          {assignedBy && <span className="tiny muted">Showing only tasks assigned by {assignedBy === 'me' ? 'you' : 'an admin'} — every card and list below follows this.</span>}
        </div>
      )}

      <div className="kpi-row">
        {cards.map((c) => (
          <Kpi
            key={c.status}
            label={c.label}
            value={data ? counts[c.status] ?? 0 : undefined}
            color={c.color}
            active={taskView === 'list' && status === c.status && c.status !== 'all'}
            onClick={() => drill(c.label, c.status, c.desc)}
          />
        ))}
      </div>

      <TaskFilters filters={filters} onChange={setFilters} hide={hideFilters} />

      <div className="row between wrap gap-3">
        {taskView === 'list' ? (
          <div className="row gap-2 wrap">
            <Segmented
              value={status}
              onChange={(s) => setParam('status', s === defaultStatus ? '' : s)}
              options={DLG_STATUS_TABS.map((s) => ({
                value: s,
                label: s === 'all' ? 'All' : DLG_STATUS_META[s].label,
                count: counts[s] ?? 0,
              }))}
            />
            {!TAB_STATUSES.has(status) && (
              <span className="chip active">
                Showing: {cards.find((c) => c.status === status)?.label || status} · {counts[status] ?? 0}
                <X size={13} style={{ cursor: 'pointer' }} onClick={() => setParam('status', '')} />
              </span>
            )}
          </div>
        ) : (
          <span className="sm muted">{tasks.length} task(s){isFetching ? ' · refreshing…' : ''}</span>
        )}
        <Segmented
          value={taskView}
          onChange={setTaskView}
          options={[
            { value: 'list', icon: List, title: 'List' },
            { value: 'board', icon: KanbanSquare, title: 'Board' },
            { value: 'calendar', icon: CalendarDays, title: 'Calendar' },
          ]}
        />
      </div>

      {isLoading ? (
        <SkTable rows={8} />
      ) : !tasks.length && taskView !== 'calendar' ? (
        <div className="card">
          <EmptyState icon={Inbox} title="No tasks here" hint={emptyHint || 'Try another status tab or clear the filters.'} />
        </div>
      ) : taskView === 'board' ? (
        <TaskBoard tasks={tasks} onOpen={(id) => setParam('task', id)} />
      ) : taskView === 'calendar' ? (
        <TaskCalendar tasks={tasks} onOpen={(id) => setParam('task', id)} />
      ) : (
        <>
          <TaskList
            tasks={tasks}
            onOpen={(id) => setParam('task', id)}
            show={show}
            onReopen={setReopening}
            canReopen={(t) => isAdmin || String(t.assigner?._id || t.assigner) === me}
          />
          {data?.meta?.total > tasks.length && <div className="tiny muted center">Showing {tasks.length} of {data.meta.total} — narrow the filters to see the rest.</div>}
        </>
      )}

      <ReasonModal
        open={Boolean(reopening)}
        onClose={() => setReopening(null)}
        title="Reopen completed task"
        subtitle={reopening ? `${reopening.code} · ${reopening.title}` : ''}
        label="What needs further action, correction or review?"
        confirmLabel="Reopen task"
        onSubmit={async (reason) => {
          try {
            await reopenAct.mutateAsync({ id: reopening._id, action: 'reopen', body: { reason } });
            toast.success(`${reopening.code} reopened — back with ${reopening.doer?.name || 'the doer'}`);
            return true;
          } catch (e) {
            toast.error(errMsg(e));
            return false;
          }
        }}
      >
        <p className="sm muted" style={{ marginBottom: 12 }}>
          The task goes back to <b>In Progress</b> with {reopening?.doer?.name || 'its doer'}, who is notified along with everyone on the task. Its completion stays on record in the history.
        </p>
      </ReasonModal>

      <TaskDetailDrawer taskId={openId} onClose={() => setParam('task', '')} onOpenTask={(id) => setParam('task', id)} />
    </div>
  );
}

export default TaskExplorer;
