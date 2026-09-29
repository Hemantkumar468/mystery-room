import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import {
  AlertTriangle, CheckSquare, ChevronLeft, ChevronRight, Clock, GitBranch, Layers, Repeat, Search, ShieldCheck, Paperclip, Megaphone, RotateCcw,
} from 'lucide-react';
import { Avatar, PriorityBadge } from '../../components/ui/primitives.jsx';
import { DlgStatusBadge, FilterSelect } from '../../components/ops/common.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { DateRangeFilter } from '../../components/ops/DateRangeFilter.jsx';
import { useCatalog, useGroups, useTeams } from '../../lib/opsQueries.js';
import {
  DLG_STATUS_META, FREQ_LABEL, ESCALATION_LABEL, PRIORITY_OPTIONS, DLG_FREQUENCIES, isDlgOverdue,
} from '../../lib/opsUi.js';
import { fmtDateShort, daysUntil } from '../../lib/format.js';

dayjs.extend(isoWeek);

function DueCell({ task }) {
  if (!task.dueDate) return <span className="subtle sm">No date</span>;
  const d = daysUntil(task.dueDate);
  const overdue = isDlgOverdue(task);
  return (
    <div className="col">
      <span className="sm" style={{ color: overdue ? 'var(--danger)' : undefined, fontWeight: overdue ? 650 : 500 }}>
        {fmtDateShort(task.dueDate)}
      </span>
      {task.status !== 'completed' && task.status !== 'shifted' && (
        <span className="tiny" style={{ color: overdue ? 'var(--danger)' : 'var(--text-subtle)' }}>
          {d < 0 ? `${-d}d late` : d === 0 ? 'today' : `in ${d}d`}
        </span>
      )}
    </div>
  );
}

/**
 * Row-style task list. Pass `onReopen` (and `canReopen(task)`) to show a
 * one-click Reopen on completed rows.
 */
export function TaskList({ tasks, onOpen, show = { assigner: true, doer: true }, onReopen, canReopen = () => false }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="task-row head">
        <span>Task</span>
        <span className="hide-md">{show.doer ? 'Doer' : 'Assigned by'}</span>
        <span className="hide-md">Status</span>
        <span className="hide-md">Priority</span>
        <span className="hide-md">Category</span>
        <span>Due</span>
      </div>
      {tasks.map((t) => (
        <div key={t._id} className="task-row" onClick={() => onOpen(t._id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t._id)}>
          <div style={{ minWidth: 0 }}>
            <div className="task-title truncate">{t.title}</div>
            <div className="task-meta">
              <span className="mono">{t.code}</span>
              {t.parent && <span><GitBranch size={11} /> {t.parent.code}</span>}
              {t.subtaskCount > 0 && <span title={t.assigneeHierarchy ? `Passed to ${t.assigneeHierarchy}` : ''}><Layers size={11} /> {t.subtaskCount}</span>}
              {t.checklistItems?.length > 0 && (
                <span><CheckSquare size={11} /> {t.checklistItems.filter((c) => c.completed).length}/{t.checklistItems.length}</span>
              )}
              {t.recurrence && <span><Repeat size={11} /> {FREQ_LABEL[t.recurrence.frequency]}</span>}
              {t.group && <span style={{ color: t.group.color }}>● {t.group.name}</span>}
              {t.verificationRequired && <span><ShieldCheck size={11} /> verify</span>}
              {t.evidenceRequired && <span><Paperclip size={11} /> proof</span>}
              {t.followUpCount > 0 && <span style={{ color: 'var(--danger)' }}><Megaphone size={11} /> {t.followUpCount}</span>}
              {t.escalationTier > 0 && <span className="escalation-pill"><AlertTriangle size={10} /> {ESCALATION_LABEL[t.escalationTier]}</span>}
              {t.branch && <span>{t.branch.code}</span>}
            </div>
          </div>
          <div className="hide-md row gap-2" style={{ minWidth: 0 }}>
            {show.doer ? (
              <>
                <Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={26} />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="sm truncate">{t.doer?.name}</span>
                  {show.assigner && <span className="tiny subtle truncate">by {t.assigner?.name}</span>}
                </span>
              </>
            ) : (
              <>
                <Avatar name={t.assigner?.name} color={t.assigner?.avatarColor} size={26} />
                <span className="sm truncate">{t.assigner?.name}</span>
              </>
            )}
          </div>
          <div className="hide-md"><DlgStatusBadge value={t.status} /></div>
          <div className="hide-md"><PriorityBadge value={t.priority} /></div>
          <div className="hide-md sm muted truncate">{t.category || '—'}</div>
          <div className="col gap-1" style={{ alignItems: 'flex-start' }}>
            <DueCell task={t} />
            {onReopen && t.status === 'completed' && canReopen(t) && (
              <button
                type="button"
                className="btn btn-subtle btn-sm reopen-btn"
                title="Reopen for further action, correction or review"
                onClick={(e) => {
                  e.stopPropagation();
                  onReopen(t);
                }}
              >
                <RotateCcw size={12} /> Reopen
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const BOARD_COLUMNS = ['pending', 'accepted', 'in_progress', 'dependent', 'blocked', 'awaiting_verification', 'completed'];

/** Kanban by status (read-only columns — actions happen in the drawer). */
export function TaskBoard({ tasks, onOpen }) {
  const cols = BOARD_COLUMNS.map((s) => ({ status: s, tasks: tasks.filter((t) => t.status === s) }));
  return (
    <div className="board dlg-board">
      {cols.map((c) => {
        const meta = DLG_STATUS_META[c.status];
        return (
          <div key={c.status} className="board-col">
            <div className="board-col-head">
              <span className="badge-dot" style={{ background: meta.color, width: 8, height: 8 }} />
              {meta.label}
              <span className="nav-badge" style={{ marginLeft: 'auto', background: 'var(--surface-hover)', color: 'var(--text-muted)' }}>{c.tasks.length}</span>
            </div>
            {c.tasks.map((t) => (
              <div key={t._id} className="task-card dlg-card" onClick={() => onOpen(t._id)} role="button" tabIndex={0}>
                <div className="row between" style={{ marginBottom: 6 }}>
                  <span className="mono tiny subtle">{t.code}</span>
                  <PriorityBadge value={t.priority} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 13.5, lineHeight: 1.35 }}>{t.title}</div>
                <div className="row between" style={{ marginTop: 10 }}>
                  <span className="row gap-1 tiny" style={{ color: isDlgOverdue(t) ? 'var(--danger)' : 'var(--text-muted)' }}>
                    {isDlgOverdue(t) ? <AlertTriangle size={12} /> : <Clock size={12} />}
                    {t.dueDate ? fmtDateShort(t.dueDate) : '—'}
                  </span>
                  <Avatar name={t.doer?.name} color={t.doer?.avatarColor} size={22} />
                </div>
              </div>
            ))}
            {!c.tasks.length && <div className="tiny subtle center" style={{ padding: 14 }}>Nothing here</div>}
          </div>
        );
      })}
    </div>
  );
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month calendar of due dates. */
export function TaskCalendar({ tasks, onOpen }) {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));
  const start = cursor.startOf('month').startOf('isoWeek');
  const end = cursor.endOf('month').endOf('isoWeek');
  const days = useMemo(() => {
    const out = [];
    for (let d = start; !d.isAfter(end, 'day'); d = d.add(1, 'day')) out.push(d);
    return out;
  }, [start, end]);
  const byDay = useMemo(() => {
    const m = {};
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const k = dayjs(t.dueDate).format('YYYY-MM-DD');
      (m[k] = m[k] || []).push(t);
    });
    return m;
  }, [tasks]);
  const today = dayjs();
  return (
    <div className="col gap-3">
      <div className="row gap-2">
        <button className="btn btn-ghost btn-icon" onClick={() => setCursor((c) => c.subtract(1, 'month'))}><ChevronLeft size={16} /></button>
        <span style={{ fontWeight: 650, minWidth: 140, textAlign: 'center' }}>{cursor.format('MMMM YYYY')}</span>
        <button className="btn btn-ghost btn-icon" onClick={() => setCursor((c) => c.add(1, 'month'))}><ChevronRight size={16} /></button>
        <button className="btn btn-subtle btn-sm" onClick={() => setCursor(dayjs().startOf('month'))}>Today</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {days.map((d) => {
          const k = d.format('YYYY-MM-DD');
          const evs = byDay[k] || [];
          return (
            <div key={k} className={`cal-cell ${d.month() === cursor.month() ? '' : 'dim'} ${d.isSame(today, 'day') ? 'today' : ''}`}>
              <span className="cal-date">{d.date()}</span>
              {evs.slice(0, 4).map((t) => (
                <div
                  key={t._id}
                  className="cal-event"
                  style={{ background: isDlgOverdue(t) ? DLG_STATUS_META.overdue.color : DLG_STATUS_META[t.status]?.color }}
                  onClick={() => onOpen(t._id)}
                  title={`${t.code} · ${t.title} — ${t.doer?.name}`}
                >
                  {t.title}
                </div>
              ))}
              {evs.length > 4 && <span className="tiny subtle">+{evs.length - 4} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Filter bar shared by every task list. `hide` removes filters that don't
 * apply to a view (e.g. doer on "My tasks").
 */
export function TaskFilters({ filters, onChange, hide = [] }) {
  const { data: categories = [] } = useCatalog('categories');
  const { data: tags = [] } = useCatalog('tags');
  const { data: groups = [] } = useGroups();
  const { data: teams = [] } = useTeams();
  const set = (patch) => onChange({ ...filters, ...patch });
  const has = (k) => !hide.includes(k);

  return (
    <div className="card">
      <div className="filter-bar">
        <label className="search-box">
          <Search size={15} className="subtle" />
          <input value={filters.search || ''} onChange={(e) => set({ search: e.target.value })} placeholder="Search title, description or code…" />
        </label>
        {has('team') && <FilterSelect label="Team" value={filters.team} onChange={(team) => set({ team })} options={teams.map((t) => ({ value: t._id, label: t.name }))} />}
        {has('group') && <FilterSelect label="Group" value={filters.group} onChange={(group) => set({ group })} options={groups.map((g) => ({ value: g._id, label: g.name }))} />}
        <FilterSelect label="Category" value={filters.category} onChange={(category) => set({ category })} options={categories.map((c) => ({ value: c.name, label: c.name }))} />
        <FilterSelect label="Priority" value={filters.priority} onChange={(priority) => set({ priority })} options={PRIORITY_OPTIONS} width={120} />
        {tags.length > 0 && <FilterSelect label="Tag" value={filters.tag} onChange={(tag) => set({ tag })} options={tags.map((t) => ({ value: t.name, label: t.name }))} width={120} />}
        <FilterSelect
          label="Frequency"
          value={filters.frequency}
          onChange={(frequency) => set({ frequency })}
          options={[{ value: 'once', label: 'One-time' }, { value: 'recurring', label: 'Any repeat' }, ...DLG_FREQUENCIES]}
          width={130}
        />
        <FilterSelect
          label="Verification"
          value={filters.verification}
          onChange={(verification) => set({ verification })}
          options={[{ value: 'required', label: 'Required' }, { value: 'not_required', label: 'Not required' }]}
          width={130}
        />
        {has('doer') && (
          <label className="filter-select" style={{ minWidth: 190 }}>
            <span className="tiny subtle upper">Doer</span>
            <PersonPicker value={filters.doer} onChange={(doer) => set({ doer })} placeholder="Anyone" />
          </label>
        )}
        {has('assigner') && (
          <label className="filter-select" style={{ minWidth: 190 }}>
            <span className="tiny subtle upper">Assigned by</span>
            <PersonPicker value={filters.assigner} onChange={(assigner) => set({ assigner })} placeholder="Anyone" />
          </label>
        )}
        <DateRangeFilter label="Due date" value={filters.date} onChange={(date) => set({ date })} />
        {Object.entries(filters).some(([k, v]) => (k === 'date' ? v && v.preset !== 'all' : Boolean(v))) && (
          <button className="btn btn-ghost btn-sm" onClick={() => onChange({})}>Clear</button>
        )}
      </div>
    </div>
  );
}

