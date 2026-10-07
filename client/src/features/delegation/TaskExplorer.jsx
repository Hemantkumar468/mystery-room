import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { List, KanbanSquare, CalendarDays, Inbox, X } from 'lucide-react';
import { Segmented, ReasonModal } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useDelegations, useDelegationAction } from '../../lib/opsQueries.js';
import { useOpsStore } from '../../store/opsStore.js';
import { DLG_STATUS_META, DLG_STATUS_TABS, errMsg } from '../../lib/opsUi.js';
import { TaskList, TaskBoard, TaskCalendar, TaskFilters } from './TaskViews.jsx';
import { TaskDetailDrawer } from './TaskDetailDrawer.jsx';
import { DelegationKpis, DELEGATION_CARDS } from './DelegationKpis.jsx';
import { can } from '../../lib/roles.js';

/**
 * Shorter names for the tab strip only.
 *
 * "Awaiting Verification" is 21 characters, and ten tabs have to share one
 * line on a 14-inch screen. The badge on a row still says the full thing —
 * there it is the only label and it has room. A tab's job is to be
 * distinguishable from its nine neighbours, which "Verification" manages
 * on its own.
 */
const TAB_LABEL = { awaiting_verification: 'Verification' };

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
export function TaskExplorer({ baseParams = {}, hideFilters = [], defaultStatus = 'all', show, emptyHint }) {
  const user = useAppSelector(selectCurrentUser);
  const me = String(user?.id || user?._id || '');
  const isAdmin = can.actForLeadership(user?.role); // MD / EA
  const reopenAct = useDelegationAction();
  const [reopening, setReopening] = useState(null);
  const branch = useOpsStore((s) => s.branch);
  const { taskView, setTaskView } = useOpsStore();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({});
  const status = params.get('status') || defaultStatus;
  const openId = params.get('task');
  const search = useDebounced(filters.search || '');

  // The single date filter ({ preset, from, to }) applies to the due date.
  const { date, ...plainFilters } = filters;
  const dueRange = { dueFrom: date?.from, dueTo: date?.to };

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
    [baseParams, filters, search, branch, status, taskView],
  );
  const { data, isLoading, isFetching } = useDelegations(query);
  const tasks = data?.data || [];
  const counts = data?.meta?.counts || {};
  const scopeType = baseParams.view || (baseParams.group ? 'group' : 'all');
  /* The second request that fed the old "In the loop" card on All tasks is
     gone with it. The eight cards all read from this view's own `counts`, so
     nothing needs a parallel fetch in a different scope any more. */

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: k === 'status' });
  };

  /* `scope` and `drill()` lived here: a drawer that listed the rows behind
     a KPI card. The cards filter the table directly now, so a second
     surface showing the same rows — over the top of the table that was
     about to show them — had nothing left to add. */
  const TAB_STATUSES = new Set(DLG_STATUS_TABS);
  /**
   * THE CARDS ARE NO LONGER WRITTEN HERE.
   *
   * Each scope used to carry its own list — four cards on All tasks, three
   * on Delegated by me, three on In the loop, with different names for the
   * same number. The counts behind them were always the same shape, so the
   * difference was purely in what each view had remembered to ask for.
   * DelegationKpis holds the one set; the scope is already baked into
   * `counts`, which the server computes under this view's own filter.
   */

  return (
    <div className="col gap-4">
      {/* The cards come first. The "Assigned by" switch used to sit above
          them, which put a control where the page's figures belong; it now
          sits with the filters, which is what it is. */}
      <DelegationKpis
        counts={counts}
        ready={Boolean(data)}
        active={status}
        /* The card drives the TABLE, not a drawer over it. Board and
           calendar ignore the status filter, so a card press also returns
           to the list — otherwise the number changes and nothing below it
           does, which reads as a dead button. */
        onSelect={(statusKey) => {
          setTaskView('list');
          setParam('status', statusKey === defaultStatus ? '' : statusKey);
        }}
      />

      {/* The "Assigned by: Everyone / Me / Any admin" switch was here.
          Removed by request. The same question is answerable from the
          Assigned by person-picker under More filters, which names a
          person rather than a category, so nothing is lost. */}
      <TaskFilters filters={filters} onChange={setFilters} hide={hideFilters} />

      {/* THE "Task Status" PANEL IS GONE.

          It listed ten statuses with their counts in a card of its own —
          directly above a row of pill tabs listing the same ten statuses
          with the same counts. Two controls, one question, and the one that
          took the most room was the one that only filtered. The pills below
          do the job and are what the reference shows. `statuses` went with
          it. */}
      <div className="row between wrap gap-3">
        {taskView === 'list' ? (
          <div className="row gap-2 wrap dlg-status-tabs">
            <Segmented
              value={status}
              onChange={(s) => setParam('status', s === defaultStatus ? '' : s)}
              options={DLG_STATUS_TABS.map((s) => ({
                value: s,
                label: s === 'all' ? 'All' : (TAB_LABEL[s] ?? DLG_STATUS_META[s].label),
                count: counts[s] ?? 0,
              }))}
            />
            {!TAB_STATUSES.has(status) && (
              <span className="chip active">
                Showing: {DELEGATION_CARDS.find((c) => c.key === status)?.label || status} · {counts[status] ?? 0}
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
