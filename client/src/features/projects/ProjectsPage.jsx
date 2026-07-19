import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, MapPin, FolderKanban } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  ProgressBar,
  ProjectStatusBadge,
  HealthBadge,
  Avatar,
  EmptyState,
} from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useProjects } from '../../lib/queries.js';
import { PROJECT_STATUS_META } from '../../lib/ui.js';
import { fmtDate, daysUntil } from '../../lib/format.js';
import { NewProjectModal } from './NewProjectModal.jsx';

const STATUS_FILTERS = ['all', 'planning', 'active', 'on_hold', 'completed'];

export function ProjectsPage() {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();

  const { data, isLoading } = useProjects({
    ...(status !== 'all' ? { status } : {}),
    ...(search ? { search } : {}),
    limit: 100,
  });
  const projects = data?.data || [];

  return (
    <>
      <Topbar
        title="Projects"
        subtitle="Every franchise launch, end to end"
        actions={
          <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New Project
          </button>
        }
      />
      <div className="content">
        <div className="content-narrow col gap-4 fade-in">
          {/* Filters */}
          <div className="row between wrap gap-3">
            <div className="row gap-2 wrap">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  className={`chip ${status === s ? 'active' : ''}`}
                  onClick={() => setStatus(s)}
                >
                  {s === 'all' ? 'All' : PROJECT_STATUS_META[s]?.label}
                </button>
              ))}
            </div>
            <div className="row gap-2 input" style={{ width: 260, padding: '0 12px' }}>
              <Search size={15} className="subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                style={{ border: 'none', background: 'transparent', outline: 'none', padding: '9px 0', width: '100%', color: 'var(--text)' }}
              />
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <SkTable rows={7} />
          ) : (
          <div className="card">
            {!projects.length ? (
              <EmptyState icon={FolderKanban} title="No projects yet" hint="Create your first franchise launch from a template." action={<button className="btn btn-primary" onClick={() => setModalOpen(true)}><Plus size={16} /> New Project</button>} />
            ) : (
              <table className="table table-clickable">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>City</th>
                    <th>Status</th>
                    <th>Health</th>
                    <th style={{ width: 180 }}>Progress</th>
                    <th>Opening Date</th>
                    <th>Go-Live</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => {
                    const dleft = daysUntil(p.targetEndDate);
                    return (
                      <tr key={p._id} onClick={() => navigate(`/projects/${p._id}`)}>
                        <td>
                          <div className="col">
                            <span className="mono tiny" style={{ color: 'var(--primary)', fontWeight: 600 }}>{p.code}</span>
                            <span style={{ fontWeight: 600 }}>{p.name}</span>
                          </div>
                        </td>
                        <td><span className="row gap-1"><MapPin size={13} className="subtle" />{p.city}</span></td>
                        <td><ProjectStatusBadge value={p.status} /></td>
                        <td><HealthBadge value={p.health} /></td>
                        <td>
                          <div className="row gap-2">
                            <ProgressBar value={p.progress} height={6} />
                            <span className="tabular sm" style={{ width: 34 }}>{p.progress}%</span>
                          </div>
                        </td>
                        <td><span className="sm">{fmtDate(p.plannedStartDate)}</span></td>
                        <td>
                          <div className="col">
                            <span className="sm">{fmtDate(p.targetEndDate)}</span>
                            {dleft != null && (
                              <span className="tiny" style={{ color: dleft < 0 ? 'var(--danger)' : 'var(--text-subtle)' }}>
                                {dleft < 0 ? `${-dleft}d overdue` : `${dleft}d left`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{p.owner ? <Avatar name={p.owner.name} color={p.owner.avatarColor} /> : <span className="subtle sm">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          )}
        </div>
      </div>

      <NewProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

export default ProjectsPage;
