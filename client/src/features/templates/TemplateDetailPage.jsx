import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Layers, ListChecks, Clock, Database, ChevronDown, ChevronRight, CheckSquare,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, PriorityBadge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../lib/queries.js';
import { DEPT_META } from '../../lib/ui.js';

function StageBlock({ stage, index, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setOpen((o) => !o)}>
        <div className="row gap-3">
          <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${stage.color}22`, color: stage.color, fontWeight: 700, fontSize: 13 }}>
            {index + 1}
          </span>
          <div className="col">
            <span className="section-title">{stage.name}</span>
            <span className="tiny muted">{stage.tasks?.length || 0} tasks · {stage.slaDays}d SLA · {DEPT_META[stage.ownerDepartment] || '—'}</span>
          </div>
        </div>
        <div className="row gap-2">
          <span className="badge-dot" style={{ background: stage.color, width: 10, height: 10 }} />
          {open ? <ChevronDown size={18} className="subtle" /> : <ChevronRight size={18} className="subtle" />}
        </div>
      </div>

      {open && (
        <div className="card-body col gap-4">
          {stage.description && <p className="sm muted">{stage.description}</p>}

          {/* Tasks */}
          <div className="col gap-2">
            <span className="eyebrow">Tasks</span>
            {[...(stage.tasks || [])].sort((a, b) => a.order - b.order).map((task) => (
              <div key={task.key} className="row between" style={{ padding: '10px 12px', background: 'var(--surface-hover)', borderRadius: 'var(--radius)' }}>
                <div className="col grow">
                  <span className="row gap-2" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {task.title}
                    {task.checklist?.length > 0 && <span className="row gap-1 tiny subtle"><CheckSquare size={12} />{task.checklist.length}</span>}
                  </span>
                  {task.description && <span className="tiny muted">{task.description}</span>}
                </div>
                <div className="row gap-2">
                  <span className="tiny muted row gap-1"><Clock size={12} />{task.estimatedDays}d</span>
                  <PriorityBadge value={task.priority} />
                </div>
              </div>
            ))}
          </div>

          {/* Master data schema */}
          {stage.masterDataSchema?.length > 0 && (
            <div className="col gap-2">
              <span className="eyebrow row gap-1"><Database size={12} /> Master Data Captured Here</span>
              <div className="row wrap gap-2">
                {stage.masterDataSchema.map((f) => (
                  <span key={f.key} className="chip">
                    {f.label}
                    <span className="tiny subtle">{f.type}</span>
                    {f.required && <span style={{ color: 'var(--danger)' }}>*</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TemplateDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: template, isLoading } = useTemplate(id);

  if (isLoading || !template) {
    return (
      <>
        <Topbar title="Template" />
        <div className="content"><SkDetail /></div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate('/templates')}><ArrowLeft size={16} /></button>
            {template.name}
          </span>
        }
        subtitle={`${template.code} · v${template.version}`}
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in" style={{ maxWidth: 920 }}>
          <div className="card card-pad">
            <div className="row between wrap gap-3">
              <p className="muted" style={{ maxWidth: 560 }}>{template.description}</p>
              <Badge color={template.status === 'published' ? '#10b981' : '#6b7280'} dot>{template.status}</Badge>
            </div>
            <div className="row gap-5" style={{ marginTop: 18 }}>
              <span className="row gap-2"><Layers size={18} className="subtle" /> <b>{template.totalStages}</b> <span className="muted sm">stages</span></span>
              <span className="row gap-2"><ListChecks size={18} className="subtle" /> <b>{template.totalTasks}</b> <span className="muted sm">tasks</span></span>
              <span className="row gap-2"><Clock size={18} className="subtle" /> <b>~{template.estimatedDurationDays}</b> <span className="muted sm">days end-to-end</span></span>
            </div>
          </div>

          <div className="col gap-3">
            {[...template.stages].sort((a, b) => a.order - b.order).map((stage, i) => (
              <StageBlock key={stage.key} stage={stage} index={i} defaultOpen={i === 0} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default TemplateDetailPage;
