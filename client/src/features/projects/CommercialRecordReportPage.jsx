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
import DepositLedger from './DepositLedger.jsx';
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
/**
 * One stored value, as a person reads it.
 *
 * Deliberately the SAME three rules the Report Summary on this page already
 * applies — money with a rupee sign and grouping, dates as '07 Oct 2026',
 * everything else as it was typed. Two formatters on one screen is how the
 * header comes to say 2026-10-07 while the body says 07 Oct 2026, which is
 * exactly what this page was doing.
 */
function readValue(field, raw) {
  if (field.type === 'currency') return `₹${Number(raw).toLocaleString('en-IN')}`;
  if (field.type === 'date') return fmtDate(raw);
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (Array.isArray(raw)) return raw.join(', ');
  return String(raw);
}

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
  /**
   * WHO MAY ACCEPT THIS DOCUMENT.
   *
   * Two rules, both enforced on the server (record.service#decide) — this
   * only decides whether to draw the buttons, so nobody clicks into a
   * refusal:
   *
   *   it is the MD's desk   accepting the paperwork is a leadership call,
   *                          not something everyone with Manage can do.
   *   never your own         the person who filed it cannot sign it off.
   *                          This is the one that showed on screen: the EA
   *                          who submitted the LOI was offered Approve and
   *                          Reject on her own submission.
   */
  const submittedByMe = Boolean(user) && [record?.submittedBy?._id, record?.submittedBy, record?.createdBy?._id]
    .filter(Boolean)
    .some((v) => String(v) === String(user._id || user.id));
  const canDecide = can.actForLeadership(user?.role) && !submittedByMe;

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


  /**
   * THE TWO DATES THAT SAY WHETHER THIS DOCUMENT IS STILL GOOD.
   *
   * "LOI Report" over a property name does not answer the question a reader
   * opens the page with, which is "what is this and has it expired?". Both
   * answers were in the form below, in grey boxes identical to every other
   * field. These lift them into the header line beside Status.
   *
   * Found by TYPE rather than by name: the six closure modules each call
   * their dates something different (LOI Date, Agreement Date, Valid Until,
   * Expiry), and matching on labels would work for the LOI and quietly do
   * nothing for the other five.
   */
  const dateFacts = (type?.masterDataSchema || [])
    .filter((f) => f.type === 'date' && isVisible(f, record.values || {}))
    .filter((f) => record.values?.[f.key])
    .slice(0, 2);
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
                {/**
                  * WHICH DOCUMENT THIS IS, said once and plainly.
                  *
                  * The page was headed "LOI Report" over the property name,
                  * and everything that makes an LOI an LOI — its number, the
                  * date it runs from, the date it expires — was somewhere
                  * down a column of identical grey form fields. A reader
                  * opening it could not answer "what am I looking at, and is
                  * it still valid?" without hunting.
                  *
                  * So the module gets a badge of its own, the full name is
                  * the heading, and the facts that identify the document sit
                  * directly under it. The fields below are unchanged — this
                  * is a summary, not a second source.
                  */}
                <span className="crr-kind">{type?.name || 'Document'}</span>
                <h1 className="crr-title">{type?.name ? `${type.name} — ${property?.title || 'Property'}` : title}</h1>
                <span className="crr-sub">
                  {[property?.title, project?.name, project?.code].filter(Boolean).join(' · ')}
                </span>
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
                {dateFacts.map((f) => (
                  <div key={f.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{f.label || f.key}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{fmtDate(record.values[f.key])}</span>
                  </div>
                ))}
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
              {/* Deposit Management is a running account, not a filed form: the
                  agreed figure comes from the LOI and the money arrives in
                  instalments. The ledger goes first, above the form's fields —
                  it is what anyone opening this record came to see. */}
              {record.assessmentType === 'deposit' && (
                <DepositLedger record={record} projectId={id} />
              )}
              {sections.map((section) => (
                <div key={section.title} className="card" style={{ background: '#fff', border: '1px solid #E5E7EB', padding: 24 }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textAlign: 'left' }}>{section.title}</h2>
                  {/**
                    * TWO COLUMNS, AND VALUES RATHER THAN INPUT BOXES.
                    *
                    * This was one full-width label-and-box per line, so an LOI
                    * with fourteen fields was fourteen screens-worth of
                    * scrolling to read five numbers — and every value sat in a
                    * bordered box that looks exactly like somewhere you can
                    * type. On a report nothing here is editable; drawing it as
                    * a form invites people to try, and then to wonder why it
                    * will not save. Edit is a button at the top.
                    *
                    * So: a definition list, two across on anything wider than a
                    * phone, label small above value. Paragraphs and files keep
                    * the whole width — a lease clause in a half column is
                    * unreadable, and a file field has its own viewer.
                    */}
                  <div className="crr-grid">
                    {section.fields.filter((f) => isVisible(f, record.values || {})).map((field) => {
                      const raw = record.values?.[field.key];
                      const wide = field.type === 'file' || field.type === 'textarea';
                      /* A file keeps DynamicField: its thumbnail, preview and
                         download are the point, and re-implementing them here
                         is how the two drift apart. */
                      if (field.type === 'file') {
                        return (
                          <div key={field.key} className="crr-item is-wide">
                            <span className="crr-label">{field.label}</span>
                            <DynamicField field={field} value={raw} onChange={() => {}} readOnly />
                          </div>
                        );
                      }
                      const empty = raw === undefined || raw === null || raw === '';
                      return (
                        <div key={field.key} className={`crr-item${wide ? ' is-wide' : ''}`}>
                          <span className="crr-label">{field.label}</span>
                          <span className={`crr-value${empty ? ' is-empty' : ''}`}>
                            {empty ? 'Not provided' : readValue(field, raw)}
                          </span>
                        </div>
                      );
                    })}
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
                        {/* readValue, not a second copy of its rules: this
                            printed 2026-10-07 while the header and the body
                            printed 07 Oct 2026, on the same screen. */}
                        {readValue(f, record.values[f.key])}
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
