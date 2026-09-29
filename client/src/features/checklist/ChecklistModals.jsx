import { useState } from 'react';
import dayjs from 'dayjs';
import {
  CalendarDays, Check, CheckCircle2, Info, MapPin, MessageSquareWarning, Pencil, Plus, StickyNote, Trash2, X,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar } from '../../components/ui/primitives.jsx';
import { PersonPicker } from '../../components/ops/PersonPicker.jsx';
import { FileUploader } from '../../components/ops/FileUploader.jsx';
import { Segmented } from '../../components/ops/common.jsx';
import { toast } from '../../components/ops/toast.jsx';
import {
  useBranches, useChecklistAction, useChecklistRemarks, useChecklistSites, useRemoveSite, useSaveSite, useStopRoutine,
} from '../../lib/opsQueries.js';
import { FREQ_LABEL, errMsg, parseRemarkLines } from '../../lib/opsUi.js';
import { fmtDate } from '../../lib/format.js';
import { useOpsStore } from '../../store/opsStore.js';

const todayKey = () => dayjs().format('YYYY-MM-DD');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Render the body only while there is a subject, so its form state starts fresh each time. */
const withSubject = (prop, Body) =>
  function SubjectModal(props) {
    if (!props[prop]) return null;
    return <Body key={props[prop]._id || 'bulk'} {...props} />;
  };

function SubmitButton({ busy, disabled, danger, onClick, children }) {
  return (
    <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onClick} disabled={busy || disabled}>
      {busy ? <span className="spinner" /> : children}
    </button>
  );
}

/** Compact recap of the occurrence being acted on. */
function TaskBox({ task }) {
  return (
    <div className="chk-task-box">
      <div className="row gap-2">
        <span className="mono tiny subtle">{task.code}</span>
        <span className="chk-tag">{FREQ_LABEL[task.frequency] || task.frequency}</span>
      </div>
      <div className="chk-task-name" style={{ marginTop: 4 }}>{task.taskName}</div>
      <div className="chk-sub">
        <span><Avatar name={task.doer?.name} color={task.doer?.avatarColor} size={16} /> {task.doer?.name || '—'}</span>
        <span><CalendarDays size={12} /> {fmtDate(task.plannedKey || task.plannedDate)}</span>
        {task.site && <span><MapPin size={12} /> {task.site}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Complete                                                            */
/* ------------------------------------------------------------------ */

function CompleteBody({ task, onClose }) {
  const action = useChecklistAction();
  const [proof, setProof] = useState([]);
  const [remark, setRemark] = useState('');
  const needsProof = !!task.proofRequired;
  const early = task.plannedKey > todayKey();

  const submit = async () => {
    try {
      await action.mutateAsync({
        id: task._id,
        action: 'complete',
        body: { documentUrl: proof[0] || undefined, remark: remark.trim() || undefined },
      });
      toast.success(`"${task.taskName}" marked done`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Complete checklist"
      subtitle="Close this occurrence as done"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton busy={action.isPending} disabled={needsProof && !proof.length} onClick={submit}>
            <CheckCircle2 size={15} /> Mark done
          </SubmitButton>
        </>
      }
    >
      <TaskBox task={task} />
      {early && (
        <div className="chk-callout">
          <Info size={15} />
          <span>This occurrence is planned for {fmtDate(task.plannedKey)} — you are completing it ahead of schedule.</span>
        </div>
      )}
      <div className="field">
        <label className="label">
          Proof document{needsProof ? <span className="danger-text"> *</span> : <span className="subtle"> (optional)</span>}
        </label>
        <FileUploader value={proof} onChange={setProof} multiple={false} label="Upload proof" />
        {needsProof && <span className="tiny muted">This routine needs a photo or document before it can be closed.</span>}
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Remark <span className="subtle">(optional)</span></label>
        <textarea className="textarea" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Anything worth noting…" />
      </div>
    </Modal>
  );
}
export const CompleteTaskModal = withSubject('task', CompleteBody);

/* ------------------------------------------------------------------ */
/* Non-functional                                                      */
/* ------------------------------------------------------------------ */

function NonFunctionalBody({ task, onClose }) {
  const action = useChecklistAction();
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 2;

  const submit = async () => {
    if (!valid) return;
    try {
      await action.mutateAsync({ id: task._id, action: 'non-functional', body: { reason: reason.trim() } });
      toast.success('Marked non-functional');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark non-functional"
      subtitle="Close it without counting as a miss"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton busy={action.isPending} disabled={!valid} onClick={submit}>Mark non-functional</SubmitButton>
        </>
      }
    >
      <TaskBox task={task} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Reason<span className="danger-text"> *</span></label>
        <textarea
          className="textarea"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Room closed for maintenance, power outage…"
        />
      </div>
    </Modal>
  );
}
export const NonFunctionalModal = withSubject('task', NonFunctionalBody);

/* ------------------------------------------------------------------ */
/* Reopen                                                              */
/* ------------------------------------------------------------------ */

function ReopenBody({ task, onClose }) {
  const action = useChecklistAction();
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 2;
  const wasNf = task.isNonFunctional;

  const submit = async () => {
    if (!valid) return;
    try {
      await action.mutateAsync({ id: task._id, action: 'reopen', body: { reason: reason.trim() } });
      toast.success(`${task.code} reopened — back with ${task.doer?.name || 'the doer'}`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reopen checklist task"
      subtitle="Send it back for further action, correction or review"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton busy={action.isPending} disabled={!valid} onClick={submit}>Reopen task</SubmitButton>
        </>
      }
    >
      <TaskBox task={task} />
      <p className="sm muted" style={{ margin: '0 0 12px' }}>
        {wasNf ? 'The non-functional mark is cleared and the' : 'The completion is cleared and the'} occurrence goes back to <b>pending</b> for{' '}
        {task.doer?.name || 'its doer'}, who is notified. Your reason is kept in the coordinator notes.
      </p>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">What needs to be redone?<span className="danger-text"> *</span></label>
        <textarea
          className="textarea"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Photo proof is blurry, props in room 2 not reset…"
        />
      </div>
    </Modal>
  );
}
export const ReopenTaskModal = withSubject('task', ReopenBody);

/* ------------------------------------------------------------------ */
/* Reassign                                                            */
/* ------------------------------------------------------------------ */

function ReassignBody({ task, onClose }) {
  const action = useChecklistAction();
  const [doer, setDoer] = useState('');
  const [applyToFuture, setApplyToFuture] = useState(false);
  const [reason, setReason] = useState('');

  const submit = async () => {
    if (!doer) return;
    try {
      const res = await action.mutateAsync({
        id: task._id,
        action: 'reassign',
        body: { newDoerId: doer, applyToFuture, reason: reason.trim() || undefined },
      });
      const more = res?.data?.futureCount;
      toast.success(more ? `Reassigned, plus ${plural(more, 'later occurrence')}` : 'Task reassigned');
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reassign checklist"
      subtitle="Hand this occurrence to someone else"
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton busy={action.isPending} disabled={!doer} onClick={submit}>Reassign</SubmitButton>
        </>
      }
    >
      <TaskBox task={task} />
      <div className="field">
        <label className="label">New doer<span className="danger-text"> *</span></label>
        <PersonPicker value={doer} onChange={setDoer} exclude={task.doer?._id ? [task.doer._id] : []} placeholder="Pick a person…" />
      </div>
      <label className="toggle-row" style={{ marginBottom: 'var(--space-4)' }}>
        <input type="checkbox" checked={applyToFuture} onChange={(e) => setApplyToFuture(e.target.checked)} />
        <span>Also hand over all later open occurrences of this routine</span>
      </label>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">Reason <span className="subtle">(optional)</span></label>
        <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. On leave this week" />
      </div>
    </Modal>
  );
}
export const ReassignModal = withSubject('task', ReassignBody);

/* ------------------------------------------------------------------ */
/* Remarks — view one task's channels (and add, for managers)          */
/* ------------------------------------------------------------------ */

function RemarkColumn({ title, icon: Icon, lines, kind, empty }) {
  return (
    <div className={`chk-remark-col ${kind}`}>
      <div className="row gap-2 eyebrow" style={{ marginBottom: 'var(--space-2)' }}>
        <Icon size={13} /> {title} <span className="subtle">({lines.length})</span>
      </div>
      {lines.length ? (
        <div className="chk-remark-list">
          {lines.map((l, i) => (
            <div key={`${l.at}-${i}`} className="remark-line">
              {l.at && <div className="tiny subtle mono">{l.at}</div>}
              <div className="sm">{l.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sm subtle">{empty}</div>
      )}
    </div>
  );
}

const CHANNEL_OPTIONS = [
  { value: 'management', label: 'Follow-up', icon: MessageSquareWarning },
  { value: 'coordinator', label: 'Note', icon: StickyNote },
];

function RemarksBody({ task, onClose, canRemark }) {
  const remarks = useChecklistRemarks();
  const [channel, setChannel] = useState('management');
  const [text, setText] = useState('');
  const [local, setLocal] = useState({ management: [], coordinator: [] });

  const mgmt = [...local.management, ...parseRemarkLines(task.managementRemark)];
  const coord = [...local.coordinator, ...parseRemarkLines(task.coordinatorRemark)];

  const add = async () => {
    const remark = text.trim();
    if (!remark) return;
    try {
      await remarks.mutateAsync({ taskIds: [task._id], remark, channel });
      // Show it immediately; the list refetch brings the server-stamped line.
      setLocal((s) => ({ ...s, [channel]: [{ at: dayjs().format('DD/MM/YYYY HH:mm'), text: `You: ${remark}` }, ...s[channel]] }));
      setText('');
      toast.success(channel === 'management' ? 'Follow-up sent to the doer' : 'Note added');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Remarks"
      subtitle={task.followUpCount ? `${plural(task.followUpCount, 'follow-up')} so far` : 'Management follow-ups and coordinator notes'}
      width={600}
      footer={<button className="btn btn-ghost" onClick={onClose}>Close</button>}
    >
      <TaskBox task={task} />
      <RemarkColumn title="Management follow-ups" icon={MessageSquareWarning} kind="management" lines={mgmt} empty="No follow-ups yet." />
      <RemarkColumn title="Coordinator notes" icon={StickyNote} kind="coordinator" lines={coord} empty="No notes yet." />
      {canRemark && (
        <div className="form-section" style={{ marginTop: 'var(--space-5)', marginBottom: 0 }}>
          <div className="row between" style={{ marginBottom: 'var(--space-3)' }}>
            <span className="eyebrow">Add a remark</span>
            <Segmented value={channel} onChange={setChannel} options={CHANNEL_OPTIONS} />
          </div>
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={channel === 'management' ? 'Chase the doer — they get notified…' : 'Internal note, no notification…'}
          />
          <div className="row between" style={{ marginTop: 'var(--space-3)' }}>
            <span className="tiny muted">
              {channel === 'management' ? 'Counts as a follow-up and notifies the doer.' : 'Visible on the task only.'}
            </span>
            <SubmitButton busy={remarks.isPending} disabled={!text.trim()} onClick={add}>Add</SubmitButton>
          </div>
        </div>
      )}
    </Modal>
  );
}
export const TaskRemarksModal = withSubject('task', RemarksBody);

/* ------------------------------------------------------------------ */
/* Bulk remark                                                         */
/* ------------------------------------------------------------------ */

function BulkRemarkBody({ bulk, onClose, onDone }) {
  const remarks = useChecklistRemarks();
  const [text, setText] = useState('');
  const { taskIds, channel } = bulk;
  const isMgmt = channel === 'management';

  const submit = async () => {
    const remark = text.trim();
    if (!remark) return;
    try {
      const res = await remarks.mutateAsync({ taskIds, remark, channel });
      const n = res?.data?.updated ?? taskIds.length;
      toast.success(`${isMgmt ? 'Follow-up' : 'Note'} added to ${plural(n, 'task')}`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isMgmt ? 'Add follow-up' : 'Add note'}
      subtitle={`Applies to ${plural(taskIds.length, 'selected task')}`}
      width={520}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <SubmitButton busy={remarks.isPending} disabled={!text.trim()} onClick={submit}>
            {isMgmt ? 'Send follow-up' : 'Add note'}
          </SubmitButton>
        </>
      }
    >
      <div className={`chk-callout ${isMgmt ? 'warn' : ''}`}>
        {isMgmt ? <MessageSquareWarning size={15} /> : <StickyNote size={15} />}
        <span>
          {isMgmt
            ? 'A management follow-up is logged on each task, bumps its follow-up count and notifies the doers.'
            : 'A coordinator note is logged on each task without notifying anyone.'}
        </span>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label">{isMgmt ? 'Follow-up' : 'Note'}<span className="danger-text"> *</span></label>
        <textarea className="textarea" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </Modal>
  );
}
export const BulkRemarkModal = withSubject('bulk', BulkRemarkBody);

/* ------------------------------------------------------------------ */
/* Stop routine                                                        */
/* ------------------------------------------------------------------ */

function StopRoutineBody({ routine, onClose }) {
  const stop = useStopRoutine();
  const submit = async () => {
    try {
      await stop.mutateAsync(routine._id);
      toast.success(`Routine ${routine.code} stopped`);
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Stop routine?"
      subtitle={`${routine.code} · ${routine.taskName}`}
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Keep running</button>
          <SubmitButton danger busy={stop.isPending} onClick={submit}>Stop routine</SubmitButton>
        </>
      }
    >
      <div className="chk-callout danger">
        <Info size={15} />
        <span>
          All open future occurrences are removed. Completed, missed and non-functional history stays in the reports.
        </span>
      </div>
      <p className="sm muted" style={{ margin: 0 }}>
        {routine.doer?.name ? `${routine.doer.name} will stop receiving this checklist.` : 'The doer will stop receiving this checklist.'}
      </p>
    </Modal>
  );
}
export const StopRoutineModal = withSubject('routine', StopRoutineBody);

/* ------------------------------------------------------------------ */
/* Sites manager                                                       */
/* ------------------------------------------------------------------ */

function SiteRow({ site, branchName }) {
  const save = useSaveSite();
  const remove = useRemoveSite();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [confirm, setConfirm] = useState(false);

  const rename = async () => {
    const next = name.trim();
    if (!next || next === site.name) {
      setEditing(false);
      setName(site.name);
      return;
    }
    try {
      const res = await save.mutateAsync({ _id: site._id, name: next });
      const touched = (res?.data?.tasks || 0) + (res?.data?.masters || 0);
      toast.success(touched ? `Renamed — ${plural(touched, 'record')} updated` : 'Site renamed');
      setEditing(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const drop = async () => {
    try {
      await remove.mutateAsync(site._id);
      toast.success(`"${site.name}" removed`);
    } catch (e) {
      toast.error(errMsg(e));
      setConfirm(false);
    }
  };

  if (editing) {
    return (
      <div className="chk-site-row">
        <input
          className="input grow"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rename();
            if (e.key === 'Escape') {
              setEditing(false);
              setName(site.name);
            }
          }}
        />
        <button className="btn btn-primary btn-sm btn-icon" title="Save" onClick={rename} disabled={save.isPending}>
          {save.isPending ? <span className="spinner" /> : <Check size={14} />}
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" title="Cancel" onClick={() => { setEditing(false); setName(site.name); }}>
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="chk-site-row">
      <MapPin size={14} className="subtle" />
      <span className="grow truncate" style={{ fontWeight: 600 }}>{site.name}</span>
      {branchName && <span className="tiny subtle nowrap">{branchName}</span>}
      {confirm ? (
        <>
          <span className="tiny danger-text nowrap">Remove?</span>
          <button className="btn btn-danger btn-sm" onClick={drop} disabled={remove.isPending}>
            {remove.isPending ? <span className="spinner" /> : 'Remove'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>No</button>
        </>
      ) : (
        <>
          <button className="btn btn-ghost btn-sm btn-icon" title="Rename" onClick={() => setEditing(true)}><Pencil size={14} /></button>
          <button className="btn btn-ghost btn-sm btn-icon" title="Remove" onClick={() => setConfirm(true)}><Trash2 size={14} /></button>
        </>
      )}
    </div>
  );
}

export function SitesManagerModal({ open, onClose }) {
  const branch = useOpsStore((s) => s.branch);
  const { data, isLoading } = useChecklistSites({ branch: branch || undefined });
  const { data: branchData } = useBranches();
  const save = useSaveSite();
  const [name, setName] = useState('');

  const managed = data?.managed || [];
  const managedNames = new Set(managed.map((s) => s.name));
  const unmanaged = (data?.sites || []).filter((s) => !managedNames.has(s));
  const branchName = Object.fromEntries((branchData?.data || []).map((b) => [b._id, b.name]));
  const showBranch = branch === 'all';

  const add = async (value) => {
    const next = (value ?? name).trim();
    if (!next) return;
    try {
      await save.mutateAsync({ name: next, branch: branch && branch !== 'all' ? branch : undefined });
      toast.success(`"${next}" added`);
      if (value === undefined) setName('');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sites"
      subtitle="Rooms and areas checklists are carried out in"
      width={560}
      footer={<button className="btn btn-ghost" onClick={onClose}>Done</button>}
    >
      <div className="row gap-2" style={{ marginBottom: 'var(--space-4)' }}>
        <input
          className="input grow"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="e.g. Room 3 — The Asylum, Reception & Lobby"
        />
        <button className="btn btn-primary nowrap" onClick={() => add()} disabled={!name.trim() || save.isPending}>
          <Plus size={15} /> Add
        </button>
      </div>

      {isLoading ? (
        <div className="row gap-2 muted"><span className="spinner" /> Loading sites…</div>
      ) : managed.length ? (
        managed.map((s) => <SiteRow key={s._id} site={s} branchName={showBranch ? branchName[s.branch] : null} />)
      ) : (
        <div className="empty sm" style={{ padding: 'var(--space-5)' }}>No managed sites yet — add the rooms and areas of this outlet.</div>
      )}

      {unmanaged.length > 0 && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Used by checklists but not in the list</div>
          <div className="row gap-2 wrap">
            {unmanaged.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => add(s)} title="Add to the managed list" disabled={save.isPending}>
                <Plus size={12} /> {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default SitesManagerModal;
