import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Check, X, CalendarClock, AlertTriangle, Phone, CalendarDays,
  Presentation, MapPin, Mail, FileText,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import {
  useCrmTasks, useCompleteTask, useCancelTask, useCrmOptions,
} from '../../app/api/crmApi.js';
import { TaskFormModal } from './TaskFormModal.jsx';
import './crm.css';

/**
 * Every task, not just today's.
 *
 * The Today screen answers "what now"; this answers "what have I got" — which
 * is a different question and needs filters rather than urgency ordering. The
 * type filter is the one that earns its place: an agent doing fifty calls and
 * no demos has a problem that only shows up when the list can be sliced.
 *
 * Completed tasks are visible but never editable. A finished task is a record
 * of what somebody did, and a list that lets you un-finish things is a list
 * whose history cannot be trusted.
 */

const TYPE_ICON = {
  call: Phone,
  meeting: CalendarDays,
  demo: Presentation,
  site_visit: MapPin,
  email: Mail,
  follow_up: CalendarClock,
  document: FileText,
};

const fmtWhen = (d) => {
  const date = new Date(d);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const isOverdue = (t) => t.status === 'open' && new Date(t.dueAt) < new Date();

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  const status = params.get('status') || 'open';
  const type = params.get('type') || '';

  const { data, isError } = useCrmTasks({ status, type: type || undefined, limit: 200 });
  const { data: options } = useCrmOptions();
  const complete = useCompleteTask();
  const cancel = useCancelTask();

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const busy = complete.isPending || cancel.isPending;

  return (
    <>
      <Topbar
        title="Tasks"
        actions={(
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> New task
          </button>
        )}
      />

      <div className="content col gap-4">
        <div className="crm-toolbar">
          <select
            className="crm-select" value={status}
            onChange={(e) => setFilter('status', e.target.value)} aria-label="Status"
          >
            <option value="open">Open</option>
            <option value="done">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <select
            className="crm-select" value={type}
            onChange={(e) => setFilter('type', e.target.value)} aria-label="Type"
          >
            <option value="">All types</option>
            {(options?.taskTypes || []).map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>

          {data && <span className="crm-muted">{data.total} tasks</span>}
        </div>

        {(complete.error || cancel.error) && (
          <div className="crm-form__error">
            {complete.error?.response?.data?.message
              || cancel.error?.response?.data?.message
              || 'That task could not be updated.'}
          </div>
        )}

        {isError ? (
          <EmptyState icon={AlertTriangle} title="Those tasks could not be loaded" />
        ) : !data ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : !data.items.length ? (
          <EmptyState
            icon={CalendarClock}
            title={status === 'open' ? 'Nothing outstanding' : 'Nothing here'}
            hint={status === 'open'
              ? 'New leads and stage changes create follow-ups automatically.'
              : undefined}
          />
        ) : (
          <ul className="crm-tasks">
            {data.items.map((t) => {
              const Icon = TYPE_ICON[t.type] || CalendarClock;
              const open = t.status === 'open';
              return (
                <li key={t._id} className={`crm-task ${isOverdue(t) ? 'is-overdue' : ''} ${open ? '' : 'is-future'}`}>
                  {open ? (
                    <button
                      type="button" className="crm-task__done" disabled={busy}
                      onClick={() => complete.mutate({ id: t._id })}
                      title="Mark done" aria-label={`Mark "${t.title}" done`}
                    >
                      <Check size={14} />
                    </button>
                  ) : (
                    <span className="crm-task__icon">
                      {t.status === 'done' ? <Check size={14} /> : <X size={14} />}
                    </span>
                  )}

                  <span className="crm-task__icon" title={t.type.replace(/_/g, ' ')}>
                    <Icon size={14} aria-hidden />
                  </span>

                  <span className="crm-task__body">
                    <strong>{t.title}</strong>
                    {t.entityLabel && <span className="crm-muted"> · {t.entityLabel}</span>}
                    {t.notes && <span className="crm-task__notes">{t.notes}</span>}
                    <span className="row gap-1" style={{ marginTop: 3, flexWrap: 'wrap' }}>
                      {t.createdByRule && <span className="crm-task__rule">added automatically</span>}
                      {/* How a completion was confirmed. Everything is
                          self-reported until telephony lands; showing it now
                          means the distinction is visible from the day it
                          starts being real. */}
                      {t.completionSource === 'telephony' && (
                        <Badge color="#10b981" soft="var(--surface-2)">confirmed by call log</Badge>
                      )}
                      {t.completionSource === 'self_reported' && (
                        <span className="crm-task__rule">marked done by hand</span>
                      )}
                    </span>
                  </span>

                  <span className="crm-task__when">{fmtWhen(t.dueAt)}</span>

                  {open && (
                    <button
                      type="button" className="crm-task__skip" disabled={busy}
                      onClick={() => cancel.mutate({ id: t._id })}
                      title="Cancel" aria-label={`Cancel "${t.title}"`}
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TaskFormModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

export default TasksPage;
