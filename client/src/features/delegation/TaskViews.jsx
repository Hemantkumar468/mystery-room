import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import {
  AlertTriangle, CheckSquare, ChevronLeft, ChevronRight, Clock, GitBranch, Layers, Repeat, Search, ShieldCheck, Paperclip, Megaphone, RotateCcw,
  SlidersHorizontal,
  PlayCircle, CheckCircle2, Eye,
} from 'lucide-react';
import { Avatar, PriorityBadge } from '../../components/ui/primitives.jsx';
import { DlgStatusBadge, FilterSelect } from '../../components/ops/common.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { DateRangeFilter } from '../../components/ops/DateRangeFilter.jsx';
import { useCatalog, useGroups, useTeams, useDelegationAction } from '../../lib/opsQueries.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { toast } from '../../components/ops/toast.jsx';
import { CompleteModal } from './ActionModals.jsx';
import {
  DLG_STATUS_META, FREQ_LABEL, ESCALATION_LABEL, PRIORITY_OPTIONS, DLG_FREQUENCIES, isDlgOverdue, errMsg,
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
        {/* With the time: a task due at 11 am and one due at the end of the
            day are not the same deadline. A date-only due is stored as the
            end of that day, so it reads 11:59 PM. */}
        {fmtDateShort(task.dueDate)}, {dayjs(task.dueDate).format('h:mm A')}
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
/**
 * ONE-TAP START AND DONE, for a row that is YOUR OWN work.
 *
 * My Work used to be a separate hand-built list whose only advantage over
 * this one was these two buttons; folding that page onto the shared
 * workspace would have taken them away from every doer, which is a worse
 * trade than the duplication was. So they move here, and every view that
 * shows somebody a task of their own now offers them — Delegated by me and
 * All tasks included, where a manager is sometimes the doer too.
 *
 * ONLY ON YOUR OWN ROWS, and only while the task can still be worked:
 * pending, accepted or in progress. Anything submitted, completed or
 * blocked needs the drawer, because those transitions ask a question
 * (proof, a reason, an approval) that a single tap cannot answer.
 */
const WORKABLE = ['pending', 'accepted', 'in_progress'];

/** Is this row the signed-in person's own work, and still actionable? */
const isMyWorkableTask = (task, me) => Boolean(me)
  && String(task.doer?._id || task.doer || '') === String(me)
  && WORKABLE.includes(task.status);

function QuickActions({ task, onComplete }) {
  const act = useDelegationAction();

  const start = async (e) => {
    e.stopPropagation();
    try {
      await act.mutateAsync({ id: task._id, action: 'status', body: { status: 'in_progress' } });
      toast.success('Work started');
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <span className="row gap-1" onClick={(e) => e.stopPropagation()}>
      {task.status !== 'in_progress' && (
        <button type="button" className="btn btn-subtle btn-sm" onClick={start} disabled={act.isPending}>
          <PlayCircle size={12} /> Start
        </button>
      )}
      <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); onComplete(task); }}>
        {task.verificationRequired ? <><ShieldCheck size={12} /> Submit</> : <><CheckCircle2 size={12} /> Done</>}
      </button>
    </span>
  );
}

export function TaskList({ tasks, onOpen, show = { assigner: true, doer: true }, onReopen, canReopen = () => false }) {
  const [completing, setCompleting] = useState(null);
  const user = useAppSelector(selectCurrentUser);
  const me = String(user?.id || user?._id || '');
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="task-row head">
        <span className="task-sno">No</span>
        <span>Task</span>
        <span className="hide-md">{show.doer ? 'Doer' : 'Assigned by'}</span>
        <span className="hide-md">Status</span>
        <span className="hide-md">Priority</span>
        <span className="hide-md">Category</span>
        <span>Due</span>
        <span className="task-action-head">Action</span>
      </div>
      {tasks.map((t, i) => (
        <div key={t._id} className="task-row" onClick={() => onOpen(t._id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(t._id)}>
          {/* A PLAIN POSITION IN THE LIST, not an id. The code (DLG-000006)
              is already under the title and is the thing to quote; this is
              for counting and for saying "the third one down". It follows
              the sort, so it renumbers when the order changes — which is
              what a row number means. */}
          <span className="task-sno tabular">{i + 1}</span>
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
          </div>
          {/**
            * ONE ACTION CELL, AND ONE BUTTON IN IT.
            *
            * Reopen used to hang underneath the due date, which made the
            * Due column two different things depending on the row and left
            * the table with no action column at all. The reference has one,
            * on the right; so does this.
            *
            * Which button appears follows what the row actually offers, in
            * that order — your own work first, then the assigner's undo,
            * then the fallback. Showing all three and disabling two would
            * be a wider column saying less.
            *
            * "View" rather than "Remind": chasing a doer is recorded
            * through the follow-up form (call status, what they said, when
            * to chase again) and one click cannot answer those. View opens
            * the row that form lives on.
            */}
          <div className="task-action" onClick={(e) => e.stopPropagation()}>
            {isMyWorkableTask(t, me) ? (
              <QuickActions task={t} onComplete={setCompleting} />
            ) : onReopen && t.status === 'completed' && canReopen(t) ? (
              <button
                type="button"
                className="btn btn-sm task-act-btn"
                title="Reopen for further action, correction or review"
                onClick={() => onReopen(t)}
              >
                <RotateCcw size={12} /> Reopen
              </button>
            ) : (
              <button type="button" className="btn btn-sm task-act-btn" onClick={() => onOpen(t._id)}><Eye size={12} /> View</button>
            )}
          </div>
        </div>
      ))}
      <CompleteModal task={completing} open={Boolean(completing)} onClose={() => setCompleting(null)} />
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
/**
 * ONE LINE OF FILTERS, with the rest one click away.
 *
 * There were nine controls wrapped across two rows above every task list —
 * Team, Group, Category, Priority, Tag, Frequency, Verification, Doer,
 * Assigned by, Due date — and the band of them was taller than the table it
 * filtered. Nine controls is not nine times as useful as five; it is a wall
 * somebody has to read past to reach their work, and eight of the nine are
 * empty on any given day.
 *
 * So the line carries what people actually reach for, and "More filters"
 * holds the rest. The disclosure counts what is set inside it, because a
 * hidden filter that is silently narrowing the list is worse than a visible
 * one — the count is what stops "where did my tasks go?".
 *
 * Reset appears only when something is set. A permanently visible Reset
 * invites a click that does nothing.
 */
export function TaskFilters({ filters, onChange, hide = [] }) {
  const { data: categories = [] } = useCatalog('categories');
  const { data: tags = [] } = useCatalog('tags');
  const { data: groups = [] } = useGroups();
  const { data: teams = [] } = useTeams();
  const [more, setMore] = useState(false);
  const set = (patch) => onChange({ ...filters, ...patch });
  const has = (k) => !hide.includes(k);

  /* What is set, and of that, what is hidden behind the disclosure. */
  const isSet = (k) => (k === 'date'
    ? Boolean(filters.date) && filters.date.preset !== 'all'
    : Boolean(filters[k]));
  const ADVANCED = ['group', 'tag', 'frequency', 'verification', 'assigner'];
  const advancedSet = ADVANCED.filter((k) => has(k) && isSet(k)).length;
  const anySet = Object.keys(filters).some(isSet);

  return (
    <div className="card dlg-filters">
      <div className="filter-line">
        <label className="search-box">
          <Search size={15} className="subtle" />
          <input
            value={filters.search || ''}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search task, description or code"
          />
        </label>

        {has('team') && (
          <FilterSelect inline allLabel="All teams" label="Team" value={filters.team} onChange={(team) => set({ team })} options={teams.map((t) => ({ value: t._id, label: t.name }))} width={140} />
        )}
        <FilterSelect inline allLabel="All categories" label="Category" value={filters.category} onChange={(category) => set({ category })} options={categories.map((c) => ({ value: c.name, label: c.name }))} width={155} />
        <FilterSelect inline allLabel="All priorities" label="Priority" value={filters.priority} onChange={(priority) => set({ priority })} options={PRIORITY_OPTIONS} width={140} />
        {has('doer') && (
          <label className="filter-select is-inline" style={{ minWidth: 160 }}>
            <PersonPicker value={filters.doer} onChange={(doer) => set({ doer })} placeholder="Doer: anyone" />
          </label>
        )}
        <DateRangeFilter inline label="Due date" value={filters.date} onChange={(date) => set({ date })} />

        <button
          type="button"
          className={`btn btn-subtle btn-sm dlg-more${more ? ' is-open' : ''}`}
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
        >
          <SlidersHorizontal size={14} /> More filters
          {advancedSet > 0 && <span className="dlg-more-count">{advancedSet}</span>}
        </button>

        {anySet && (
          <button type="button" className="btn btn-ghost btn-sm dlg-reset" onClick={() => onChange({})}>Reset</button>
        )}
      </div>

      {more && (
        <div className="filter-line is-more">
          {has('group') && <FilterSelect label="Group" value={filters.group} onChange={(group) => set({ group })} options={groups.map((g) => ({ value: g._id, label: g.name }))} width={150} />}
          {tags.length > 0 && <FilterSelect label="Tag" value={filters.tag} onChange={(tag) => set({ tag })} options={tags.map((t) => ({ value: t.name, label: t.name }))} width={135} />}
          <FilterSelect
            label="Frequency"
            value={filters.frequency}
            onChange={(frequency) => set({ frequency })}
            options={[{ value: 'once', label: 'One-time' }, { value: 'recurring', label: 'Any repeat' }, ...DLG_FREQUENCIES]}
            width={145}
          />
          <FilterSelect
            label="Verification"
            value={filters.verification}
            onChange={(verification) => set({ verification })}
            options={[{ value: 'required', label: 'Required' }, { value: 'not_required', label: 'Not required' }]}
            width={145}
          />
          {has('assigner') && (
            <label className="filter-select" style={{ minWidth: 165 }}>
              <span className="tiny subtle upper">Assigned by</span>
              <PersonPicker value={filters.assigner} onChange={(assigner) => set({ assigner })} placeholder="Anyone" />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

