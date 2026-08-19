import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, Phone, Users, TrendingDown, Check, X,
  CalendarDays, Presentation, MapPin, Mail, FileText, Sun,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { useToday, useCompleteTask, useCancelTask } from '../../app/api/crmApi.js';
import './crm.css';

/**
 * "Today" — what this person should actually do, in the order they should do it.
 *
 * THE MOST IMPORTANT SCREEN IN THE MODULE, and the reason is adoption rather
 * than features: an agent who opens the CRM and immediately knows what to do
 * keeps opening it. One who has to assemble that answer from a board, a list
 * and a dashboard stops after a week, and then the pipeline data stops being
 * true — which makes every other screen a work of fiction.
 *
 * ORDERED BY OBLIGATION. Overdue first, in red, because it is somebody's
 * failure and the only thing on the page that is already too late. Then
 * today's work, then what has arrived, then what is quietly dying. Sorting
 * these by anything else — type, record, alphabetically — buries the one
 * section that matters.
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

const timeOf = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

const overdueBy = (d) => {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 60) return `${mins}m late`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h late`;
  return `${Math.floor(mins / 1440)}d late`;
};

function TaskRow({ task, tone, onDone, onCancel, busy }) {
  const Icon = TYPE_ICON[task.type] || CalendarClock;
  return (
    <li className={`crm-task ${tone || ''}`}>
      {/* Completing is the primary action, so it is a real button on the left
          where the eye starts — not hidden in a row menu. */}
      <button
        type="button" className="crm-task__done" onClick={() => onDone(task)}
        disabled={busy} title="Mark done" aria-label={`Mark "${task.title}" done`}
      >
        <Check size={14} />
      </button>

      <span className="crm-task__icon" title={task.type.replace(/_/g, ' ')}>
        <Icon size={14} aria-hidden />
      </span>

      <span className="crm-task__body">
        <strong>{task.title}</strong>
        {task.entityLabel && <span className="crm-muted"> · {task.entityLabel}</span>}
        {task.notes && <span className="crm-task__notes">{task.notes}</span>}
        {/* Provenance. An automated task nobody can explain is an automated
            task people start ignoring wholesale. */}
        {task.createdByRule && (
          <span className="crm-task__rule">added automatically</span>
        )}
      </span>

      <span className="crm-task__when">
        {tone === 'is-overdue' ? overdueBy(task.dueAt) : timeOf(task.dueAt)}
      </span>

      <button
        type="button" className="crm-task__skip" onClick={() => onCancel(task)}
        disabled={busy} title="Cancel this task" aria-label={`Cancel "${task.title}"`}
      >
        <X size={13} />
      </button>
    </li>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError } = useToday();
  const complete = useCompleteTask();
  const cancel = useCancelTask();

  const firstName = String(user?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const onDone = (task) => complete.mutate({ id: task._id });
  const onCancel = (task) => cancel.mutate({ id: task._id });
  const busy = complete.isPending || cancel.isPending;

  if (isError) {
    return (
      <>
        <Topbar title="Today" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Today could not be loaded" />
        </div>
      </>
    );
  }

  const c = data?.counts || {};
  const nothingAtAll = data
    && !data.overdue.length && !data.dueToday.length
    && !data.newLeads.length && !data.stalled.length;

  return (
    <>
      <Topbar title={firstName ? `${greeting}, ${firstName}` : 'Today'} />

      <div className="content col gap-4">
        {(complete.error || cancel.error) && (
          <div className="crm-form__error">
            {complete.error?.response?.data?.message
              || cancel.error?.response?.data?.message
              || 'That task could not be updated.'}
          </div>
        )}

        {isLoading || !data ? (
          <div className="sm muted" style={{ padding: 24 }}>Loading…</div>
        ) : nothingAtAll ? (
          <EmptyState
            icon={Sun}
            title="Nothing outstanding"
            hint="No overdue work, nothing due today, and no lead waiting on a first call. Enjoy it."
          />
        ) : (
          <>
            {/* The checklist, as one line. Read before anything else on the
                page, and the only place the four numbers appear together. */}
            <div className="crm-checklist">
              <span className={c.overdue ? 'is-bad' : ''}>
                <strong>{c.overdue}</strong> overdue
              </span>
              <span><strong>{c.dueToday}</strong> due today</span>
              <span><strong>{c.meetings}</strong> meetings</span>
              <span><strong>{c.newLeads}</strong> new leads</span>
              <span><strong>{c.stalled}</strong> stalled deals</span>
            </div>

            {Boolean(data.overdue.length) && (
              <section className="crm-section">
                <h2 className="crm-section__title is-bad">
                  <AlertTriangle size={14} aria-hidden /> Overdue
                </h2>
                <ul className="crm-tasks">
                  {data.overdue.map((t) => (
                    <TaskRow key={t._id} task={t} tone="is-overdue" onDone={onDone} onCancel={onCancel} busy={busy} />
                  ))}
                </ul>
              </section>
            )}

            <section className="crm-section">
              <h2 className="crm-section__title"><CalendarClock size={14} aria-hidden /> Due today</h2>
              {data.dueToday.length ? (
                <ul className="crm-tasks">
                  {data.dueToday.map((t) => (
                    <TaskRow key={t._id} task={t} onDone={onDone} onCancel={onCancel} busy={busy} />
                  ))}
                </ul>
              ) : (
                <p className="crm-muted">Nothing due today.</p>
              )}
            </section>

            {/* EVERYONE ELSE'S OVERDUE WORK — managers only, and the reason
                it exists: an agent's overdue tasks otherwise live on exactly
                one screen, theirs. A week of leave is forty follow-ups nobody
                sees, and the customers behind them are never called back.

                 is null for an agent, so its absence is the permission
                check — this page does not re-derive the role rule. */}
            {Boolean(data.team?.length) && (
              <section className="crm-section">
                <h2 className="crm-section__title">
                  <Users size={14} aria-hidden /> Overdue elsewhere in the team
                </h2>
                <ul className="crm-teamoverdue">
                  {data.team.map((row) => (
                    <li key={row.owner?._id || 'gone'}>
                      <span>
                        <strong>{row.owner?.name || 'A deleted account'}</strong>
                        {/* Flagged, not filtered out. Somebody who has left is
                            precisely whose queue must be looked at, and hiding
                            those rows makes the problem invisible at the moment
                            it becomes permanent. */}
                        {row.ownerInactive && (
                          <Badge color="#dc2626" soft="var(--surface-2)">cannot log in</Badge>
                        )}
                      </span>
                      <span className="crm-muted">
                        oldest {Math.floor((Date.now() - new Date(row.oldest).getTime()) / 86400000)}d ago
                      </span>
                      <strong className="is-bad">{row.overdue}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="crm-split">
              {Boolean(data.newLeads.length) && (
                <section className="crm-card">
                  <div className="crm-card__head">
                    <h2 className="crm-section__title"><Users size={14} aria-hidden /> Waiting on you</h2>
                    <span className="crm-muted">assigned, never contacted</span>
                  </div>
                  <ul className="crm-minilist">
                    {data.newLeads.map((l) => (
                      <li key={l._id}>
                        <button type="button" onClick={() => navigate(`/crm/leads?open=${l._id}`)}>
                          <strong>{l.name}</strong>
                          <span className="crm-muted">
                            {[l.company, l.city].filter(Boolean).join(' · ') || l.source?.replace(/_/g, ' ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {Boolean(data.stalled.length) && (
                <section className="crm-card">
                  <div className="crm-card__head">
                    <h2 className="crm-section__title"><TrendingDown size={14} aria-hidden /> Going stale</h2>
                    <span className="crm-muted">a week in the same stage</span>
                  </div>
                  <ul className="crm-minilist">
                    {data.stalled.map((d) => (
                      <li key={d._id}>
                        <button type="button" onClick={() => navigate('/crm/pipeline')}>
                          <strong>{d.title}</strong>
                          <span className="crm-muted">
                            {d.value ? `₹${(d.value / 100000).toFixed(1)}L · ` : ''}
                            {Math.floor((Date.now() - new Date(d.stageEnteredAt).getTime()) / 86_400_000)}d
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {Boolean(data.upcoming.length) && (
              <section className="crm-section">
                <h2 className="crm-section__title">Coming up</h2>
                <ul className="crm-tasks">
                  {data.upcoming.map((t) => (
                    <li key={t._id} className="crm-task is-future">
                      <span className="crm-task__icon">
                        {(() => { const I = TYPE_ICON[t.type] || CalendarClock; return <I size={14} aria-hidden />; })()}
                      </span>
                      <span className="crm-task__body">
                        <strong>{t.title}</strong>
                        {t.entityLabel && <span className="crm-muted"> · {t.entityLabel}</span>}
                      </span>
                      <span className="crm-task__when">
                        <Badge color="var(--text-subtle)" soft="var(--surface-2)">
                          {new Date(t.dueAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default TodayPage;
