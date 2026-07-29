import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, XCircle, Circle } from 'lucide-react';
import { isValidId } from '../../lib/id.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { RECORD_STATUS_META } from './records/recordUi.js';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

const ROW_ICON = { approved: CheckCircle2, rejected: XCircle, submitted: Clock, draft: Clock };

/**
 * Checklist "report" for the two Commercial Finalization modules that need
 * several independent records at once (NOC Management — 7 NOC types;
 * Commercial Approvals — 5 sign-off levels) — one row per required sub-item,
 * each linking to its own CommercialRecordReportPage once a record exists.
 * A single-record report page (like the other 4 modules use directly)
 * can't represent "3 of 7 done, 4 pending" on its own, so this is the
 * module-level "report" for these two types instead.
 */
export function CommercialModuleChecklistPage() {
  const { id, moduleKey } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const propertyId = new URLSearchParams(location.search).get('propertyId') || '';

  const { data: project, isLoading: projectLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template, isLoading: templateLoading } = useTemplate(templateId, { enabled: isValidId(templateId) });
  const { data: records, isLoading: recordsLoading } = useStageRecords(id, 'p3', { parentRecordId: propertyId }, { enabled: isValidId(id) && isValidId(propertyId) });

  if (projectLoading || templateLoading || recordsLoading) {
    return (<><Topbar title="Module Report" /><div className="content"><SkDetail /></div></>);
  }

  const type = template?.stages?.find((s) => s.key === 'p3')?.assessmentTypes?.find((t) => t.key === moduleKey);
  const field = type?.masterDataSchema?.find((f) => f.key === type.subKeyField);
  const required = field?.options || [];

  const ownRecords = (records || []).filter((r) => r.assessmentType === moduleKey);
  const bestFor = (option) => {
    const matches = ownRecords.filter((r) => r.values?.[type.subKeyField] === option);
    const approved = matches.find((r) => r.status === 'approved');
    if (approved) return approved;
    return [...matches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  };

  const doneCount = required.filter((o) => bestFor(o)?.status === 'approved').length;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft size={16} /></button>
            {type?.name || 'Module'} Report
          </span>
        }
        subtitle={`${project?.code || ''} · ${project?.name || ''}`}
      />
      <div className="content page-compact">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="content-narrow col gap-3 fade-in">
          <SectionCard
            title={`${type?.name || 'Module'} Checklist (${doneCount}/${required.length} Approved)`}
          >
            {!type ? (
              <EmptyState icon={Circle} title="Module not found" hint="This commercial module isn't configured on the template." />
            ) : (
              <div className="col gap-2">
                <table className="table table-clickable">
                  <thead>
                    <tr>
                      <th>{field?.label || 'Item'}</th>
                      <th>Status</th>
                      <th>Submitted By</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {required.map((option) => {
                      const record = bestFor(option);
                      const meta = record ? (RECORD_STATUS_META[record.status] || { label: record.status, color: '#6B7280', soft: '#F3F4F6' }) : { label: 'Not Submitted', color: '#7c7784', soft: 'var(--surface-hover)' };
                      const Icon = record ? (ROW_ICON[record.status] || Circle) : Circle;
                      return (
                        <tr
                          key={option}
                          onClick={record ? () => navigate(`/projects/${id}/commercial-finalization/record/${record._id}`) : undefined}
                          style={{ cursor: record ? 'pointer' : 'default' }}
                        >
                          <td style={{ fontWeight: 500 }}>
                            <span className="row gap-2" style={{ alignItems: 'center' }}>
                              <Icon size={14} color={meta.color} /> {option}
                            </span>
                          </td>
                          <td><Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge></td>
                          <td className="sm">{record?.submittedBy?.name || record?.createdBy?.name || '—'}</td>
                          <td className="tiny muted">{record ? fmtDateTime(record.submittedAt || record.createdAt) : '—'}</td>
                          <td className="tiny" style={{ color: 'var(--primary)' }}>{record ? 'View Report →' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </>
  );
}

export default CommercialModuleChecklistPage;
