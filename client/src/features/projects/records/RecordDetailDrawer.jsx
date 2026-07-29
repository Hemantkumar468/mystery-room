import { useEffect, useState } from 'react';
import { Check, X, Undo2, Pencil, Trash2, Paperclip } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal.jsx';
import { Avatar, Badge } from '../../../components/ui/primitives.jsx';
import {
  useRecordDecision,
  useUndoRecordDecision,
  useDeleteRecord,
} from '../../../app/api/recordsApi.js';
import { fmtDate, fromNow } from '../../../lib/format.js';
import { RECORD_STATUS_META, formatFieldValue, isEmptyValue } from './recordUi.js';

const DECIDED = ['shortlisted', 'rejected', 'approved', 'locked'];
const isLink = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

function ValueCell({ field, value }) {
  if (field.type === 'file' && !isEmptyValue(value)) {
    return isLink(value)
      ? <a className="sm" href={value} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', wordBreak: 'break-all' }}><Paperclip size={12} /> {value}</a>
      : <span className="sm row gap-1" style={{ fontWeight: 650 }}><Paperclip size={12} /> {value}</span>;
  }
  const text = formatFieldValue(field, value);
  const missing = text === '—';
  return (
    <span className="sm" style={{ color: missing ? 'var(--text-muted)' : 'var(--text)', fontWeight: missing ? 500 : 650 }}>
      {text}
    </span>
  );
}

/**
 * Read-only detail for one record + the manager decision controls
 * (shortlist / reject with reason / undo / delete).
 */
export function RecordDetailDrawer({
  open, onClose, record, schema, recordNoun = 'Record', projectId, stageKey, canDecide, onEdit,
}) {
  const decide = useRecordDecision(projectId, stageKey);
  const undo = useUndoRecordDecision(projectId, stageKey);
  const del = useDeleteRecord(projectId, stageKey);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const pending = decide.isPending || undo.isPending || del.isPending;

  useEffect(() => {
    if (open) { setRejecting(false); setReason(''); }
  }, [open, record]);

  if (!record) return null;

  const meta = RECORD_STATUS_META[record.status] || { label: record.status, color: '#7c7784' };
  const decided = DECIDED.includes(record.status);
  const ordered = [...(schema || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const runDecision = async (decision) => {
    await decide.mutateAsync({ id: record._id, decision });
  };
  const confirmReject = async () => {
    await decide.mutateAsync({ id: record._id, decision: 'reject', reason: reason.trim() || undefined });
    setRejecting(false);
  };
  const runUndo = async () => { await undo.mutateAsync(record._id); };
  const runDelete = async () => {
    await del.mutateAsync(record._id);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={record.title || recordNoun}
      subtitle={`${recordNoun} · captured ${fromNow(record.createdAt)}`}
      width={760}
      footer={
        <div className="row between grow gap-3 wrap">
          <div className="row gap-2">
            {onEdit && (
              <button className="btn btn-ghost btn-sm" onClick={() => onEdit(record)} disabled={pending}>
                <Pencil size={14} /> Edit
              </button>
            )}
            {canDecide && (
              <button className="btn btn-ghost btn-sm" onClick={runDelete} disabled={pending} style={{ color: 'var(--danger)' }}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
          {canDecide && (
            <div className="row gap-2">
              {decided && (
                <button className="btn btn-secondary btn-sm" onClick={runUndo} disabled={pending}>
                  <Undo2 size={14} /> Undo
                </button>
              )}
              {record.status !== 'rejected' && (
                <button className="btn btn-ghost btn-sm" onClick={() => setRejecting((v) => !v)} disabled={pending} style={{ color: 'var(--danger)' }}>
                  <X size={14} /> Reject
                </button>
              )}
              {record.status !== 'shortlisted' && (
                <button className="btn btn-primary btn-sm" onClick={() => runDecision('shortlist')} disabled={pending} style={{ background: '#10b981', borderColor: '#10b981' }}>
                  <Check size={14} /> Shortlist
                </button>
              )}
            </div>
          )}
        </div>
      }
    >
      <div className="col gap-4">
        <div className="row between wrap gap-3">
          <div className="col gap-1">
            <span className="tiny subtle upper">Status</span>
            <Badge color={meta.color} soft={meta.soft}>{meta.label}</Badge>
          </div>
          {record.decidedBy && (
            <div className="col gap-1" style={{ alignItems: 'flex-end' }}>
              <span className="tiny subtle upper">Decision by</span>
              <span className="row gap-2">
                <Avatar name={record.decidedBy.name} color={record.decidedBy.avatarColor} size={22} />
                <span className="sm" style={{ fontWeight: 650 }}>{record.decidedBy.name}</span>
                <span className="tiny muted">{fmtDate(record.decidedAt)}</span>
              </span>
            </div>
          )}
        </div>

        {record.decisionReason && (
          <div className="sm" style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span className="tiny subtle upper">Reason</span>
            <div style={{ marginTop: 2 }}>{record.decisionReason}</div>
          </div>
        )}

        {rejecting && (
          <div className="col gap-2" style={{ padding: 12, borderRadius: 8, border: '1px solid var(--danger)', background: 'var(--danger-soft)' }}>
            <label className="label" style={{ color: 'var(--danger)' }}>Reason for rejection</label>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this property being rejected?" />
            <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setRejecting(false)} disabled={pending}>Cancel</button>
              <button className="btn btn-sm" onClick={confirmReject} disabled={pending} style={{ background: 'var(--danger)', color: '#fff' }}>Confirm reject</button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
          {ordered.map((f) => (
            <div key={f.key} className="col gap-1" style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <span className="tiny subtle upper">{f.label}</span>
              <ValueCell field={f} value={record.values?.[f.key]} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default RecordDetailDrawer;
