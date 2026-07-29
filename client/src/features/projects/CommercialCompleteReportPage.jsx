import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileDown } from 'lucide-react';
import { isValidId } from '../../lib/id.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useRecord, useStageRecords } from '../../app/api/recordsApi.js';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { groupBySection, isVisible } from './records/RecordFormModal.jsx';
import { RECORD_STATUS_META } from './records/recordUi.js';

/** Latest record of `assessmentType` for this property, preferring an Approved one. */
function latestOf(records, assessmentType) {
  const matches = (records || []).filter((r) => r.assessmentType === assessmentType);
  const approved = matches.find((r) => r.status === 'approved');
  if (approved) return approved;
  return [...matches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

/** Field value formatted for a plain label/value print row — currency gets ₹ formatting, everything else prints as-is. */
function fieldValueText(field, values) {
  const v = values?.[field.key];
  if (v == null || v === '') return '—';
  if (field.type === 'currency') return `₹${Number(v).toLocaleString('en-IN')}`;
  if (field.type === 'date') return fmtDate(v);
  if (field.type === 'file') return Array.isArray(v) ? `${v.length} file(s) attached` : v ? '1 file attached' : '—';
  return String(v);
}

/** A module's field grid, schema-driven — matches CommercialRecordReportPage's rendering so a value never looks different across the two report surfaces. */
function ModuleSection({ numeral, type, record }) {
  if (!type) return null;
  const sections = groupBySection(type.masterDataSchema || []);
  return (
    <div className="report-section" style={{ marginTop: 24 }}>
      <h2 className="report-h2">{numeral}. {type.name}</h2>
      <hr className="report-divider" />
      {record ? (
        <div className="col gap-3">
          {sections.map((section) => (
            <div key={section.title} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              {section.fields.filter((f) => isVisible(f, record.values || {}) && f.type !== 'textarea').map((f) => (
                <div key={f.key} className="row between">
                  <span className="report-title-label">{f.label}</span>
                  <span className="report-value-text">{fieldValueText(f, record.values)}</span>
                </div>
              ))}
            </div>
          ))}
          {(record.values?.remarks || record.values?.commercial_terms || record.values?.legal_opinion) && (
            <p style={{ fontSize: 13, color: '#4B5563', lineHeight: 1.4, margin: 0 }}>
              {record.values?.remarks || record.values?.commercial_terms || record.values?.legal_opinion}
            </p>
          )}
          <span className="tiny muted">Approved by {record.approvedBy?.name || record.decidedBy?.name || '—'} · {fmtDate(record.approvedAt || record.decidedAt)}</span>
        </div>
      ) : (
        <div className="empty sm" style={{ padding: '8px 0' }}>Not completed.</div>
      )}
    </div>
  );
}

/** Checklist section for a subKeyField module (NOC Management, Commercial Approvals). */
function ChecklistSection({ numeral, type, records }) {
  if (!type) return null;
  const field = type.masterDataSchema?.find((f) => f.key === type.subKeyField);
  const required = field?.options || [];
  const bestFor = (option) => {
    const matches = (records || []).filter((r) => r.assessmentType === type.key && r.values?.[type.subKeyField] === option);
    return matches.find((r) => r.status === 'approved') || [...matches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  };
  return (
    <div className="report-section" style={{ marginTop: 24 }}>
      <h2 className="report-h2">{numeral}. {type.name}</h2>
      <hr className="report-divider" />
      <table className="table" style={{ fontSize: 13 }}>
        <thead><tr><th>{field?.label || 'Item'}</th><th>Status</th><th>Approved By</th><th>Date</th></tr></thead>
        <tbody>
          {required.map((option) => {
            const record = bestFor(option);
            const meta = record ? (RECORD_STATUS_META[record.status] || {}) : { label: 'Not Submitted', color: '#7c7784' };
            return (
              <tr key={option}>
                <td>{option}</td>
                <td><Badge color={meta.color}>{meta.label}</Badge></td>
                <td>{record?.approvedBy?.name || '—'}</td>
                <td>{record?.approvedAt ? fmtDate(record.approvedAt) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CommercialCompleteReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const propertyId = new URLSearchParams(location.search).get('propertyId') || '';

  const { data: project, isLoading: projectLoading } = useProject(id);
  const { data: property, isLoading: propertyLoading } = useRecord(propertyId, { enabled: isValidId(propertyId) });
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId, { enabled: isValidId(templateId) });
  const { data: records, isLoading: recordsLoading } = useStageRecords(id, 'p3', { parentRecordId: propertyId }, { enabled: isValidId(id) && isValidId(propertyId) });
  const { data: activities } = useProjectActivity(id);

  if (projectLoading || propertyLoading || recordsLoading || !property) {
    return (<><Topbar title="Commercial Finalization Report" /><div className="content"><SkDetail /></div></>);
  }

  const assessmentTypes = template?.stages?.find((s) => s.key === 'p3')?.assessmentTypes || [];
  const typeByKey = (key) => assessmentTypes.find((t) => t.key === key);
  const loi = latestOf(records, 'loi');
  const lease = latestOf(records, 'lease');
  const legal = latestOf(records, 'legal');
  const deposit = latestOf(records, 'deposit');

  const propertyRecordIds = new Set((records || []).map((r) => String(r._id)));
  const stageActivities = (activities || [])
    .filter((a) => propertyRecordIds.has(a.meta?.recordId) || a.meta?.parentRecordId === String(propertyId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const attachments = (records || []).flatMap((r) => {
    const type = typeByKey(r.assessmentType);
    return (r.attachments || []).map((a) => ({ ...a, moduleName: type?.name || r.assessmentType }));
  });

  const approvalsType = typeByKey('approvals');
  const approvalLevels = approvalsType?.masterDataSchema?.find((f) => f.key === 'approval_level')?.options || [];
  const approvalHistory = approvalLevels
    .map((level) => (records || []).find((r) => r.assessmentType === 'approvals' && r.values?.approval_level === level && r.status === 'approved'))
    .filter(Boolean);

  const recommendations = [];
  if (legal?.values?.title_verification === 'Clear') recommendations.push('Title verification is Clear — no ownership disputes identified.');
  if (legal?.values?.litigation_status === 'None') recommendations.push('No pending litigation on this property.');
  if (legal?.values?.encumbrance_check === 'Clear') recommendations.push('No encumbrances found on the property.');
  if (approvalHistory.length === approvalLevels.length && approvalLevels.length > 0) recommendations.push(`All ${approvalLevels.length} management sign-offs obtained (${approvalLevels.join(', ')}).`);
  if (lease?.values?.lease_start_date && lease?.values?.lease_end_date) recommendations.push(`Lease term confirmed: ${fmtDate(lease.values.lease_start_date)} to ${fmtDate(lease.values.lease_end_date)}.`);
  if (loi?.values?.proposed_rent) recommendations.push(`Proposed rent of ₹${Number(loi.values.proposed_rent).toLocaleString('en-IN')} finalized in LOI.`);
  if (!recommendations.length) recommendations.push('All six commercial modules are approved — property is ready to proceed to Phase 4 (Project Creation).');

  const handleBack = () => navigate(-1);
  const handlePrint = () => window.print();

  return (
    <>
      <Topbar
        title={<span className="row gap-3 no-print"><button className="btn btn-ghost btn-icon" onClick={handleBack} aria-label="Back"><ArrowLeft size={16} /></button>Commercial Finalization Report</span>}
        subtitle={`${property.title} · Commercial Dossier`}
      />

      <div className="content" style={{ background: '#F8FAFC', minHeight: 'calc(100vh - var(--topbar-height))', padding: '24px 0 80px 0' }}>
        <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 16px auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={handleBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={15} /> Back
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileDown size={15} /> Print / Save PDF
          </button>
        </div>

        <div className="report-sheet">
          {/* I. Executive Summary */}
          <div className="report-section">
            <h2 className="report-h2">I. Executive Summary</h2>
            <hr className="report-divider" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 40px' }}>
              <div className="row between"><span className="report-title-label">Property</span><span className="report-value-text">{property.title}</span></div>
              <div className="row between"><span className="report-title-label">City / Locality</span><span className="report-value-text">{property.values?.city || '—'} / {property.values?.locality || '—'}</span></div>
              <div className="row between"><span className="report-title-label">Project</span><span className="report-value-text">{project.code} · {project.name}</span></div>
              <div className="row between"><span className="report-title-label">Commercial Status</span><span className="report-value-text"><Badge color="var(--success)" soft="var(--success-soft)">All Modules Approved</Badge></span></div>
            </div>
          </div>

          <ModuleSection numeral="II" type={typeByKey('loi')} record={loi} />
          <ModuleSection numeral="III" type={typeByKey('lease')} record={lease} />
          <ModuleSection numeral="IV" type={typeByKey('legal')} record={legal} />
          <ModuleSection numeral="V" type={typeByKey('deposit')} record={deposit} />
          <ChecklistSection numeral="VI" type={typeByKey('nocs')} records={records} />
          <ChecklistSection numeral="VII" type={typeByKey('approvals')} records={records} />

          {/* VIII. Commercial Timeline */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">VIII. Commercial Timeline</h2>
            <hr className="report-divider" />
            {stageActivities.length ? (
              <div className="col gap-2">
                {stageActivities.map((a) => (
                  <div key={a._id} className="row between" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 6 }}>
                    <span className="report-value-text" style={{ fontWeight: 500 }}>{a.message}</span>
                    <span className="tiny muted">{fmtDateTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="empty sm">No timeline events yet.</div>}
          </div>

          {/* IX. Attachments */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">IX. Attachments</h2>
            <hr className="report-divider" />
            {attachments.length ? (
              <div className="col gap-1">
                {attachments.map((a, i) => (
                  <div key={i} className="row between" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 6 }}>
                    <span className="sm">{a.originalName} <span className="tiny muted">({a.moduleName})</span></span>
                    <a href={a.url} target="_blank" rel="noreferrer" className="tiny" style={{ color: 'var(--primary)' }}>Download</a>
                  </div>
                ))}
              </div>
            ) : <div className="empty sm">No attachments uploaded.</div>}
          </div>

          {/* X. Audit Trail */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">X. Audit Trail</h2>
            <hr className="report-divider" />
            <table className="table" style={{ fontSize: 12.5 }}>
              <thead><tr><th>Date</th><th>Actor</th><th>Action</th></tr></thead>
              <tbody>
                {[...stageActivities].reverse().slice(0, 20).map((a) => (
                  <tr key={a._id}>
                    <td className="tiny muted">{fmtDateTime(a.createdAt)}</td>
                    <td>{a.actor?.name || 'System'}</td>
                    <td>{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* XI. Recommendations */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">XI. Recommendations</h2>
            <hr className="report-divider" />
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {recommendations.map((r, i) => <li key={i} className="report-value-text" style={{ marginBottom: 6 }}>{r}</li>)}
            </ul>
          </div>

          {/* XII. Approval History */}
          <div className="report-section" style={{ marginTop: 24 }}>
            <h2 className="report-h2">XII. Approval History</h2>
            <hr className="report-divider" />
            {approvalHistory.length ? (
              <div className="col gap-2">
                {approvalHistory.map((r) => (
                  <div key={r._id} className="row between" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 6 }}>
                    <span className="report-value-text">{r.values?.approval_level} sign-off</span>
                    <span className="tiny muted">{r.approvedBy?.name || '—'} · {fmtDate(r.approvedAt)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="empty sm">No approvals recorded yet.</div>}
          </div>

          <div className="tiny muted" style={{ marginTop: 32, textAlign: 'right' }}>
            Report generated {fmtDateTime(new Date().toISOString())}
          </div>
        </div>
      </div>
    </>
  );
}

export default CommercialCompleteReportPage;
