import { useNavigate } from 'react-router-dom';
import { LayoutTemplate, Layers, ListChecks, Clock, ChevronRight } from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkBlock } from '../../components/ui/Skeletons.jsx';
import { useTemplates } from '../../lib/queries.js';

const STATUS_COLORS = {
  draft: { color: '#6b7280' },
  published: { color: '#10b981' },
  archived: { color: '#f59e0b' },
};

export function TemplatesPage() {
  const { data, isLoading } = useTemplates({ limit: 50 });
  const navigate = useNavigate();
  const templates = data?.data || [];

  return (
    <>
      <Topbar
        title="Templates"
        subtitle="Reusable launch playbooks — design once, run in every city"
        actions={<button className="btn btn-primary" disabled title="Template builder coming in the next iteration">+ New Template</button>}
      />
      <div className="content">
        <div className="content-narrow fade-in">
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {Array.from({ length: 6 }).map((_, i) => <SkBlock key={i} h={186} />)}
            </div>
          ) : !templates.length ? (
            <EmptyState icon={LayoutTemplate} title="No templates yet" hint="Seed the demo data to load the Franchise Launch playbook." />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 'var(--space-4)' }}>
              {templates.map((t) => (
                <div key={t._id} className="card" style={{ cursor: 'pointer', transition: 'var(--transition)' }} onClick={() => navigate(`/templates/${t._id}`)}>
                  <div className="card-body">
                    <div className="row between" style={{ marginBottom: 14 }}>
                      <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: `${t.color}1e`, color: t.color }}>
                        <LayoutTemplate size={22} />
                      </span>
                      <Badge color={STATUS_COLORS[t.status]?.color} dot>{t.status}</Badge>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{t.name}</div>
                    <div className="mono tiny subtle" style={{ marginTop: 2 }}>{t.code} · v{t.version}</div>
                    <p className="sm muted" style={{ marginTop: 8, minHeight: 38 }}>{t.description}</p>

                    <div className="row gap-4" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                      <span className="row gap-1 sm muted"><Layers size={14} /> {t.totalStages} stages</span>
                      <span className="row gap-1 sm muted"><ListChecks size={14} /> {t.totalTasks} tasks</span>
                      <span className="row gap-1 sm muted"><Clock size={14} /> ~{t.estimatedDurationDays}d</span>
                      <ChevronRight size={16} className="subtle" style={{ marginLeft: 'auto' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default TemplatesPage;
