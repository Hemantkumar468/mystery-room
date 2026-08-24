/** Every application across every role — the flat view for searching a person. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useGetCandidatesQuery } from '../../app/api/hrmsApi.js';
import { fromNow } from '../../lib/format.js';
import { STAGE_META, SOURCE_LABEL } from './hrmsUi.js';

export function CandidateListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const { data, isLoading } = useGetCandidatesQuery({ search: search || undefined, stage: stage || undefined });
  const rows = data || [];

  return (
    <>
      <Topbar title="Candidates" subtitle="Every application, across every role" />
      <div className="content">
        <div className="content-narrow col gap-3 fade-in">
          <div className="row gap-2 wrap">
            <div className="input-icon-wrap grow" style={{ minWidth: 220, maxWidth: 380 }}>
              <Search size={15} className="input-icon" />
              <input className="input" placeholder="Search name, phone, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="select" style={{ width: 170 }} value={stage} onChange={(e) => setStage(e.target.value)}>
              <option value="">All stages</option>
              {Object.entries(STAGE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>

          <SectionCard title={`Candidates (${rows.length})`}>
            {isLoading ? <SkTable rows={6} /> : rows.length === 0 ? (
              <EmptyState icon={Users} title="No candidates match" hint="Applications from the public job pages and hand-added candidates both land here." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table table-clickable">
                  <thead><tr><th>Candidate</th><th>Role</th><th>Stage</th><th>Source</th><th>City</th><th>Applied</th></tr></thead>
                  <tbody>
                    {rows.map((c) => {
                      const m = STAGE_META[c.stage] || {};
                      return (
                        <tr key={c._id} onClick={() => c.requisition?._id && navigate(`/hrms/requisitions/${c.requisition._id}`)}>
                          <td>
                            <div className="col">
                              <span className="sm" style={{ fontWeight: 650 }}>{c.name}</span>
                              <span className="tiny muted">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</span>
                            </div>
                          </td>
                          <td className="sm">{c.requisition?.title || '—'} <span className="tiny muted mono">{c.requisition?.code || ''}</span></td>
                          <td><Badge color={m.color} soft={m.soft} dot>{m.label || c.stage}</Badge></td>
                          <td className="tiny">{SOURCE_LABEL[c.source] || c.source}</td>
                          <td className="tiny">{c.city || '—'}</td>
                          <td className="tiny muted">{fromNow(c.createdAt)}</td>
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

export default CandidateListPage;
