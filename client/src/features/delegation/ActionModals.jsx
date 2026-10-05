import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import { AlertTriangle, CalendarClock, GitBranch } from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { FileUploader } from '../../components/ops/FileUploader.jsx';
import { toast } from '../../components/ops/toast.jsx';
import { useDelegationAction, useSaveReminders } from '../../lib/opsQueries.js';
import { DLG_STATUS_META, errMsg } from '../../lib/opsUi.js';
import { fmtDate } from '../../lib/format.js';
import { RemindersEditor } from './RemindersEditor.jsx';
import { TimePicker } from '../../components/ui/TimePicker.jsx';

dayjs.extend(isoWeek);

/** Shared footer + submit plumbing for every lifecycle modal. */
function useAction(task, onDone) {
  const act = useDelegationAction();
  const run = async (action, body, success) => {
    try {
      const res = await act.mutateAsync({ id: task._id, action, body });
      toast.success(success);
      onDone?.(res);
      return res;
    } catch (e) {
      toast.error(errMsg(e));
      return null;
    }
  };
  return { run, busy: act.isPending };
}

const Footer = ({ onClose, onSubmit, busy, disabled, label, danger }) => (
  <>
    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
    <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onSubmit} disabled={busy || disabled}>
      {busy ? <span className="spinner" /> : label}
    </button>
  </>
);

/* ------------------------------------------------------------------ */
/* Complete / submit for verification                                  */
/* ------------------------------------------------------------------ */

export function CompleteModal({ task, open, onClose, onDone }) {
  const [evidence, setEvidence] = useState([]);
  const [remark, setRemark] = useState('');
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) { setEvidence([]); setRemark(''); } }, [open]);
  if (!task) return null;

  const needsProof = task.evidenceRequired && !(task.evidenceUrls?.length) && !evidence.length;
  const openItems = (task.checklistItems || []).filter((c) => !c.completed).length;
  const verify = task.verificationRequired;

  const submit = async () => {
    const res = await run('complete', { evidenceUrls: evidence, remark: remark.trim() || undefined }, verify ? 'Submitted for verification' : 'Task completed');
    if (res) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={verify ? 'Submit for verification' : 'Mark as completed'}
      subtitle={`${task.code} · ${task.title}`}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={needsProof || openItems > 0} label={verify ? 'Submit' : 'Complete'} />}
    >
      {openItems > 0 && (
        <div className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)', marginBottom: 12 }}>
          <AlertTriangle size={13} /> Tick the remaining {openItems} checklist item(s) first
        </div>
      )}
      {verify && <p className="sm muted" style={{ marginBottom: 12 }}>The assigner will verify your work and either approve it or send it back.</p>}
      <div className="field">
        <label className="label">Proof of completion {task.evidenceRequired && <span className="danger-text">*</span>}</label>
        {task.evidenceUrls?.length > 0 && <span className="tiny muted">{task.evidenceUrls.length} file(s) already attached</span>}
        <FileUploader value={evidence} onChange={setEvidence} label="Upload photos / documents" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Closing remark</label>
        <textarea className="textarea" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="What was done?" />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Change the due date (server decides revise vs shift)                */
/* ------------------------------------------------------------------ */

export function ReviseDateModal({ task, open, onClose, onDone }) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState([]);
  const { run, busy } = useAction(task, onDone);

  useEffect(() => {
    if (open && task) {
      setDate(task.dueDate ? dayjs(task.dueDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'));
      setTime('');
      setReason('');
      setEvidence([]);
    }
  }, [open, task]);

  const outcome = useMemo(() => {
    if (!task || !date) return null;
    if (!task.dueDate) return { kind: 'initial', text: 'This sets the first deadline.' };
    const same = dayjs(task.dueDate).isoWeek() === dayjs(date).isoWeek() && dayjs(task.dueDate).isoWeekYear() === dayjs(date).isoWeekYear();
    const used = (task.revision1 ? 1 : 0) + (task.revision2 ? 1 : 0);
    if (same) {
      return used >= 2
        ? { kind: 'blocked', text: 'Both same-week revisions are used. Pick a date in another week — that shifts the task.' }
        : { kind: 'revise', text: `Same week — uses revision ${used + 1} of 2.` };
    }
    return { kind: 'shift', text: `Different week — ${task.code} closes as Shifted and a fresh copy opens for ${fmtDate(date)}.` };
  }, [task, date]);

  if (!task) return null;
  const submit = async () => {
    const newDate = time ? dayjs(`${date}T${time}`).toISOString() : date;
    const res = await run('due-date', { newDate, reason: reason.trim(), evidenceUrl: evidence[0] }, 'Deadline updated');
    if (res) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change the deadline"
      subtitle={`${task.code} · currently ${task.dueDate ? fmtDate(task.dueDate) : 'not set'}`}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={!reason.trim() || !date || outcome?.kind === 'blocked'} label="Save new date" />}
    >
      <div className="row gap-2">
        <div className="field grow">
          <label className="label">New due date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ width: 140 }}>
          <label className="label">Time (optional)</label>
          <TimePicker ariaLabel="Time" value={time} onChange={setTime} />
        </div>
      </div>
      {outcome && (
        <div
          className="row gap-2 sm"
          style={{
            padding: '10px 12px',
            borderRadius: 'var(--radius)',
            marginBottom: 'var(--space-4)',
            background: outcome.kind === 'blocked' ? 'var(--danger-soft)' : outcome.kind === 'shift' ? 'var(--primary-soft)' : 'var(--surface-hover)',
            color: outcome.kind === 'blocked' ? 'var(--danger)' : 'var(--text)',
          }}
        >
          {outcome.kind === 'shift' ? <GitBranch size={15} /> : <CalendarClock size={15} />} {outcome.text}
        </div>
      )}
      <div className="field">
        <label className="label">Reason <span className="danger-text">*</span></label>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the date moving?" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Supporting document (optional)</label>
        <FileUploader multiple={false} value={evidence} onChange={setEvidence} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Dependent on others (pre-start)                                     */
/* ------------------------------------------------------------------ */

export function DependentModal({ task, open, onClose, onDone }) {
  const [f, setF] = useState({});
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) setF({ personId: '', dependentOnTask: '', pendingApproval: '', requiredTeam: '', remark: '' }); }, [open]);
  if (!task) return null;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const anything = f.personId || f.dependentOnTask?.trim() || f.pendingApproval?.trim() || f.requiredTeam?.trim();

  const submit = async () => {
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v && String(v).trim()));
    const res = await run('dependent', body, f.personId ? 'Handed over to the person it depends on' : 'Marked as dependent');
    if (res) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dependent on others"
      subtitle="You can't start until something else happens"
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={!anything || !f.remark?.trim()} label="Save dependency" />}
    >
      <div className="field">
        <label className="label">Depends on a person</label>
        <PersonPicker value={f.personId} onChange={(personId) => set({ personId })} exclude={[task.doer?._id]} placeholder="Optional — the task moves to them to accept" />
        {f.personId && <span className="tiny muted">The task will be handed to this person (you stay in the loop).</span>}
      </div>
      <div className="form-grid">
        <div className="field">
          <label className="label">Depends on task</label>
          <input className="input" value={f.dependentOnTask} onChange={(e) => set({ dependentOnTask: e.target.value })} placeholder="e.g. DLG-000120 electrical wiring" />
        </div>
        <div className="field">
          <label className="label">Pending approval</label>
          <input className="input" value={f.pendingApproval} onChange={(e) => set({ pendingApproval: e.target.value })} placeholder="e.g. Landlord NOC" />
        </div>
        <div className="field span-2">
          <label className="label">Team / department needed</label>
          <input className="input" value={f.requiredTeam} onChange={(e) => set({ requiredTeam: e.target.value })} placeholder="e.g. Finance" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Remark <span className="danger-text">*</span></label>
        <textarea className="textarea" value={f.remark} onChange={(e) => set({ remark: e.target.value })} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Blocked by (mid-work)                                               */
/* ------------------------------------------------------------------ */

export function BlockedModal({ task, open, onClose, onDone }) {
  const [f, setF] = useState({});
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) setF({ person: '', department: '', vendor: '', consultant: '', reason: '' }); }, [open]);
  if (!task) return null;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const anyone = ['person', 'department', 'vendor', 'consultant'].some((k) => f[k]?.trim());
  const submit = async () => {
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v && v.trim()));
    const res = await run('blocked', body, 'Task flagged as blocked');
    if (res) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Blocked by"
      subtitle="Who or what is holding this up?"
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={!anyone || !f.reason?.trim()} label="Flag as blocked" danger />}
    >
      <div className="form-grid">
        {[
          ['person', 'Person'],
          ['department', 'Department'],
          ['vendor', 'Vendor'],
          ['consultant', 'Consultant'],
        ].map(([k, label]) => (
          <div className="field" key={k}>
            <label className="label">{label}</label>
            <input className="input" value={f[k] || ''} onChange={(e) => set({ [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Reason <span className="danger-text">*</span></label>
        <textarea className="textarea" value={f.reason || ''} onChange={(e) => set({ reason: e.target.value })} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Reassign                                                            */
/* ------------------------------------------------------------------ */

export function ReassignModal({ task, open, onClose, onDone }) {
  const [who, setWho] = useState('');
  const [reason, setReason] = useState('');
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) { setWho(''); setReason(''); } }, [open]);
  if (!task) return null;
  const submit = async () => {
    const res = await run('reassign', { newDoerId: who, reason: reason.trim() || undefined }, 'Task reassigned');
    if (res) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reassign task"
      subtitle={`Currently with ${task.doer?.name || '—'} — they'll stay in the loop`}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={!who} label="Reassign" />}
    >
      <div className="field">
        <label className="label">New owner</label>
        <PersonPicker value={who} onChange={setWho} exclude={[task.doer?._id]} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Reason</label>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Management follow-up / coordinator note                             */
/* ------------------------------------------------------------------ */

export function ChannelRemarkModal({ task, channel, open, onClose, onDone, canSetStatus }) {
  const [remark, setRemark] = useState('');
  const [status, setStatus] = useState('');
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) { setRemark(''); setStatus(''); } }, [open]);
  if (!task) return null;
  const mgmt = channel === 'management';
  const submit = async () => {
    const body = { remark: remark.trim(), ...(status ? { status } : {}) };
    const res = await run(mgmt ? 'management-remark' : 'coordinator-note', body, mgmt ? 'Follow-up recorded' : 'Note added');
    if (res) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mgmt ? 'Management follow-up' : 'Coordinator note'}
      subtitle={mgmt ? 'A chase — counts towards the follow-up score' : 'An informational note on the task'}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} disabled={!remark.trim()} label="Add" />}
    >
      <div className="field">
        <label className="label">Remark <span className="danger-text">*</span></label>
        <textarea className="textarea" autoFocus value={remark} onChange={(e) => setRemark(e.target.value)} />
      </div>
      {mgmt && canSetStatus && (
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="label">Also change status (optional)</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Keep {DLG_STATUS_META[task.status]?.label}</option>
            {['pending', 'accepted', 'in_progress', 'blocked', 'dependent'].filter((s) => s !== task.status).map((s) => (
              <option key={s} value={s}>{DLG_STATUS_META[s].label}</option>
            ))}
          </select>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Coordinator follow-up call                                          */
/* ------------------------------------------------------------------ */

export function FollowupModal({ task, open, onClose, onDone }) {
  const [f, setF] = useState({});
  const { run, busy } = useAction(task, onDone);
  useEffect(() => { if (open) setF({ callStatus: 'connected', observedStatus: '', response: '', systemUpdated: '', nextFollowUpDate: '', escalationRequired: false }); }, [open]);
  if (!task) return null;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const submit = async () => {
    const body = {
      callStatus: f.callStatus,
      ...(f.observedStatus ? { observedStatus: f.observedStatus } : {}),
      ...(f.response.trim() ? { response: f.response.trim() } : {}),
      ...(f.systemUpdated ? { systemUpdated: f.systemUpdated === 'yes' } : {}),
      ...(f.nextFollowUpDate ? { nextFollowUpDate: f.nextFollowUpDate } : {}),
      escalationRequired: f.escalationRequired,
    };
    const res = await run('followups', body, 'Follow-up logged');
    if (res) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log a follow-up call"
      subtitle={`Called ${task.doer?.name || 'the doer'} about ${task.code}`}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={busy} label="Log call" />}
    >
      <div className="form-grid">
        <div className="field">
          <label className="label">Call</label>
          <select className="select" value={f.callStatus} onChange={(e) => set({ callStatus: e.target.value })}>
            <option value="connected">Connected</option>
            <option value="not_connected">Not connected</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Status they reported</label>
          <select className="select" value={f.observedStatus} onChange={(e) => set({ observedStatus: e.target.value })}>
            <option value="">—</option>
            {['Not started', 'In progress', 'Almost done', 'Done — not updated', 'Blocked'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Updated in the ERP?</label>
          <select className="select" value={f.systemUpdated} onChange={(e) => set({ systemUpdated: e.target.value })}>
            <option value="">—</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="field">
          <label className="label">Next follow-up</label>
          <input className="input" type="date" value={f.nextFollowUpDate} onChange={(e) => set({ nextFollowUpDate: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label className="label">What they said</label>
        <textarea className="textarea" value={f.response} onChange={(e) => set({ response: e.target.value })} />
      </div>
      <label className="toggle-row">
        <input type="checkbox" checked={f.escalationRequired} onChange={(e) => set({ escalationRequired: e.target.checked })} />
        Needs escalation — alert the assigner
      </label>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

export function RemindersModal({ task, open, onClose }) {
  const [rows, setRows] = useState([]);
  const save = useSaveReminders();
  useEffect(() => {
    if (open && task) {
      setRows((task.reminders || []).filter((r) => !r.sentAt).map(({ value, unit, trigger, channel }) => ({ value, unit, trigger, channel })));
    }
  }, [open, task]);
  if (!task) return null;
  const submit = async () => {
    try {
      await save.mutateAsync({ id: task._id, reminders: rows });
      toast.success('Reminders saved');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reminders"
      subtitle={`Relative to the due date · ${task.dueDate ? fmtDate(task.dueDate) : 'no due date'}`}
      width={640}
      footer={<Footer onClose={onClose} onSubmit={submit} busy={save.isPending} label="Save reminders" />}
    >
      <RemindersEditor value={rows} onChange={setRows} />
    </Modal>
  );
}
