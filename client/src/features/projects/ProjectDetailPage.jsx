import { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Check, MapPin, Wallet, CalendarRange, Users, Target, Layers,
  CalendarClock, ChevronRight, ListChecks, AlertTriangle, FileText, Activity as ActivityIcon,
  ShieldCheck, RotateCcw, Flag, PenLine, Lock,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import {
  ProgressBar, ProgressRing, ProjectStatusBadge, HealthBadge, Avatar,
  SectionCard, Badge,
} from '../../components/ui/primitives.jsx';
import { SkDetail, SkeletonActivity } from '../../components/ui/Skeletons.jsx';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import {
  STAGE_STATUS_META, HEALTH_META, TASK_WORK_DONE_STATUSES, isReworkStatus, isTaskDelayed, deptMeta,
} from '../../lib/ui.js';
import { fmtDate, fmtDateTime, fmtCurrency, fromNow, daysUntil } from '../../lib/format.js';
import { TaskBoard } from '../tasks/TaskBoard.jsx';
import { MasterDataPanel } from './MasterDataPanel.jsx';
import { StageDetailModal } from './StageDetailModal.jsx';
import { STAGES_CONFIG, getStagePath, getStageAccess, effectiveCurrentKey } from './stagesConfig.jsx';

const TABS = ['Overview', 'Task Board', 'Master Data', 'Activity'];

/**
 * Every project metric shown on the overview, derived once from the real task
 * list + project document. A project with no tasks yields all-zero counts (not
 * fabricated numbers). Shared by the header, the top summary and the health
 * card so they can never disagree.
 */
function useProjectMetrics(project, tasks) {
  return useMemo(() => {
    const open = tasks.filter((t) => !TASK_WORK_DONE_STATUSES.includes(t.status) && t.status !== 'rejected' && !isReworkStatus(t.status));
    const rework = tasks.filter((t) => isReworkStatus(t.status));
    const blocked = tasks.filter((t) => t.status === 'blocked');
    const delayed = tasks.filter((t) => isTaskDelayed(t));
    const pendingApprovals = tasks.filter((t) => t.status === 'waiting_approval' || t.status === 'waiting_management_approval');
    const approved = tasks.filter((t) => t.status === 'approved');
    const critical = tasks.filter((t) => ['critical', 'high'].includes(t.priority) && (t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t)));
    const documents = tasks.reduce((sum, t) => sum + (t.attachments?.length || 0), 0);

    const stages = [...(project.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const currentKey = effectiveCurrentKey(project.stages);
    const currentStage = stages.find((s) => s.key === currentKey) || null;
    const currentIndex = currentStage ? stages.findIndex((s) => s.key === currentStage.key) + 1 : null;
    const nextMilestone = stages.find((s) => s.status !== 'completed') || null;

    const planned = project.budget?.planned || 0;
    const actual = project.budget?.actual || 0;

    return {
      total: tasks.length,
      open: open.length,
      blocked: blocked.length,
      rework: rework.length,
      delayed: delayed.length,
      pendingApprovals: pendingApprovals.length,
      approved: approved.length,
      critical: critical.length,
      issues: blocked.length + rework.length,
      documents,
      teamCount: (project.members?.length || 0) + (project.owner ? 1 : 0),
      currentStage,
      currentIndex,
      nextMilestone,
      budget: { planned, actual, remaining: Math.max(0, planned - actual), utilization: project.budgetUtilization ?? (planned ? Math.round((actual / planned) * 100) : 0) },
    };
  }, [project, tasks]);
}

/** Header KPI figure with an icon cap. */
function HeaderKpi({ icon: Icon, cap, value, sub }) {
  return (
    <div className="pd-kpi-strip-item">
      <span className="pd-kpi-cap"><Icon size={12} /> {cap}</span>
      <span className="pd-kpi-strip-value">{value}</span>
      {sub && <span className="pd-kpi-strip-sub">{sub}</span>}
    </div>
  );
}

/**
 * The 10-phase workflow stepper. Each node's state (completed / current /
 * upcoming) is derived live from the project's own stage list via
 * getStageAccess — the current phase is whatever the backend's stage statuses
 * resolve to, never hardcoded.
 */
function StageStepper({ stages, onStageClick }) {
  const ordered = [...stages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <div className="pd-stepper">
      {ordered.map((s, i) => {
        const meta = STAGE_STATUS_META[s.status] || STAGE_STATUS_META.not_started;
        const access = getStageAccess(stages, s.key);
        const isCurrent = access === 'current';
        const isDone = s.status === 'completed';
        const locked = access === 'locked';
        const color = isDone ? '#059669' : isCurrent ? '#4F46E5' : meta.color;
        return (
          <div key={s.key} className="pd-step">
            <div className="pd-step-body">
              <button
                type="button"
                className="pd-step-dot"
                data-state={isDone ? 'completed' : isCurrent ? 'current' : 'upcoming'}
                style={{ '--step-color': color, opacity: locked ? 0.5 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                onClick={() => !locked && onStageClick?.(s)}
                disabled={locked}
                aria-label={locked ? `${s.name} — locked` : `Open ${s.name}`}
                title={locked ? `${s.name} — locked until Property Identification is Marked Done` : `Open ${s.name}`}
              >
                {isDone ? <Check size={16} strokeWidth={3} /> : locked ? <Lock size={14} /> : i + 1}
              </button>
              <span className="pd-step-name" data-current={isCurrent}>{s.name}</span>
              <span className="pd-step-sub" style={{ color }}>
                {isDone ? 'Completed' : locked ? 'Locked' : isCurrent ? 'Current Stage' : meta.label}
              </span>
            </div>
            {i < ordered.length - 1 && <span className="pd-step-connector" data-done={isDone} />}
          </div>
        );
      })}
    </div>
  );
}

/** One small operational KPI at the foot of the overview. */
function MiniCard({ icon: Icon, accent, label, value, sub, link, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className="pd-mini" style={{ '--mini-accent': accent }} onClick={onClick}>
      <div className="pd-mini-top">
        <span className="pd-mini-icon"><Icon size={16} strokeWidth={2.1} /></span>
        <span className="pd-mini-label">{label}</span>
      </div>
      <span className="pd-mini-value">{value}</span>
      {sub && <span className="pd-mini-sub">{sub}</span>}
      {link && <span className="pd-mini-link">{link} →</span>}
    </Tag>
  );
}

function OverviewTab({ project, metrics, tasksLoading, activity, activityLoading, onOpenStage, onGoTab }) {
  const dleft = daysUntil(project.targetEndDate);
  const healthMeta = HEALTH_META[project.health] || HEALTH_META.on_track;
  const b = metrics.budget;
  const stages = [...(project.stages || [])].sort((a, b2) => (a.order ?? 0) - (b2.order ?? 0));
  const lastActivity = (activity || [])[0];

  return (
    <div className="col gap-3">
      <div className="pd-overview">
        {/* Stage plan */}
        <SectionCard
          title="Stage Plan"
          subtitle={`${stages.filter((s) => s.status === 'completed').length} of ${stages.length} phases completed`}
          action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenStage(metrics.currentStage || stages[0])}>Open current <ChevronRight size={14} /></button>}
        >
          <div className="pd-stage-list">
            {stages.map((s, i) => {
              const meta = STAGE_STATUS_META[s.status] || STAGE_STATUS_META.not_started;
              const access = getStageAccess(project.stages, s.key);
              const isCurrent = access === 'current';
              const locked = access === 'locked';
              return (
                <button
                  key={s.key}
                  type="button"
                  className="pd-stage-row"
                  data-current={isCurrent}
                  style={locked ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                  onClick={() => !locked && onOpenStage(s)}
                  disabled={locked}
                  title={locked ? `${s.name} — locked until Property Identification is Marked Done` : undefined}
                >
                  <span className="pd-stage-index" style={{ '--stage-color': meta.color }}>
                    {s.status === 'completed' ? <Check size={14} strokeWidth={3} /> : locked ? <Lock size={13} /> : i + 1}
                  </span>
                  <span className="pd-stage-main">
                    <span className="pd-stage-name">{s.name}</span>
                    <span className="pd-stage-meta">
                      {fmtDate(s.plannedStart)} → {fmtDate(s.plannedEnd)}{s.slaDays ? ` · ${s.slaDays}d SLA` : ''}
                      {s.ownerDepartment ? ` · ${deptMeta(s.ownerDepartment).label}` : ''}
                    </span>
                  </span>
                  {locked
                    ? <Badge color="#6B7280" soft="#F3F4F6" dot>Locked</Badge>
                    : <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>}
                  <ChevronRight size={16} className="muted" />
                </button>
              );
            })}
          </div>
        </SectionCard>

        {/* Right rail: timeline+budget, health */}
        <div className="col gap-3">
          <SectionCard title="Timeline & Budget">
            <div className="col gap-3">
              <div className="pd-line"><span className="pd-line-label"><CalendarRange size={15} /> Planned start</span><span className="pd-line-value">{fmtDate(project.plannedStartDate)}</span></div>
              <div className="pd-line"><span className="pd-line-label"><Target size={15} /> Target go-live</span><span className="pd-line-value">{fmtDate(project.targetEndDate)}</span></div>
              <div className="pd-line"><span className="pd-line-label"><CalendarClock size={15} /> Days remaining</span>
                <span className="pd-line-value" style={{ color: dleft != null && dleft < 0 ? 'var(--danger)' : 'var(--text)' }}>
                  {dleft != null ? (dleft < 0 ? `${-dleft}d overdue` : `${dleft}d`) : '—'}
                </span>
              </div>
              <hr className="divider" />
              <div className="pd-line"><span className="pd-line-label"><Wallet size={15} /> Budget</span><span className="pd-line-value">{fmtCurrency(b.planned)}</span></div>
              <div className="col gap-1">
                <div className="row between tiny muted"><span>Spent {fmtCurrency(b.actual)}</span><span>{b.utilization}%</span></div>
                <ProgressBar value={b.utilization} height={7} gradient={b.utilization > 100 ? 'var(--danger)' : 'linear-gradient(90deg, var(--gold-300), var(--gold-600))'} />
                <div className="row between tiny muted"><span>Remaining {fmtCurrency(b.remaining)}</span><span>{b.planned ? Math.max(0, 100 - b.utilization) : 0}% left</span></div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Project Health">
            <div className="col gap-2">
              <div className="pd-health-banner" style={{ background: healthMeta.soft, border: `1px solid ${healthMeta.color}33` }}>
                <span className="pd-health-icon" style={{ color: healthMeta.color, background: `${healthMeta.color}22` }}>
                  <ShieldCheck size={18} />
                </span>
                <div className="col gap-1">
                  <span className="sm" style={{ fontWeight: 700, color: healthMeta.color }}>{healthMeta.label}</span>
                  <span className="tiny muted">
                    {metrics.critical > 0 ? `${metrics.critical} critical issue${metrics.critical === 1 ? '' : 's'} need attention.`
                      : metrics.blocked > 0 ? `${metrics.blocked} task${metrics.blocked === 1 ? '' : 's'} blocked.`
                        : 'Everything looks good. Keep going!'}
                  </span>
                </div>
              </div>
              <div className="pd-health-metrics">
                <div className="pd-health-metric"><span className="pd-health-metric-value">{tasksLoading ? '—' : metrics.blocked}</span><span className="pd-health-metric-label">Blocked Tasks</span></div>
                <div className="pd-health-metric"><span className="pd-health-metric-value" style={{ color: metrics.critical ? 'var(--danger)' : undefined }}>{tasksLoading ? '—' : metrics.critical}</span><span className="pd-health-metric-label">Critical Issues</span></div>
                <div className="pd-health-metric"><span className="pd-health-metric-value" style={{ color: metrics.delayed ? 'var(--danger)' : undefined }}>{tasksLoading ? '—' : metrics.delayed}</span><span className="pd-health-metric-label">Delayed Tasks</span></div>
                <div className="pd-health-metric"><span className="pd-health-metric-value">{metrics.pendingApprovals}</span><span className="pd-health-metric-label">Pending Approvals</span></div>
              </div>
              {metrics.nextMilestone && (
                <div className="pd-line" style={{ marginTop: 4 }}>
                  <span className="pd-line-label"><Flag size={14} /> Next milestone</span>
                  <span className="pd-line-value">{metrics.nextMilestone.name}</span>
                </div>
              )}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Operational mini-KPIs */}
      <div className="pd-mini-grid">
        <MiniCard icon={ListChecks} accent="#2563EB" label="Tasks" value={tasksLoading ? '—' : metrics.open} sub={`${metrics.total} total`} link="View Tasks" onClick={() => onGoTab('Task Board')} />
        <MiniCard icon={AlertTriangle} accent="#DC2626" label="Issues" value={tasksLoading ? '—' : metrics.issues} sub={`${metrics.critical} critical`} link="View Issues" onClick={() => onGoTab('Task Board')} />
        <MiniCard icon={FileText} accent="#D97706" label="Documents" value={tasksLoading ? '—' : metrics.documents} sub="On tasks" link="View Master Data" onClick={() => onGoTab('Master Data')} />
        <MiniCard icon={Users} accent="#059669" label="Team" value={metrics.teamCount} sub="Total members" />
        <MiniCard icon={ActivityIcon} accent="#7C3AED" label="Last Activity" value={activityLoading ? '—' : (lastActivity ? fromNow(lastActivity.createdAt) : 'None')} sub={lastActivity ? (lastActivity.actor?.name || 'System') : 'No updates yet'} link="View Activity" onClick={() => onGoTab('Activity')} />
      </div>
    </div>
  );
}

/** Enterprise activity timeline — actor, action, department, timestamp. */
function ActivityTab({ activity, isLoading }) {
  if (isLoading) {
    return <SectionCard title="Activity Log"><SkeletonActivity rows={6} /></SectionCard>;
  }
  const rows = activity || [];
  return (
    <SectionCard title="Activity Log" subtitle={`${rows.length} recent event${rows.length === 1 ? '' : 's'}`}>
      {!rows.length ? (
        <div className="empty sm" style={{ padding: '20px 12px' }}>No activity yet</div>
      ) : (
        <div className="col">
          {rows.map((a, i) => {
            const dept = a.actor?.department ? deptMeta(a.actor.department) : null;
            return (
              <div key={a._id} className="pd-activity-item">
                <div className="pd-activity-rail">
                  <Avatar name={a.actor?.name || 'System'} color={a.actor?.avatarColor || 'var(--ink-500)'} size={30} />
                  {i < rows.length - 1 && <span className="pd-activity-line" />}
                </div>
                <div className="pd-activity-body">
                  <div className="sm"><b>{a.actor?.name || 'System'}</b> <span className="muted">{a.message}</span></div>
                  <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {dept && <Badge color={dept.color}>{dept.label}</Badge>}
                    <span className="tiny subtle">{fmtDateTime(a.createdAt)} · {fromNow(a.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading, isError, refetch } = useProject(id);
  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, limit: 1000 });
  const { data: activity, isLoading: activityLoading } = useProjectActivity(id);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'Overview';
  const [tab, setTab] = useState(initialTab);
  const [selectedStageKey, setSelectedStageKey] = useState(null);

  const tasks = tasksResp?.data || tasksResp || [];
  const metrics = useProjectMetrics(project || { stages: [] }, tasks);

  const goTab = (t) => {
    setTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === 'Overview') next.delete('tab'); else next.set('tab', t);
    setSearchParams(next, { replace: true });
  };

  const openStage = (stage) => {
    if (!stage) return;
    // The 10 standard lifecycle phases each have their own dedicated page
    // (routed via the shared STAGES_CONFIG map, also used by the sidebar).
    if (STAGES_CONFIG.some((s) => s.key === stage.key)) {
      navigate(getStagePath(project._id, stage.key));
      return;
    }
    if (stage.captureMode === 'collection') {
      navigate(`/projects/${project._id}/property-identification`);
      return;
    }
    setSelectedStageKey(stage.key);
  };

  if (isLoading) {
    return (<><Topbar title="Project" /><div className="content"><SkDetail /></div></>);
  }
  if (isError || !project) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate('/projects')}><ArrowLeft size={16} /></button>Project</span>} />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><AlertTriangle size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>Couldn’t load this project</span>
                <span className="sm muted">The project service didn’t respond. Please try again.</span>
              </div>
              <button type="button" className="btn btn-primary" onClick={() => refetch()}><RotateCcw size={15} style={{ marginRight: 6 }} /> Retry</button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Drafts have no template/stages/tasks materialized yet (see
  // project.service.js#createDraft) — every tab below assumes a real,
  // materialized project, so a draft's detail page stops here rather than
  // rendering broken/empty tabs. Continue Editing reopens the Create Project
  // modal on the Projects list, carried over via router state (same pattern
  // ProjectsPage's `lens` preselection already uses).
  if (project.status === 'draft') {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate('/projects')}><ArrowLeft size={16} /></button>Project</span>} />
        <div className="content">
          <div className="card">
            <div className="pd-error">
              <span className="pd-error-icon"><PenLine size={24} /></span>
              <div className="col gap-1 center">
                <span style={{ fontWeight: 700 }}>"{project.name}" is still a draft</span>
                <span className="sm muted">It hasn't been created yet — no phases, tasks or workflow exist for it. Continue editing to finish setting it up.</span>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate('/projects', { state: { continueDraftId: project._id } })}
              >
                <PenLine size={15} style={{ marginRight: 6 }} /> Continue Editing
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const selectedStage = selectedStageKey ? project.stages.find((s) => s.key === selectedStageKey) : null;
  const dleft = daysUntil(project.targetEndDate);

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
      <div className="content projects-content">
        <div className="content-wide col gap-3 fade-in">
          {/* Header card */}
          <div className="card pd-header">
            <div className="pd-header-row">
              <div className="pd-ident">
                <div className="pd-ring-wrap">
                  <ProgressRing value={project.progress} size={76} stroke={7} />
                  <span className="pd-ring-value">{project.progress ?? 0}%</span>
                </div>
                <div className="pd-ident-meta">
                  <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
                    <ProjectStatusBadge value={project.status} />
                    <HealthBadge value={project.health} />
                    {metrics.currentStage && (
                      <Badge color="#4F46E5" soft="#EEF2FF" dot>
                        Phase {metrics.currentIndex}: {metrics.currentStage.name}
                      </Badge>
                    )}
                  </div>
                  <span className="pd-loc"><MapPin size={14} />{[project.city, project.address].filter(Boolean).join(' · ') || '—'}</span>
                </div>
              </div>

              <div className="pd-kpi-strip">
                <HeaderKpi icon={Layers} cap="Stages" value={project.stages.length} sub="Total" />
                <HeaderKpi icon={CalendarRange} cap="Opening" value={fmtDate(project.plannedStartDate)} sub="Target Date" />
                <HeaderKpi icon={Target} cap="Go-Live" value={fmtDate(project.targetEndDate)} sub="Target Date" />
                <HeaderKpi icon={CalendarClock} cap="Days Left" value={dleft != null ? (dleft < 0 ? `${-dleft}d over` : `${dleft}d`) : '—'} sub="To go-live" />
                <HeaderKpi icon={Wallet} cap="Budget" value={fmtCurrency(project.budget?.planned)} sub={`${metrics.budget.utilization}% used`} />
              </div>
            </div>

            <hr className="divider" style={{ margin: 0 }} />
            <StageStepper stages={project.stages} onStageClick={openStage} />
          </div>

          {/* Tabs */}
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => goTab(t)}>{t}</button>
            ))}
          </div>

          {tab === 'Overview' && (
            <OverviewTab
              project={project}
              metrics={metrics}
              tasksLoading={tasksLoading}
              activity={activity}
              activityLoading={activityLoading}
              onOpenStage={openStage}
              onGoTab={goTab}
            />
          )}
          {tab === 'Task Board' && <TaskBoard projectId={project._id} />}
          {tab === 'Master Data' && <MasterDataPanel project={project} />}
          {tab === 'Activity' && <ActivityTab activity={activity} isLoading={activityLoading} />}
        </div>
      </div>

      {selectedStage && (
        <StageDetailModal project={project} stage={selectedStage} onClose={() => setSelectedStageKey(null)} />
      )}
    </>
  );
}

export default ProjectDetailPage;
