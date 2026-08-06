import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown, Pencil } from 'lucide-react';
import { isValidId } from '../../lib/id.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useRecordDecision } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { groupBySection, isVisible } from './records/RecordFormModal.jsx';
import { DynamicField } from './records/DynamicField.jsx';
import { RejectDialog } from './records/RejectDialog.jsx';
import { RECORD_STATUS_META } from './records/recordUi.js';
import { can } from '../../lib/roles.js';

/**
 * Commercial Finalization's per-record report page — Phase 3's equivalent of
 * Site Evaluation's AssessmentReportPage.jsx, same two-column shape (details
 * left, Activity History + Report Summary right), but with two differences
 * the p3 workflow actually needs:
 *  - Approve/Reject live here (p2 has none — decisions there are property-
 *    level; p3's decisions are per-record and Phase 4's own eligibility
 *    depends on them, see CommercialFinalizationPage.jsx).
 *  - No fabricated score/priority — p3's six modules (LOI/Lease/Legal/
 *    Deposit/NOC/Approvals) aren't scored the way p2's feasibility/financial
 *    were. Report Summary instead surfaces the record's own field values.
 * Field rendering reuses `groupBySection`/`isVisible` (exported from
 * RecordFormModal.jsx) + `DynamicField` in read-only mode — the same render
 * path the create/edit form already uses, so a value can never look
 * different here than it did when submitted, and file fields get their
 * existing thumbnail/preview/download rendering for free instead of a
 * second, independent attachment-tab viewer.
 */
export function CommercialRecordReportPage() {
  const { id, recordId } = useParams();
  const navigate = useNavigate();
  const stageKey = 'p3';

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: record, isLoading: recordLoading } = useRecord(recordId, { enabled: isValidId(recordId) });
  const { data: property } = useRecord(record?.parentRecordId, { enabled: isValidId(record?.parentRecordId) });
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId, { enabled: isValidId(templateId) });
  const { data: activities } = useProjectActivity(id);

  const decide = useRecordDecision(id, stageKey);
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const [rejectOpen, setRejectOpen] = useState(false);

  if (projectLoading || recordLoading || !record) {
    return (
      <>
        <Topbar title="Commercial Record Report" />
        <div className="content"><SkDetail /></div>
      </>
    );
  }

  const stage = template?.stages?.find((s) => s.key === stageKey);
  const type = stage?.assessmentTypes?.find((t) => t.key === record.assessmentType);
  const title = type ? `${type.name} Report` : 'Commercial Record Report';
  const meta = RECORD_STATUS_META[record.status] || { label: record.status, color: '#6B7280', soft: '#F3F4F6' };
  const sections = groupBySection(type?.masterDataSchema || []);

  const recordActivities = (activities || [])
    .filter((a) => a.meta?.recordId === recordId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // A handful of the record's own filled-in field values — real facts, not a
  // fabricated score, so the sidebar stays honest for every module type
  // without per-type special-casing.
  const keyFacts = (type?.masterDataSchema || [])
    .filter((f) => f.type !== 'file' && f.type !== 'textarea' && isVisible(f, record.values || {}))
    .filter((f) => record.values?.[f.key] != null && record.values[f.key] !== '')
    .slice(0, 5);

  const handleBack = () => navigate(-1);
  const handleEdit = () => navigate('/projects/' + id + '/commercial-finalization', { state: { editRecordId: recordId } });
  const handleDownloadPDF = () => window.print();

  const doApprove = () => decide.mutate({ id: recordId, decision: 'approve' });
  const doReject = (reason, remarks) => decide.mutate(
    { id: recordId, decision: 'reject', reason, remarks },
    { onSuccess: () => setRejectOpen(false) },
  );

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3 no-print">
            <button className="btn btn-ghost btn-icon" onClick={handleBack} aria-label="Back"><ArrowLeft size={16} /></button>
            {title}
          </span>
        }
        subtitle={`${property?.title || 'Property'} · ${project?.code || ''}`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))' }}>
        <div className="content-wide col gap-4 fade-in" style={{ paddingBottom: 60 }}>

          {/* Top audit header */}
          <div className="card no-print" style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12, background: '#fff', border: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div className="col gap-1 text-left">
                <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', margin: 0 }}>{title}</h1>
                <span style={{ fontSize: 13, color: 'var(--text-subtle)', fontWeight: 500 }}>{property?.title || 'Property'}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</span>
                  <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Submitted By</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{record.submittedBy?.name || record.createdBy?.name || '—'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Submitted On</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{fmtDateTime(record.submittedAt || record.createdAt)}</span>
                </div>
                {record.status === 'rejected' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rejected By</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)' }}>{record.rejectedBy?.name || '—'} · {fmtDate(record.rejectedAt)}</span>
                  </div>
                )}
                {record.status === 'approved' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Approved By</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{record.approvedBy?.name || '—'} · {fmtDate(record.approvedAt)}</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" onClick={handleDownloadPDF} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: '#D1D5DB' }}>
                  <FileDown size={15} /> Download PDF
                </button>
                {canDecide && record.status === 'submitted' && (
                  <>
                    <button type="button" className="btn btn-outline-success" disabled={decide.isPending} onClick={doApprove}>
                      ✓ Approve
                    </button>
                    <button type="button" className="btn btn-outline-danger" disabled={decide.isPending} onClick={() => setRejectOpen(true)}>
                      ✕ Reject
                    </button>
                  </>
                )}
                {record.status !== 'approved' && (
                  <button type="button" className="btn btn-primary" onClick={handleEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Pencil size={14} /> Edit
                  </button>
                )}
              </div>
            </div>
            {record.status === 'rejected' && (record.rejectReason || record.decisionReason) && (
              <div className="sm" style={{ color: 'var(--danger)', padding: '8px 10px', border: '1px solid var(--danger)', borderRadius: 8, textAlign: 'left' }}>
                <b>Rejection Reason:</b> {record.rejectReason || record.decisionReason}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '70fr 30fr', gap: 20, width: '100%', alignItems: 'start' }} className="grid-responsive">
            {/* Left column */}
            <div className="col gap-4">
              {sections.map((section) => (
                <div key={section.title} className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'left' }}>{section.title}</h2>
                  <div className="col gap-3">
                    {section.fields.filter((f) => isVisible(f, record.values || {})).map((field) => (
                      <div key={field.key} className="col gap-1" style={{ textAlign: 'left' }}>
                        <span className="tiny subtle upper">{field.label}</span>
                        <DynamicField field={field} value={record.values?.[field.key]} onChange={() => {}} readOnly />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Right sidebar */}
            <div className="col gap-4">
              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 20, textAlign: 'left' }}>Activity History</h2>
                {recordActivities.length ? (
                  <div className="col gap-3" style={{ textAlign: 'left' }}>
                    {recordActivities.map((a) => (
                      <div key={a._id} className="col gap-1">
                        <span className="sm" style={{ fontWeight: 650 }}>{a.message}</span>
                        <span className="tiny muted">by {a.actor?.name || 'System'} · {fmtDateTime(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty sm" style={{ padding: '16px 0' }}>No activity logged yet.</div>
                )}
              </div>

              <div className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 20, textAlign: 'left' }}>Report Summary</h2>
                <div className="col gap-3" style={{ fontSize: 13.5, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                    <span style={{ color: '#6B7280' }}>Module</span>
                    <strong style={{ color: 'var(--text)' }}>{type?.name || '—'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8, alignItems: 'center' }}>
                    <span style={{ color: '#6B7280' }}>Status</span>
                    <Badge color={meta.color} soft={meta.soft}>{meta.label}</Badge>
                  </div>
                  {keyFacts.map((f) => (
                    <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', paddingBottom: 8 }}>
                      <span style={{ color: '#6B7280' }}>{f.label}</span>
                      <strong style={{ color: 'var(--text)' }}>
                        {f.type === 'currency' ? `₹${Number(record.values[f.key]).toLocaleString('en-IN')}` : String(record.values[f.key])}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <RejectDialog
        open={rejectOpen}
        title={`Reject ${type?.name || 'Record'}`}
        onClose={() => setRejectOpen(false)}
        onConfirm={doReject}
        pending={decide.isPending}
        placeholder="Why is this record being rejected?"
      />
    </>
  );
}

export default CommercialRecordReportPage;
