import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, ArrowLeftRight } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useProjects } from '../../app/api/projectsApi.js';
import { fmtDate } from '../../lib/format.js';

/**
 * Plan vs Actual — the entry point. Pick which project you want the report
 * for; the report itself lives at /projects/:id/flow and is shared with the
 * in-project sidebar entry, so there is exactly ONE report implementation.
 *
 * Deliberately just a chooser: putting a project dropdown above a live report
 * on one screen sounds smaller but reads worse — the page's content would
 * change identity under the reader. Choose, then read.
 */
export default function PlanVsActualPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useProjects({ limit: 100 });
  const [q, setQ] = useState('');

  const projects = useMemo(() => {
    const rows = data?.data || data || [];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((p) => [p.name, p.code, p.city].some((s) => String(s || '').toLowerCase().includes(needle)))
      : rows;
    // Most-recently-touched first — the project being worked on is the one
    // whose plan-vs-actual someone came to check.
    return [...filtered].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }, [data, q]);

  return (
    <>
      <Topbar title="Plan vs Actual" />
      <div className="content col gap-3">
        <p className="pva-intro">
          Pick a project to see every phase on one page — who does it, when it was
          planned, when it actually happened, and everything filled along the way.
        </p>

        <div className="proj-search" style={{ maxWidth: 380 }}>
          <Search size={15} />
          <input
            className="proj-search-input"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, font: 'inherit', color: 'var(--text)' }}
            placeholder="Search by name, code or city…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {isLoading ? <SkDetail /> : projects.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} title="No projects found" hint={q ? 'Try a different search.' : 'Create a project first.'} />
        ) : (
          <div className="pva-list">
            {projects.map((p) => {
              const stages = p.stages || [];
              const done = stages.filter((s) => s.status === 'completed').length;
              return (
                <button
                  type="button"
                  key={p._id}
                  className="pva-pick"
                  onClick={() => navigate(`/projects/${p._id}/flow`)}
                >
                  <span className="pva-pick-main">
                    <span className="pva-name-text">{p.name}</span>
                    <span className="pva-who">
                      {p.code}{p.city ? ` · ${p.city}` : ''}
                      {p.targetEndDate ? ` · opening target ${fmtDate(p.targetEndDate)}` : ''}
                    </span>
                  </span>
                  <span className="pva-pick-side">
                    {stages.length > 0 && (
                      <Badge soft="var(--surface-2)">{done}/{stages.length} phases done</Badge>
                    )}
                    <span className="pva-pick-progress">
                      <span className="pva-pick-bar"><span style={{ width: `${p.progress || 0}%` }} /></span>
                      {Math.round(p.progress || 0)}%
                    </span>
                    <ArrowRight size={15} className="muted" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
