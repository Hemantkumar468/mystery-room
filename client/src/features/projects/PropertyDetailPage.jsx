import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Check, X, RotateCcw } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import {
  useRecord, useProject, useTemplate, useProjectActivity,
  useUpdateRecord, useRecordDecision, useUndoRecordDecision,
} from '../../lib/queries.js';
import { fmtDate, fmtDateTime, fromNow, fmtCurrency } from '../../lib/format.js';
import { useAuthStore } from '../../store/authStore.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RECORD_STATUS_META, propertyNo } from './records/recordUi.js';

function groupBySection(schema) {
  const ordered = [...schema].sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  const map = new Map();
  for (const f of ordered) {
    const title = f.section || 'Details';
    if (!map.has(title)) {
      const g = { title, fields: [] };
      map.set(title, g);
      out.push(g);
    }
    map.get(title).fields.push(f);
  }
  return out;
}

function MediaThumb({ item }) {
  const isImg = (item.mimetype || '').startsWith('image/') || item.resourceType === 'image';
  const isVid = (item.mimetype || '').startsWith('video/') || item.resourceType === 'video';
  if (isImg) {
    return (
      <a href={item.url} target="_blank" rel="noreferrer">
        <img src={item.url} alt={item.originalName} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6 }} />
      </a>
    );
  }
  if (isVid) {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video src={item.url} controls style={{ width: 120, height: 66, borderRadius: 6, background: '#000' }} />;
  }
  return <a className="sm" href={item.url} target="_blank" rel="noreferrer">📄 {item.originalName || 'file'}</a>;
}

function FieldValue({ field, value }) {
  const empty = value == null || value === '' || (Array.isArray(value) && !value.length);
  if (empty) return <span className="sm" style={{ color: 'var(--text-muted)' }}>—</span>;
  switch (field.type) {
    case 'currency':
      return <span className="sm">{fmtCurrency(Number(value) || 0)}</span>;
    case 'date':
      return <span className="sm">{fmtDate(value)}</span>;
    case 'boolean':
      return <span className="sm">{value === true || value === 'true' ? 'Yes' : 'No'}</span>;
    case 'location': {
      const href = value.mapUrl || (value.lat != null ? `https://www.google.com/maps?q=${value.lat},${value.lng}` : null);
      return href
        ? <a className="sm" href={href} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>📍 Open in Google Maps</a>
        : <span className="sm">—</span>;
    }
    case 'file': {
      const items = Array.isArray(value) ? value : [value];
      return <div className="row gap-2 wrap">{items.map((it, i) => <MediaThumb key={it.publicId || i} item={it} />)}</div>;
    }
    case 'multiselect':
      return <span className="sm">{Array.isArray(value) ? value.join(', ') : String(value)}</span>;
    default:
      return <span className="sm" style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</span>;
  }
}

function AuditRow({ label, who, when, extra }) {
  if (!who && !when) return null;
  return (
    <div className="col gap-1" style={{ minWidth: 150 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650 }}>{who?.name || '—'}</span>
      <span className="tiny muted">{when ? fmtDateTime(when) : ''}</span>
      {extra && <span className="tiny" style={{ color: 'var(--danger)' }}>{extra}</span>}
    </div>
  );
}

export function PropertyDetailPage() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();
  const { data: record, isLoading } = useRecord(recordId);
  const { data: project } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);
  const user = useAuthStore((s) => s.user);

  const stageKey = record?.stageKey;
  const update = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const undo = useUndoRecordDecision(id, stageKey);

  const [editing, setEditing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const backTo = () => navigate(`/projects/${id}/property-identification`);

  if (isLoading || !record) {
    return (<><Topbar title="Property" /><div className="content"><SkPropertyDetail /></div></>);
  }

  const schema = template?.stages?.find((s) => s.key === stageKey)?.masterDataSchema || [];
  const recordNoun = project?.stages?.find((s) => s.key === stageKey)?.recordNoun || 'Property';
  const meta = RECORD_STATUS_META[record.status] || { label: record.status, color: '#7c7784' };
  const values = record.values || {};
  const sections = groupBySection(schema);
  const canDecide = user?.role === 'admin' || user?.role === 'manager';
  const recordActivity = (activities || []).filter(
    (a) => a.entityType === 'record' && String(a.entityId) === String(recordId),
  );

  // This page only ever renders Phase 1 property records — they become
  // eligible for Site Evaluation by reaching 'shortlisted', not 'approved'
  // ('approved' is reserved for later-stage assessment records).
  const doShortlist = () => decide.mutate({ id: recordId, decision: 'shortlist' });
  const doReject = (reason) => {
    decide.mutate(
      { id: recordId, decision: 'reject', reason },
      { onSuccess: () => setRejectOpen(false) },
    );
  };
  const saveEdit = (vals, status) =>
    update.mutate({ id: recordId, values: vals, status }, { onSuccess: () => setEditing(false) });

  const busy = decide.isPending || undo.isPending;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={backTo} aria-label="Back"><ArrowLeft size={16} /></button>
            {record.title || recordNoun}
          </span>
        }
        subtitle={`${propertyNo(record.seq)} · ${project?.code || ''}`}
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {/* Status + actions */}
          <div className="card card-pad row between wrap gap-3">
            <div className="row gap-3">
              <span className="tiny subtle upper">Status</span>
              <Badge color={meta.color}>{meta.label}</Badge>
            </div>
            <div className="row gap-2 wrap">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                <Pencil size={14} /> Edit
              </button>
              {canDecide && record.status === 'submitted' && (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={doShortlist} disabled={busy}>
                    <Check size={14} /> Shortlist
                  </button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setRejectOpen(true)} disabled={busy}>
                    <X size={14} /> Reject
                  </button>
                </>
              )}
              {canDecide && (record.status === 'shortlisted' || record.status === 'rejected') && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => undo.mutate(recordId)} disabled={busy}>
                  <RotateCcw size={14} /> Revert to Submitted
                </button>
              )}
            </div>
          </div>

          {/* Audit information */}
          <SectionCard title="Audit">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
              <AuditRow label="Created By" who={record.createdBy} when={record.createdAt} />
              <AuditRow label="Last Updated By" who={record.updatedBy} when={record.updatedAt} />
              <AuditRow label="Submitted By" who={record.submittedBy} when={record.submittedAt} />
              <AuditRow label="Shortlisted By" who={record.shortlistedBy} when={record.shortlistedAt} />
              <AuditRow label="Approved By" who={record.approvedBy} when={record.approvedAt} />
              <AuditRow label="Rejected By" who={record.rejectedBy} when={record.rejectedAt} extra={record.rejectReason ? `Reason: ${record.rejectReason}` : null} />
            </div>
          </SectionCard>

          {/* Read-only sections from the schema */}
          {sections.map((section) => (
            <SectionCard key={section.title} title={section.title}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
                {section.fields.map((f) => (
                  <div key={f.key} className="col gap-1">
                    <span className="tiny subtle upper">{f.label}</span>
                    <FieldValue field={f} value={values[f.key]} />
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}

          {/* Activity Timeline */}
          <SectionCard title="Activity Timeline">
            {activitiesLoading ? (
              <SkeletonActivity rows={3} />
            ) : recordActivity.length ? (
              <div className="col gap-4">
                {recordActivity.map((a) => (
                  <div key={a._id} className="row gap-3">
                    <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                    <div className="col grow">
                      <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
                      <div className="tiny muted">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty sm" style={{ padding: '16px 12px' }}>No activity yet</div>
            )}
          </SectionCard>
        </div>
      </div>

      {editing && (
        <RecordFormModal
          open
          onClose={() => setEditing(false)}
          schema={schema}
          recordNoun={recordNoun}
          recordNo={propertyNo(record.seq)}
          initialValues={record.values}
          saving={update.isPending}
          loading={templateLoading}
          onSaveDraft={({ values: v }) => saveEdit(v, 'draft')}
          onSubmit={({ values: v }) => saveEdit(v, 'submitted')}
        />
      )}

      <RejectDialog
        open={rejectOpen}
        title={`Reject ${recordNoun}`}
        onClose={() => setRejectOpen(false)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this property being rejected?"
      />
    </>
  );
}

export default PropertyDetailPage;
