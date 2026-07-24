import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, AlertTriangle, Rocket, Lock, ChevronRight,
  Settings2, Monitor, CreditCard, Wifi, BatteryCharging, Users, ShieldCheck, PhoneCall,
  Package, Megaphone, Scale, IndianRupee, Plus, ArrowRight, Award, Bell, Circle,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Countdown } from '../../components/ui/Countdown.jsx';
import {
  useProject, useTasks, useCompleteStage, useCreateTask, useProjectActivity,
  useUpdateTaskStatus, useSaveMasterData, useNotifications,
} from '../../lib/queries.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  TASK_STATUS_META, deptMeta, isReworkStatus, isTaskDelayed,
  LAUNCH_CATEGORY_META, LAUNCH_CATEGORY_ORDER, launchCategoryMeta,
} from '../../lib/ui.js';
import { ActivityLog } from '../tasks/taskDetailShared.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { getStagePath } from './stagesConfig.jsx';
import { AllocateTaskModal } from './DepartmentPlanningPage.jsx';

const STAGE_KEY = 'p9';
const ANCHOR_TASK_KEY = 'p9_golive_final';

/** Icon per Go-Live Checklist category — same role CATEGORY_ICONS plays for
 * Store Readiness (Phase 8); exported so CategoryDetailsPage's p9 route uses
 * the same icon per category. */
export const LAUNCH_CATEGORY_ICONS = {
  operations: ShieldCheck,
  it: Monitor,
  pos: CreditCard,
  internet: Wifi,
  power_backup: BatteryCharging,
  staff: Users,
  security: Settings2,
  emergency_contacts: PhoneCall,
  inventory: Package,
  marketing: Megaphone,
  legal: Scale,
  finance: IndianRupee,
};

/** The spec's 6 named Pre-Launch Activities, each mapped to the specific
 * template task that best represents it — real Task data, not fabricated
 * rows. Matched by `templateTaskKey` so materialized tasks resolve reliably. */
const PRE_LAUNCH_ACTIVITIES = [
  { label: 'Final Staff Briefing', templateTaskKey: 'p9_staff_5' },
  { label: 'System Health Check', templateTaskKey: 'p9_it_1' },
  { label: 'POS Testing', templateTaskKey: 'p9_pos_4' },
  { label: 'Inventory Validation', templateTaskKey: 'p9_inventory_1' },
  { label: 'Marketing Activation', templateTaskKey: 'p9_marketing_1' },
  { label: 'Safety Inspection', templateTaskKey: 'p9_operations_3' },
];

const TIMELINE_STEPS = ['Store Ready', 'Go-Live Approval', 'Pre-Launch Verification', 'Final Sign-Off', 'Store Launch'];

const PAGE_TABS = [
  { key: 'overview', label: 'Launch Overview' },
  { key: 'checklist', label: 'Go-Live Checklist' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'timeline', label: 'Launch Plan' },
  { key: 'activity', label: 'Activity Log' },
];

function KpiCard({ icon: Icon, label, value, color, badge }) {
  return (
    <div className="card" style={{ padding: '14px 16px', flex: '1 1 0', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: `${color}1A`, color, display: 'grid', placeItems: 'center' }}>
          <Icon size={17} strokeWidth={2.2} />
        </span>
        {badge}
      </div>
      <div className="col" style={{ gap: 1 }}>
        <span style={{ fontSize: 22, fontWeight: 750, lineHeight: 1 }}>{value}</span>
        <span className="tiny muted">{label}</span>
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="col gap-1" style={{ minWidth: 0 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650 }}>{value ?? '—'}</span>
    </div>
  );
}

/** Category card — mirrors Phase 8's CategoryCard exactly (icon, %, counts,
 * progress bar, status badge), keyed off the launch category taxonomy. */
function CategoryCard({ cat, onOpen }) {
  const Icon = LAUNCH_CATEGORY_ICONS[cat.key] || ClipboardList;
  const meta = {
    completed: { label: 'Completed', color: '#059669', soft: '#DCFCE7' },
    blocked: { label: 'Blocked', color: '#DC2626', soft: '#FEE2E2' },
    in_progress: { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' },
    pending: { label: 'Pending', color: '#D97706', soft: '#FEF3C7' },
    not_started: { label: 'Not Started', color: '#6B7280', soft: '#F3F4F6' },
  }[cat.status];
  return (
    <button type="button" className="card" onClick={onOpen} style={{ textAlign: 'left', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, cursor: 'pointer' }}>
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: `${cat.color}1A`, color: cat.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <ChevronRight size={16} className="muted" />
      </div>
      <div className="col gap-1">
        <span style={{ fontWeight: 650 }}>{cat.label}</span>
        <span className="tiny muted">{cat.total} checklist item{cat.total === 1 ? '' : 's'}</span>
      </div>
      <ProgressBar value={cat.pct} height={6} gradient={cat.color} />
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="tiny muted">{cat.completed}/{cat.total} completed</span>
        <Badge color={meta.color} soft={meta.soft} dot>{meta.label}</Badge>
      </div>
    </button>
  );
}

/** Go-Live Timeline — 5 fixed milestones, each derived from real state:
 * Store Ready (p8 completed), Go-Live Approval (anchor task dept tier),
 * Pre-Launch Verification (aggregate checklist %), Final Sign-Off (anchor
 * task management tier), Store Launch (p9 stage completed). */
function LaunchTimeline({ steps }) {
  return (
    <div className="pc-timeline" style={{ flexDirection: 'row', alignItems: 'center' }}>
      {steps.map((s, i) => (
        <div key={s.label} className="row gap-2" style={{ alignItems: 'center', flex: i < steps.length - 1 ? '1 1 auto' : '0 0 auto' }}>
          <div className="col gap-1" style={{ alignItems: 'center', minWidth: 100 }}>
            <span
              style={{
                width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: s.status === 'completed' ? '#059669' : s.status === 'current' ? '#2563EB1A' : 'var(--surface-hover)',
                color: s.status === 'completed' ? '#fff' : s.status === 'current' ? '#2563EB' : 'var(--text-subtle)',
                border: s.status === 'current' ? '2px solid #2563EB' : 'none',
              }}
            >
              {s.status === 'completed' ? <CheckCircle2 size={16} /> : <Circle size={14} />}
            </span>
            <span className="tiny" style={{ fontWeight: 600, textAlign: 'center' }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: steps[i + 1].status !== 'upcoming' ? '#059669' : 'var(--border)', minWidth: 24 }} />}
        </div>
      ))}
    </div>
  );
}

/**
 * Store Launch — Phase 9's Go-Live Command Center. Every checklist item is a
 * real Task (`stageKey:'p9'`, grouped by `taskCategory` per LAUNCH_CATEGORIES)
 * going through the same two-tier approval pipeline Phase 6/7/8 already use —
 * see storeLaunchTemplate.js's p9 `tasks` blueprint. Nothing on this page is
 * fabricated; the Launch Store gate is re-validated server-side in
 * project.service.js#completeStage's `p9` branch, which is the actual
 * execution point for going live (project.status -> 'store_live').
 */
export function StoreLaunchPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading } = useProject(id);
  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey: STAGE_KEY, limit: 1000 });
  const tasks = tasksResp?.data || tasksResp || [];
  const { data: activities } = useProjectActivity(id);
  const { data: notifications } = useNotifications({ project: id, limit: 5 });

  const completeStage = useCompleteStage(id);
  const createTask = useCreateTask(id);
  const updateStatus = useUpdateTaskStatus(id);
  const saveMasterData = useSaveMasterData(id);
  const user = useAuthStore((s) => s.user);
  const canLaunch = user?.role === 'admin' || user?.role === 'manager';

  const [pageTab, setPageTab] = useState('overview');
  const [modal, setModal] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);

  const stage = project?.stages?.find((s) => s.key === STAGE_KEY);
  const p8Stage = project?.stages?.find((s) => s.key === 'p8');
  const isLive = project?.status === 'store_live';
  const isCompleted = stage?.status === 'completed';

  const openTaskDetail = (t) => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`);
  const openCategory = (key) => navigate(`/projects/${id}/store-launch/category/${key}`);
  const onTaskStatusChange = (taskId, status) => updateStatus.mutate({ id: taskId, status });

  const anchorTask = tasks.find((t) => t.templateTaskKey === ANCHOR_TASK_KEY) || null;

  const categories = useMemo(() => LAUNCH_CATEGORY_ORDER.map((key) => {
    const catTasks = tasks.filter((t) => t.taskCategory === key);
    const total = catTasks.length;
    const completed = catTasks.filter((t) => t.status === 'approved').length;
    const blocked = catTasks.filter((t) => t.status === 'blocked' || isReworkStatus(t.status)).length;
    const active = catTasks.filter((t) => ['in_progress', 'waiting_approval', 'waiting_management_approval', 'done'].includes(t.status)).length;
    const pct = total ? Math.round((completed / total) * 100) : 0;
    let status = 'not_started';
    if (total > 0) {
      if (completed === total) status = 'completed';
      else if (blocked > 0) status = 'blocked';
      else if (completed > 0 || active > 0) status = 'in_progress';
      else status = 'pending';
    }
    return { key, ...launchCategoryMeta(key), total, completed, blocked, active, pct, status };
  }), [tasks]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'approved').length;
  const overallPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const criticalIssues = useMemo(() => tasks
    .filter((t) => ['critical', 'high'].includes(t.priority) && (t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t)))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'critical' ? -1 : 1)), [tasks]);

  // Per-department dept-tier approval rows + one aggregate Management row +
  // one Go-Live (Final) row bound to the anchor task — real roles only
  // (admin/manager), no fictional CEO/Ops-Head/Finance-Head rows.
  const departments = useMemo(() => [...new Set(tasks.map((t) => t.department).filter(Boolean))].sort(), [tasks]);
  const deptApprovalRows = departments.map((dep) => {
    const depTasks = tasks.filter((t) => t.department === dep);
    const cleared = depTasks.filter((t) => ['waiting_management_approval', 'approved'].includes(t.status));
    const latest = [...depTasks].filter((t) => t.approvedAt).sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt))[0];
    return {
      key: dep, label: `${deptMeta(dep).label} Approval`, total: depTasks.length, done: cleared.length,
      approvedBy: latest?.approvedBy?.name, approvedAt: latest?.approvedAt, signature: latest?.approvalSignature,
    };
  });
  const mgmtCleared = tasks.filter((t) => t.status === 'approved');
  const mgmtLatest = [...tasks].filter((t) => t.managementApprovedAt).sort((a, b) => new Date(b.managementApprovedAt) - new Date(a.managementApprovedAt))[0];

  const deptPct = totalTasks ? Math.round((tasks.filter((t) => ['waiting_management_approval', 'approved'].includes(t.status)).length / totalTasks) * 100) : 0;
  const mgmtPct = totalTasks ? Math.round((mgmtCleared.length / totalTasks) * 100) : 0;

  const stageActivity = useMemo(() => (activities || [])
    .filter((a) => a.meta?.stageKey === STAGE_KEY)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [activities]);

  const categoryOptions = LAUNCH_CATEGORY_ORDER.map((key) => ({ key, name: LAUNCH_CATEGORY_META[key] }));
  const departmentOptions = departments.map((key) => ({ key, name: deptMeta(key).label }));

  const launchDetails = project?.masterData?.[STAGE_KEY] || {};
  const targetLaunch = launchDetails.launchDateTime;

  const readyToLaunch = totalTasks > 0 && overallPct === 100 && criticalIssues.length === 0 && anchorTask?.status === 'approved';
  const launchReasons = [];
  if (totalTasks === 0) launchReasons.push('No Go-Live checklist items exist yet');
  else if (overallPct < 100) launchReasons.push(`${totalTasks - completedTasks} checklist item${totalTasks - completedTasks === 1 ? '' : 's'} not yet approved`);
  if (criticalIssues.length > 0) launchReasons.push(`${criticalIssues.length} critical issue${criticalIssues.length === 1 ? '' : 's'} still open`);
  if (anchorTask && anchorTask.status !== 'approved') launchReasons.push('Final Go-Live Approval has not been given');
  if (p8Stage && p8Stage.status !== 'completed') launchReasons.push('Store Readiness (Phase 8) is not yet completed');

  const launchStatus = isLive ? 'Live' : criticalIssues.length > 0 ? 'Not Ready' : targetLaunch && new Date(targetLaunch) < new Date() ? 'Delayed' : readyToLaunch ? 'Ready' : 'Not Ready';
  const launchStatusMeta = {
    Live: { color: '#059669', soft: '#DCFCE7' }, Ready: { color: '#059669', soft: '#DCFCE7' },
    Delayed: { color: '#DC2626', soft: '#FEE2E2' }, 'Not Ready': { color: '#D97706', soft: '#FEF3C7' },
  }[launchStatus];

  const timelineSteps = TIMELINE_STEPS.map((label, i) => {
    const done = [p8Stage?.status === 'completed', anchorTask?.approvedAt, overallPct === 100, anchorTask?.status === 'approved', isLive];
    const isDone = done[i];
    const isCurrent = !isDone && done.slice(0, i).every(Boolean);
    return { label, status: isDone ? 'completed' : isCurrent ? 'current' : 'upcoming' };
  });

  const createNewTask = async (payload) => { await createTask.mutateAsync(payload); setModal(false); };

  const doLaunch = () => {
    setLaunchError('');
    completeStage.mutate(STAGE_KEY, {
      onSuccess: () => setConfirmOpen(false),
      onError: (err) => { setLaunchError(err?.response?.data?.message || 'Store is not ready to launch yet.'); setConfirmOpen(false); },
    });
  };

  const printCertificate = () => {
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`
      <html><head><title>Go-Live Certificate — ${project.code}</title>
      <style>
        body { font-family: Georgia, serif; padding: 48px; text-align: center; color: #1a1a1a; }
        .frame { border: 4px double #16a79a; padding: 40px; }
        h1 { font-size: 26px; margin-bottom: 4px; }
        h2 { font-size: 16px; font-weight: normal; color: #555; margin-top: 0; }
        .store { font-size: 22px; font-weight: bold; margin: 24px 0 4px; }
        .code { color: #555; margin-bottom: 24px; }
        table { margin: 24px auto; border-collapse: collapse; }
        td { padding: 6px 18px; text-align: left; font-size: 13px; }
        td.label { color: #777; }
      </style></head>
      <body>
        <div class="frame">
          <h1>Certificate of Go-Live</h1>
          <h2>Mystery Rooms — Store Launch</h2>
          <div class="store">${project.name}</div>
          <div class="code">${project.code}</div>
          <table>
            <tr><td class="label">Launch Date &amp; Time</td><td>${project.storeLiveAt ? new Date(project.storeLiveAt).toLocaleString() : '—'}</td></tr>
            <tr><td class="label">Store ID</td><td>${project.code}</td></tr>
            <tr><td class="label">Project Completion</td><td>${project.progress ?? 0}%</td></tr>
            <tr><td class="label">Final Go-Live Approval</td><td>${anchorTask?.managementApprovalSignature || anchorTask?.managementApprovedBy?.name || '—'}</td></tr>
          </table>
        </div>
      </body></html>
    `);
    doc.close();
    iframe.onload = () => { iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(() => iframe.remove(), 1000); };
  };

  if (isLoading || !project) {
    return (<><Topbar title="Store Launch" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!stage) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Store Launch</span>} />
        <div className="content"><EmptyState icon={ClipboardList} title="No Store Launch stage" hint="This project has no Store Launch stage." /></div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project"><ArrowLeft size={16} /></button>
            Phase 9: {stage.name}
          </span>
        }
        subtitle={`${project.code} · ${project.name} · Go-live approval and store opening management`}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal(true)}>
            <Plus size={14} style={{ marginRight: 6 }} /> Create
          </button>
        }
      />
      <div className="content page-compact store-launch-page">
        <div className="content-wide col gap-3 fade-in">
          {tasksLoading ? (
            <SkPropertyIdentification />
          ) : totalTasks === 0 ? (
            <EmptyState icon={ClipboardList} title="No Go-Live checklist items yet" hint="This project's Go-Live Checklist hasn't been generated yet — it's created automatically when the project reaches Phase 9." />
          ) : (
            <>
              <div className="tabs">
                {PAGE_TABS.map((tb) => (
                  <button key={tb.key} type="button" className={`tab${pageTab === tb.key ? ' active' : ''}`} onClick={() => setPageTab(tb.key)}>{tb.label}</button>
                ))}
              </div>

              {pageTab === 'overview' && (
                <>
                  {isLive && (
                    <div className="row gap-3" style={{ alignItems: 'center', padding: '14px 18px', borderRadius: 10, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
                      <Rocket size={18} style={{ color: 'var(--success)' }} />
                      <div className="col gap-1">
                        <span className="sm" style={{ fontWeight: 700, color: 'var(--success)' }}>Store Live — Launch Successful</span>
                        <span className="tiny muted">Launched {fmtDateTime(project.storeLiveAt)} · Store ID {project.code} · Project {project.progress ?? 0}% complete</span>
                      </div>
                      <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={printCertificate}>
                        <Award size={14} style={{ marginRight: 6 }} /> View Go-Live Certificate
                      </button>
                    </div>
                  )}

                  <div className="row gap-2" style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
                    <KpiCard icon={ClipboardList} value={`${overallPct}%`} label="Overall Launch Readiness" color="#059669" />
                    <KpiCard icon={ShieldCheck} value={anchorTask ? (TASK_STATUS_META[anchorTask.status]?.label || anchorTask.status) : '—'} label="Go-Live Approval" color="#2563EB" />
                    <KpiCard icon={Clock} value={targetLaunch ? fmtDate(targetLaunch) : '—'} label="Target Launch Date" color="#7C3AED" />
                    <KpiCard icon={Rocket} value={launchStatus} label="Launch Status" color={launchStatusMeta.color} badge={<Badge color={launchStatusMeta.color} soft={launchStatusMeta.soft} dot>{launchStatus}</Badge>} />
                    <KpiCard icon={AlertTriangle} value={criticalIssues.length} label="Open Critical Issues" color="#DC2626" />
                  </div>

                  <SectionCard title="Go-Live Timeline">
                    <LaunchTimeline steps={timelineSteps} />
                  </SectionCard>

                  <div className="row gap-3" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <div className="col gap-3" style={{ flex: '2 1 560px', minWidth: 320 }}>
                      <SectionCard title="Launch Details" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingDetails((v) => !v)}>{editingDetails ? 'Close' : 'Edit'}</button>}>
                        {editingDetails ? (
                          <LaunchDetailsForm
                            initial={launchDetails}
                            saving={saveMasterData.isPending}
                            onSave={async (values) => { await saveMasterData.mutateAsync({ stageKey: STAGE_KEY, values }); setEditingDetails(false); }}
                          />
                        ) : (
                          <div className="sl-summary-row1">
                            <InfoTile label="Store Code" value={project.code} />
                            <InfoTile label="Location" value={[project.city, project.address].filter(Boolean).join(', ')} />
                            <InfoTile label="Launch Date" value={targetLaunch ? fmtDate(targetLaunch) : '—'} />
                            <InfoTile label="Launch Time" value={targetLaunch ? new Date(targetLaunch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'} />
                            <InfoTile label="Store Type" value={launchDetails.storeType} />
                            <InfoTile label="Project Manager" value={project.owner?.name} />
                            <InfoTile label="Regional Head" value={launchDetails.regionalHead} />
                            <InfoTile label="Operations Head" value={launchDetails.opsHead} />
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard title="Go-Live Checklist Summary" subtitle="Click a category to open its checklist">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                          {categories.map((cat) => <CategoryCard key={cat.key} cat={cat} onOpen={() => openCategory(cat.key)} />)}
                        </div>
                      </SectionCard>

                      <SectionCard title="Pre-Launch Activities">
                        <PreLaunchActivities tasks={tasks} onOpenTask={openTaskDetail} />
                      </SectionCard>
                    </div>

                    <div className="col gap-3" style={{ flex: '1 1 300px', minWidth: 280 }}>
                      <SectionCard title="Approvals" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPageTab('approvals')}>View all</button>}>
                        <div className="col gap-2">
                          {deptApprovalRows.slice(0, 3).map((r) => (
                            <div key={r.key} className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className="sm">{r.label}</span>
                              <Badge color={r.done === r.total && r.total > 0 ? '#059669' : '#D97706'} soft={r.done === r.total && r.total > 0 ? '#DCFCE7' : '#FEF3C7'}>{r.done === r.total && r.total > 0 ? 'Approved' : 'Pending'}</Badge>
                            </div>
                          ))}
                          <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="sm">Final Go-Live Approval</span>
                            <Badge color={anchorTask?.status === 'approved' ? '#059669' : '#D97706'} soft={anchorTask?.status === 'approved' ? '#DCFCE7' : '#FEF3C7'}>{anchorTask ? (TASK_STATUS_META[anchorTask.status]?.label || anchorTask.status) : 'Pending'}</Badge>
                          </div>
                        </div>
                      </SectionCard>

                      <SectionCard title="Go-Live Countdown">
                        <Countdown target={targetLaunch} />
                      </SectionCard>

                      <div
                        className={`card pc-next-card${isCompleted ? '' : ' locked'}`}
                        onClick={() => isCompleted && navigate(getStagePath(id, 'p10'))}
                      >
                        <div className="col">
                          <span className="pc-next-card-label">{isCompleted ? 'Next Phase Unlocked' : 'Next Step'}</span>
                          <span className="pc-next-card-phase">Phase 10</span>
                          <span className="pc-next-card-name">Project Closure</span>
                          {!isCompleted && <span className="tiny subtle" style={{ marginTop: 4 }}>All Go-Live checklist items approved</span>}
                        </div>
                        {isCompleted ? <ChevronRight size={18} color="var(--sl-green, #059669)" /> : <Lock size={16} color="var(--text-subtle)" />}
                      </div>

                      <SectionCard title="Critical Alerts">
                        {criticalIssues.length === 0 ? (
                          <EmptyState icon={CheckCircle2} title="No critical issues" />
                        ) : (
                          <div className="col gap-2">
                            {criticalIssues.slice(0, 5).map((t) => (
                              <div key={t._id} className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => openTaskDetail(t)}>
                                <span className="sm">{t.title}</span>
                                <Badge color="#DC2626" soft="#FEE2E2">{TASK_STATUS_META[t.status]?.label || t.status}</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard title="Recent Notifications">
                        {!notifications?.length ? (
                          <EmptyState icon={Bell} title="No notifications yet" />
                        ) : (
                          <div className="col gap-2">
                            {notifications.map((n) => (
                              <div key={n._id} className="col gap-1">
                                <span className="sm" style={{ fontWeight: 600 }}>{n.title}</span>
                                <span className="tiny muted">{n.message}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </SectionCard>
                    </div>
                  </div>

                  <SectionCard title={isLive ? 'Store Live' : 'Launch Store'}>
                    {isLive ? (
                      <div className="row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 700 }}>
                        <CheckCircle2 size={16} /> This store has gone live and cannot be re-launched.
                      </div>
                    ) : (
                      <div className="col gap-2">
                        {readyToLaunch ? (
                          <div className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)' }}>
                            <CheckCircle2 size={15} /> Ready for Go-Live — every gate has cleared.
                          </div>
                        ) : (
                          <ul className="col gap-1" style={{ margin: 0, paddingLeft: 18 }}>
                            {launchReasons.map((r) => <li key={r} className="tiny muted">{r}</li>)}
                          </ul>
                        )}
                        {launchError && <span className="tiny" style={{ color: 'var(--danger)' }}>{launchError}</span>}
                        {canLaunch && (
                          <button type="button" className="btn btn-primary" disabled={!readyToLaunch || completeStage.isPending} onClick={() => setConfirmOpen(true)} style={{ alignSelf: 'flex-start' }}>
                            <Rocket size={15} style={{ marginRight: 6 }} /> Launch Store <ArrowRight size={13} style={{ marginLeft: 6 }} />
                          </button>
                        )}
                      </div>
                    )}
                  </SectionCard>
                </>
              )}

              {pageTab === 'checklist' && (
                <SectionCard title={`Go-Live Checklist (${totalTasks})`} subtitle="Every checklist item across all categories — open one to act on it">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                    {categories.map((cat) => <CategoryCard key={cat.key} cat={cat} onOpen={() => openCategory(cat.key)} />)}
                  </div>
                </SectionCard>
              )}

              {pageTab === 'approvals' && (
                <div className="col gap-3">
                  <SectionCard title="Approval Progress">
                    <div className="row gap-4 wrap">
                      <div className="col gap-1" style={{ flex: '1 1 220px', minWidth: 200 }}>
                        <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Department Verification</span><Badge color={deptPct === 100 ? '#059669' : '#D97706'} soft={deptPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{deptPct === 100 ? 'Completed' : 'In Progress'}</Badge></div>
                        <ProgressBar value={deptPct} height={7} gradient="#2563EB" />
                      </div>
                      <div className="col gap-1" style={{ flex: '1 1 220px', minWidth: 200 }}>
                        <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Management Verification</span><Badge color={mgmtPct === 100 ? '#059669' : '#D97706'} soft={mgmtPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{mgmtPct === 100 ? 'Completed' : 'In Progress'}</Badge></div>
                        <ProgressBar value={mgmtPct} height={7} gradient="#059669" />
                      </div>
                    </div>
                    {mgmtLatest && (
                      <div className="tiny muted" style={{ marginTop: 10 }}>
                        Last management approval by {mgmtLatest.managementApprovedBy?.name || '—'} on {fmtDateTime(mgmtLatest.managementApprovedAt)}
                        {mgmtLatest.managementApprovalSignature ? ` — signed "${mgmtLatest.managementApprovalSignature}"` : ''}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Department Approvals">
                    {deptApprovalRows.length === 0 ? <EmptyState title="No departments on this checklist yet" /> : (
                      <div className="col gap-2">
                        {deptApprovalRows.map((r) => (
                          <div key={r.key} className="row gap-3 wrap" style={{ alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
                            <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{r.label}</span>
                            <span className="tiny muted">{r.done}/{r.total} cleared</span>
                            {r.approvedBy && <span className="tiny muted">by {r.approvedBy} · {fmtDateTime(r.approvedAt)}</span>}
                            <Badge color={r.done === r.total && r.total > 0 ? '#059669' : '#D97706'} soft={r.done === r.total && r.total > 0 ? '#DCFCE7' : '#FEF3C7'}>{r.done === r.total && r.total > 0 ? 'Approved' : 'In Progress'}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Go-Live Approval (Final)">
                    {!anchorTask ? <EmptyState title="Final Go-Live Approval task not found" /> : (
                      <div className="row gap-3 wrap" style={{ alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }} onClick={() => openTaskDetail(anchorTask)}>
                        <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{anchorTask.title}</span>
                        {anchorTask.managementApprovedBy?.name && <span className="tiny muted">by {anchorTask.managementApprovedBy.name} · {fmtDateTime(anchorTask.managementApprovedAt)}</span>}
                        <Badge color={TASK_STATUS_META[anchorTask.status]?.color} soft={TASK_STATUS_META[anchorTask.status]?.soft} dot>{TASK_STATUS_META[anchorTask.status]?.label || anchorTask.status}</Badge>
                      </div>
                    )}
                  </SectionCard>
                </div>
              )}

              {pageTab === 'timeline' && (
                <SectionCard title="Go-Live Timeline">
                  <LaunchTimeline steps={timelineSteps} />
                </SectionCard>
              )}

              {pageTab === 'activity' && (
                <SectionCard title="Activity Log" subtitle="Every status change, upload and comment across this phase's checklist items">
                  <ActivityLog activity={stageActivity} />
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>

      <AllocateTaskModal
        open={modal}
        onClose={() => setModal(false)}
        projectId={id}
        departments={departmentOptions}
        presetDept=""
        stageKey={STAGE_KEY}
        categoryOptions={categoryOptions}
        onCreate={createNewTask}
        creating={createTask.isPending}
        tasks={tasks}
      />

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm Launch"
        subtitle={`${project.name} (${project.code}) will go live immediately.`}
        footer={
          <div className="row gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setConfirmOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={completeStage.isPending} onClick={doLaunch}>
              {completeStage.isPending ? 'Launching…' : 'Confirm Launch'}
            </button>
          </div>
        }
      >
        <p className="sm muted">
          This action is irreversible — once confirmed, the project status changes to Store Live, a launch timestamp
          is recorded, Phases 1-8 become read-only, and stakeholders are notified. Continue?
        </p>
      </Modal>
    </>
  );
}

/** Inline edit form for the 4 Launch Details master-data fields. */
function LaunchDetailsForm({ initial, saving, onSave }) {
  const [values, setValues] = useState({
    launchDateTime: initial.launchDateTime ? String(initial.launchDateTime).slice(0, 16) : '',
    storeType: initial.storeType || '',
    regionalHead: initial.regionalHead || '',
    opsHead: initial.opsHead || '',
  });
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return (
    <div className="col gap-3">
      <div className="sl-summary-row1">
        <div className="col gap-1">
          <span className="tiny subtle upper">Launch Date &amp; Time</span>
          <input className="input" type="datetime-local" value={values.launchDateTime} onChange={set('launchDateTime')} />
        </div>
        <div className="col gap-1">
          <span className="tiny subtle upper">Store Type</span>
          <select className="input" value={values.storeType} onChange={set('storeType')}>
            <option value="">Select…</option>
            {['Flagship', 'Standard', 'Kiosk', 'Mall'].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="col gap-1">
          <span className="tiny subtle upper">Regional Head</span>
          <input className="input" value={values.regionalHead} onChange={set('regionalHead')} />
        </div>
        <div className="col gap-1">
          <span className="tiny subtle upper">Operations Head</span>
          <input className="input" value={values.opsHead} onChange={set('opsHead')} />
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={saving} style={{ alignSelf: 'flex-start' }} onClick={() => onSave(values)}>
        {saving ? 'Saving…' : 'Save Launch Details'}
      </button>
    </div>
  );
}

/** The spec's 6 named Pre-Launch Activities, resolved against real tasks. */
function PreLaunchActivities({ tasks, onOpenTask }) {
  const rows = PRE_LAUNCH_ACTIVITIES.map((a) => ({ ...a, task: tasks.find((t) => t.templateTaskKey === a.templateTaskKey) }));
  return (
    <div className="col gap-2">
      {rows.map((r) => {
        const st = r.task ? TASK_STATUS_META[r.task.status] : null;
        return (
          <div key={r.label} className="row gap-3 wrap" style={{ alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: r.task ? 'pointer' : 'default' }} onClick={() => r.task && onOpenTask(r.task)}>
            <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{r.label}</span>
            <span className="tiny muted">{r.task?.assignee?.name || 'Unassigned'}</span>
            <span className="tiny muted">{r.task?.actualEnd ? `Completed ${fmtDateTime(r.task.actualEnd)}` : ''}</span>
            {st ? <Badge color={st.color} soft={st.soft} dot>{st.label}</Badge> : <Badge color="#6B7280" soft="#F3F4F6">Not Set Up</Badge>}
          </div>
        );
      })}
    </div>
  );
}

export default StoreLaunchPage;
