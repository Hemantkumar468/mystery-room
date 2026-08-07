import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, AlertTriangle, Search, X, RotateCcw } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useTasks, useTaskDecisionMutation } from '../../app/api/tasksApi.js';
// The same parity-tested rules the server enforces in task.service.js — not
// role-string tests, so the queue stays correct as roles change.
import { canApprove, canManagementApprove, deptMeta, isOwnTaskWork } from '../../lib/ui.js';
import {
  useGetPendingApprovalsQuery,
  useBulkRecordDecisionMutation,
} from '../../app/api/recordsApi.js';
import { RejectDialog } from '../projects/records/RejectDialog.jsx';
import { STAGES_CONFIG, getStagePath } from '../projects/stagesConfig.jsx';

/**
 * Every decision waiting on the current user, across every project.
 *
 * The backlog this exists to clear is structural, not behavioural. Approving
 * one item meant navigating project → phase → record, there was no way to act
 * on more than one at a time, and nothing surfaced age — so the queue grew to
 * 246 records with 238 of them over a week old.
 *
 * Three things fix that, and they are the whole feature: one list across all
 * projects, sorted oldest-first; inline decisions without leaving the page;
 * and bulk approve/reject for the routine majority.
 *
 * Not built here, and specified in docs/APPROVALS_QUEUE_SPEC.md: auto-approval
 * rules, delegation, SLA escalation, and the `Approval` pointer collection.
 * Those need a data model this deliberately does without — it reads the
 * existing submitted Records, so it needed no migration to start working.
 */

const daysWaiting = (r) => {
  const since = r.submittedAt || r.updatedAt;
  if (!since) return null;
  const d = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

const stageName = (key) => STAGES_CONFIG.find((s) => s.key === key)?.name || key;
const projectIdOf = (r) => String(r.project?._id || r.project?.id || r.project || '');

/** Grey under 3 days, amber 3–7, red beyond — the ageing scale from the spec. */
function AgeChip({ days }) {
  if (days == null) return null;
  const tone = days >= 7 ? 'var(--danger)' : days >= 3 ? 'var(--warning)' : 'var(--text-subtle)';
  const strong = days >= 3;
  return (
    <span
      className="apr-age"
      style={{
        color: tone,
        background: strong ? `color-mix(in srgb, ${tone} 12%, transparent)` : 'transparent',
        border: `1px solid ${strong ? `color-mix(in srgb, ${tone} 30%, transparent)` : 'transparent'}`,
      }}
      title={`Waiting ${days} day${days === 1 ? '' : 's'}`}
    >
      <Clock size={11} strokeWidth={2.3} />
      {days === 0 ? 'today' : `${days}d`}
    </span>
  );
}

/** Server cap. Mirrors bulkDecisionSchema — kept in step so the UI never
 *  submits a batch the API is going to reject outright. */
const BULK_LIMIT = 100;

const FILTERS = [
  { key: 'overdue', label: 'Over a week', test: (r) => (daysWaiting(r) ?? 0) >= 7 },
  { key: 'week', label: 'This week', test: (r) => (daysWaiting(r) ?? 0) < 7 },
  { key: 'all', label: 'Everything', test: () => true },
];

export function ApprovalsPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const { data, isLoading, isError, refetch } = useGetPendingApprovalsQuery(undefined, {
    skip: !canDecide,
  });
  const [bulkDecide, bulkState] = useBulkRecordDecisionMutation();

  /**
   * Tasks awaiting a signature, both tiers.
   *
   * A task marked Done auto-submits to `waiting_approval` (its own department
   * manager), then to `waiting_management_approval` (cross-department). Neither
   * had a queue: this page listed only Records, and Phase 7 lists only the
   * second tier — so a finished task sat invisible until someone happened to
   * open it. That is the single most confusing thing in the product: work is
   * "executed", nothing shows up to approve, and the phase will not close.
   */
  const { data: tier1 } = useTasks({ status: 'waiting_approval', limit: 200 }, { skip: !canDecide });
  const { data: tier2 } = useTasks({ status: 'waiting_management_approval', limit: 200 }, { skip: !canDecide });
  const [decideTask, taskState] = useTaskDecisionMutation();

  const taskItems = useMemo(() => {
    const rows = [...(tier1?.data || tier1 || []), ...(tier2?.data || tier2 || [])];
    // Only what THIS user may actually sign: tier 1 is department-scoped for a
    // Manager, tier 2 is not. Showing a row someone cannot action is worse than
    // not showing it — they cannot clear it and cannot tell why.
    return rows.filter((t) => (
      t.status === 'waiting_management_approval'
        ? canManagementApprove(user)
        : canApprove(user, t)
    ));
  }, [tier1, tier2, user]);

  // Oldest-first by default and "over a week" pre-selected: a queue this size
  // is worked from the stale end, and the oldest item here is 58 days old.
  const [filter, setFilter] = useState('overdue');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(false);
  const [rejectTask, setRejectTask] = useState(null);
  const [result, setResult] = useState(null);

  const records = useMemo(() => data || [], [data]);

  const ordered = useMemo(
    () => [...records].sort(
      (a, b) => new Date(a.submittedAt || a.updatedAt || 0) - new Date(b.submittedAt || b.updatedAt || 0),
    ),
    [records],
  );

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, ordered.filter(f.test).length])),
    [ordered],
  );

  const visible = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test || (() => true);
    const q = search.trim().toLowerCase();
    return ordered.filter((r) => {
      if (!test(r)) return false;
      if (!q) return true;
      return [r.title, r.project?.name, r.project?.code, r.submittedBy?.name, stageName(r.stageKey)]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [ordered, filter, search]);

  /* ── selection ─────────────────────────────────────────────────────── */

  const selectableIds = visible.slice(0, BULK_LIMIT).map((r) => r._id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Selects the filtered set, capped at the server's batch limit — never
  // "everything", which is how accidental mass approvals happen.
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));

  /* ── decisions ─────────────────────────────────────────────────────── */

  const run = async (decision, reason) => {
    const ids = [...selected].slice(0, BULK_LIMIT);
    if (!ids.length) return;
    try {
      const res = await bulkDecide({ ids, decision, reason }).unwrap();
      setResult(res);
      setSelected(new Set());
      setRejecting(false);
    } catch {
      // Surfaced by the mutation's error state below; the selection is kept so
      // the approver can retry rather than reselecting forty rows.
    }
  };

  const decideOne = async (record, decision, reason) => {
    try {
      await bulkDecide({ ids: [record._id], decision, reason }).unwrap();
    } catch { /* as above */ }
  };

  const openRecord = (r) => navigate(getStagePath(projectIdOf(r), r.stageKey));

  if (!canDecide) {
    return (
      <>
        <Topbar title="Approvals" />
        <div className="content">
          <div className="card">
            <EmptyState
              icon={CheckCircle2}
              title="Approvals are for Managers, EAs and the MD"
              hint="Your role can capture and complete work, but not sign it off."
            />
          </div>
        </div>
      </>
    );
  }

  const stale = counts.overdue || 0;
  const busy = bulkState.isLoading;

  return (
    <>
      <Topbar title="Approvals" />

      <div className="content">
        <div className="content-wide col gap-3 fade-in">
          <div className="stage-explain">
            <div className="stage-explain-main">
              <span className="stage-explain-step">Everything waiting on you</span>
              <p className="stage-explain-text">
                Records submitted from any phase of any launch, oldest first. Decide them here
                without opening each project — or select several and clear them in one go.
              </p>
              {stale > 0 && (
                <p className="stage-explain-text" style={{ marginTop: 6, color: 'var(--danger)' }}>
                  {stale} {stale === 1 ? 'item has' : 'items have'} been waiting over a week.
                </p>
              )}
            </div>
          </div>

          <div className="apr-toolbar">
            <div className="apr-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`proj-chip${filter === f.key ? ' active' : ''}`}
                  style={{ '--chip-accent': f.key === 'overdue' ? '#DC2626' : '#6366F1' }}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="proj-chip-count">{counts[f.key] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="proj-search">
              <Search size={15} className="subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search record, launch or submitter…"
                aria-label="Search approvals"
              />
              {search && (
                <button
                  type="button"
                  className="proj-actions-btn"
                  style={{ width: 22, height: 22 }}
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Outcome of the last batch. Partial success is normal — another
              approver may have cleared some between load and submit — so it is
              reported plainly rather than as an error. */}
          {result && (
            <div className={`apr-result${result.failed?.length ? ' has-failures' : ''}`}>
              <span>
                <b>{result.succeeded?.length || 0}</b> recorded
                {result.failed?.length ? <> · <b>{result.failed.length}</b> could not be</> : null}
              </span>
              {result.failed?.length > 0 && (
                <span className="tiny muted">
                  {result.failed[0].message}
                  {result.failed.length > 1 && ` (+${result.failed.length - 1} more)`}
                </span>
              )}
              <button type="button" onClick={() => setResult(null)} aria-label="Dismiss"><X size={14} /></button>
            </div>
          )}

          {bulkState.isError && (
            <div className="apr-result has-failures">
              <span>Could not record that decision. Nothing was changed.</span>
              <button type="button" onClick={() => refetch()}>Retry</button>
            </div>
          )}

          {/* Tasks first: a finished task blocks its phase from closing, and a
              doer is stood waiting on the answer. A submitted record is a form
              awaiting review — important, but not blocking a person. */}
          {taskItems.length > 0 && (
            <div className="card">
              <div className="apr-bulkbar">
                <span className="sm" style={{ fontWeight: 650 }}>
                  Completed work waiting for your approval
                </span>
                <span className="tiny muted">{taskItems.length} task{taskItems.length === 1 ? '' : 's'}</span>
              </div>

              {taskItems.map((t) => {
                const tier2 = t.status === 'waiting_management_approval';
                const busy = taskState.isLoading;
                // Separation of duties: nobody signs off work they did or
                // submitted. Shown-but-disabled rather than hidden — an item
                // that silently vanishes from your queue is the reason people
                // stop trusting the queue. Saying who it needs instead is the
                // difference between "broken" and "waiting on someone else".
                const ownWork = isOwnTaskWork(user, t, tier2 ? 'management' : 'department');
                return (
                  <div key={t._id} className="apr-row">
                    <div
                      className="apr-main"
                      onClick={() => navigate(`/projects/${t.project?._id || t.project}/tasks/${t.code}`)}
                    >
                      {/* What it is, which phase it belongs to, who finished
                          it. No tier numbers — the person deciding needs the
                          task and its stage, not the internals of the pipeline
                          it travelled through to reach them. */}
                      <div className="apr-meta-top">
                        <span className="proj-code">{t.code}</span>
                        <span className="apr-stage">{stageName(t.stageKey)}</span>
                        {t.department && <span className="apr-type">· {deptMeta(t.department).label}</span>}
                      </div>
                      <div className="apr-title">{t.title}</div>
                      <div className="apr-sub">
                        {t.project?.name ? `${t.project.name} · ` : ''}
                        {t.assignee?.name ? `completed by ${t.assignee.name}` : 'unassigned'}
                        {t.dueDate ? ` · due ${dayjs(t.dueDate).format('D MMM')}` : ''}
                      </div>
                    </div>

                    <Badge color="var(--warning)" soft dot>Waiting for approval</Badge>

                    {ownWork ? (
                      <span className="tiny muted" style={{ maxWidth: 210, textAlign: 'right' }}>
                        You submitted this — it needs a different signer.
                      </span>
                    ) : (
                      <div className="row gap-2">
                        <button
                          type="button"
                          className="btn btn-subtle btn-sm"
                          disabled={busy}
                          style={{ color: 'var(--danger)' }}
                          onClick={() => setRejectTask(t)}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={() => decideTask({
                            taskId: t._id,
                            projectId: t.project?._id || t.project,
                            decision: 'approve',
                          })}
                        >
                          Approve
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {isLoading ? (
            <div className="card"><SkTable rows={8} /></div>
          ) : isError ? (
            <div className="card">
              <EmptyState
                icon={AlertTriangle}
                title="Couldn’t load approvals"
                hint="The records service didn’t respond."
                action={<button className="btn btn-primary" onClick={() => refetch()}>Retry</button>}
              />
            </div>
          ) : !visible.length ? (
            <div className="card">
              <EmptyState
                icon={CheckCircle2}
                title={records.length ? 'Nothing in this view' : 'All caught up'}
                hint={
                  records.length
                    ? 'Try a different filter or clear the search.'
                    : 'Nothing is waiting on your decision.'
                }
                action={records.length ? (
                  <button className="btn btn-subtle" onClick={() => { setFilter('all'); setSearch(''); }}>
                    Show everything
                  </button>
                ) : null}
              />
            </div>
          ) : (
            <div className="card">
              {/* Bulk bar. Present but inert with nothing selected, so the
                  capability is discoverable before it is needed. */}
              <div className="apr-bulkbar">
                <label className="row gap-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" />
                  <span className="sm">
                    {selected.size > 0
                      ? `${selected.size} selected`
                      : `Select all ${Math.min(visible.length, BULK_LIMIT)}`}
                  </span>
                </label>

                {visible.length > BULK_LIMIT && (
                  <span className="tiny muted">
                    {BULK_LIMIT} at a time — {visible.length - BULK_LIMIT} more after this batch
                  </span>
                )}

                <div className="row gap-2" style={{ marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className="btn btn-subtle btn-sm"
                    disabled={!selected.size || busy}
                    onClick={() => setRejecting(true)}
                    style={{ color: selected.size ? 'var(--danger)' : undefined }}
                  >
                    Reject{selected.size ? ` ${selected.size}` : ''}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!selected.size || busy}
                    onClick={() => run('approve')}
                  >
                    {busy ? <span className="spinner" /> : `Approve${selected.size ? ` ${selected.size}` : ''}`}
                  </button>
                </div>
              </div>

              {visible.map((r) => {
                const days = daysWaiting(r);
                const checked = selected.has(r._id);
                return (
                  <div key={r._id} className={`apr-row${checked ? ' selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(r._id)}
                      aria-label={`Select ${r.title || 'record'}`}
                      onClick={(e) => e.stopPropagation()}
                    />

                    <div className="apr-main" onClick={() => openRecord(r)}>
                      <div className="apr-meta-top">
                        <span className="proj-code">{r.project?.code || '—'}</span>
                        <span className="apr-stage">{stageName(r.stageKey)}</span>
                        {r.assessmentType && <span className="apr-type">· {r.assessmentType}</span>}
                      </div>
                      <div className="apr-title">{r.title || r.project?.name || 'Untitled record'}</div>
                      <div className="apr-sub">
                        {r.project?.name ? `${r.project.name} · ` : ''}
                        {r.submittedBy?.name || '—'}
                        {' · '}
                        {dayjs(r.submittedAt || r.updatedAt).format('D MMM YYYY')}
                      </div>
                    </div>

                    <AgeChip days={days} />

                    <div className="row gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-subtle btn-sm"
                        disabled={busy}
                        onClick={() => { setSelected(new Set([r._id])); setRejecting(true); }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => decideOne(r, 'approve')}
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="apr-foot">
                Showing {visible.length} of {records.length} · oldest first
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Task rejection always needs a reason — it sends work back to a person
          who has to know what to change. */}
      {rejectTask && (
        <RejectDialog
          open
          title={`Reject — ${rejectTask.title}`}
          placeholder="What needs to change before this can be approved?"
          pending={taskState.isLoading}
          onClose={() => setRejectTask(null)}
          onConfirm={async (reason) => {
            try {
              await decideTask({
                taskId: rejectTask._id,
                projectId: rejectTask.project?._id || rejectTask.project,
                decision: 'reject',
                reason,
              }).unwrap();
            } finally {
              setRejectTask(null);
            }
          }}
        />
      )}

      {rejecting && (
        <RejectDialog
          open
          title={selected.size > 1 ? `Reject ${selected.size} records` : 'Reject record'}
          placeholder={
            selected.size > 1
              ? 'This reason is recorded on every selected record — make it useful to all of them.'
              : 'Why is this being rejected?'
          }
          pending={busy}
          onClose={() => setRejecting(false)}
          onConfirm={(reason) => run('reject', reason)}
        />
      )}
    </>
  );
}

export default ApprovalsPage;
