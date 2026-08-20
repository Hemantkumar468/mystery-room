import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Users, TrendingDown, Sun, Phone, Mail,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import {
  useToday, useCompleteTask, useCancelTask, useClickToCall,
} from '../../app/api/crmApi.js';
import { EmailComposeModal } from './EmailComposeModal.jsx';
import './crm.css';

/**
 * "Today" — what this person should actually do, in the order they should do it.
 *
 * THE MOST IMPORTANT SCREEN IN THE MODULE, and the reason is adoption rather
 * than features: an agent who opens the CRM and immediately knows what to do
 * keeps opening it. One who has to assemble that answer from a board, a list
 * and a dashboard stops after a week — and then the pipeline data stops being
 * true, which makes every other screen a work of fiction.
 *
 * EVERY ROW CARRIES ITS NEXT ACTION. A row that says "first call · Ankit
 * Verma" and nothing else costs three clicks to act on: open the lead, find
 * the number, dial. With the number and the channel button on the row itself
 * it costs one. That difference is the whole design — the screen is a queue to
 * be worked, not a report to be read.
 *
 * ORDERED BY OBLIGATION. Overdue first, in red, because it is already too
 * late and it is somebody's failure. Then today, then what has just arrived.
 * Sorting by anything else — type, record, alphabetically — buries the one
 * section that matters.
 */

/** Late enough to be alarming, rather than merely late. */
const SEVERE_HOURS = 12;

const lateness = (dueAt) => {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(dueAt).getTime()) / 60_000));
  const hours = mins / 60;
  const text = mins < 60 ? `${mins}m late`
    : hours < 24 ? `${Math.floor(hours)}h late`
      : `${Math.floor(hours / 24)}d late`;
  return { text, severe: hours >= SEVERE_HOURS };
};

const timeOf = (d) => new Date(d).toLocaleTimeString('en-IN', {
  hour: '2-digit', minute: '2-digit', hour12: false,
});

const ago = (d) => {
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60_000);
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

const money = (n) => (n ? `₹${Number(n).toLocaleString('en-IN')}` : null);

/** +918826810058 → +91 88268 10058. A number nobody can read at a glance is a
 *  number that gets misdialled off the screen. */
const phoneOf = (raw) => {
  const text = String(raw || '');
  const m = text.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : text;
};

const initials = (name) => String(name || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0])
  .join('')
  .toUpperCase();

/**
 * One row of work.
 *
 * The subtitle is the record, not the task: a phone number and where the
 * enquiry came from, or — for a deal — the stage and the money on the table.
 * That is what decides how the call opens.
 */
function WorkRow({
  task, overdue, onDone, onCall, onEmail, onOpen, busy,
}) {
  const record = task.record;
  const late = overdue ? lateness(task.dueAt) : null;

  /* WHICH BUTTON. An email task offers Email; anything else offers Call — but
     only when there is a number to dial and the customer has not asked us not
     to. Offering a button the server will refuse reads as a broken button, so
     it simply is not shown. */
  const canCall = Boolean(record?.phone) && !record?.doNotDisturb && task.type !== 'email';
  const canEmail = task.type === 'email' && Boolean(record?.email || record?.kind === 'deal');

  const subtitle = record?.kind === 'deal'
    ? [record.stageName, money(record.value)].filter(Boolean).join(' · ')
    : [phoneOf(record?.phone), record?.source?.replace(/_/g, ' ')].filter(Boolean).join(' · ');

  /* WITHOUT REPEATING ITSELF. A task created by a rule is titled
     "Onboarding handover — Nagpur franchise" and carries "Nagpur franchise" as
     its label, so printing both gives a row that says the same thing twice and
     reads as a bug. The label leads only when it adds something. */
  const heading = record?.name || task.entityLabel;
  const showTaskName = Boolean(heading) && !String(task.title).includes(String(heading));

  return (
    <li className={`tdy-row ${overdue ? 'is-overdue' : ''}`}>
      <button
        type="button"
        className="tdy-row__tick"
        onClick={() => onDone(task)}
        disabled={busy}
        title="Mark done"
        aria-label={`Mark "${task.title}" done`}
      />

      {/* Red for badly late, amber for merely late. Two levels, not five —
          a gradient of urgency is a gradient nobody reads. */}
      {overdue && <span className={`tdy-row__bar ${late.severe ? 'is-severe' : ''}`} aria-hidden />}

      <span className="tdy-row__body">
        <span className="tdy-row__title">
          <strong>{heading || task.title}</strong>
          {/* An unnamed enquiry still needs to be distinguishable from the
              other eight unnamed enquiries, so it carries a short handle. */}
          {record?.unnamed && <code className="tdy-row__ref">{record.ref}</code>}
          {showTaskName && <span className="tdy-row__task"> · {task.title}</span>}
        </span>
        {subtitle && <span className="tdy-row__meta">{subtitle}</span>}
      </span>

      <span className={`tdy-row__when ${overdue ? (late.severe ? 'is-severe' : 'is-late') : ''}`}>
        {overdue ? late.text : timeOf(task.dueAt)}
      </span>

      <span className="tdy-row__actions">
        {canCall && (
          <button type="button" className="tdy-btn" onClick={() => onCall(record)} disabled={busy}>
            Call
          </button>
        )}
        {canEmail && (
          <button type="button" className="tdy-btn" onClick={() => onEmail(record)}>
            Email
          </button>
        )}
        {record?.doNotDisturb && <span className="tdy-row__dnc">do not call</span>}
        <button type="button" className="tdy-btn" onClick={() => onOpen(record, task)}>
          Open
        </button>
      </span>
    </li>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const { data, isLoading, isError } = useToday();
  const complete = useCompleteTask();
  const cancel = useCancelTask();
  const call = useClickToCall();

  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [composing, setComposing] = useState(null);
  const [error, setError] = useState(null);

  const firstName = String(user?.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const busy = complete.isPending || cancel.isPending;
  const onDone = (task) => complete.mutate({ id: task._id }, { onError: () => {} });

  const onCall = async (record) => {
    setError(null);
    try {
      await call.mutateAsync({ entityType: record.kind, entityId: String(record.id) });
    } catch (err) {
      setError(err?.message || 'That call could not be placed.');
    }
  };

  const onOpen = (record, task) => {
    if (record?.kind === 'lead') navigate(`/crm/leads?open=${record.id}`);
    else if (record?.kind === 'deal') navigate(`/crm/pipeline?open=${record.id}`);
    else navigate(`/crm/tasks?open=${task._id}`);
  };

  if (isError) {
    return (
      <>
        <Topbar title="Today" />
        <div className="content">
          <EmptyState
            icon={AlertTriangle}
            title="Today could not be loaded"
            hint="This is not an empty day — the list could not be fetched."
          />
        </div>
      </>
    );
  }

  const c = data?.counts || {};
  const overdue = data?.overdue || [];
  const visibleOverdue = showAllOverdue ? overdue : overdue.slice(0, 4);
  const hiddenOverdue = (data?.overdueTotal ?? overdue.length) - visibleOverdue.length;
  /* Counted over the rows that are HIDDEN, not all of them — "28 more overdue,
     3 of them unnamed" is a statement about what is behind the fold, which is
     what the sentence is for. The server's figure covers the whole fetched
     page and is the fallback when the tail was not fetched. */
  const hiddenUnnamed = overdue.slice(visibleOverdue.length).filter((t) => t.record?.unnamed).length
    || (showAllOverdue ? 0 : data?.unnamedOverdue) || 0;

  const nothingAtAll = data
    && !overdue.length && !data.dueToday.length
    && !data.newLeads.length && !data.stalled.length;

  return (
    <>
      <Topbar title={firstName ? `${greeting}, ${firstName}` : 'Today'} />

      <div className="content tdy">
        <p className="tdy-date">{today}</p>

        {error && <div className="crm-form__error">{error}</div>}

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
            {/* THE FIVE NUMBERS, once. A zero is greyed rather than coloured:
                "0 stalled" is good news and must not compete for attention
                with the count that is somebody's failure. */}
            <div className="tdy-summary">
              <span className={c.overdue ? 'is-bad' : 'is-zero'}>
                <strong>{c.overdue}</strong> overdue
              </span>
              <span className={c.dueToday ? '' : 'is-zero'}>
                <strong>{c.dueToday}</strong> due today
              </span>
              <span className={c.meetings ? '' : 'is-zero'}>
                <strong>{c.meetings}</strong> meetings
              </span>
              <span className={c.newLeads ? '' : 'is-zero'}>
                <strong>{c.newLeads}</strong> new leads
              </span>
              <span className={c.stalled ? '' : 'is-zero'}>
                <strong>{c.stalled}</strong> stalled
              </span>
            </div>

            {Boolean(overdue.length) && (
              <section className="tdy-section">
                <header className="tdy-section__head">
                  <h2 className="is-bad">Overdue · {data.overdueTotal ?? overdue.length}</h2>
                  <span className="tdy-muted">Oldest first</span>
                </header>

                <div className="tdy-card">
                  <ul className="tdy-rows">
                    {visibleOverdue.map((t) => (
                      <WorkRow
                        key={t._id} task={t} overdue onDone={onDone}
                        onCall={onCall} onEmail={setComposing} onOpen={onOpen} busy={busy}
                      />
                    ))}
                  </ul>

                  {hiddenOverdue > 0 && (
                    /* The rest, summarised rather than hidden — and the reason
                       there are so many, if the reason is that nobody could be
                       named. Twelve identical "Web visitor" rows is a form
                       problem, not a diligence problem. */
                    <div className="tdy-more">
                      <span>
                        {hiddenOverdue} more overdue
                        {hiddenUnnamed > 0 && ` — ${hiddenUnnamed} are unnamed web visitors`}
                      </span>
                      <button type="button" className="tdy-btn" onClick={() => setShowAllOverdue(true)}>
                        Show all
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="tdy-section">
              <header className="tdy-section__head">
                <h2>Due today · {c.dueToday || 0}</h2>
              </header>
              {data.dueToday.length ? (
                <div className="tdy-card">
                  <ul className="tdy-rows">
                    {data.dueToday.map((t) => (
                      <WorkRow
                        key={t._id} task={t} onDone={onDone}
                        onCall={onCall} onEmail={setComposing} onOpen={onOpen} busy={busy}
                      />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="tdy-muted" style={{ padding: '4px 2px' }}>Nothing due today.</p>
              )}
            </section>

            {Boolean(data.newLeads.length) && (
              <section className="tdy-section">
                <header className="tdy-section__head">
                  <h2>New leads assigned · {data.newLeads.length}</h2>
                </header>
                {/* Two across, because these are the ones that go cold first
                    and a single-file list buries the second one. */}
                <div className="tdy-leads">
                  {data.newLeads.map((lead) => (
                    <article key={lead._id} className="tdy-lead">
                      <span className="tdy-lead__avatar">{initials(lead.name)}</span>
                      <span className="tdy-lead__body">
                        <strong>{lead.name}</strong>
                        <span className="tdy-lead__meta">
                          {[
                            phoneOf(lead.phone),
                            lead.source?.replace(/_/g, ' '),
                            lead.assignedAt ? ago(lead.assignedAt) : null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {lead.phone ? (
                        <button
                          type="button" className="tdy-btn is-primary"
                          onClick={() => onCall({ kind: 'lead', id: lead._id })}
                        >
                          Call
                        </button>
                      ) : (
                        <button
                          type="button" className="tdy-btn"
                          onClick={() => navigate(`/crm/leads?open=${lead._id}`)}
                        >
                          Open
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {Boolean(data.stalled?.length) && (
              <section className="tdy-section">
                <header className="tdy-section__head">
                  <h2><TrendingDown size={13} aria-hidden /> Going stale · {data.stalled.length}</h2>
                  <span className="tdy-muted">a week in the same stage</span>
                </header>
                <div className="tdy-card">
                  <ul className="tdy-rows">
                    {data.stalled.map((d) => (
                      <li key={d._id} className="tdy-row">
                        <span className="tdy-row__body">
                          <span className="tdy-row__title"><strong>{d.title}</strong></span>
                          <span className="tdy-row__meta">
                            {[money(d.value), `${Math.floor((Date.now() - new Date(d.stageEnteredAt).getTime()) / 86_400_000)}d in stage`]
                              .filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        <span className="tdy-row__actions">
                          <button type="button" className="tdy-btn" onClick={() => navigate(`/crm/pipeline?open=${d._id}`)}>
                            Open
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {Boolean(data.team?.length) && (
              <section className="tdy-section">
                <header className="tdy-section__head">
                  <h2><Users size={13} aria-hidden /> Overdue elsewhere in the team</h2>
                </header>
                <div className="tdy-card">
                  <ul className="tdy-rows">
                    {data.team.map((row) => (
                      <li key={row.owner?._id || 'gone'} className="tdy-row">
                        <span className="tdy-row__body">
                          <span className="tdy-row__title">
                            <strong>{row.owner?.name || 'A deleted account'}</strong>
                            {/* Flagged, not filtered. Somebody who has left is
                                precisely whose queue must be looked at. */}
                            {row.ownerInactive && (
                              <Badge color="#C1392B" soft="var(--surface-2)">cannot log in</Badge>
                            )}
                          </span>
                          <span className="tdy-row__meta">
                            oldest {Math.floor((Date.now() - new Date(row.oldest).getTime()) / 86_400_000)}d ago
                          </span>
                        </span>
                        <span className="tdy-row__when is-severe">{row.overdue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* THE INSIGHT, at the bottom, where it does not compete with the
                work. A run of unnamed enquiries is a form that stopped sending
                a name field — a problem no amount of chasing fixes, and one
                nobody notices from inside a list of identical rows. */}
            {data.unnamedToday > 0 && (
              <div className="tdy-insight">
                <span className="tdy-insight__body">
                  <strong>
                    {data.unnamedToday} of today&apos;s leads have no name
                  </strong>
                  <span>
                    The website form is not capturing a name field — agents cannot personalise
                    these calls.
                  </span>
                </span>
                <button
                  type="button" className="tdy-btn is-warn"
                  onClick={() => navigate('/crm/leads?source=web_form')}
                >
                  Fix the form
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {composing && (
        <EmailComposeModal
          entityType={composing.kind}
          entityId={String(composing.id)}
          to={composing.email}
          name={composing.name}
          onClose={() => setComposing(null)}
        />
      )}
    </>
  );
}

export default TodayPage;
