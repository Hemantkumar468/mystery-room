import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ClipboardList, CheckCircle2, Clock, AlertTriangle, ListChecks,
  HardHat, Zap, Monitor, UserPlus, GraduationCap, Megaphone, TestTube2, Package, ShieldCheck,
  Plus, ArrowRight, Search, ChevronRight, Lock, Eye, ChevronDown, CalendarDays,
  MessageCircle, Paperclip, FileText, Image as ImageIcon, Video as VideoIcon,
  Ban, History as HistoryIcon, RotateCcw,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, Badge, EmptyState, ProgressBar, Avatar } from '../../components/ui/primitives.jsx';
import { KpiStrip } from '../../components/ui/KpiStrip.jsx';
import { StageExplainer } from '../../components/ui/StageExplainer.jsx';
import { SkPropertyIdentification } from '../../components/ui/Skeletons.jsx';
import { DonutChart } from '../../components/charts/chartkit.jsx';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useProject, useProjectActivity, useCompleteStage } from '../../app/api/projectsApi.js';
import {
  useTasks, useCreateTask, useUpdateTaskStatus, useBulkTaskStatus,
} from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  PRIORITY_META, TASK_STATUS_META, TASK_STATUS_ORDER, deptMeta, isReworkStatus, isTaskDelayed,
  READINESS_CATEGORY_META, READINESS_CATEGORY_ORDER, readinessCategoryMeta,
} from '../../lib/ui.js';
import { isImage, isVideo, AttachmentRow, VideoCard, ActivityLog } from '../tasks/taskDetailShared.jsx';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { getStagePath } from './stagesConfig.jsx';
import { AllocateTaskModal } from './DepartmentPlanningPage.jsx';
import { RowActionsMenu } from './DepartmentTasksPage.jsx';
import { useProjectReadOnly, ReadOnlyProjectBanner } from '../../components/ui/ReadOnlyProjectBanner.jsx';
import { can } from '../../lib/roles.js';

const STAGE_KEY = 'p8';

const PAGE_TABS = [
  { key: 'overview', label: 'Readiness Overview' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'issues', label: 'Issues & Exceptions' },
  { key: 'documents', label: 'Documents' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'activity', label: 'Activity Log' },
];

/** One icon per readiness category — purely presentational, keyed off the
 * same READINESS_CATEGORY_ORDER every category-facing view here shares.
 * Exported so CategoryDetailsPage uses the same icon per category. */
export const CATEGORY_ICONS = {
  construction: HardHat,
  utilities: Zap,
  it_systems: Monitor,
  hiring: UserPlus,
  training: GraduationCap,
  marketing: Megaphone,
  testing: TestTube2,
  inventory: Package,
  compliance: ShieldCheck,
};

/** A category's own aggregate state — Not Started / Pending / In Progress /
 * Blocked / Completed — derived entirely from its real Task statuses (never
 * fabricated). Blocked wins if anything in the category is stuck; Completed
 * only once every task in it is fully `approved`. */
function categoryStatusMeta(status) {
  switch (status) {
    case 'completed': return { label: 'Completed', color: '#059669', soft: '#DCFCE7' };
    case 'blocked': return { label: 'Blocked', color: '#DC2626', soft: '#FEE2E2' };
    case 'in_progress': return { label: 'In Progress', color: '#2563EB', soft: '#DBEAFE' };
    case 'pending': return { label: 'Pending', color: '#D97706', soft: '#FEF3C7' };
    default: return { label: 'Not Started', color: '#6B7280', soft: '#F3F4F6' };
  }
}

/** One readiness category card — icon, completion %, completed/pending item
 * counts, progress bar, status badge. Click navigates to that category's
 * dedicated page (CategoryDetailsPage), per the routing standard — no drawer. */
function CategoryCard({ cat, onOpen }) {
  const Icon = CATEGORY_ICONS[cat.key] || ClipboardList;
  const smeta = categoryStatusMeta(cat.status);
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
        <span className="tiny muted">{cat.total} readiness item{cat.total === 1 ? '' : 's'}</span>
      </div>
      <ProgressBar value={cat.pct} height={6} gradient={cat.color} />
      <div className="row gap-2" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="tiny muted">{cat.completed}/{cat.total} completed</span>
        <Badge color={smeta.color} soft={smeta.soft} dot>{smeta.label}</Badge>
      </div>
    </button>
  );
}

/** One compact filter control — small label and value sharing a single bordered box (matches ExecutionPage's FilterBox). */
function FilterBox({ label, icon: Icon, children }) {
  return (
    <div className="filter-box">
      <span className="filter-box-label">{label}</span>
      <div className="filter-box-value">
        {children}
        {Icon && <Icon size={13} />}
      </div>
    </div>
  );
}

const CHECKLIST_EMPTY_FILTERS = { search: '', category: '', status: '', department: '', priority: '' };

/** Server's per-call id cap for POST /pms/tasks/bulk-status (task.validation.js). */
const BULK_CHUNK = 200;

/**
 * "Checklist" tab — every checklist item across every category, one flat
 * filterable table (spec's "Checklist Search" + Category/Status/Department/
 * Priority filters). Same quick-status-change pattern as
 * ExecutionRecordsTable/DepartmentTasksPage, just scoped to stageKey 'p8'
 * and with a Category column added.
 */
function GlobalChecklistTab({ tasks, onOpenTask, onStatusChange, onBulkComplete, readOnly }) {
  const [f, setF] = useState(CHECKLIST_EMPTY_FILTERS);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const setField = (k) => (e) => setF((old) => ({ ...old, [k]: e.target.value }));

  const visible = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (q && !t.title?.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
      if (f.category && t.taskCategory !== f.category) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.department && t.department !== f.department) return false;
      if (f.priority && t.priority !== f.priority) return false;
      return true;
    });
  }, [tasks, f]);

  const departmentOptions = useMemo(() => [...new Set(tasks.map((t) => t.department).filter(Boolean))].sort(), [tasks]);

  /* ── bulk complete ───────────────────────────────────────────────────
   * 81 items ticked one at a time is not a workflow anyone will follow, so
   * the filters double as the selection tool: narrow to a category, select
   * all, mark them done.
   *
   * Only items that are not already finished can be selected — re-completing
   * a done item is a no-op the server would reject as an illegal transition.
   */
  const DONE_ISH = ['done', 'waiting_approval', 'waiting_management_approval', 'approved'];
  const selectable = visible.filter((t) => !DONE_ISH.includes(t.status));
  const allSelected = selectable.length > 0 && selectable.every((t) => selected.has(t._id));

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((t) => t._id)));

  /**
   * One request for the whole selection. This used to loop client-side —
   * two PATCHes per item, because `todo → done` is not a legal single
   * transition — which meant an 81-item checklist fired 162 requests and
   * tripped the API rate limiter. The server now walks that intermediate hop
   * itself (taskService.setStatusThroughLegalPath) and reports per-id
   * outcomes, so a row someone else already completed no longer stops the rest.
   */
  const [bulkResult, setBulkResult] = useState(null);
  const bulkComplete = async () => {
    const ids = visible.filter((t) => selected.has(t._id)).map((t) => t._id);
    if (!ids.length) return;
    setBulkBusy(true);
    setBulkResult(null);
    try {
      const res = await onBulkComplete(ids);
      setSelected(new Set());
      if (res?.failed?.length) setBulkResult(res);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <SectionCard
      title={`Checklist (${visible.length})`}
      subtitle={`${tasks.length} readiness items across every category`}
      action={
        <div className="row gap-2 wrap" style={{ alignItems: 'center' }}>
          <div className="filter-search" style={{ minWidth: 180 }}>
            <Search size={14} className="muted" />
            <input value={f.search} onChange={setField('search')} placeholder="Search checklist items…" />
          </div>
          <FilterBox label="Category" icon={ChevronDown}>
            <select value={f.category} onChange={setField('category')}>
              <option value="">All</option>
              {READINESS_CATEGORY_ORDER.map((k) => <option key={k} value={k}>{READINESS_CATEGORY_META[k]}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Status" icon={ChevronDown}>
            <select value={f.status} onChange={setField('status')}>
              <option value="">All</option>
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Department" icon={ChevronDown}>
            <select value={f.department} onChange={setField('department')}>
              <option value="">All</option>
              {departmentOptions.map((d) => <option key={d} value={d}>{deptMeta(d).label}</option>)}
            </select>
          </FilterBox>
          <FilterBox label="Priority" icon={ChevronDown}>
            <select value={f.priority} onChange={setField('priority')}>
              <option value="">All</option>
              {Object.entries(PRIORITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </FilterBox>
        </div>
      }
    >
      {visible.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No checklist items match these filters" hint="Try clearing a filter." />
      ) : (
        <div className="pi-table-wrap">
          {/* Bulk bar sits above the table and stays visible with nothing
              selected, so the capability is discoverable before it is needed —
              81 items ticked individually is not a workflow anyone follows. */}
          {!readOnly && selectable.length > 0 && (
            <div className="apr-bulkbar">
              <label className="row gap-2" style={{ alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all shown" />
                <span className="sm">
                  {selected.size > 0 ? `${selected.size} selected` : `Select all ${selectable.length} shown`}
                </span>
              </label>
              <span className="tiny muted">Narrow with the filters above, then tick them off together.</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginLeft: 'auto' }}
                disabled={!selected.size || bulkBusy}
                onClick={bulkComplete}
              >
                {bulkBusy ? <span className="spinner" /> : `Mark ${selected.size || ''} complete`}
              </button>
            </div>
          )}

          {/* Only shown when some ids failed — say which and why, rather than
              leaving the user to spot that the count didn't move. */}
          {bulkResult?.failed?.length > 0 && (
            <div className="apr-bulk-result">
              <strong>{bulkResult.succeeded?.length || 0} completed.</strong>{' '}
              {bulkResult.failed.length} could not be:
              <ul>
                {bulkResult.failed.slice(0, 5).map((f) => (
                  <li key={f.id}>
                    {tasks.find((t) => t._id === f.id)?.title || f.id} — {f.message}
                  </li>
                ))}
                {bulkResult.failed.length > 5 && (
                  <li className="muted">…and {bulkResult.failed.length - 5} more</li>
                )}
              </ul>
            </div>
          )}

          <table className="table rd-checklist">
            <thead>
              <tr>
                {!readOnly && <th style={{ width: 34 }} aria-label="Select" />}
                <th>Checklist Item</th><th>Category</th><th>Department</th><th>Priority</th><th>Status</th>
                <th>Assignee</th><th>Due Date</th><th>Evidence</th><th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => {
                const st = TASK_STATUS_META[t.status] || {};
                const pr = PRIORITY_META[t.priority] || {};
                const dm = deptMeta(t.department);
                const cat = readinessCategoryMeta(t.taskCategory);
                return (
                  <tr key={t._id} onClick={() => onOpenTask(t)} style={{ cursor: 'pointer' }}>
                    {!readOnly && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(t._id)}
                          disabled={DONE_ISH.includes(t.status)}
                          onChange={() => toggle(t._id)}
                          aria-label={`Select ${t.title}`}
                        />
                      </td>
                    )}
                    <td>
                      <div className="col" style={{ gap: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600 }} title={t.title}>{t.title}</span>
                        <span className="tiny muted">{t.code}</span>
                      </div>
                    </td>
                    <td>{t.taskCategory ? <Badge color={cat.color}>{cat.label}</Badge> : <span className="tiny muted">—</span>}</td>
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
      )}
    </SectionCard>
  );
}

/** One row shared by every Issues & Exceptions section — title/category/priority + Resolve. */
function IssueRow({ t, onOpenTask, extra }) {
  const cat = readinessCategoryMeta(t.taskCategory);
  const pmeta = PRIORITY_META[t.priority];
  return (
    <div className="row gap-3 wrap" style={{ alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8 }}>
      <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{t.title}</span>
      {t.taskCategory && <Badge color={cat.color}>{cat.label}</Badge>}
      {pmeta && <Badge color={pmeta.color} soft={pmeta.soft}>{pmeta.label}</Badge>}
      {extra}
      <span className="tiny muted">{t.plannedEnd ? `Due ${fmtDate(t.plannedEnd)}` : 'No due date'}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenTask(t)}>
        <Eye size={13} style={{ marginRight: 4 }} /> Resolve
      </button>
    </div>
  );
}

/**
 * "Issues & Exceptions" tab — Critical Issues / Minor Issues / Blocked Items
 * / Exception Requests, per the spec's Issues Management section. All four
 * are computed live from the same real Task list, never fabricated:
 *  - Critical: high/critical priority AND stuck (blocked/rework/overdue).
 *  - Minor: low/medium priority AND stuck — same stuck condition, lower stakes.
 *  - Blocked: status === 'blocked' specifically, regardless of priority.
 *  - Exception Requests: tasks with a live deadline-extension request
 *    (`extensionRequest`, the same field Phase 6/7 already use).
 */
function IssuesTab({ tasks, onOpenTask }) {
  const stuck = (t) => t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t);
  const critical = tasks.filter((t) => ['critical', 'high'].includes(t.priority) && stuck(t));
  const minor = tasks.filter((t) => !['critical', 'high'].includes(t.priority) && stuck(t));
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const exceptions = tasks.filter((t) => t.extensionRequest);

  return (
    <div className="col gap-3">
      <SectionCard title="Critical Issues" action={<Badge color="#DC2626" soft="#FEE2E2">{critical.length}</Badge>}>
        {critical.length === 0 ? <EmptyState icon={CheckCircle2} title="No critical issues" /> : (
          <div className="col gap-2">{critical.map((t) => <IssueRow key={t._id} t={t} onOpenTask={onOpenTask} />)}</div>
        )}
      </SectionCard>
      <SectionCard title="Minor Issues" action={<Badge color="#D97706" soft="#FEF3C7">{minor.length}</Badge>}>
        {minor.length === 0 ? <EmptyState icon={CheckCircle2} title="No minor issues" /> : (
          <div className="col gap-2">{minor.map((t) => <IssueRow key={t._id} t={t} onOpenTask={onOpenTask} />)}</div>
        )}
      </SectionCard>
      <SectionCard title="Blocked Items" action={<Badge color="#DC2626" soft="#FEE2E2">{blocked.length}</Badge>}>
        {blocked.length === 0 ? <EmptyState icon={Ban} title="Nothing blocked" /> : (
          <div className="col gap-2">{blocked.map((t) => <IssueRow key={t._id} t={t} onOpenTask={onOpenTask} />)}</div>
        )}
      </SectionCard>
      <SectionCard title="Exception Requests" subtitle="Deadline-extension requests raised on a checklist item" action={<Badge color="#7C3AED" soft="#EDE9FE">{exceptions.length}</Badge>}>
        {exceptions.length === 0 ? <EmptyState icon={HistoryIcon} title="No exception requests" /> : (
          <div className="col gap-2">
            {exceptions.map((t) => (
              <IssueRow
                key={t._id}
                t={t}
                onOpenTask={onOpenTask}
                extra={<Badge color="#7C3AED" soft="#EDE9FE">{t.extensionRequest.status === 'pending' ? 'Pending decision' : t.extensionRequest.status}</Badge>}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * "Documents" tab — every piece of evidence uploaded across every checklist
 * item, grouped by task and bucketed Documents/Images/Videos with the same
 * isImage/isVideo helpers TaskDetailPage itself uses.
 */
function DocumentsTab({ tasks, onOpenTask }) {
  const groups = tasks
    .map((t) => ({
      task: t,
      images: (t.attachments || []).filter(isImage),
      videos: (t.attachments || []).filter((a) => !isImage(a) && isVideo(a)),
      documents: (t.attachments || []).filter((a) => !isImage(a) && !isVideo(a)),
    }))
    .filter((g) => g.images.length || g.videos.length || g.documents.length);

  if (groups.length === 0) {
    return <EmptyState icon={FileText} title="No evidence uploaded yet" hint="Documents, images and videos uploaded on any checklist item show up here." />;
  }

  return (
    <div className="col gap-4">
      {groups.map(({ task, images, videos, documents }) => (
        <SectionCard
          key={task._id}
          title={task.title}
          subtitle={task.code}
          action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenTask(task)}>Open item</button>}
        >
          <div className="col gap-3">
            {images.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><ImageIcon size={12} /> Images ({images.length})</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {images.map((a) => <AttachmentRow key={a._id} a={a} />)}
                </div>
              </div>
            )}
            {videos.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><VideoIcon size={12} /> Videos ({videos.length})</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                  {videos.map((a) => <VideoCard key={a._id} a={a} compact />)}
                </div>
              </div>
            )}
            {documents.length > 0 && (
              <div className="col gap-2">
                <span className="tiny subtle upper row gap-1" style={{ alignItems: 'center' }}><FileText size={12} /> Documents ({documents.length})</span>
                <div className="col gap-1">
                  {documents.map((a) => <AttachmentRow key={a._id} a={a} />)}
                </div>
              </div>
            )}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

/** A task's own current approval-tier label, mirroring ApprovalWorkflowPage's currentStageLabel(). */
function approvalStageLabel(status) {
  if (status === 'waiting_approval') return 'Department Review';
  if (status === 'waiting_management_approval') return 'Management Review';
  if (status === 'approved') return 'Approved';
  if (isReworkStatus(status)) return 'Rework Required';
  return '—';
}

/**
 * "Approvals" tab — the full-page version of the sidebar's compact Approval
 * Status card: Department/Management Verification progress + Final Approval
 * gate, plus a table of every task currently sitting in either approval
 * tier so a reviewer can act without leaving this tab.
 */
function ApprovalsTab({
  tasks, deptPct, mgmtPct, isCompleted, canFinalApprove, readyForFinalApproval,
  completeStage, onFinalApproval, finalApprovalError, onOpenTask, readOnly,
}) {
  const inPipeline = tasks.filter((t) => ['waiting_approval', 'waiting_management_approval'].includes(t.status));
  const decided = tasks.filter((t) => t.status === 'approved' || isReworkStatus(t.status));

  return (
    <div className="col gap-3">
      <SectionCard title="Approval Progress">
        <div className="row gap-4 wrap">
          <div className="col gap-1" style={{ flex: '1 1 220px', minWidth: 200 }}>
            <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
              <span className="sm">Department Verification</span>
              <Badge color={deptPct === 100 ? '#059669' : '#D97706'} soft={deptPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{deptPct === 100 ? 'Completed' : 'In Progress'}</Badge>
            </div>
            <ProgressBar value={deptPct} height={7} gradient="#2563EB" />
            <span className="tiny muted">{deptPct}%</span>
          </div>
          <div className="col gap-1" style={{ flex: '1 1 220px', minWidth: 200 }}>
            <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
              <span className="sm">Management Verification</span>
              <Badge color={mgmtPct === 100 ? '#059669' : '#D97706'} soft={mgmtPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{mgmtPct === 100 ? 'Completed' : 'In Progress'}</Badge>
            </div>
            <ProgressBar value={mgmtPct} height={7} gradient="#059669" />
            <span className="tiny muted">{mgmtPct}%</span>
          </div>
          <div className="col gap-2" style={{ flex: '1 1 220px', minWidth: 200 }}>
            <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="sm">Final Approval</span>
              <Badge color={isCompleted ? '#059669' : '#6B7280'} soft={isCompleted ? '#DCFCE7' : '#F3F4F6'}>{isCompleted ? 'Approved' : 'Pending'}</Badge>
            </div>
            {!isCompleted && canFinalApprove && (
              <button type="button" className="btn btn-primary btn-sm" disabled={completeStage.isPending || readOnly} onClick={onFinalApproval} style={{ alignSelf: 'flex-start' }}>
                {completeStage.isPending ? 'Approving…' : 'Give Final Approval'}
              </button>
            )}
            {finalApprovalError && <span className="tiny" style={{ color: 'var(--danger)' }}>{finalApprovalError}</span>}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Waiting on Approval" subtitle="Currently at either verification tier">
        {inPipeline.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing waiting right now" />
        ) : (
          <div className="col gap-2">
            {inPipeline.map((t) => (
              <div key={t._id} className="row gap-3 wrap" style={{ alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }} onClick={() => onOpenTask(t)}>
                <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{t.title}</span>
                <Badge color="#7C3AED" soft="#EDE9FE">{approvalStageLabel(t.status)}</Badge>
                <span className="tiny muted">{t.submittedForApprovalAt ? `Submitted ${fmtDateTime(t.submittedForApprovalAt)}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recently Decided">
        {decided.length === 0 ? (
          <EmptyState title="Nothing decided yet" />
        ) : (
          <div className="col gap-2">
            {decided.slice(0, 15).map((t) => {
              const st = TASK_STATUS_META[t.status] || {};
              return (
                <div key={t._id} className="row gap-3 wrap" style={{ alignItems: 'center', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }} onClick={() => onOpenTask(t)}>
                  <span className="sm grow" style={{ fontWeight: 600, minWidth: 160 }}>{t.title}</span>
                  <Badge color={st.color} soft={st.soft} dot>{st.label || t.status}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/**
 * Store Readiness Checklist (Phase 8) — the enterprise redesign. Each of the
 * 9 readiness categories (Construction/Utilities/IT & Systems/Hiring/
 * Training/Marketing/Testing/Inventory/Compliance) is a real Task grouping
 * (`taskCategory`, `stageKey:'p8'`) rather than a single form per module —
 * see storeLaunchTemplate.js's p8 `tasks` blueprint. Every number on this
 * page is computed live from that Task list; nothing here is fabricated.
 * The old Record-based module workspace is preserved, unrouted, at
 * records/StoreReadinessRecordPipeline.jsx.
 *
 * Six top-level tabs (Readiness Overview/Checklist/Issues & Exceptions/
 * Documents/Approvals/Activity Log) — all client-side slices of the same
 * `useTasks({stageKey:'p8'})` list, no per-tab endpoints.
 */
export function StoreReadinessDashboardPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: project, isLoading, isError, refetch } = useProject(id);
  const readOnly = useProjectReadOnly(project);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const { data: tasksResp, isLoading: tasksLoading } = useTasks({ project: id, stageKey: STAGE_KEY, limit: 1000 });
  const tasks = tasksResp?.data || tasksResp || [];
  const { data: activities } = useProjectActivity(id);

  const completeStage = useCompleteStage(id);
  const createTask = useCreateTask(id);
  const updateStatus = useUpdateTaskStatus(id);
  const bulkStatus = useBulkTaskStatus(id);
  const user = useAppSelector(selectCurrentUser);
  const canFinalApprove = can.decide(user?.role);

  const [pageTab, setPageTab] = useState('overview');
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState('');
  const [finalApprovalError, setFinalApprovalError] = useState('');

  const stage = project?.stages?.find((s) => s.key === STAGE_KEY);
  const isCompleted = stage?.status === 'completed';

  const openTaskDetail = (t) => navigate(`/projects/${id}/tasks/${encodeURIComponent(t.code)}`);
  const openCategory = (key) => navigate(`/projects/${id}/store-readiness/category/${key}`);
  // `mutateAsync`, not `mutate`: callers await the result so the row's spinner
  // clears on the real response rather than optimistically.
  const onTaskStatusChange = (taskId, status) => updateStatus.mutateAsync({ id: taskId, status });

  // Whole selection in one request; resolves `{ succeeded, failed }` so the
  // checklist can name any item that wouldn't move. Chunked at the server's
  // 200-id cap so a bigger template still works — two requests at worst, not
  // one per item.
  const onBulkComplete = async (ids) => {
    const merged = { succeeded: [], failed: [] };
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      // eslint-disable-next-line no-await-in-loop -- chunks must not race the project recompute
      const res = await bulkStatus.mutateAsync({ ids: ids.slice(i, i + BULK_CHUNK), status: 'done' });
      merged.succeeded.push(...(res?.succeeded || []));
      merged.failed.push(...(res?.failed || []));
    }
    return merged;
  };

  // The readiness modules come from THIS project's template — the same
  // `taskCategory` values the server's p8 gate treats as mandatory
  // (project.service.js#p8RequiredCategories). The shared constant is only a
  // fallback for a template that defines no p8 blueprint, so the two can't
  // drift into requiring different module sets.
  const categoryKeys = useMemo(() => {
    const p8 = template?.stages?.find((s) => s.key === STAGE_KEY);
    const fromTemplate = [...new Set((p8?.tasks || []).map((t) => t.taskCategory).filter(Boolean))];
    return fromTemplate.length ? fromTemplate : READINESS_CATEGORY_ORDER;
  }, [template]);

  const categories = useMemo(() => categoryKeys.map((key) => {
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
    return { key, ...readinessCategoryMeta(key), total, completed, blocked, active, pct, status };
  }), [tasks, categoryKeys]);

  const visibleCategories = search.trim()
    ? categories.filter((c) => c.label.toLowerCase().includes(search.trim().toLowerCase()))
    : categories;

  const totalCategories = categories.length;
  const completedCategories = categories.filter((c) => c.status === 'completed').length;
  const inProgressCategories = categories.filter((c) => c.status === 'in_progress').length;
  const pendingCategories = categories.filter((c) => c.status === 'pending' || c.status === 'not_started').length;

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'approved').length;
  const inProgressTasks = tasks.filter((t) => ['in_progress', 'waiting_approval', 'waiting_management_approval', 'done'].includes(t.status)).length;
  const pendingTasks = tasks.filter((t) => t.status === 'todo').length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked' || isReworkStatus(t.status)).length;
  const overallPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // A "critical issue" is a high-stakes item that's actually stuck — high/
  // critical priority AND (blocked, rejected/rework, or overdue). Real data
  // only, no synthetic severity score.
  const criticalIssues = useMemo(() => tasks
    .filter((t) => ['critical', 'high'].includes(t.priority) && (t.status === 'blocked' || isReworkStatus(t.status) || isTaskDelayed(t)))
    .sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'critical' ? -1 : 1)), [tasks]);

  // Department/Management Verification — aggregate read of the same 2-tier
  // approval pipeline Phase 6/7 already use, scoped to this stage's tasks.
  const deptVerified = tasks.filter((t) => ['waiting_management_approval', 'approved'].includes(t.status)).length;
  const mgmtVerified = completedTasks;
  const deptPct = totalTasks ? Math.round((deptVerified / totalTasks) * 100) : 0;
  const mgmtPct = totalTasks ? Math.round((mgmtVerified / totalTasks) * 100) : 0;
  // Every mandatory category needs at least one task filed against it —
  // mirrors project.service.js's p8RequiredCategories/`missing` check
  // exactly (categoryKeys is already sourced from the same template data
  // that function reads). Without this, a category with ZERO tasks
  // contributes nothing to totalTasks/completedTasks, so overallPct could
  // read 100% while the server's gate still reports it as missing.
  const allCategoriesCovered = categories.every((c) => c.total > 0);
  // DISPLAY ONLY — the real readiness rule lives on the server
  // (project.service.js's p8 branch: Phase 7 complete, every mandatory
  // template module covered, every item approved, nothing blocked). This
  // drives the banner wording and icons; it must never gate the buttons,
  // or the UI can hide a hand-off the server would accept (and vice versa).
  const readyForFinalApproval = totalTasks > 0 && allCategoriesCovered && overallPct === 100 && criticalIssues.length === 0;

  const taskById = useMemo(() => new Map(tasks.map((t) => [String(t._id), t])), [tasks]);
  const stageActivity = useMemo(() => (activities || [])
    .filter((a) => a.meta?.stageKey === STAGE_KEY)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [activities]);
  const recentActivity = stageActivity.slice(0, 12);

  const departments = [...new Set(tasks.map((t) => t.department).filter(Boolean))].map((key) => ({ key, name: key }));
  const categoryOptions = categoryKeys.map((key) => ({ key, name: READINESS_CATEGORY_META[key] || key }));

  const createNewTask = async (payload) => { await createTask.mutateAsync(payload); setModal(false); };

  const onFinalApproval = () => {
    setFinalApprovalError('');
    completeStage.mutate(STAGE_KEY, {
      onSuccess: () => navigate(getStagePath(id, 'p9')),
      onError: (err) => setFinalApprovalError(err?.response?.data?.message || 'Store Readiness is not ready to complete yet.'),
    });
  };

  if (isLoading) {
    return (<><Topbar title="Store Readiness Checklist" /><div className="content"><SkPropertyIdentification /></div></>);
  }
  if (isError || !project) {
    return (
      <>
        <Topbar title="Store Readiness Checklist" />
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
  if (!stage) {
    return (
      <>
        <Topbar
          title={<span className="row gap-3"><button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)}><ArrowLeft size={16} /></button>Store Readiness Checklist</span>}
        />
        <div className="content">
          <EmptyState icon={ClipboardList} title="No Store Readiness stage" hint="This project has no Store Readiness Checklist stage." />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={
          <span className="row gap-3">
            <button className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back to project">
              <ArrowLeft size={16} />
            </button>
            Phase 8: {stage.name}
          </span>
        }
        subtitle="Validate construction, utilities, IT, hiring, training, marketing, testing, inventory and compliance before store launch."
        actions={
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <div className="filter-search" style={{ minWidth: 220 }}>
              <Search size={14} className="muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search checklist items, department…" />
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal(true)} disabled={readOnly}>
              <Plus size={14} style={{ marginRight: 6 }} /> Create
            </button>
          </div>
        }
      />
      <div className="content">
        {readOnly && <ReadOnlyProjectBanner />}
        <div className="se-page se-page--tight-top store-readiness-page col gap-3 fade-in">
          {tasksLoading ? (
            <SkPropertyIdentification />
          ) : totalTasks === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No readiness checklist items yet"
              hint="This project's Store Readiness Checklist hasn't been generated yet — it's created automatically when the project reaches Phase 8."
            />
          ) : (
            <>
              <div className="tabs">
                {PAGE_TABS.map((tb) => (
                  <button key={tb.key} type="button" className={`tab${pageTab === tb.key ? ' active' : ''}`} onClick={() => setPageTab(tb.key)}>
                    {tb.label}
                  </button>
                ))}
              </div>

              {pageTab === 'overview' && (
                <>
                  {/* Gate banner + report action — matches the reference's
                      "Store readiness must reach 100%…" strip. */}
                  <div
                    className="row gap-3"
                    style={{
                      alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 16px', borderRadius: 10,
                      background: readyForFinalApproval || isCompleted ? 'var(--success)0F' : 'var(--info)0F',
                      border: `1px solid ${readyForFinalApproval || isCompleted ? 'var(--success)' : 'var(--info)'}33`,
                    }}
                  >
                    <span className="sm row gap-2" style={{ alignItems: 'center' }}>
                      {isCompleted ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} /> : <Lock size={15} style={{ color: 'var(--warning)' }} />}
                      {isCompleted
                        ? 'Store Readiness completed — every category cleared and Final Approval was given.'
                        : 'Store readiness must reach 100% with no critical issues before proceeding to Phase 9.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${id}/store-readiness/report`)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 'var(--radius-pill)',
                        background: 'linear-gradient(135deg, #6366F1, #4338CA)', color: '#fff', fontWeight: 650, fontSize: 13.5,
                        border: 'none', cursor: 'pointer', boxShadow: '0 4px 14px rgba(79,70,229,0.35)',
                      }}
                    >
                      <FileText size={15} /> Readiness Summary Report
                    </button>
                  </div>

                  <StageExplainer
                    stageKey="p8"
                    project={project}
                    fallback="The last reversible step. Everything before this can still be reopened and corrected; once the store goes live, Phases 1–8 freeze as history. So this is the point to walk all 14 categories — construction, utilities, IT, network, security, furniture, inventory, POS, hiring, training, marketing, branding, fire safety and licences — and confirm each is genuinely ready. Anything left open here becomes a problem on opening day, when it can no longer be fixed quietly."
                    todo={
                      overallPct === 100
                        ? 'Every item is ticked. Mark this phase done to unlock Store Launch.'
                        : `${overallPct}% ready. Open a category, tick what is finished, flag what is not. When every category is clear, this phase closes and Store Launch opens.`
                    }
                  />

                  {/* KPI strip */}
                  <KpiStrip cards={[
                    { key: 'overall', label: 'Overall Readiness', value: overallPct, valueSuffix: '%', icon: ListChecks, color: 'var(--success)', soft: 'var(--success-soft)' },
                    { key: 'totalCategories', label: 'Total Categories', value: totalCategories, icon: ClipboardList, color: 'var(--info)', soft: 'var(--info-soft)' },
                    { key: 'completedCategories', label: 'Categories Completed', value: completedCategories, icon: CheckCircle2, color: 'var(--success)', soft: 'var(--success-soft)' },
                    { key: 'inProgressCategories', label: 'Categories In Progress', value: inProgressCategories, icon: Clock, color: 'var(--warning)', soft: 'var(--warning-soft)' },
                    { key: 'pendingCategories', label: 'Categories Pending', value: pendingCategories, icon: Clock, color: '#6B7280', soft: '#F3F4F6' },
                    { key: 'criticalIssues', label: 'Critical Issues', value: criticalIssues.length, icon: AlertTriangle, color: 'var(--danger)', soft: 'var(--danger-soft)' },
                  ]} />

                  <div className="row gap-3" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
                    {/* Main column */}
                    <div className="col gap-3" style={{ flex: '2 1 560px', minWidth: 320 }}>
                      <SectionCard title="Readiness by Category" subtitle="Click a category to open its checklist">
                        {visibleCategories.length === 0 ? (
                          <EmptyState title="No categories match your search" hint="Try clearing the search box." />
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
                            {visibleCategories.map((cat) => (
                              <CategoryCard key={cat.key} cat={cat} onOpen={() => openCategory(cat.key)} />
                            ))}
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard title="Recent Readiness Activity">
                        {recentActivity.length === 0 ? (
                          <EmptyState title="No activity yet" hint="Activity shows up here as checklist items are worked on." />
                        ) : (
                          <div className="col gap-2">
                            <div style={{ overflowX: 'auto' }}>
                              <table className="table">
                                <thead>
                                  <tr>
                                    <th>#</th><th>Activity</th><th>Category</th><th>Status</th><th>Updated By</th><th>Updated On</th><th>Remarks</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recentActivity.map((a, i) => {
                                    const t = taskById.get(String(a.entityId));
                                    const cat = t ? readinessCategoryMeta(t.taskCategory) : null;
                                    const st = t ? TASK_STATUS_META[t.status] : null;
                                    return (
                                      <tr key={a._id}>
                                        <td className="sm muted">{i + 1}</td>
                                        <td className="sm">{a.message}</td>
                                        <td>{cat ? <Badge color={cat.color}>{cat.label}</Badge> : <span className="tiny muted">—</span>}</td>
                                        <td>{st ? <Badge color={st.color} soft={st.soft} dot>{st.label}</Badge> : <span className="tiny muted">—</span>}</td>
                                        <td className="sm">{a.actor?.name || 'System'}</td>
                                        <td className="sm">{fmtDateTime(a.createdAt)}</td>
                                        <td className="tiny muted">{t?.remarks || '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <div className="row gap-3" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                              <span className="tiny muted">Showing 1 to {recentActivity.length} of {stageActivity.length} activit{stageActivity.length === 1 ? 'y' : 'ies'}</span>
                              <button
                                type="button"
                                onClick={() => setPageTab('activity')}
                                style={{
                                  padding: '7px 16px', borderRadius: 'var(--radius-pill)', background: 'transparent',
                                  border: '1px solid #6366F1', color: '#6366F1', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                                }}
                              >
                                View All Activity
                              </button>
                            </div>
                          </div>
                        )}
                      </SectionCard>
                    </div>

                    {/* Right rail */}
                    <div className="col gap-3" style={{ flex: '1 1 300px', minWidth: 280 }}>
                      <SectionCard title="Readiness Summary">
                        <DonutChart
                          height={180}
                          innerRadius={54}
                          outerRadius={78}
                          centerLabel={{ value: `${overallPct}%`, label: 'READY' }}
                          data={[
                            { name: 'Completed', value: completedTasks, color: '#059669' },
                            { name: 'In Progress', value: Math.max(0, inProgressTasks - blockedTasks), color: '#2563EB' },
                            { name: 'Pending', value: pendingTasks, color: '#D97706' },
                            { name: 'Blocked', value: blockedTasks, color: '#DC2626' },
                          ].filter((d) => d.value > 0)}
                        />
                        <div className="col gap-2" style={{ marginTop: 8 }}>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Completed</span><span className="sm" style={{ color: '#059669', fontWeight: 700 }}>{completedTasks}</span></div>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Pending</span><span className="sm" style={{ color: '#D97706', fontWeight: 700 }}>{pendingTasks}</span></div>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Blocked</span><span className="sm" style={{ color: '#DC2626', fontWeight: 700 }}>{blockedTasks}</span></div>
                          <div className="row gap-2" style={{ justifyContent: 'space-between' }}><span className="sm">Critical Issues</span><span className="sm" style={{ color: '#DC2626', fontWeight: 700 }}>{criticalIssues.length}</span></div>
                        </div>
                      </SectionCard>

                      <SectionCard title="Critical Issues" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPageTab('issues')}>View all <Badge color="#DC2626" soft="#FEE2E2" style={{ marginLeft: 4 }}>{criticalIssues.length}</Badge></button>}>
                        {criticalIssues.length === 0 ? (
                          <EmptyState icon={CheckCircle2} title="No critical issues" hint="Nothing high-priority is blocked, rejected, or overdue right now." />
                        ) : (
                          <div className="col gap-2">
                            {criticalIssues.slice(0, 5).map((t) => (
                              <IssueRow key={t._id} t={t} onOpenTask={openTaskDetail} />
                            ))}
                          </div>
                        )}
                      </SectionCard>

                      <SectionCard title="Approval Status" action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setPageTab('approvals')}>View all</button>}>
                        <div className="col gap-3">
                          <div className="col gap-1">
                            <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                              <span className="sm">Department Verification</span>
                              <Badge color={deptPct === 100 ? '#059669' : '#D97706'} soft={deptPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{deptPct === 100 ? 'Completed' : 'In Progress'}</Badge>
                            </div>
                            <ProgressBar value={deptPct} height={6} gradient="#2563EB" />
                          </div>
                          <div className="col gap-1">
                            <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                              <span className="sm">Management Verification</span>
                              <Badge color={mgmtPct === 100 ? '#059669' : '#D97706'} soft={mgmtPct === 100 ? '#DCFCE7' : '#FEF3C7'}>{mgmtPct === 100 ? 'Completed' : 'In Progress'}</Badge>
                            </div>
                            <ProgressBar value={mgmtPct} height={6} gradient="#059669" />
                          </div>
                          <div className="col gap-1">
                            <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className="sm">Final Approval</span>
                              <Badge color={isCompleted ? '#059669' : '#6B7280'} soft={isCompleted ? '#DCFCE7' : '#F3F4F6'}>{isCompleted ? 'Approved' : 'Pending'}</Badge>
                            </div>
                            {!isCompleted && canFinalApprove && (
                              <button type="button" className="btn btn-primary btn-sm" disabled={completeStage.isPending || readOnly} onClick={onFinalApproval} style={{ marginTop: 4 }}>
                                {completeStage.isPending ? 'Approving…' : 'Give Final Approval'}
                              </button>
                            )}
                            {finalApprovalError && <span className="tiny" style={{ color: 'var(--danger)' }}>{finalApprovalError}</span>}
                          </div>
                        </div>
                      </SectionCard>

                      <SectionCard title="Next Step">
                        {isCompleted ? (
                          <div className="col gap-2" style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--success)0F', border: '1px solid var(--success)33' }}>
                            <span className="sm row gap-2" style={{ alignItems: 'center', color: 'var(--success)', fontWeight: 700 }}>
                              <CheckCircle2 size={16} /> Store Readiness Completed
                            </span>
                            <span className="tiny muted">Every category cleared and Final Approval was given.</span>
                          </div>
                        ) : (
                          <div className="col gap-2">
                            <span className="sm row gap-2" style={{ alignItems: 'center' }}>
                              {readyForFinalApproval ? <CheckCircle2 size={15} style={{ color: 'var(--success)' }} /> : <Lock size={15} style={{ color: 'var(--warning)' }} />}
                              {readyForFinalApproval ? 'Ready to launch — give Final Approval above to proceed.' : 'Store readiness must reach 100% with no critical issues before proceeding to Phase 9.'}
                            </span>
                            {!readyForFinalApproval && (
                              <ul className="col gap-1" style={{ margin: 0, paddingLeft: 18 }}>
                                {!allCategoriesCovered && <li className="tiny muted">{categories.filter((c) => c.total === 0).length} readiness module{categories.filter((c) => c.total === 0).length === 1 ? '' : 's'} with no checklist item yet</li>}
                                {overallPct < 100 && <li className="tiny muted">{totalTasks - completedTasks} checklist item{totalTasks - completedTasks === 1 ? '' : 's'} not yet completed ({overallPct}% ready)</li>}
                                {criticalIssues.length > 0 && <li className="tiny muted">{criticalIssues.length} critical issue{criticalIssues.length === 1 ? '' : 's'} to resolve</li>}
                              </ul>
                            )}
                            {canFinalApprove && (
                              <button
                                type="button"
                                className="btn btn-subtle btn-sm"
                                disabled={readOnly}
                                onClick={onFinalApproval}
                                style={{ alignSelf: 'flex-start' }}
                              >
                                Proceed to Phase 9 <ArrowRight size={13} style={{ marginLeft: 4 }} />
                              </button>
                            )}
                          </div>
                        )}
                      </SectionCard>
                    </div>
                  </div>
                </>
              )}

              {pageTab === 'checklist' && (
                <GlobalChecklistTab
                  tasks={tasks}
                  onOpenTask={openTaskDetail}
                  onStatusChange={onTaskStatusChange}
                  onBulkComplete={onBulkComplete}
                  readOnly={readOnly}
                />
              )}

              {pageTab === 'issues' && (
                <IssuesTab tasks={tasks} onOpenTask={openTaskDetail} />
              )}

              {pageTab === 'documents' && (
                <DocumentsTab tasks={tasks} onOpenTask={openTaskDetail} />
              )}

              {pageTab === 'approvals' && (
                <ApprovalsTab
                  tasks={tasks}
                  deptPct={deptPct}
                  mgmtPct={mgmtPct}
                  isCompleted={isCompleted}
                  canFinalApprove={canFinalApprove}
                  readyForFinalApproval={readyForFinalApproval}
                  completeStage={completeStage}
                  onFinalApproval={onFinalApproval}
                  finalApprovalError={finalApprovalError}
                  onOpenTask={openTaskDetail}
                  readOnly={readOnly}
                />
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
        departments={departments}
        presetDept=""
        stageKey={STAGE_KEY}
        categoryOptions={categoryOptions}
        onCreate={createNewTask}
        creating={createTask.isPending}
        tasks={tasks}
      />
    </>
  );
}

export default StoreReadinessDashboardPage;
