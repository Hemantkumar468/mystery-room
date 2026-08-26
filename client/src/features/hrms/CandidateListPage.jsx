/** Every application across every role — the flat view for searching a person. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Download } from 'lucide-react';
import { api } from '../../lib/api.js';
import { qs } from '../../app/api/qs.js';
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

  /* Downloaded through the api client rather than a plain <a href>: the
     endpoint needs the access token, and a bare link sends no Authorization
     header — it would download the login page as a .csv and look like it
     worked. */
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/hrms/candidates/export${qs({ search: search || undefined, stage: stage || undefined })}`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.response?.data?.message || 'Could not prepare the download.');
    } finally {
      setExporting(false);
    }
  };

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
            <button type="button" className="btn btn-subtle" onClick={exportCsv} disabled={exporting || rows.length === 0}>
              <Download size={14} /> {exporting ? 'Preparing…' : 'Download as CSV'}
            </button>
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
                        <tr key={c._id} onClick={() => navigate(`/hrms/candidates/${c._id}`)}>
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
