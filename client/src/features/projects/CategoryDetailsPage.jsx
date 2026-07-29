import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, FileText, Image as ImageIcon, Video as VideoIcon,
  Activity as ActivityIcon, History, CalendarDays, MessageCircle, Paperclip,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, Avatar } from '../../components/ui/primitives.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { useProject, useProjectActivity } from '../../app/api/projectsApi.js';
import { useTasks, useUpdateTaskStatus } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  TASK_STATUS_META, TASK_STATUS_ORDER, PRIORITY_META, deptMeta, isReworkStatus,
  READINESS_CATEGORY_META, readinessCategoryMeta,
} from '../../lib/ui.js';
import { isImage, isVideo, AttachmentRow, VideoCard, ActivityLog } from '../tasks/taskDetailShared.jsx';
import { RowActionsMenu } from './DepartmentTasksPage.jsx';
import { CATEGORY_ICONS } from './StoreReadinessDashboardPage.jsx';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';

const TABS = [
  { key: 'overview', label: 'Overview', icon: ClipboardList },
  { key: 'checklist', label: 'Checklist', icon: ClipboardList },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'images', label: 'Images', icon: ImageIcon },
  { key: 'videos', label: 'Videos', icon: VideoIcon },
  { key: 'activity', label: 'Activity', icon: ActivityIcon },
  { key: 'audit', label: 'Audit Log', icon: History },
];

/** The Checklist tab — one row per checklist-item Task in this category,
 * same columns/quick-status-change pattern as ExecutionRecordsTable/
 * DepartmentTasksPage, scoped down to a single category. Row click opens the
 * full item detail (attachments, comments, approval, history) at the
 * existing /tasks/:code route — no second copy of that page. */
function ChecklistTable({ tasks, onOpenTask, onStatusChange, readOnly }) {
  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardList} title="No checklist items in this category" hint="Checklist items are generated automatically when the project reaches Phase 8." />;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr>
            <th>Checklist Item</th><th>Department</th><th>Priority</th><th>Status</th>
            <th>Assignee</th><th>Due Date</th><th>Evidence</th><th></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const st = TASK_STATUS_META[t.status] || {};
            const pr = PRIORITY_META[t.priority] || {};
            const dm = deptMeta(t.department);
            return (
              <tr key={t._id} onClick={() => onOpenTask(t)} style={{ cursor: 'pointer' }}>
                <td>
                  <div className="col" style={{ gap: 1 }}>
                    <span style={{ fontWeight: 600 }}>{t.title}</span>
                    <span className="tiny muted">{t.code}</span>
                  </div>
                </td>
                <td>{t.department ? <Badge color={dm.color}>{dm.label}</Badge> : <span className="tiny muted">—</span>}</td>
                <td>{pr.label && <Badge color={pr.color} soft={pr.soft}>{pr.label}</Badge>}</td>
                <td><Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge></td>
                <td>
                  {t.assignee?.name ? (
                    <div className="row gap-2" style={{ alignItems: 'center' }}>
                      <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size={24} />
                      <span className="sm">{t.assignee.name}</span>
                    </div>
                  ) : <span className="tiny muted">Unassigned</span>}
                </td>
                <td className="sm">{t.plannedEnd ? <span className="row gap-1" style={{ alignItems: 'center' }}><CalendarDays size={12} className="muted" />{fmtDate(t.plannedEnd)}</span> : '—'}</td>
                <td>
                  <span className="tiny muted row gap-2" style={{ alignItems: 'center' }}>
                    <span className="row gap-1" style={{ alignItems: 'center' }}><Paperclip size={11} />{t.attachments?.length || 0}</span>
                    <span className="row gap-1" style={{ alignItems: 'center' }}><MessageCircle size={11} />{t.comments?.length || 0}</span>
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {!readOnly && <RowActionsMenu task={t} onStatusChange={(s) => onStatusChange(t._id, s)} onDelete={undefined} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Documents/Images/Videos tabs — every attachment across this category's
 * tasks, bucketed by mimetype with the same isImage/isVideo helpers
 * TaskDetailPage itself uses, grouped under the task it belongs to (an
 * attachment no longer has a single obvious "form" to sit inside once
 * checklist items are separate Tasks). */
function EvidenceTab({ tasks, kind, onOpenTask }) {
  const groups = tasks
    .map((t) => {
      const atts = (t.attachments || []).filter((a) => (kind === 'images' ? isImage(a) : kind === 'videos' ? isVideo(a) : !isImage(a) && !isVideo(a)));
      return { task: t, atts };
    })
    .filter((g) => g.atts.length > 0);

  if (groups.length === 0) {
    return <EmptyState icon={kind === 'images' ? ImageIcon : kind === 'videos' ? VideoIcon : FileText} title={`No ${kind} uploaded yet`} hint="Evidence uploaded on a checklist item's detail page shows up here." />;
  }

  return (
    <div className="col gap-4">
      {groups.map(({ task, atts }) => (
        <div key={task._id} className="col gap-2">
          <button type="button" className="sm" style={{ fontWeight: 650, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)', textAlign: 'left' }} onClick={() => onOpenTask(task)}>
            {task.title} <span className="tiny muted">({task.code})</span>
          </button>
          {kind === 'images' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {atts.map((a) => <AttachmentRow key={a._id} a={a} />)}
            </div>
          ) : kind === 'videos' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {atts.map((a) => <VideoCard key={a._id} a={a} compact />)}
            </div>
          ) : (
            <div className="col gap-1">
              {atts.map((a) => <AttachmentRow key={a._id} a={a} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Audit Log tab — structured table reusing the same fromStatus/toStatus meta
 * every task status-change activity entry already logs (task.service.js),
 * same treatment ApprovalDetailsPage gives its own Audit Log table. */
function AuditLogTable({ activity }) {
  if (activity.length === 0) {
    return <EmptyState icon={History} title="No audit history yet" hint="Status changes on this category's checklist items will show up here." />;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead>
          <tr><th>User</th><th>Action</th><th>Old Status</th><th>New Status</th><th>Timestamp</th><th>Remarks</th></tr>
        </thead>
        <tbody>
          {activity.map((a) => {
            const fromMeta = a.meta?.fromStatus ? (TASK_STATUS_META[a.meta.fromStatus]?.label || a.meta.fromStatus) : '—';
            const toMeta = a.meta?.toStatus ? (TASK_STATUS_META[a.meta.toStatus]?.label || a.meta.toStatus) : '—';
            return (
              <tr key={a._id}>
                <td className="sm">{a.actor?.name || 'System'}</td>
                <td className="sm">{a.action}</td>
                <td className="sm">{fromMeta}</td>
                <td className="sm">{toMeta}</td>
                <td className="sm">{fmtDateTime(a.createdAt)}</td>
                <td className="tiny muted">{a.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One checklist category's dedicated page — Overview/Checklist/Documents/
 * Images/Videos/Activity/Audit Log tabs over its own slice of a stage's Task
 * list (`taskCategory === categoryKey`). Shared by Phase 8 (Store Readiness)
 * and Phase 9 (Store Launch) via props rather than a fork — both stages use
 * the identical "one Task per checklist line, grouped by category" shape,
 * only the category taxonomy/stage/back-link differ. Route: /projects/:id/
 * store-readiness/category/:categoryKey or /store-launch/category/:categoryKey
 * — categoryKey is the human-readable category slug, never a Mongo id, per
 * the routing standard.
 */
export function CategoryDetailsPage({
  stageKey = 'p8',
  categoryMetaMap = READINESS_CATEGORY_META,
  categoryMetaFn = readinessCategoryMeta,
  categoryIcons = CATEGORY_ICONS,
  backPath = 'store-readiness',
  backLabel = 'Store Readiness',
}) {
  const { id, categoryKey } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');

  const { data: project, isLoading } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey, limit: 1000 });
  const allTasks = tasksResp?.data || tasksResp || [];
  const { data: activities } = useProjectActivity(id);
  const updateStatus = useUpdateTaskStatus(id);

  const stage = project?.stages?.find((s) => s.key === stageKey);
  const tasks = useMemo(() => allTasks.filter((t) => t.taskCategory === categoryKey), [allTasks, categoryKey]);
  const cat = categoryMetaFn(categoryKey);
  const Icon = categoryIcons[categoryKey] || ClipboardList;

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'approved').length;
  const blocked = tasks.filter((t) => t.status === 'blocked' || isReworkStatus(t.status)).length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const taskIds = useMemo(() => new Set(tasks.map((t) => String(t._id))), [tasks]);
  const categoryActivity = useMemo(() => (activities || [])
    .filter((a) => a.entityType === 'task' && taskIds.has(String(a.entityId)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [activities, taskIds]);

  const openTaskDetail = (t) => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`);
  const onStatusChange = (taskId, status) => updateStatus.mutate({ id: taskId, status });

  if (isLoading || !project) {
    return (<><Topbar title={backLabel} /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (!categoryMetaMap[categoryKey]) {
    return (
      <>
        <Topbar title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/${backPath}`)}><ArrowLeft size={16} /></button>{backLabel}</span>} />
        <div className="content"><EmptyState icon={ClipboardList} title="Unknown category" hint="This checklist category doesn't exist." /></div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}/${backPath}`)} aria-label={`Back to ${backLabel}`}>
              <ArrowLeft size={16} />
            </button>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: `${cat.color}1A`, color: cat.color, display: 'grid', placeItems: 'center' }}>
              <Icon size={15} strokeWidth={2} />
            </span>
            {cat.label}
          </span>
        }
        subtitle={`${project.code} · ${project.name} · ${stage?.name || backLabel}`}
      />
      <div className="content page-compact store-readiness-page">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="content-wide col gap-3 fade-in">
          <SectionCard bodyClass="card-body-compact">
            <div className="row gap-3" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="col gap-1" style={{ minWidth: 160 }}>
                <span className="tiny subtle upper">Completion</span>
                <span style={{ fontSize: 22, fontWeight: 750 }}>{pct}%</span>
              </div>
              <div className="col gap-1" style={{ flex: '1 1 220px', minWidth: 180 }}>
                <ProgressBar value={pct} height={8} gradient={cat.color} />
                <span className="tiny muted">{completed}/{total} checklist items completed{blocked ? ` · ${blocked} blocked/rework` : ''}</span>
              </div>
            </div>
          </SectionCard>

          <div className="tabs">
            {TABS.map((tb) => (
              <button key={tb.key} type="button" className={`tab${tab === tb.key ? ' active' : ''}`} onClick={() => setTab(tb.key)}>
                {tb.label}
              </button>
            ))}
          </div>

          {tasksLoading ? (
            <SkPropertyIdentification />
          ) : (
            <>
              {tab === 'overview' && (
                <SectionCard title="Overview">
                  <div className="col gap-3">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                      {TASK_STATUS_ORDER.filter((s) => tasks.some((t) => t.status === s)).map((s) => {
                        const st = TASK_STATUS_META[s];
                        const count = tasks.filter((t) => t.status === s).length;
                        return (
                          <div key={s} className="row gap-2" style={{ alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--surface-2)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: st?.color, flexShrink: 0 }} />
                            <span className="sm grow">{st?.label || s}</span>
                            <span className="sm" style={{ fontWeight: 700 }}>{count}</span>
                          </div>
                        );
                      })}
                    </div>
                    {tasks.length === 0 && <EmptyState icon={ClipboardList} title="No checklist items in this category yet" />}
                  </div>
                </SectionCard>
              )}

              {tab === 'checklist' && (
                <SectionCard title={`Checklist (${tasks.length})`} subtitle="Click a row to open its full detail — evidence, comments, approvals and history">
                  <ChecklistTable tasks={tasks} onOpenTask={openTaskDetail} onStatusChange={onStatusChange} readOnly={readOnly} />
                </SectionCard>
              )}

              {tab === 'documents' && (
                <SectionCard title="Documents"><EvidenceTab tasks={tasks} kind="documents" onOpenTask={openTaskDetail} /></SectionCard>
              )}
              {tab === 'images' && (
                <SectionCard title="Images"><EvidenceTab tasks={tasks} kind="images" onOpenTask={openTaskDetail} /></SectionCard>
              )}
              {tab === 'videos' && (
                <SectionCard title="Videos"><EvidenceTab tasks={tasks} kind="videos" onOpenTask={openTaskDetail} /></SectionCard>
              )}

              {tab === 'activity' && (
                <SectionCard title="Activity"><ActivityLog activity={categoryActivity} /></SectionCard>
              )}
              {tab === 'audit' && (
                <SectionCard title="Audit Log"><AuditLogTable activity={categoryActivity} /></SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default CategoryDetailsPage;
