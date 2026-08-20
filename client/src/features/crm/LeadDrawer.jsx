import { useState } from 'react';
import {
  X, Phone, Mail, MessageSquare, StickyNote, Clock, UserCog, Send,
} from 'lucide-react';
import { Badge, Avatar, Spinner } from '../../components/ui/primitives.jsx';
import { useEmployees } from '../../hooks/useEmployees.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import {
  useLead, useLogLeadActivity, useSetLeadStatus, useReassignLead, useCrmOptions,
  useClickToCall,
} from '../../app/api/crmApi.js';
import { TaskFormModal } from './TaskFormModal.jsx';
import { CrmTimeline } from './CrmTimeline.jsx';

/**
 * One lead, opened from the list — the screen where an agent actually works.
 *
 * A DRAWER, NOT A PAGE. Working a queue means opening a lead, logging the call,
 * closing it and opening the next one. A full page navigation loses the list's
 * scroll position and filters every time, which turns a 20-lead session into 20
 * round trips through the filter bar.
 *
 * LOGGING AN ACTIVITY IS THE PRIMARY ACTION, so it is at the top and always
 * open — not behind a button. Everything else on this screen is a statistic;
 * this is the one control that changes whether the lead has been worked, and
 * it is what stops the dashboard counting it as ignored.
 */

const STATUS_TONE = {
  new: 'var(--primary)',
  contacted: '#3b82f6',
  qualified: '#10b981',
  converted: '#059669',
  disqualified: 'var(--text-subtle)',
};

const ACTIVITY_ICON = {
  call: Phone,
  whatsapp: MessageSquare,
  email: Mail,
  note: StickyNote,
  meeting: Clock,
  stage_change: UserCog,
  system: Clock,
  task: Clock,
};

const when = (d) => new Date(d).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

export function LeadDrawer({ id, onClose, onGone }) {
  const { data, isLoading, isError } = useLead(id);
  const { data: options } = useCrmOptions();
  const { employees } = useEmployees();
  const currentUser = useAppSelector(selectCurrentUser);

  const log = useLogLeadActivity();
  const setStatus = useSetLeadStatus();
  const reassign = useReassignLead();
  const call = useClickToCall();

  const [type, setType] = useState('call');
  const [addingTask, setAddingTask] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  if (!id) return null;

  const lead = data?.lead;
  const timeline = data?.timeline || [];
  const isManager = can.manage?.(currentUser?.role) ?? ['md', 'ea', 'manager'].includes(currentUser?.role);

  const submitNote = async (e) => {
    e.preventDefault();
    if (!note.trim()) return;
    setError(null);
    try {
      await log.mutateAsync({ id, type, body: note.trim() });
      setNote('');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not log that.');
    }
  };

  const changeStatus = async (next) => {
    setError(null);
    // The one status that demands an explanation. Asked for here rather than
    // silently sent empty, because the server refuses it without one — and the
    // reasons are what any future "why are we losing leads" report is made of.
    let reason;
    if (next === 'disqualified') {
      // eslint-disable-next-line no-alert
      reason = window.prompt('Why is this lead being disqualified?');
      if (!reason?.trim()) return;
    }
    try {
      await setStatus.mutateAsync({ id, status: next, reason });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not change the status.');
    }
  };

  const changeOwner = async (userId) => {
    if (!userId) return;
    setError(null);
    try {
      await reassign.mutateAsync({ id, assignedTo: userId });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not reassign.');
    }
  };

  return (
    <>
      {/* Click-away, and the Escape key via the button below — a drawer with no
          way out but a 20px × is a drawer people fight with. */}
      <div className="crm-scrim" role="presentation" onClick={onClose} />

      <aside className="crm-drawer" aria-label="Lead details">
        <header className="crm-drawer__head">
          <div className="row gap-2" style={{ alignItems: 'center', minWidth: 0 }}>
            {lead && <Avatar name={lead.name} size={34} />}
            <div style={{ minWidth: 0 }}>
              <strong className="crm-drawer__name">{lead?.name || 'Lead'}</strong>
              {lead && (
                <div className="crm-muted crm-drawer__sub">
                  {[lead.company, lead.city].filter(Boolean).join(' · ') || 'No company recorded'}
                </div>
              )}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {isLoading && <div style={{ padding: 24 }}><Spinner label="Loading…" /></div>}

        {isError && (
          <div className="crm-drawer__body">
            <p className="crm-muted">
              That lead could not be opened — it may have been deleted, or it belongs to someone else.
            </p>
            <button type="button" className="btn btn-subtle btn-sm" onClick={onGone}>Back to the list</button>
          </div>
        )}

        {lead && (
          <div className="crm-drawer__body">
            {error && <div className="crm-form__error">{error}</div>}

            {/* ── Contact details. The REAL phone number, not the masked one:
                   opening a record is the deliberate act the masking exists to
                   make deliberate. ─────────────────────────────────────── */}
            <div className="crm-drawer__contact">
              {/* Click-to-call, not a tel: link. It rings the agent's own
                  phone first and shows the customer the company number —
                  that masking is the entire reason a cloud provider is in
                  the picture at all. */}
              {lead.phone && !lead.doNotDisturb && (
                <button
                  type="button" className="btn btn-primary btn-sm"
                  onClick={async () => {
                    setError(null);
                    try {
                      await call.mutateAsync({ entityType: 'lead', entityId: id });
                    } catch (err) {
                      setError(err?.response?.data?.message || 'Could not place that call.');
                    }
                  }}
                  disabled={call.isPending}
                >
                  <Phone size={14} /> {call.isPending ? 'Ringing you…' : `Call ${lead.phone}`}
                </button>
              )}
              {lead.doNotDisturb && (
                <span className="crm-dnc">
                  <Phone size={14} aria-hidden />
                  <span><strong>Do not call.</strong> They asked not to be contacted by phone.</span>
                </span>
              )}
              {lead.email && (
                <a className="crm-chip" href={`mailto:${lead.email}`}>
                  <Mail size={14} aria-hidden /> {lead.email}
                </a>
              )}
              {lead.phone && (
                <a
                  className="crm-chip"
                  href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`}
                  target="_blank" rel="noreferrer"
                >
                  <MessageSquare size={14} aria-hidden /> WhatsApp
                </a>
              )}
            </div>

            {/* ── Facts ─────────────────────────────────────────── */}
            <dl className="crm-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <select
                    className="crm-select" value={lead.status}
                    onChange={(e) => changeStatus(e.target.value)}
                    disabled={setStatus.isPending}
                    aria-label="Lead status"
                  >
                    {(options?.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  {isManager ? (
                    <select
                      className="crm-select"
                      value={String(lead.assignedTo?._id || '')}
                      onChange={(e) => changeOwner(e.target.value)}
                      disabled={reassign.isPending}
                      aria-label="Assigned to"
                    >
                      <option value="">Unassigned</option>
                      {/* Viewers excluded, matching the server rule in
                          shared/ownership.js. Offering a name the API will
                          refuse is a dead end the user cannot diagnose. */}
                      {employees
                        .filter((emp) => emp.systemRole !== 'viewer')
                        .map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                    </select>
                  ) : (
                    // Agents see who owns it and cannot change it. Someone who
                    // could reassign could hand their hard leads away.
                    <span>{lead.assignedTo?.name || 'Unassigned'}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <Badge color="var(--text-subtle)" soft="var(--surface-2)">
                    {String(lead.source || '').replace(/_/g, ' ')}
                  </Badge>
                  {lead.sourceDetail && <span className="crm-muted"> {lead.sourceDetail}</span>}
                </dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>{when(lead.createdAt)}</dd>
              </div>
              {lead.routedBy && (
                <div>
                  <dt>Routed by</dt>
                  {/* "Why do I have this lead?" is asked constantly, and an
                      unanswerable version of it is how routing rules lose trust. */}
                  <dd className="crm-muted">{lead.routedBy}</dd>
                </div>
              )}
              {lead.utm?.campaign && (
                <div>
                  <dt>Campaign</dt>
                  <dd>{lead.utm.campaign}</dd>
                </div>
              )}
            </dl>

            {lead.message && (
              <blockquote className="crm-quote">{lead.message}</blockquote>
            )}

            {/* ── Log something. The primary action, always open. ─── */}
            <form className="crm-log" onSubmit={submitNote}>
              <div className="crm-log__types">
                {['call', 'whatsapp', 'email', 'note'].map((t) => {
                  const Icon = ACTIVITY_ICON[t];
                  return (
                    <button
                      key={t} type="button"
                      className={`crm-log__type ${type === t ? 'is-on' : ''}`}
                      onClick={() => setType(t)}
                      aria-pressed={type === t}
                    >
                      <Icon size={14} aria-hidden /> {t}
                    </button>
                  );
                })}
              </div>
              <div className="crm-log__row">
                <input
                  className="input"
                  placeholder={type === 'call' ? 'What did they say?' : 'What happened?'}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={log.isPending || !note.trim()}>
                  <Send size={15} /> Log
                </button>
              </div>
            </form>

            {/* ── The timeline ──────────────────────────────────── */}
            <div className="row gap-2">
              <button type="button" className="btn btn-subtle btn-sm" onClick={() => setAddingTask(true)}>
                Plan a follow-up
              </button>
            </div>

            <h3 className="crm-section__title">History</h3>
            <CrmTimeline items={timeline} />
          </div>
        )}
      </aside>

      <TaskFormModal
        open={addingTask}
        onClose={() => setAddingTask(false)}
        entityType="lead"
        entityId={id}
        entityLabel={lead?.name}
      />
    </>
  );
}

export default LeadDrawer;
