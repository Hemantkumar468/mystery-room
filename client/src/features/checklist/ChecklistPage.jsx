import '../../styles/ops-checklist.css';
import { Fragment, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Ban, BarChart3, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleStop, ClipboardCheck, Info, ListChecks,
  MapPin, MessageSquare, MessageSquareWarning, Paperclip, Pencil, Plus, Repeat, RotateCcw, Search, StickyNote, UserRoundCog, X,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { drawers } from '../../store/drawerStore.js';
import { DateRangeFilter, resolveDateRange } from '../../components/ops/DateRangeFilter.jsx';
import { Avatar, Badge, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { BranchSwitcher } from '../../components/ops/BranchSwitcher.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { ChkStatusBadge, FilterSelect, Kpi, Segmented } from '../../components/ops/common.jsx';
import {
  useChecklistDepartments, useChecklistReport, useChecklistRoutines, useChecklistSites, useChecklistSummary,
  useBranches, useChecklistTasks, useGroups, useTeams,
} from '../../lib/opsQueries.js';
import { CHK_FREQUENCIES, FREQ_LABEL, WEEKDAYS, parseRemarkLines } from '../../lib/opsUi.js';
import { DEPT_META } from '../../lib/ui.js';
import { daysUntil, fmtDate, fmtDateShort, fmtDateTime } from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useOpsStore } from '../../store/opsStore.js';
import { RoutineFormModal } from './RoutineFormModal.jsx';
import {
  BulkRemarkModal, CompleteTaskModal, NonFunctionalModal, ReassignModal, ReopenTaskModal, SitesManagerModal, StopRoutineModal, TaskRemarksModal,
} from './ChecklistModals.jsx';
import { can } from '../../lib/roles.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TASK_LIMIT = 500;

const STATUS_OPTIONS = [
  { value: 'pending_today', label: 'Pending today' },
  { value: 'pending', label: 'Total pending' },
  { value: 'due_today', label: 'Due today' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'on_time', label: 'On time' },
  { value: 'late', label: 'Done late' },
  { value: 'non_functional', label: 'Non-functional' },
  { value: 'all', label: 'All' },
];

/** Header KPI cards — each drills into the exact occurrences it counts. */
const KPI_DEFS = [
  { key: 'total', label: 'Total', status: 'all', color: 'var(--primary)', value: (s) => s.total, desc: 'Every occurrence in the current scope' },
  {
    key: 'pending', label: 'Total pending', status: 'pending', color: '#8b5cf6', value: (s) => s.pending,
    hint: 'All incomplete, any date', desc: 'Every occurrence not yet completed, irrespective of its planned date (overdue, today and upcoming)',
  },
  { key: 'plate', label: 'Pending today', status: 'pending_today', color: 'var(--primary)', value: (s) => s.pendingToday, hint: 'Due today + carried over', desc: 'Still open and due today or already overdue' },
  { key: 'due', label: 'Due today', status: 'due_today', color: 'var(--info)', value: (s) => s.dueToday, desc: 'Open occurrences planned for today' },
  { key: 'overdue', label: 'Overdue', status: 'overdue', color: 'var(--danger)', value: (s) => s.overdue, desc: 'Open past their planned day — these count as misses' },
  { key: 'upcoming', label: 'Upcoming', status: 'upcoming', color: 'var(--text-muted)', value: (s) => s.upcoming, desc: 'Scheduled after today' },
  { key: 'completed', label: 'Completed', status: 'completed', color: 'var(--success)', value: (s) => s.completed, desc: 'Closed as done' },
  {
    key: 'ontime', label: 'On-time', status: 'on_time', color: 'var(--info)', value: (s) => pct(s.onTimeRate),
    hint: (s) => (s.onTime != null ? `${s.onTime} done on the day` : undefined), desc: 'Closed on or before the planned day',
  },
  { key: 'late', label: 'Done late', status: 'late', color: 'var(--warning)', value: (s) => s.late, desc: 'Closed after the planned day' },
  { key: 'nf', label: 'Non-functional', status: 'non_functional', color: 'var(--warning)', value: (s) => s.nonFunctional, desc: 'Closed without counting as a miss (room closed, outage…)' },
  {
    key: 'compliance', label: 'Compliance', status: 'overdue', drillLabel: 'Missed — pulling compliance down', noActive: true,
    color: (s) => (s.complianceRate != null ? rateColor(s.complianceRate) : 'var(--primary)'), value: (s) => pct(s.complianceRate),
    hint: (s) => `${s.total ?? 0} in scope`, desc: 'Open occurrences past their planned day — each one lowers compliance',
  },
];

/** Report column → task-list status bucket. */
const REPORT_BUCKETS = {
  total: { status: 'all', label: 'All occurrences' },
  completed: { status: 'completed', label: 'Completed' },
  pending: { status: 'due_today', label: 'Pending' },
  missed: { status: 'overdue', label: 'Missed' },
  nonFunctional: { status: 'non_functional', label: 'Non-functional' },
};

const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Stopped' },
  { value: '', label: 'All' },
];

const DEFAULT_FILTERS = {
  status: 'pending_today',
  frequency: '',
  department: '',
  site: '',
  team: '',
  group: '',
  doer: '',
  datePreset: 'all', // single date filter on the planned date; from/to hold the resolved range
  from: '',
  to: '',
  master: '',
  masterLabel: '',
};

const WEEKDAY_LABEL = Object.fromEntries(WEEKDAYS.map((d) => [d.value, d.label]));
const WEEKDAY_SHORT = Object.fromEntries(WEEKDAYS.map((d) => [d.value, d.short]));
const FREQ_OPTIONS = CHK_FREQUENCIES;
const deptLabel = (d) => DEPT_META[d] || d || 'Unassigned';
const pct = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
const rateColor = (v) => (v >= 90 ? 'var(--success)' : v >= 70 ? 'var(--warning)' : 'var(--danger)');
const userIdOf = (u) => u?.id || u?._id;
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const stop = (e) => e.stopPropagation();

/** A number that opens a drill-down; plain text when there's nothing to show. */
function NumLink({ value, onClick, style }) {
  if (!value) return <span className="tabular" style={style}>{value ?? 0}</span>;
  return (
    <button
      type="button"
      className="num-link tabular"
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {value}
    </button>
  );
}

function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Status as people read it: open + past → overdue, open + future → upcoming, done after the day → late. */
function displayStatus(t, today) {
  if (t.status === 'pending') {
    if (t.plannedKey < today) return 'overdue';
    if (t.plannedKey > today) return 'upcoming';
    return 'pending';
  }
  if (t.status === 'completed' && t.actualDate && dayjs(t.actualDate).isAfter(dayjs(t.plannedKey).endOf('day'))) return 'late';
  return t.status;
}

function scheduleText(r) {
  const base = FREQ_LABEL[r.frequency] || r.frequency;
  if ((r.frequency === 'weekly' || r.frequency === 'fortnightly') && r.anchorWeekday != null) {
    return `${base} · ${WEEKDAY_LABEL[r.anchorWeekday]}`;
  }
  if (r.frequency === 'monthly' && r.anchorDay) return `${base} · day ${r.anchorDay}`;
  return base;
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search-box">
      <Search size={15} className="subtle" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {value && <X size={14} className="subtle" style={{ cursor: 'pointer' }} onClick={() => onChange('')} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function ChecklistPage() {
  const user = useAppSelector(selectCurrentUser);
  const role = user?.role;
  const isManager = can.manage(role); // MD / EA / Manager
  const canWrite = !!role && role !== 'viewer';
  const branch = useOpsStore((s) => s.branch);

  const [view, setView] = useState('tasks');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText.trim(), 300);
  const [routineModal, setRoutineModal] = useState(null); // { routine? } when open
  const [sitesOpen, setSitesOpen] = useState(false);
  // "Created by" switch: '' everyone · 'me' routines I set up · 'admins' routines set up from an admin login
  const [createdBy, setCreatedBy] = useState('');

  const scope = useMemo(
    () => ({
      branch: branch || undefined,
      frequency: filters.frequency,
      department: filters.department,
      site: filters.site,
      team: filters.team,
      group: filters.group,
      doer: isManager ? filters.doer : undefined,
      master: filters.master,
      from: filters.from,
      to: filters.to,
      search,
      createdBy: isManager ? createdBy || undefined : undefined,
    }),
    [branch, filters, search, isManager, createdBy],
  );

  const { data: summary } = useChecklistSummary(scope);
  const { data: branchData } = useBranches();

  /** Who/what the header numbers are about — used in drill titles. */
  const scopeContext = useMemo(() => {
    if (filters.masterLabel) return filters.masterLabel;
    if (filters.department) return deptLabel(filters.department);
    if (filters.site) return filters.site;
    if (branch === 'all') return 'All branches';
    const b = (branchData?.data || []).find((x) => x._id === branch);
    return b ? b.name : 'My branch';
  }, [filters.masterLabel, filters.department, filters.site, branch, branchData]);

  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const pickStatus = (status) => {
    patchFilters({ status });
    setView('tasks');
  };

  const drillKpi = (k) =>
    drawers.drill({
      kind: 'checklist',
      label: `${k.drillLabel || k.label} — ${scopeContext}`,
      description: k.desc,
      params: clean({ ...scope, status: k.status }),
      onShowInList: () => pickStatus(k.status),
    });

  const viewOccurrences = (r, status = 'all') => {
    setFilters({ ...DEFAULT_FILTERS, status, master: r._id, masterLabel: `${r.code} · ${r.taskName}` });
    setSearchText('');
    setView('tasks');
  };

  const viewOptions = [
    { value: 'tasks', label: 'Tasks', icon: ListChecks },
    { value: 'routines', label: 'Routines', icon: Repeat },
    ...(isManager ? [{ value: 'report', label: 'Department report', icon: BarChart3 }] : []),
  ];

  return (
    <>
      <Topbar
        title="Checklist"
        subtitle="Recurring room resets, opening checks and routines — scheduled automatically"
        actions={
          <div className="row gap-2">
            <BranchSwitcher />
            {isManager && (
              <button className="btn btn-ghost" onClick={() => setSitesOpen(true)} title="Manage sites">
                <MapPin size={16} /> Sites
              </button>
            )}
            {canWrite && (
              <button className="btn btn-primary" onClick={() => setRoutineModal({})}>
                <Plus size={16} /> New routine
              </button>
            )}
          </div>
        }
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          <div className="kpi-row">
            {KPI_DEFS.map((k) => (
              <Kpi
                key={k.key}
                label={k.label}
                value={summary ? k.value(summary) : undefined}
                color={typeof k.color === 'function' ? (summary ? k.color(summary) : 'var(--primary)') : k.color}
                hint={typeof k.hint === 'function' ? (summary ? k.hint(summary) : undefined) : k.hint}
                active={!k.noActive && view === 'tasks' && filters.status === k.status}
                onClick={() => drillKpi(k)}
              />
            ))}
          </div>

          <div className="row between wrap gap-3">
            <Segmented value={view} onChange={setView} options={viewOptions} />
            {isManager && (
              <div className="row gap-2 wrap">
                <span className="tiny subtle upper">Created by</span>
                <Segmented
                  value={createdBy}
                  onChange={setCreatedBy}
                  options={[
                    { value: '', label: 'Everyone' },
                    { value: 'me', label: can.actForLeadership(role) ? 'Me (my admin login)' : 'Me' },
                    { value: 'admins', label: 'Any admin' },
                  ]}
                />
              </div>
            )}
          </div>
          {isManager && createdBy && (
            <div className="tiny muted" style={{ marginTop: -8 }}>
              Showing only checklists created or assigned by {createdBy === 'me' ? 'you' : 'an admin'} — the cards, tasks, routines and report all follow this.
            </div>
          )}

          {view === 'tasks' && (
            <TasksView
              scope={scope}
              filters={filters}
              patchFilters={patchFilters}
              resetFilters={() => {
                setFilters(DEFAULT_FILTERS);
                setSearchText('');
              }}
              searchText={searchText}
              setSearchText={setSearchText}
              user={user}
              isManager={isManager}
              canWrite={canWrite}
              onNewRoutine={() => setRoutineModal({})}
            />
          )}
          {view === 'routines' && (
            <RoutinesView
              createdBy={scope.createdBy}
              isManager={isManager}
              canWrite={canWrite}
              onEdit={(routine) => setRoutineModal({ routine })}
              onNew={() => setRoutineModal({})}
              onViewOccurrences={viewOccurrences}
            />
          )}
          {view === 'report' && isManager && <ReportView isAdmin={can.actForLeadership(role)} createdBy={scope.createdBy} />}
        </div>
      </div>

      <RoutineFormModal open={!!routineModal} routine={routineModal?.routine} onClose={() => setRoutineModal(null)} />
      {isManager && <SitesManagerModal open={sitesOpen} onClose={() => setSitesOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function TasksView({ scope, filters, patchFilters, resetFilters, searchText, setSearchText, user, isManager, canWrite, onNewRoutine }) {
  const branch = scope.branch;
  const params = useMemo(() => ({ ...scope, status: filters.status, limit: TASK_LIMIT }), [scope, filters.status]);
  const { data, isLoading, isFetching } = useChecklistTasks(params);
  const { data: departments = [] } = useChecklistDepartments({ branch });
  const { data: siteData } = useChecklistSites({ branch });
  const { data: teams = [] } = useTeams();
  const { data: groups = [] } = useGroups();

  const [selected, setSelected] = useState(() => new Set());
  const [dialog, setDialog] = useState(null); // { kind, task }
  const [bulk, setBulk] = useState(null); // { taskIds, channel }

  const paramsKey = JSON.stringify(params);
  useEffect(() => setSelected(new Set()), [paramsKey]);

  const rows = data?.data || [];
  const total = data?.meta?.total ?? rows.length;
  const today = dayjs().format('YYYY-MM-DD');
  const me = userIdOf(user);

  const hasFilters =
    Object.entries(DEFAULT_FILTERS).some(([k, v]) => k !== 'masterLabel' && filters[k] !== v) || !!searchText;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r._id));
  const someSelected = selected.size > 0 && !allSelected;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r._id)));
  const toggleOne = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (kind, task) => setDialog({ kind, task });
  const close = () => setDialog(null);
  const subject = (kind) => (dialog?.kind === kind ? dialog.task : null);

  const emptyCopy =
    filters.status === 'pending_today' && !hasFilters
      ? { title: 'All clear for today', hint: 'Nothing due today and nothing overdue. Nice work.' }
      : { title: 'No checklist tasks match', hint: 'Try a different status or clear some filters.' };

  return (
    <>
      <div className="card">
        <div className="filter-bar">
          <SearchBox value={searchText} onChange={setSearchText} placeholder="Search task, code or site…" />
          <FilterSelect label="Frequency" value={filters.frequency} onChange={(frequency) => patchFilters({ frequency })} options={FREQ_OPTIONS} width={130} />
          <FilterSelect
            label="Department"
            value={filters.department}
            onChange={(department) => patchFilters({ department })}
            options={departments.map((d) => ({ value: d, label: deptLabel(d) }))}
            width={140}
          />
          <FilterSelect
            label="Site"
            value={filters.site}
            onChange={(site) => patchFilters({ site })}
            options={(siteData?.sites || []).map((s) => ({ value: s, label: s }))}
            width={160}
          />
          <FilterSelect label="Team" value={filters.team} onChange={(team) => patchFilters({ team })} options={teams.map((t) => ({ value: t._id, label: t.name }))} width={140} />
          <FilterSelect label="Group" value={filters.group} onChange={(group) => patchFilters({ group })} options={groups.map((g) => ({ value: g._id, label: g.name }))} width={130} />
          {isManager && (
            <div className="filter-select chk-doer-filter">
              <span className="tiny subtle upper">Doer</span>
              <PersonPicker value={filters.doer} onChange={(doer) => patchFilters({ doer: doer || '' })} placeholder="Anyone" />
            </div>
          )}
          <DateRangeFilter
            label="Planned date"
            value={{ preset: filters.datePreset, from: filters.from, to: filters.to }}
            onChange={(v) => patchFilters({ datePreset: v.preset, from: v.from || '', to: v.to || '' })}
          />
          {hasFilters && (
            <button className="btn btn-ghost btn-sm" onClick={resetFilters} title="Reset filters">
              <RotateCcw size={14} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="row between wrap gap-3">
        <div className="row gap-2 wrap">
          <Segmented value={filters.status} onChange={(status) => patchFilters({ status })} options={STATUS_OPTIONS} />
          {filters.master && (
            <span className="chip active chk-filter-chip">
              <Repeat size={13} /> {filters.masterLabel || 'One routine'}
              <button type="button" title="Show all routines" onClick={() => patchFilters({ master: '', masterLabel: '' })}>
                <X size={13} />
              </button>
            </span>
          )}
        </div>
        <span className="sm muted row gap-2">
          {isFetching && !isLoading && <span className="spinner" />}
          Showing <b className="tabular">{rows.length}</b> of <b className="tabular">{total}</b>
          {total > rows.length && <span className="tiny subtle">— narrow the filters to see the rest</span>}
        </span>
      </div>

      {isLoading ? (
        <SkTable rows={7} />
      ) : !rows.length ? (
        <div className="card">
          <EmptyState
            icon={ClipboardCheck}
            title={emptyCopy.title}
            hint={emptyCopy.hint}
            action={
              hasFilters ? (
                <button className="btn btn-subtle btn-sm" onClick={resetFilters}><RotateCcw size={14} /> Reset filters</button>
              ) : canWrite ? (
                <button className="btn btn-primary btn-sm" onClick={onNewRoutine}><Plus size={14} /> New routine</button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="card chk-table-wrap">
          <table className="table chk-table">
            <thead>
              <tr>
                {isManager && (
                  <th className="chk-col-check">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                <th>Code</th>
                <th>Task</th>
                <th>Doer</th>
                <th>Planned</th>
                <th>Status</th>
                <th>Proof</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <TaskRow
                  key={t._id}
                  task={t}
                  today={today}
                  selectable={isManager}
                  selected={selected.has(t._id)}
                  onToggle={() => toggleOne(t._id)}
                  canAct={canWrite && (isManager || t.doer?._id === me)}
                  isManager={isManager}
                  onAction={open}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isManager && selected.size > 0 && (
        <div className="chk-bulk-bar fade-in">
          <span className="sm" style={{ fontWeight: 650 }}>
            {selected.size} selected
          </span>
          <div className="row gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => setBulk({ taskIds: [...selected], channel: 'management' })}>
              <MessageSquareWarning size={14} /> Add follow-up
            </button>
            <button className="btn btn-subtle btn-sm" onClick={() => setBulk({ taskIds: [...selected], channel: 'coordinator' })}>
              <StickyNote size={14} /> Add note
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <CompleteTaskModal task={subject('complete')} onClose={close} />
      <NonFunctionalModal task={subject('nonFunctional')} onClose={close} />
      <ReopenTaskModal task={subject('reopen')} onClose={close} />
      <ReassignModal task={subject('reassign')} onClose={close} />
      <TaskRemarksModal task={subject('remarks')} onClose={close} canRemark={isManager} />
      <BulkRemarkModal bulk={bulk} onClose={() => setBulk(null)} onDone={() => setSelected(new Set())} />
    </>
  );
}

function TaskRow({ task: t, today, selectable, selected, onToggle, canAct, isManager, onAction }) {
  const status = displayStatus(t, today);
  const isOpen = t.status === 'pending';
  const overdueDays = status === 'overdue' ? -daysUntil(t.plannedKey) : 0;
  const remarkCount = parseRemarkLines(t.managementRemark).length + parseRemarkLines(t.coordinatorRemark).length;

  return (
    <tr className={`row-link ${selected ? 'selected' : ''}`} onClick={() => drawers.checklistTask(t._id)} title="Open details">
      {selectable && (
        <td className="chk-col-check" onClick={stop}>
          <input type="checkbox" aria-label={`Select ${t.code}`} checked={selected} onChange={onToggle} />
        </td>
      )}
      <td className="mono tiny subtle nowrap">{t.code}</td>
      <td style={{ minWidth: 240 }}>
        <div className="chk-task-name">{t.taskName}</div>
        <div className="chk-sub">
          <span className="chk-tag">{FREQ_LABEL[t.frequency] || t.frequency}</span>
          {t.site && <span><MapPin size={12} /> {t.site}</span>}
          {t.department && <span>{deptLabel(t.department)}</span>}
          {t.group && <Badge color={t.group.color}>{t.group.name}</Badge>}
          {t.followUpCount > 0 && (
            <span className="chk-tag danger" title="Management follow-ups">
              <MessageSquareWarning size={11} /> {t.followUpCount}
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="row gap-2">
          <Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={26} />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="sm nowrap" style={{ fontWeight: 600 }}>{t.doer?.name || '—'}</span>
            {t.reassignedFrom?.name && <span className="tiny subtle nowrap">reassigned from {t.reassignedFrom.name}</span>}
          </div>
        </div>
      </td>
      <td className="nowrap">
        <div className="sm">{fmtDate(t.plannedKey)}</div>
        {status === 'overdue' && <div className="tiny danger-text" style={{ fontWeight: 600 }}>{overdueDays}d overdue</div>}
        {status === 'pending' && <div className="tiny" style={{ color: 'var(--info)', fontWeight: 600 }}>Due today</div>}
        {t.actualDate && <div className="tiny subtle">closed {fmtDateTime(t.actualDate)}</div>}
      </td>
      <td><ChkStatusBadge value={status} /></td>
      <td className="nowrap">
        {t.documentUrl ? (
          <a className="chk-proof" href={t.documentUrl} target="_blank" rel="noreferrer" title="Open proof" onClick={stop}>
            <Paperclip size={13} /> View
          </a>
        ) : t.proofRequired ? (
          <span className={`chk-tag ${isOpen ? 'warn' : ''}`}>required</span>
        ) : (
          <span className="subtle">—</span>
        )}
      </td>
      <td onClick={stop} style={{ cursor: 'default' }}>
        <div className="chk-actions">
          {isOpen && canAct && (
            <button className="btn btn-primary btn-sm nowrap" onClick={() => onAction('complete', t)}>
              <CheckCircle2 size={14} /> Complete
            </button>
          )}
          {isOpen && canAct && (
            <button className="btn btn-ghost btn-sm btn-icon" title="Mark non-functional" onClick={() => onAction('nonFunctional', t)}>
              <Ban size={14} />
            </button>
          )}
          {isOpen && isManager && (
            <button className="btn btn-ghost btn-sm btn-icon" title="Reassign" onClick={() => onAction('reassign', t)}>
              <UserRoundCog size={14} />
            </button>
          )}
          {!isOpen && t.actualDate && isManager && canAct && (
            <button className="btn btn-subtle btn-sm nowrap" title="Reopen for further action, correction or review" onClick={() => onAction('reopen', t)}>
              <RotateCcw size={13} /> Reopen
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title={remarkCount ? `${remarkCount} remark(s)` : 'Remarks'}
            onClick={() => onAction('remarks', t)}
            style={remarkCount ? { color: 'var(--primary)' } : undefined}
          >
            <MessageSquare size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Routines                                                            */
/* ------------------------------------------------------------------ */

function RoutinesView({ createdBy, isManager, canWrite, onEdit, onNew, onViewOccurrences }) {
  const branch = useOpsStore((s) => s.branch);
  const [searchText, setSearchText] = useState('');
  const search = useDebounced(searchText.trim(), 300);
  const [frequency, setFrequency] = useState('');
  const [active, setActive] = useState('true');
  const [team, setTeam] = useState('');
  const [group, setGroup] = useState('');
  const [stopping, setStopping] = useState(null);

  const { data: routines = [], isLoading, isFetching } = useChecklistRoutines({
    branch: branch || undefined,
    frequency,
    active,
    team,
    group,
    search,
    createdBy,
  });
  const { data: teams = [] } = useTeams();
  const { data: groups = [] } = useGroups();
  const hasFilters = !!(searchText || frequency || team || group || active !== 'true');

  return (
    <>
      <div className="card">
        <div className="filter-bar">
          <SearchBox value={searchText} onChange={setSearchText} placeholder="Search routine or code…" />
          <FilterSelect label="Frequency" value={frequency} onChange={setFrequency} options={FREQ_OPTIONS} width={130} />
          <FilterSelect label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t._id, label: t.name }))} width={140} />
          <FilterSelect label="Group" value={group} onChange={setGroup} options={groups.map((g) => ({ value: g._id, label: g.name }))} width={130} />
          <div className="filter-select">
            <span className="tiny subtle upper">State</span>
            <Segmented value={active} onChange={setActive} options={ACTIVE_OPTIONS} />
          </div>
        </div>
      </div>

      <div className="row between">
        <span className="sm muted row gap-2">
          {isFetching && !isLoading && <span className="spinner" />}
          <b className="tabular">{routines.length}</b> routine{routines.length === 1 ? '' : 's'}
        </span>
      </div>

      {isLoading ? (
        <SkTable rows={6} />
      ) : !routines.length ? (
        <div className="card">
          <EmptyState
            icon={ClipboardCheck}
            title={hasFilters ? 'No routines match' : 'No routines yet'}
            hint={hasFilters ? 'Try different filters.' : 'Create a routine — e.g. a daily room reset — and its occurrences are scheduled for you.'}
            action={
              canWrite && !hasFilters ? (
                <button className="btn btn-primary btn-sm" onClick={onNew}><Plus size={14} /> New routine</button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="card chk-table-wrap">
          <table className="table chk-table">
            <thead>
              <tr>
                <th>Routine</th>
                <th>Doer</th>
                <th>Schedule</th>
                <th>Where</th>
                <th>Window</th>
                <th>Progress</th>
                <th>Next</th>
                <th>State</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {routines.map((r) => {
                const done = r.total ? (r.completed / r.total) * 100 : 0;
                const drill = (status, label, description) =>
                  drawers.drill({
                    kind: 'checklist',
                    label: `${label} — ${r.code} · ${r.taskName}`,
                    description,
                    params: clean({ master: r._id, branch: r.branch?._id, status }),
                    onShowInList: () => onViewOccurrences(r, status),
                  });
                return (
                  <tr key={r._id} className="row-link" onClick={() => drawers.routine(r._id)} title="Open routine">
                    <td style={{ minWidth: 220 }}>
                      <div className="mono tiny subtle">{r.code}</div>
                      <div className="chk-task-name">{r.taskName}</div>
                      {r.description && <div className="tiny muted truncate" style={{ maxWidth: 280 }} title={r.description}>{r.description}</div>}
                      <div className="chk-sub">
                        {r.proofRequired && <span className="chk-tag"><Paperclip size={11} /> proof</span>}
                        {r.group && <Badge color={r.group.color}>{r.group.name}</Badge>}
                      </div>
                    </td>
                    <td>
                      <div className="row gap-2">
                        <Avatar name={r.doer?.name} color={r.doer?.avatarColor} size={26} />
                        <span className="sm nowrap" style={{ fontWeight: 600 }}>{r.doer?.name || '—'}</span>
                      </div>
                    </td>
                    <td className="nowrap">
                      <div className="sm" style={{ fontWeight: 600 }}>{scheduleText(r)}</div>
                      {r.weeklyOffs?.length > 0 && (
                        <div className="tiny subtle">skips {r.weeklyOffs.map((d) => WEEKDAY_SHORT[d]).join(', ')}</div>
                      )}
                    </td>
                    <td>
                      {r.branch?.name && <div className="sm nowrap">{r.branch.name}</div>}
                      <div className="chk-sub">
                        {r.site && <span><MapPin size={12} /> {r.site}</span>}
                        {r.department && <span>{deptLabel(r.department)}</span>}
                      </div>
                    </td>
                    <td className="nowrap">
                      <div className="sm">{fmtDateShort(r.startDate)} → {fmtDate(r.endDate)}</div>
                      {r.autoRenew && <span className="chk-tag info"><Repeat size={10} /> auto-renews</span>}
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <div className="row between tiny" style={{ marginBottom: 4 }}>
                        <span className="tabular">
                          <b><NumLink value={r.completed} onClick={() => drill('completed', 'Completed', 'Occurrences of this routine closed as done')} /></b>
                          {' / '}
                          <NumLink value={r.total} onClick={() => drill('all', 'All occurrences', 'Every scheduled occurrence of this routine')} /> done
                        </span>
                        {r.missed > 0 && (
                          <span className="danger-text" style={{ fontWeight: 600 }}>
                            missed <NumLink value={r.missed} onClick={() => drill('overdue', 'Missed', 'Open occurrences past their planned day')} />
                          </span>
                        )}
                      </div>
                      <ProgressBar value={done} height={6} />
                    </td>
                    <td className="nowrap sm">
                      {r.nextDate ? (
                        <span className="row gap-1"><CalendarDays size={13} className="subtle" /> {fmtDateShort(r.nextDate)}</span>
                      ) : (
                        <span className="subtle">—</span>
                      )}
                    </td>
                    <td>
                      {r.isActive ? (
                        <Badge color="var(--success)" soft="var(--success-soft)" dot>Active</Badge>
                      ) : (
                        <Badge color="var(--text-muted)" soft="var(--surface-hover)" dot>Stopped</Badge>
                      )}
                    </td>
                    <td onClick={stop} style={{ cursor: 'default' }}>
                      <div className="chk-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" title="View occurrences" onClick={() => onViewOccurrences(r)}>
                          <ListChecks size={14} />
                        </button>
                        {isManager && (
                          <button className="btn btn-ghost btn-sm btn-icon" title="Edit routine" onClick={() => onEdit(r)}>
                            <Pencil size={14} />
                          </button>
                        )}
                        {isManager && r.isActive && (
                          <button className="btn btn-ghost btn-sm btn-icon danger-text" title="Stop routine" onClick={() => setStopping(r)}>
                            <CircleStop size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <StopRoutineModal routine={stopping} onClose={() => setStopping(null)} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Department report                                                   */
/* ------------------------------------------------------------------ */

function Compliance({ value }) {
  if (value === null || value === undefined) return <span className="subtle">—</span>;
  const color = rateColor(value);
  return (
    <div className="chk-compliance">
      <ProgressBar value={value} height={7} gradient={color} />
      <span className="tabular sm" style={{ color }}>{pct(value)}</span>
    </div>
  );
}

function ReportView({ isAdmin, createdBy }) {
  const branch = useOpsStore((s) => s.branch);
  const [range, setRange] = useState(() => ({ preset: 'thisMonth', ...resolveDateRange('thisMonth') }));
  // The report scores what was due, so the window never reaches past today.
  const today = dayjs().format('YYYY-MM-DD');
  const from = range.from || '';
  const to = range.to && range.to < today ? range.to : today;
  const [team, setTeam] = useState('');
  const [department, setDepartment] = useState('');
  const [expanded, setExpanded] = useState(null);

  const { data, isLoading, isFetching } = useChecklistReport(
    { branch: branch || undefined, from, to, team, createdBy, department: isAdmin ? department : undefined },
  );
  const { data: teams = [] } = useTeams();
  const departments = data?.departments || [];
  const doers = data?.doers || [];
  const windowText = `${from ? fmtDate(from) : 'Start'} → ${fmtDate(to || dayjs().format('YYYY-MM-DD'))}`;

  /** Open the exact occurrences behind a report number. `who` is a department row or a doer row. */
  const drill = (bucketKey, { dept, doerId, name }) => {
    const bucket = REPORT_BUCKETS[bucketKey];
    drawers.drill({
      kind: 'checklist',
      label: `${bucket.label} — ${name}`,
      description: windowText,
      params: clean({
        branch: branch || undefined,
        department: dept === 'Unassigned' ? 'unassigned' : dept || undefined,
        doer: doerId,
        team,
        createdBy,
        from,
        to: to || dayjs().format('YYYY-MM-DD'),
        status: bucket.status,
      }),
    });
  };

  return (
    <>
      <div className="card">
        <div className="filter-bar">
          <DateRangeFilter label="Planned date" value={range} onChange={setRange} />
          <FilterSelect label="Team" value={team} onChange={setTeam} options={teams.map((t) => ({ value: t._id, label: t.name }))} width={150} />
          {isAdmin && (
            <FilterSelect
              label="Department"
              value={department}
              onChange={setDepartment}
              options={Object.entries(DEPT_META).map(([value, label]) => ({ value, label }))}
              width={150}
            />
          )}
          <span className="tiny muted row gap-1" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
            {isFetching && !isLoading && <span className="spinner" />}
            Compliance = completed ÷ (completed + missed + pending). Non-functional doesn't count.
          </span>
        </div>
      </div>

      {data?.note && (
        <div className="chk-callout warn" style={{ margin: 0 }}>
          <Info size={15} />
          <span>{data.note}</span>
        </div>
      )}

      {isLoading ? (
        <SkTable rows={5} />
      ) : !departments.length ? (
        <div className="card">
          <EmptyState icon={ClipboardCheck} title="No checklist activity in this window" hint="Pick a wider date range or another team." />
        </div>
      ) : (
        <div className="card chk-table-wrap">
          <table className="table chk-table table-clickable">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Rank</th>
                <th>Department</th>
                <th>Compliance</th>
                <th className="tabular">Total</th>
                <th>Completed</th>
                <th>Pending</th>
                <th>Missed</th>
                <th>Non-functional</th>
                <th>Doers</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => {
                const key = d.department || '__none__';
                const isOpen = expanded === key;
                const toggle = () => setExpanded(isOpen ? null : key);
                const who = { dept: d.department, name: deptLabel(d.department) };
                const people = doers
                  .filter((p) => (p.department || '__none__') === key)
                  .sort((a, b) => (b.complianceRate ?? -1) - (a.complianceRate ?? -1));
                return (
                  <Fragment key={key}>
                    <tr onClick={toggle} aria-expanded={isOpen}>
                      <td><span className={`chk-rank ${d.rank <= 3 ? 'top' : ''}`}>{d.rank}</span></td>
                      <td style={{ fontWeight: 650 }}>{deptLabel(d.department)}</td>
                      <td><Compliance value={d.complianceRate} /></td>
                      <td><NumLink value={d.total} onClick={() => drill('total', who)} /></td>
                      <td><NumLink value={d.completed} onClick={() => drill('completed', who)} style={{ color: 'var(--success)', fontWeight: 600 }} /></td>
                      <td><NumLink value={d.pending} onClick={() => drill('pending', who)} /></td>
                      <td>
                        <NumLink value={d.missed} onClick={() => drill('missed', who)} style={d.missed ? { color: 'var(--danger)', fontWeight: 600 } : undefined} />
                      </td>
                      <td>
                        <NumLink value={d.nonFunctional} onClick={() => drill('nonFunctional', who)} style={d.nonFunctional ? { color: 'var(--warning)' } : undefined} />
                      </td>
                      <td className="tabular">{d.doers}</td>
                      <td>{isOpen ? <ChevronDown size={15} className="subtle" /> : <ChevronRight size={15} className="subtle" />}</td>
                    </tr>
                    {isOpen && (
                      <tr className="chk-expand">
                        <td colSpan={10}>
                          <div className="chk-expand-inner">
                            {people.length ? (
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>Doer</th>
                                    <th>Compliance</th>
                                    <th>Total</th>
                                    <th>Completed</th>
                                    <th>Pending</th>
                                    <th>Missed</th>
                                    <th>Non-functional</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {people.map((p) => {
                                    const person = { dept: p.department, doerId: p.doerId, name: p.doer || 'Unknown' };
                                    return (
                                      <tr
                                        key={p.doerId || p.doer}
                                        className="row-link"
                                        title={`All of ${person.name}'s occurrences in this window`}
                                        onClick={() => drill('total', person)}
                                      >
                                        <td>
                                          <span className="row gap-2">
                                            <Avatar name={p.doer} color={p.avatarColor} size={22} />
                                            <span style={{ fontWeight: 600 }}>{person.name}</span>
                                          </span>
                                        </td>
                                        <td><Compliance value={p.complianceRate} /></td>
                                        <td><NumLink value={p.total} onClick={() => drill('total', person)} /></td>
                                        <td><NumLink value={p.completed} onClick={() => drill('completed', person)} /></td>
                                        <td><NumLink value={p.pending} onClick={() => drill('pending', person)} /></td>
                                        <td>
                                          <NumLink value={p.missed} onClick={() => drill('missed', person)} style={p.missed ? { color: 'var(--danger)', fontWeight: 600 } : undefined} />
                                        </td>
                                        <td><NumLink value={p.nonFunctional} onClick={() => drill('nonFunctional', person)} /></td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            ) : (
                              <div className="sm muted" style={{ padding: 'var(--space-3) 0' }}>No per-person breakdown for this department.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default ChecklistPage;
