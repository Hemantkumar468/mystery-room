import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Check, X, RotateCcw, FileDown } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { Badge, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import {
  useRecord,
  useUpdateRecord, useRecordDecision, useUndoRecordDecision,
} from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { fmtDateTime, fromNow } from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RECORD_STATUS_META, propertyNo } from './records/recordUi.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { PropertyIntelligencePanel } from '../ai/PropertyIntelligencePanel.jsx';
import { PropertyReportSheet, SectionHeader } from './PropertyReportSheet.jsx';
import { can } from '../../lib/roles.js';

export function PropertyDetailPage() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();
  const { data: record, isLoading } = useRecord(recordId);
  const { data: project } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);
  const { data: activities, isLoading: activitiesLoading } = useProjectActivity(id);
  const user = useAppSelector(selectCurrentUser);

  const stageKey = record?.stageKey;
  const update = useUpdateRecord(id, stageKey);
  const decide = useRecordDecision(id, stageKey);
  const undo = useUndoRecordDecision(id, stageKey);

  const [editing, setEditing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  /* Back goes back — to the task, the evaluation page, wherever this report
     was opened from. It used to PUSH the property list, so the browser's own
     Back then returned here, and the two screens bounced between each other.
     The list is only the fallback for a report opened in a fresh tab. */
  const { goBack: backTo } = useGoBack(`/projects/${id}/property-identification`);
  const handlePrint = () => window.print();

  if (isLoading || !record) {
    return (<><Topbar title="Property" /><div className="content"><SkPropertyDetail /></div></>);
  }

  const schema = template?.stages?.find((s) => s.key === stageKey)?.masterDataSchema || [];
  const recordNoun = project?.stages?.find((s) => s.key === stageKey)?.recordNoun || 'Property';
  const meta = RECORD_STATUS_META[record.status] || { label: record.status, color: '#7c7784' };
  const canDecide = can.decide(user?.role);
  // Mirrors DECIDED_STATUSES in record.service.js — a reviewed record's
  // values are frozen until the decision is explicitly undone.
  const decided = ['shortlisted', 'approved', 'rejected', 'archived', 'locked'].includes(record.status);
  const recordActivity = (activities || []).filter(
    (a) => a.entityType === 'record' && String(a.entityId) === String(recordId),
  );


  const doShortlist = () => decide.mutate({ id: recordId, decision: 'shortlist' });
  const doReject = (reason) => {
    decide.mutate(
      { id: recordId, decision: 'reject', reason },
      { onSuccess: () => setRejectOpen(false) },
    );
  };
  const saveEdit = async (vals, status) => {
    await update.mutateAsync({ id: recordId, values: vals, status });
    setEditing(false);
  };

  const busy = decide.isPending || undo.isPending;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3 no-print">
            <button className="btn btn-ghost btn-icon" onClick={backTo} aria-label="Back"><ArrowLeft size={16} /></button>
            {record.title || recordNoun}
          </span>
        }
        subtitle={`${propertyNo(record.seq)} · ${project?.code || ''}`}
      />


      <div className="content page-compact" style={{ background: '#F8FAFC' }}>
        {readOnly && <ReadOnlyProjectBanner />}
        {/* Action bar — screen only */}
        <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 14px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div className="row gap-3" style={{ alignItems: 'center' }}>
            <span className="pr-label" style={{ color: '#6B7280' }}>Status</span>
            <Badge color={meta.color}>{meta.label}</Badge>
          </div>
          <div className="row gap-2 wrap">
            {/* Values are frozen once a decision is on record (enforced in
                record.service.js#update) — Revert below is the way back. */}
            <button
              type="button" className="btn btn-ghost btn-sm"
              onClick={() => setEditing(true)}
              disabled={readOnly || decided}
              title={decided ? `Already ${meta.label.toLowerCase()} — use Revert first to edit` : undefined}
            >
              <Pencil size={13} /> Edit
            </button>
            {canDecide && (record.status === 'shortlisted' || record.status === 'rejected') && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => undo.mutate(recordId)} disabled={busy || readOnly}>
                <RotateCcw size={13} /> Revert
              </button>
            )}
            {canDecide && record.status === 'submitted' && (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={doShortlist} disabled={busy || readOnly}>
                  <Check size={13} /> Shortlist
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setRejectOpen(true)} disabled={busy || readOnly}>
                  <X size={13} /> Reject
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={handlePrint}>
              <FileDown size={13} /> Download PDF
            </button>
          </div>
        </div>

        {/* ─── Single continuous paper sheet ─────────────────────── */}
        <PropertyReportSheet record={record} schema={schema} />

        {/* AI Location Intelligence — advisory screening that informs the
            Shortlist/Reject decision above without ever making it. Sits outside
            the printable Property Report sheet because it is analysis about the
            property, not the captured record of it. */}
        <div style={{ maxWidth: 900, margin: '18px auto 0' }}>
          <PropertyIntelligencePanel
            recordId={recordId}
            readOnly={readOnly}
            canRun={can.capture(user?.role)}
          />
        </div>

        {/* Activity Timeline — kept separate from the printable Property Report
            and excluded from the PDF download via `no-print` (the global
            @media print rule hides anything tagged no-print). */}
        <div
          className="no-print"
          style={{ maxWidth: 900, margin: '18px auto 0', background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '22px 44px 28px' }}
        >
          <SectionHeader title="Activity Timeline" />
          {activitiesLoading ? (
            <SkeletonActivity rows={3} />
          ) : recordActivity.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
              {recordActivity.map((a) => (
                <div key={a._id} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <b>{a.actor?.name || 'System'}</b>{' '}
                      <span style={{ color: '#6B7280' }}>{a.message}</span>
                    </div>
                    <div className="pr-subtext">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="pr-empty-note">No activity yet</div>
          )}
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
