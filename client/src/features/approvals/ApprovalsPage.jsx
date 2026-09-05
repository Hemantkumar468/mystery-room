import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, AlertTriangle, Search, X, RotateCcw, ChevronLeft } from 'lucide-react';
import dayjs from '../../lib/dayjs.js';
import { Link } from 'react-router-dom';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useGetFranchiseEnquiriesQuery, useDecideFranchiseEnquiryMutation } from '../../app/api/franchiseApi.js';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { EmptyState, Badge, CityChip } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { useTasks, useTaskDecisionMutation } from '../../app/api/tasksApi.js';
// The same parity-tested rules the server enforces in task.service.js — not
// role-string tests, so the queue stays correct as roles change.
import { canApprove, canManagementApprove, deptMeta, isOwnTaskWork } from '../../lib/ui.js';
import {
  useGetPendingApprovalsQuery, useGetApprovedRecordsQuery,
  useBulkRecordDecisionMutation,
} from '../../app/api/recordsApi.js';
import { RejectDialog } from '../projects/records/RejectDialog.jsx';
import { STAGES_CONFIG, getStagePath } from '../projects/stagesConfig.jsx';
import { ApprovalsByProject } from './ApprovalsByProject.jsx';

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

/**
 * How long a TASK has been waiting. A task reaches this queue when its doer
 * finished it, so that — not `updatedAt`, which any edit moves — is the age.
 */
const taskDaysWaiting = (t) => {
  const since = t.submittedForApprovalAt || t.actualEnd || t.updatedAt;
  if (!since) return null;
  const d = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

/** Who is waiting on this: the doer who finished a task, or the submitter of a record. */
const personOf = (item) => item.completedBy?.name || item.submittedBy?.name || item.assignee?.name || null;

const stageName = (key) => STAGES_CONFIG.find((s) => s.key === key)?.name || key;
const projectIdOf = (r) => String(r.project?._id || r.project?.id || r.project || '');

/* WHERE this decision is being made. Project names in this system are often
   working labels — "demo", "p13" — so the project alone tells an approver
   nothing about the launch they are signing off. The city does. Read through
   the populated project on both tasks and records, so the two halves of this
   page agree. */
const cityOf = (r) => r.project?.city || '';

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

/** The two ways into the same queue — see the note in ApprovalsPage. */
const VIEWS = [
  { key: 'projects', label: 'By project' },
  { key: 'everything', label: 'Everything' },
];

/**
 * Franchise enquiries — outsiders offering a property and a partnership,
 * straight from the public link. They sit ABOVE the ordinary queue
 * because an approval here creates an entire project (at Phase 3 — LOI,
 * with the property filed and approved); a rejection records why, which
 * is the expansion map of tomorrow.
 */
function FranchiseEnquiriesBlock() {
  const { data } = useGetFranchiseEnquiriesQuery('submitted');
  const [decide, decideState] = useDecideFranchiseEnquiryMutation();
  const [rejectingId, setRejectingId] = useState(null);
  const [reason, setReason] = useState('');
  const [born, setBorn] = useState(null); // { name, project }
  const rows = data || [];
  if (!rows.length && !born) return null;

  const approve = async (enq) => {
    const out = await decide({ id: enq._id, decision: 'approve' }).unwrap().catch(() => null);
    if (out?.project) {
      setBorn({ name: enq.name, project: out.project });
      flashSuccess('Approved — project created at Phase 3 (LOI)');
    }
  };
  const reject = async (enq) => {
    if (!reason.trim()) return;
    await decide({ id: enq._id, decision: 'reject', reason: reason.trim() }).unwrap().catch(() => {});
    setRejectingId(null);
    setReason('');
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="apr-bulkbar">
        <span className="sm" style={{ fontWeight: 650 }}>Franchise enquiries — a partner wants in</span>
        <span className="tiny muted">{rows.length} waiting · approval creates the project at the LOI phase</span>
      </div>
      <div className="col gap-2" style={{ padding: 12 }}>
        {born && (
          <div className="pt-alert" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
            {born.name}&rsquo;s enquiry approved — project <b>{born.project.code}</b> is live, standing at Phase 3.
            {' '}<Link to={`/projects/${born.project._id}`} style={{ fontWeight: 700 }}>Open it →</Link>
          </div>
        )}
        {rows.map((e) => (
          <div key={e._id} className="fr-row">
            <div className="fr-facts">
              <span><b>{e.name}</b> · {e.phone}{e.email ? ` · ${e.email}` : ''}</span>
              <span><b>{e.city}</b>{e.locality ? ` · ${e.locality}` : ''}</span>
              {e.carpetAreaSqft ? <span><b>{e.carpetAreaSqft}</b> sq ft{e.floor ? ` · ${e.floor}` : ''}</span> : null}
              <span>{e.ownership === 'owned' ? 'Owns the property' : e.ownership === 'family' ? 'Family property' : e.ownership === 'leased' ? 'Leased / can lease' : 'Ownership: other'}</span>
              {e.investmentReady && <span>Investment: {e.investmentReady}</span>}
            </div>
            <div className="tiny muted">{e.address}</div>
            {e.background && <div className="sm">{e.background}</div>}
            {e.message && <div className="sm muted">&ldquo;{e.message}&rdquo;</div>}
            {(e.photos?.length || e.location) && (
              <div className="fr-photos tiny">
                {(e.photos || []).map((ph, i) => (
                  <a key={ph.url || i} href={ph.url} target="_blank" rel="noreferrer">{ph.name || `photo ${i + 1}`}</a>
                ))}
                {Number.isFinite(e.location?.lat) && (
                  <a href={`https://www.google.com/maps?q=${e.location.lat},${e.location.lng}`} target="_blank" rel="noreferrer">map pin</a>
                )}
              </div>
            )}
            {rejectingId === e._id ? (
              <div className="col gap-2">
                <textarea className="textarea" rows={2} autoFocus value={reason} onChange={(ev) => setReason(ev.target.value)}
                  placeholder="Why not — market too small, area too tight, timing… (the applicant-facing record)" />
                <div className="row gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRejectingId(null); setReason(''); }}>Cancel</button>
                  <button type="button" className="btn btn-subtle btn-sm" style={{ color: 'var(--danger)' }} disabled={!reason.trim() || decideState.isLoading} onClick={() => reject(e)}>Confirm rejection</button>
                </div>
              </div>
            ) : (
              <div className="row gap-2">
                <button type="button" className="btn btn-primary btn-sm" disabled={decideState.isLoading} onClick={() => approve(e)}>
                  Approve — create the project
                </button>
                <button type="button" className="btn btn-subtle btn-sm" style={{ color: 'var(--danger)' }} disabled={decideState.isLoading} onClick={() => { setRejectingId(e._id); setReason(''); }}>
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const FILTERS = [
  { key: 'overdue', label: 'Over a week', test: (r, age) => (age(r) ?? 0) >= 7 },
  { key: 'week', label: 'This week', test: (r, age) => (age(r) ?? 0) < 7 },
  { key: 'all', label: 'Everything', test: () => true },
];

export function ApprovalsPage() {
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  /* Two ways in, one queue.
   *
   * "By project" leads, because a decision belongs to a launch and grouping by
   * it is how the work is actually handed out. "Everything" is the flat list
   * this page has always been, kept because its value is real and specific:
   * clearing sixty routine items in one pass without opening eight projects.
   * Dropping it to make room for the grouping would be a straight downgrade.
   *
   * On /approvals/project/:id there is no choice to offer — that URL IS one
   * project's queue — so the flat list renders directly, scoped to it.
   *
   * `view` holds only the choice made on /approvals. The route wins over it,
   * DERIVED on every render rather than seeded into state: both routes render
   * this same component, so React keeps the instance mounted across the
   * navigation and a `useState(routeProjectId ? … )` initialiser never runs
   * again. That left the project page rendering the project list, with the
   * queue unfiltered underneath it. */
  const [view, setView] = useState('projects');
  const activeView = routeProjectId ? 'everything' : view;

  const { data, isLoading, isError, refetch } = useGetPendingApprovalsQuery(undefined, {
    skip: !canDecide,
  });
  const [bulkDecide, bulkState] = useBulkRecordDecisionMutation();

  /* The history: what has already been signed. Fetched only once the tab
     is opened — the pending queue is the page's job, this is its memory. */
  const [approvedOpened, setApprovedOpened] = useState(false);
  const { data: approvedData } = useGetApprovedRecordsQuery(undefined, {
    skip: !canDecide || !approvedOpened,
  });

  /**
   * Tasks awaiting a signature, both tiers.
   *
   * A task marked Done auto-submits to its own department manager, then to
   * management (cross-department). Neither had a queue: this page listed only
   * Records, and Phase 7 lists only the second tier — so a finished task sat
   * invisible until someone happened to open it. That is the single most
   * confusing thing in the product: work is "executed", nothing shows up to
   * approve, and the phase will not close.
   *
   * Queried on `approvalState`, NOT `status`. The three-state migration moved
   * sign-off onto its own axis: `status` is only pending/processing/complete
   * now, so the old `status=waiting_approval` was not merely empty — it was
   * not a valid status any more and the endpoint rejected it outright, which
   * is why every project queue came back 400 and showed no tasks at all.
   */
  const { data: tier1 } = useTasks({ approvalState: 'waiting_department', limit: 200 }, { skip: !canDecide });
  const { data: tier2 } = useTasks({ approvalState: 'waiting_management', limit: 200 }, { skip: !canDecide });
  const [decideTask, taskState] = useTaskDecisionMutation();

  const taskItems = useMemo(() => {
    const rows = [...(tier1?.data || tier1 || []), ...(tier2?.data || tier2 || [])];
    // Only what THIS user may actually sign: tier 1 is department-scoped for a
    // Manager, tier 2 is not. Showing a row someone cannot action is worse than
    // not showing it — they cannot clear it and cannot tell why.
    return rows.filter((t) => (
      t.approvalState === 'waiting_management'
        ? canManagementApprove(user)
        : canApprove(user, t)
    ));
  }, [tier1, tier2, user]);

  /* Opens on EVERYTHING, oldest first. It used to open on "Over a week",
     which quietly hid anything submitted recently — twice the MD searched
     for a form filed that day, found nothing, and reasonably concluded the
     queue was broken. A queue must show its whole truth by default; the
     ageing chips narrow it when someone chooses to work the stale end. */
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  // Narrow the queue the way a decision-maker actually thinks about it: this
  // launch, this person, this phase. Each applies to BOTH lists below.
  const [cityFilter, setCityFilter] = useState('');
  /* Same reason as `activeView`: seeded once, this stayed '' when navigating
     in from /approvals, so a project's queue showed every project's items.
     Declared with its derived value here, above every memo that reads it —
     a `const` further down would be in the temporal dead zone when the first
     useMemo callback runs. */
  const [projectFilter, setProjectFilter] = useState('');
  const activeProjectFilter = routeProjectId || projectFilter;
  const [personFilter, setPersonFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(false);

  /* Typing a search means "find it wherever it is". The box used to search
     only inside the active ageing tab, so an item submitted today was
     unfindable while "Over a week" was selected — the search read as
     broken, and effectively was. The chip visibly flips to Everything so
     the scope change is honest, and stays wherever the user clicks next. */
  useEffect(() => {
    if (search.trim() && (filter === 'overdue' || filter === 'week')) setFilter('all');
  }, [search]);
  const [rejectTask, setRejectTask] = useState(null);
  const [result, setResult] = useState(null);

  const records = useMemo(() => data || [], [data]);

  const approvedList = useMemo(() => {
    const rows = approvedData || [];
    return [...rows]
      .filter((r) => matchesApproved(r))
      .sort((a, b) => new Date(b.approvedAt || b.updatedAt || 0) - new Date(a.approvedAt || a.updatedAt || 0));
    function matchesApproved(item) {
      if (cityFilter && cityOf(item) !== cityFilter) return false;
      if (activeProjectFilter && projectIdOf(item) !== activeProjectFilter) return false;
      if (personFilter && personOf(item) !== personFilter) return false;
      if (phaseFilter && item.stageKey !== phaseFilter) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return [item.title, cityOf(item), item.project?.name, item.project?.code, personOf(item), stageName(item.stageKey), item.assessmentType]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    }
  }, [approvedData, cityFilter, activeProjectFilter, personFilter, phaseFilter, search]);

  const ordered = useMemo(
    () => [...records].sort(
      (a, b) => new Date(a.submittedAt || a.updatedAt || 0) - new Date(b.submittedAt || b.updatedAt || 0),
    ),
    [records],
  );

  /**
   * One test for both lists. The search used to cover only the records, so
   * typing a project code narrowed the bottom half of the page and left the
   * tasks above it untouched — which reads as a broken search box, and is.
   */
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)?.test || (() => true);
    return (item, age) => {
      if (!test(item, age)) return false;
      if (cityFilter && cityOf(item) !== cityFilter) return false;
      if (activeProjectFilter && projectIdOf(item) !== activeProjectFilter) return false;
      if (personFilter && personOf(item) !== personFilter) return false;
      if (phaseFilter && item.stageKey !== phaseFilter) return false;
      if (!q) return true;
      return [
        item.title, item.code, cityOf(item), item.project?.name, item.project?.code,
        personOf(item), stageName(item.stageKey), item.assessmentType,
        item.department && deptMeta(item.department).label,
      ].filter(Boolean).join(' ').toLowerCase().includes(q);
    };
  }, [search, filter, cityFilter, activeProjectFilter, personFilter, phaseFilter]);

  const visibleTasks = useMemo(
    () => taskItems.filter((t) => matches(t, taskDaysWaiting)),
    [taskItems, matches],
  );

  const visible = useMemo(
    () => ordered.filter((r) => matches(r, daysWaiting)),
    [ordered, matches],
  );

  /* Chip counts cover BOTH lists — the number on "Over a week" meant records
     only, while the page above it was mostly tasks. */
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [
    f.key,
    ordered.filter((r) => f.test(r, daysWaiting)).length
      + taskItems.filter((t) => f.test(t, taskDaysWaiting)).length,
  ])), [ordered, taskItems]);

  /** Dropdown options, built from what is actually in the queue. */
  const options = useMemo(() => {
    const all = [...taskItems, ...ordered];
    const projects = new Map();
    const cities = new Set();
    const people = new Set();
    const phases = new Map();
    for (const item of all) {
      const pid = projectIdOf(item);
      if (pid && !projects.has(pid)) {
        projects.set(pid, {
          name: item.project?.name || item.project?.code || 'Untitled',
          city: cityOf(item),
        });
      }
      const c = cityOf(item);
      if (c) cities.add(c);
      const who = personOf(item);
      if (who) people.add(who);
      if (item.stageKey) phases.set(item.stageKey, stageName(item.stageKey));
    }
    return {
      projects: [...projects].sort((a, b) => a[1].name.localeCompare(b[1].name)),
      cities: [...cities].sort(),
      people: [...people].sort(),
      phases: [...phases].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [taskItems, ordered]);

  /* The header for /approvals/project/:id. Read off the queue's own items
     rather than fetched separately — every item already carries its populated
     project, so a second request would only add a way for the two to disagree. */
  const routeProject = useMemo(() => {
    if (!routeProjectId) return null;
    const hit = [...taskItems, ...ordered].find((i) => projectIdOf(i) === routeProjectId);
    return hit?.project
      ? { name: hit.project.name, code: hit.project.code, city: hit.project.city || null }
      : null;
  }, [routeProjectId, taskItems, ordered]);

  const filtersOn = Boolean(search || cityFilter || projectFilter || personFilter || phaseFilter);
  const clearFilters = () => {
    setSearch(''); setCityFilter(''); setProjectFilter(''); setPersonFilter(''); setPhaseFilter('');
  };

  /* Choosing a city narrows the launch list to that city — and drops a launch
     already selected in another city, which would otherwise empty the queue
     while both dropdowns individually look sensible. */
  const launchOptions = useMemo(
    () => (cityFilter ? options.projects.filter(([, p]) => p.city === cityFilter) : options.projects),
    [options.projects, cityFilter],
  );

  const pickCity = (next) => {
    setCityFilter(next);
    if (next && projectFilter) {
      const stillValid = options.projects.some(([id, p]) => id === projectFilter && p.city === next);
      if (!stillValid) setProjectFilter('');
    }
  };

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
                Records submitted from any phase of any launch, oldest first — each one shown
                as city &rsaquo; launch &rsaquo; task, so you can see where the work is before you
                sign it. Decide them here without opening each project — or select several and
                clear them in one go.
              </p>
              {stale > 0 && (
                <p className="stage-explain-text" style={{ marginTop: 6, color: 'var(--danger)' }}>
                  {stale} {stale === 1 ? 'item has' : 'items have'} been waiting over a week.
                </p>
              )}
            </div>
          </div>

          {/* On a project's own queue: where you are, and the way back. */}
          {routeProjectId ? (
            <div className="col gap-1">
              <button type="button" className="vend-back" onClick={() => navigate('/approvals')}>
                <ChevronLeft size={13} /> All projects
              </button>
              <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
                <h2 className="vend-drill-title">{routeProject?.name || 'This launch'}</h2>
                {routeProject?.city && <CityChip city={routeProject.city} />}
                {routeProject?.code && <span className="proj-code">{routeProject.code}</span>}
              </div>
            </div>
          ) : null}

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
              {/* The page's memory: everything already signed, newest first. */}
              <button
                type="button"
                className={`proj-chip${filter === 'approved' ? ' active' : ''}`}
                style={{ '--chip-accent': 'var(--success)' }}
                onClick={() => { setFilter('approved'); setApprovedOpened(true); }}
              >
                Approved
                {approvedOpened && <span className="proj-chip-count">{(approvedData || []).length}</span>}
              </button>
            </div>

            <div className="proj-search">
              <Search size={15} className="subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search task, code, city, launch, person or phase…"
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

          {/* Narrow by launch, person or phase — each one applies to the tasks
              AND the records below, so the whole page answers the same question. */}
          <div className="apr-narrow">
            {/* The two views and the three narrowing controls read as one row:
                which list, then how much of it. */}
            {!routeProjectId && VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                className={`proj-chip${view === v.key ? ' active' : ''}`}
                style={{ '--chip-accent': '#6366F1' }}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
            <select className="apr-select" value={cityFilter} onChange={(e) => pickCity(e.target.value)} aria-label="Filter by city">
              <option value="">All cities</option>
              {options.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Not offered on /approvals/project/:id — the URL already names
                the launch, and a dropdown that could disagree with it is a
                control whose only use is to confuse. */}
            {!routeProjectId && (
              <select className="apr-select" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} aria-label="Filter by launch">
                <option value="">All launches</option>
                {launchOptions.map(([id, p]) => (
                  <option key={id} value={id}>{p.city ? `${p.name} · ${p.city}` : p.name}</option>
                ))}
              </select>
            )}
            <select className="apr-select" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} aria-label="Filter by person">
              <option value="">Anyone</option>
              {options.people.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select className="apr-select" value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} aria-label="Filter by phase">
              <option value="">Every phase</option>
              {options.phases.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
            <span className="tiny muted apr-narrow-count">
              {visibleTasks.length + visible.length} of {taskItems.length + ordered.length} waiting
            </span>
            {filtersOn && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                <X size={13} /> Clear filters
              </button>
            )}
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

          {canDecide && <FranchiseEnquiriesBlock />}

          {bulkState.isError && (
            <div className="apr-result has-failures">
              <span>Could not record that decision. Nothing was changed.</span>
              <button type="button" onClick={() => refetch()}>Retry</button>
            </div>
          )}

          {/* By project: the same filtered items, grouped. Clicking through
              lands on that project's own queue, which is this page again with
              the project locked — so every decision control below works there
              unchanged rather than being reimplemented. */}
          {activeView === 'projects' && filter !== 'approved' && (
            <ApprovalsByProject tasks={visibleTasks} records={visible} />
          )}

          {/* Tasks first: a finished task blocks its phase from closing, and a
              doer is stood waiting on the answer. A submitted record is a form
              awaiting review — important, but not blocking a person. */}
          {activeView === 'everything' && filter !== 'approved' && visibleTasks.length > 0 && (
            <div className="card">
              <div className="apr-bulkbar">
                <span className="sm" style={{ fontWeight: 650 }}>
                  Completed work waiting for your approval
                </span>
                <span className="tiny muted">
                  {visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'}
                  {visibleTasks.length !== taskItems.length ? ` of ${taskItems.length}` : ''}
                </span>
              </div>

              {visibleTasks.map((t) => {
                const tier2 = t.approvalState === 'waiting_management';
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
                      onClick={() => navigate(
                        routeProjectId
                          ? `/approvals/project/${routeProjectId}/item/${t._id}`
                          : `/projects/${t.project?._id || t.project}/tasks/${t.code}`,
                      )}
                    >
                      {/* What it is, which phase it belongs to, who finished
                          it. No tier numbers — the person deciding needs the
                          task and its stage, not the internals of the pipeline
                          it travelled through to reach them. */}
                      <div className="apr-meta-top">
                        <CityChip city={cityOf(t)} />
                        {cityOf(t) && <span className="apr-crumb">&rsaquo;</span>}
                        {t.project?.name && <span className="apr-project">{t.project.name}</span>}
                        <span className="proj-code">{t.code}</span>
                      </div>
                      <div className="apr-title">{t.title}</div>
                      <div className="apr-sub">
                        {stageName(t.stageKey)}
                        {t.department ? ` · ${deptMeta(t.department).label}` : ''}
                        {' · '}
                        {t.assignee?.name ? `completed by ${t.assignee.name}` : 'unassigned'}
                        {t.dueDate ? ` · due ${dayjs(t.dueDate).format('D MMM')}` : ''}
                      </div>
                    </div>

                    {(() => {
                      const d = taskDaysWaiting(t);
                      return d === null ? <Badge color="var(--warning)" soft dot>Waiting for approval</Badge> : (
                        <Badge
                          color={d >= 7 ? 'var(--danger)' : 'var(--warning)'}
                          soft
                          dot
                        >
                          {d === 0 ? 'Waiting since today' : `Waiting ${d} day${d === 1 ? '' : 's'}`}
                        </Badge>
                      );
                    })()}

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

          {activeView === 'projects' && filter !== 'approved' ? null : filter === 'approved' ? (
            <div className="card">
              <div className="apr-bulkbar">
                <span className="sm" style={{ fontWeight: 650 }}>Approved — your decision history</span>
                <span className="tiny muted">{approvedList.length} record{approvedList.length === 1 ? '' : 's'} · newest first</span>
              </div>
              {approvedList.length === 0 && (
                <EmptyState
                  icon={CheckCircle2}
                  title={approvedData ? 'Nothing approved yet' : 'Loading…'}
                  hint="Everything you approve is kept here, newest first, with who signed and when."
                />
              )}
              {approvedList.map((r) => (
                <div key={r._id} className="apr-row">
                  <div className="apr-main" onClick={() => openRecord(r)}>
                    <div className="apr-meta-top">
                      <CityChip city={cityOf(r)} />
                      {cityOf(r) && <span className="apr-crumb">&rsaquo;</span>}
                      {r.project?.name && <span className="apr-project">{r.project.name}</span>}
                      <span className="proj-code">{r.project?.code || '—'}</span>
                    </div>
                    <div className="apr-title">{r.title || r.project?.name || 'Untitled record'}</div>
                    <div className="apr-sub">
                      {stageName(r.stageKey)}
                      {r.assessmentType ? ` · ${r.assessmentType}` : ''}
                      {' · submitted by '}
                      {r.submittedBy?.name || '—'}
                    </div>
                  </div>
                  <Badge color="var(--success)" soft dot>
                    Approved{r.approvedBy?.name ? ` by ${r.approvedBy.name}` : ''} · {dayjs(r.approvedAt || r.updatedAt).format('D MMM YYYY')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : isLoading ? (
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
                        <CityChip city={cityOf(r)} />
                        {cityOf(r) && <span className="apr-crumb">&rsaquo;</span>}
                        {r.project?.name && <span className="apr-project">{r.project.name}</span>}
                        <span className="proj-code">{r.project?.code || '—'}</span>
                      </div>
                      <div className="apr-title">{r.title || r.project?.name || 'Untitled record'}</div>
                      <div className="apr-sub">
                        {stageName(r.stageKey)}
                        {r.assessmentType ? ` · ${r.assessmentType}` : ''}
                        {' · '}
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
