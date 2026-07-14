import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Check, MapPin, Wallet, CalendarRange, Users, Building2, Target, Ruler,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  ProgressBar, ProgressRing, ProjectStatusBadge, HealthBadge, Avatar, AvatarStack,
  SectionCard,
} from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { useProject, useProjectActivity } from '../../lib/queries.js';
import { STAGE_STATUS_META } from '../../lib/ui.js';
import { fmtDate, fmtCurrency, fromNow, daysUntil } from '../../lib/format.js';
import { TaskBoard } from '../tasks/TaskBoard.jsx';
import { MasterDataPanel } from './MasterDataPanel.jsx';
import { StageDetailModal } from './StageDetailModal.jsx';

const TABS = ['Overview', 'Task Board', 'Master Data', 'Activity'];

function StageStepper({ stages, currentKey, onStageClick }) {
  const ordered = [...stages].sort((a, b) => a.order - b.order);
  return (
    <div className="row" style={{ overflowX: 'auto', gap: 0, padding: '4px 0' }}>
      {ordered.map((s, i) => {
        const meta = STAGE_STATUS_META[s.status];
        const isCurrent = s.key === currentKey;
        return (
          <div key={s.key} className="row" style={{ flex: 1, minWidth: 110 }}>
            <div className="col center" style={{ flex: 1, gap: 6 }}>
              <button
                type="button"
                aria-label={`Open ${s.name} stage details`}
                title={`Open ${s.name} details`}
                onClick={() => onStageClick?.(s)}
                style={{
                  width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: s.status === 'completed' ? meta.color : 'var(--surface)',
                  border: `2px solid ${meta.color}`,
                  color: s.status === 'completed' ? '#fff' : meta.color,
                  fontWeight: 700, fontSize: s.status === 'completed' ? 0 : 12,
                  boxShadow: isCurrent ? `0 0 0 4px ${meta.color}33` : 'none',
                  cursor: 'pointer',
                  padding: 0,
                  appearance: 'none',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {s.status === 'completed' ? '✓' : i + 1}
                {s.status === 'completed' && <Check size={14} strokeWidth={3} style={{ position: 'absolute' }} />}
              </button>
              <span className="tiny center" style={{ textAlign: 'center', fontWeight: isCurrent ? 700 : 500, color: isCurrent ? 'var(--text)' : 'var(--text-muted)', maxWidth: 96 }}>
                {s.name}
              </span>
            </div>
            {i < ordered.length - 1 && (
              <div style={{ height: 2, flex: 1, background: s.status === 'completed' ? meta.color : 'var(--border)', marginBottom: 22 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverviewTab({ project }) {
  const dleft = daysUntil(project.targetEndDate);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-5)' }} className="dash-split">
      <SectionCard title="Stage Plan">
        <div className="col">
          {[...project.stages].sort((a, b) => a.order - b.order).map((s) => {
            const meta = STAGE_STATUS_META[s.status];
            return (
              <div key={s.key} className="row gap-3" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="badge-dot" style={{ background: s.color, width: 10, height: 10 }} />
                <div className="col grow">
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <span className="tiny muted">{fmtDate(s.plannedStart)} → {fmtDate(s.plannedEnd)} · {s.slaDays}d SLA</span>
                </div>
                <span className="badge" style={{ background: `${meta.color}1e`, color: meta.color }}>{meta.label}</span>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="col gap-4">
        <SectionCard title="Timeline & Budget">
          <div className="col gap-4">
            <div className="row between"><span className="row gap-2 muted sm"><CalendarRange size={15} /> Planned start</span><b className="sm">{fmtDate(project.plannedStartDate)}</b></div>
            <div className="row between"><span className="row gap-2 muted sm"><Target size={15} /> Target go-live</span><b className="sm">{fmtDate(project.targetEndDate)}</b></div>
            <div className="row between"><span className="row gap-2 muted sm"><CalendarRange size={15} /> Days remaining</span>
              <b className="sm" style={{ color: dleft < 0 ? 'var(--danger)' : 'var(--text)' }}>{dleft != null ? (dleft < 0 ? `${-dleft}d over` : `${dleft}d`) : '—'}</b>
            </div>
            <hr className="divider" />
            <div className="row between"><span className="row gap-2 muted sm"><Wallet size={15} /> Budget</span><b className="sm">{fmtCurrency(project.budget?.planned)}</b></div>
            <div className="col gap-1">
              <div className="row between tiny muted"><span>Spent {fmtCurrency(project.budget?.actual)}</span><span>{project.budgetUtilization}%</span></div>
              <ProgressBar value={project.budgetUtilization} height={6} gradient="linear-gradient(90deg, var(--gold-300), var(--gold-600))" />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Site & Team">
          <div className="col gap-4">
            <div className="row between"><span className="row gap-2 muted sm"><MapPin size={15} /> City</span><b className="sm">{project.city}</b></div>
            <div className="row between"><span className="row gap-2 muted sm"><Ruler size={15} /> Area</span><b className="sm">{project.areaSqft ? `${project.areaSqft} sq.ft` : '—'}</b></div>
            <div className="row between"><span className="row gap-2 muted sm"><Building2 size={15} /> Broker</span><b className="sm">{project.broker?.name || '—'}</b></div>
            <hr className="divider" />
            <div className="row between">
              <span className="row gap-2 muted sm"><Users size={15} /> Owner</span>
              {project.owner ? <span className="row gap-2"><Avatar name={project.owner.name} color={project.owner.avatarColor} size={26} /><b className="sm">{project.owner.name}</b></span> : <span className="subtle sm">—</span>}
            </div>
            {project.members?.length > 0 && (
              <div className="row between"><span className="muted sm">Team</span><AvatarStack people={project.members} /></div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function ActivityTab({ projectId }) {
  const { data, isLoading } = useProjectActivity(projectId);
  if (isLoading) {
    return (
      <SectionCard title="Activity Log">
        <SkeletonActivity rows={5} />
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Activity Log">
      <div className="col gap-4">
        {(data || []).map((a) => (
          <div key={a._id} className="row gap-3">
            <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={28} />
            <div className="col grow">
              <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
              <div className="tiny muted">{fromNow(a.createdAt)}</div>
            </div>
          </div>
        ))}
        {!data?.length && <div className="empty sm">No activity yet</div>}
      </div>
    </SectionCard>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id);
  const [tab, setTab] = useState('Overview');
  const [selectedStageKey, setSelectedStageKey] = useState(null);

  const openStage = (stage) => {
    // Property Identification and Site Evaluation (both collection-mode) each
    // have their own dedicated dashboard page rather than the generic
    // StageDetailModal — routed explicitly by key since there's more than one
    // collection-mode stage now.
    if (stage.key === 'p1') {
      navigate(`/projects/${project._id}/property-identification`);
      return;
    }
    if (stage.key === 'p2') {
      navigate(`/projects/${project._id}/site-evaluation`);
      return;
    }
    if (stage.captureMode === 'collection') {
      navigate(`/projects/${project._id}/property-identification`);
      return;
    }
    setSelectedStageKey(stage.key);
  };

  if (isLoading || !project) {
    return (
      <>
        <Topbar title="Project" />
        <div className="content"><SkDetail /></div>
      </>
    );
  }

  const selectedStage = selectedStageKey
    ? project.stages.find((stage) => stage.key === selectedStageKey)
    : null;

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate('/projects')}><ArrowLeft size={16} /></button>
            {project.name}
          </span>
        }
        subtitle={`${project.code} · ${project.template?.name || 'Custom'}`}
      />
      <div className="content">
        <div className="content-narrow col gap-5 fade-in">
          {/* Header card */}
          <div className="card card-pad">
            <div className="row between wrap gap-4">
              <div className="row gap-4">
                <div className="center" style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
                  <ProgressRing value={project.progress} size={72} stroke={7} />
                  <span
                    className="tabular"
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontWeight: 700,
                      fontSize: 20,
                      color: 'var(--text)',
                    }}
                  >
                    {project.progress}%
                  </span>
                </div>
                <div className="col gap-2">
                  <div className="row gap-2">
                    <ProjectStatusBadge value={project.status} />
                    <HealthBadge value={project.health} />
                  </div>
                  <div className="row gap-2 muted sm"><MapPin size={14} /> {project.city} · {project.address}</div>
                </div>
              </div>
              <div className="row gap-5">
                <div className="col"><span className="tiny subtle upper">Stages</span><span style={{ fontWeight: 700, fontSize: 18 }}>{project.stages.length}</span></div>
                <div className="col"><span className="tiny subtle upper">Go-Live</span><span style={{ fontWeight: 700, fontSize: 15 }}>{fmtDate(project.targetEndDate)}</span></div>
                <div className="col"><span className="tiny subtle upper">Budget</span><span style={{ fontWeight: 700, fontSize: 15 }}>{fmtCurrency(project.budget?.planned)}</span></div>
              </div>
            </div>
            <hr className="divider" style={{ margin: '20px 0' }} />
            <StageStepper
              stages={project.stages}
              currentKey={project.currentStageKey}
              onStageClick={openStage}
            />
          </div>

          {/* Tabs */}
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>

          {tab === 'Overview' && <OverviewTab project={project} />}
          {tab === 'Task Board' && <TaskBoard projectId={project._id} />}
          {tab === 'Master Data' && <MasterDataPanel project={project} />}
          {tab === 'Activity' && <ActivityTab projectId={project._id} />}
        </div>
      </div>
      {selectedStage && (
        <StageDetailModal
          project={project}
          stage={selectedStage}
          onClose={() => setSelectedStageKey(null)}
        />
      )}
    </>
  );
}

export default ProjectDetailPage;
