import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Layers, ListChecks, Clock, Database, ChevronDown, ChevronRight, CheckSquare, ShieldCheck, Square, Star
} from 'lucide-react';
import { useGoBack } from '../../components/layout/BackButton.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, PriorityBadge } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { DEPT_META } from '../../lib/ui.js';
import { getEmployeeById } from '../../lib/employees.js';

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
            <div className="row gap-2 wrap" style={{ marginTop: 2 }}>
              <span className="tiny muted">
                {stage.tasks?.length || 0} tasks
                {(() => {
                  const n = stage.tasks?.reduce((sum, t) => sum + (t.checklist?.length || 0), 0) || 0;
                  return n ? ` · ${n} checks` : '';
                })()}
                {' · '}{stage.slaDays}d SLA · {DEPT_META[stage.ownerDepartment] || '—'}
              </span>
              {stage.requiresApproval && (
                <span className="row gap-1 tiny" style={{ color: 'var(--warning)', background: 'var(--warning-soft)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontWeight: 600 }}>
                  <ShieldCheck size={11} /> Approvals: {stage.approverRoles && stage.approverRoles.length > 0 ? stage.approverRoles.join(' & ') : 'Required'}
                </span>
              )}
            </div>
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
              <div key={task.key} className="row between gap-3" style={{ padding: '10px 12px', background: 'var(--surface-hover)', borderRadius: 'var(--radius)' }}>
                <div className="col grow" style={{ minWidth: 0 }}>
                  <span className="row gap-2" style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {task.title}
                    {task.checklist?.length > 0 && <span className="row gap-1 tiny subtle"><CheckSquare size={12} />{task.checklist.length}</span>}
                  </span>

                  {/* Task Meta: Department Tag + Assignees */}
                  <div className="row gap-2 wrap" style={{ marginTop: 4, alignItems: 'center' }}>
                    {task.department && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 650,
                        color: 'var(--text-subtle)',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        padding: '1px 5px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em'
                      }}>
                        {DEPT_META[task.department] || task.department}
                      </span>
                    )}

                    {/* Primary Assignee */}
                    {task.primaryAssignee && (() => {
                      const emp = getEmployeeById(task.primaryAssignee);
                      if (!emp) return null;
                      const isAvail = emp.availability?.status === 'available';
                      const isLeave = emp.availability?.status === 'on_leave';
                      const dotColor = isAvail ? '#10b981' : (isLeave ? '#f43f5e' : '#f59e0b');
                      return (
                        <div className="row gap-1" style={{ alignItems: 'center' }}>
                          <span title="Primary doer — owns this task" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', marginRight: 2 }}>Doer:</span>
                          <span
                            title={`${emp.name} (${emp.role}) — ${isAvail ? 'Available' : (emp.availability?.reason || emp.availability?.status)}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '1px 6px 1px 4px',
                              borderRadius: 999,
                              background: `${emp.avatarColor}15`,
                              border: `1px solid ${emp.avatarColor}33`,
                              fontSize: 10,
                              fontWeight: 600,
                              color: emp.avatarColor,
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <span style={{
                              width: 14, height: 14, borderRadius: '50%',
                              background: emp.avatarColor, color: '#fff',
                              display: 'grid', placeItems: 'center',
                              fontSize: 8, fontWeight: 700
                            }}>
                              {emp.initials.slice(0, 2)}
                            </span>
                            <span>{emp.name}</span>
                            {/* Availability dot */}
                            <span
                              style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: dotColor, display: 'inline-block', flexShrink: 0
                              }}
                              title={isAvail ? 'Available' : (emp.availability?.reason || emp.availability?.status)}
                            />
                            {!isAvail && <span style={{ fontSize: 9 }} title={emp.availability?.reason || 'Unavailable'}>⚠️</span>}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Backup Assignee */}
                    {task.backupAssignee && (() => {
                      const emp = getEmployeeById(task.backupAssignee);
                      if (!emp) return null;
                      const isAvail = emp.availability?.status === 'available';
                      const isLeave = emp.availability?.status === 'on_leave';
                      const dotColor = isAvail ? '#10b981' : (isLeave ? '#f43f5e' : '#f59e0b');
                      return (
                        <div className="row gap-1" style={{ alignItems: 'center' }}>
                          <span title="Backup buddy — takes over when the doer is unavailable" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', marginRight: 2 }}>Buddy:</span>
                          <span
                            title={`${emp.name} (${emp.role}) — ${isAvail ? 'Available' : (emp.availability?.reason || emp.availability?.status)}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '1px 6px 1px 4px',
                              borderRadius: 999,
                              background: `${emp.avatarColor}15`,
                              border: `1px solid ${emp.avatarColor}33`,
                              fontSize: 10,
                              fontWeight: 600,
                              color: emp.avatarColor,
                              whiteSpace: 'nowrap',
                              opacity: 0.85
                            }}
                          >
                            <span style={{
                              width: 14, height: 14, borderRadius: '50%',
                              background: emp.avatarColor, color: '#fff',
                              display: 'grid', placeItems: 'center',
                              fontSize: 8, fontWeight: 700
                            }}>
                              {emp.initials.slice(0, 2)}
                            </span>
                            <span>{emp.name}</span>
                            {/* Availability dot */}
                            <span
                              style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: dotColor, display: 'inline-block', flexShrink: 0
                              }}
                              title={isAvail ? 'Available' : (emp.availability?.reason || emp.availability?.status)}
                            />
                            {!isAvail && <span style={{ fontSize: 9 }} title={emp.availability?.reason || 'Unavailable'}>⚠️</span>}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {task.description && <span className="tiny muted" style={{ marginTop: 4 }}>{task.description}</span>}

                  {/* Checklist the doer must tick off to close this task */}
                  {task.checklist?.length > 0 && (
                    <div className="col gap-1" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      {[...task.checklist]
                        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                        .map((item, i) => (
                          <div key={`${task.key}-c${i}`} className="row gap-2" style={{ alignItems: 'center' }}>
                            <Square size={11} className="subtle" style={{ flexShrink: 0 }} />
                            <span className="tiny" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                            {item.required && (
                              <span
                                title="Mandatory — the task cannot be completed until this is ticked"
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 700,
                                  letterSpacing: '0.04em',
                                  color: 'var(--danger)',
                                  background: 'var(--danger-soft)',
                                  padding: '1px 5px',
                                  borderRadius: 3,
                                  textTransform: 'uppercase',
                                }}
                              >
                                Mandatory
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
                <div className="row gap-2" style={{ flexShrink: 0, alignSelf: 'flex-start' }}>
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
  const { goBack } = useGoBack('/templates');
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
            <button className="btn btn-ghost btn-icon" onClick={goBack} aria-label="Back"><ArrowLeft size={16} /></button>
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
              <div className="row gap-2">
                {template.isDefault && (
                  <Badge color="#e0a13a" style={{ fontWeight: 700 }}>
                    <Star size={11} fill="#e0a13a" /> Default
                  </Badge>
                )}
                <Badge color={template.status === 'published' ? '#10b981' : '#6b7280'} dot>{template.status}</Badge>
              </div>
            </div>
            <div className="row gap-5 wrap" style={{ marginTop: 18 }}>
              <span className="row gap-2"><Layers size={18} className="subtle" /> <b>{template.totalStages}</b> <span className="muted sm">phases</span></span>
              <span className="row gap-2"><ListChecks size={18} className="subtle" /> <b>{template.totalTasks}</b> <span className="muted sm">tasks</span></span>
              <span className="row gap-2"><CheckSquare size={18} className="subtle" /> <b>{template.totalChecklistItems}</b> <span className="muted sm">checklist items</span></span>
              <span className="row gap-2"><Clock size={18} className="subtle" /> <b>~{template.estimatedDurationDays}</b> <span className="muted sm">days end-to-end</span></span>
            </div>
            {template.isDefault && (
              <p className="tiny muted" style={{ marginTop: 12 }}>
                New projects start from this playbook unless another template is chosen.
              </p>
            )}
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
