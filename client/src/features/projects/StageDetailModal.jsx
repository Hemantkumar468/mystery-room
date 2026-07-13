import {
  CalendarRange,
  Database,
  History,
  ListChecks,
  UserRound,
} from 'lucide-react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar, Badge, Spinner } from '../../components/ui/primitives.jsx';
import { useBoard, useProjectActivity, useTemplate } from '../../lib/queries.js';
import { DEPT_META, PRIORITY_META, STAGE_STATUS_META, TASK_STATUS_META } from '../../lib/ui.js';
import { fmtCurrency, fmtDate, fromNow } from '../../lib/format.js';
import dayjs from '../../lib/dayjs.js';
import { getEmployeeById } from '../../lib/employees.js';

const EMPTY = 'Data not available';

const pluralDays = (n) => `${n} ${Number(n) === 1 ? 'day' : 'days'}`;

function daysBetween(start, end) {
  if (!start || !end) return null;
  return Math.max(0, dayjs(end).startOf('day').diff(dayjs(start).startOf('day'), 'day'));
}

function timingForStage(stage) {
  const slaDays = Number(stage.slaDays) || 0;
  const actualStart = stage.startedAt || null;
  const actualEnd = stage.completedAt || null;
  const fallbackStart = actualStart || stage.plannedStart;
  const fallbackEnd = actualEnd || (stage.status === 'completed' ? stage.plannedEnd : null);
  const completed = stage.status === 'completed';

  if (completed && fallbackStart && fallbackEnd) {
    const days = daysBetween(fallbackStart, fallbackEnd);
    const verdict = days > slaDays ? 'Delayed' : days < slaDays ? 'Ahead' : 'On time';
    const color = verdict === 'Delayed' ? 'var(--danger)' : 'var(--success)';
    return {
      label: `Completed in ${pluralDays(days)} (SLA: ${pluralDays(slaDays)}) - ${verdict}`,
      color,
    };
  }

  if ((stage.status === 'in_progress' || stage.status === 'blocked') && actualStart) {
    const days = daysBetween(actualStart, new Date());
    const verdict = days > slaDays ? 'Delayed' : 'On time';
    return {
      label: `In progress for ${pluralDays(days)} (SLA: ${pluralDays(slaDays)}) - ${verdict}`,
      color: verdict === 'Delayed' ? 'var(--danger)' : 'var(--success)',
    };
  }

  const plannedDays = daysBetween(stage.plannedStart, stage.plannedEnd);
  return {
    label:
      plannedDays == null
        ? `Actual time not available (SLA: ${pluralDays(slaDays)})`
        : `Actual time not available (planned ${pluralDays(plannedDays)}, SLA: ${pluralDays(slaDays)})`,
    color: 'var(--text-muted)',
  };
}

function flattenBoard(board) {
  return board?.columns?.flatMap((column) => column.tasks || []) || [];
}

function stageOrderLabel(stage) {
  return Number.isFinite(stage.order) ? `Stage ${stage.order + 1}` : 'Stage';
}

function personFromUser(user, detail = '') {
  if (!user?.name) return null;
  return {
    key: `user:${user._id || user.name}`,
    name: user.name,
    color: user.avatarColor,
    detail: detail || user.title || user.role || '',
  };
}

function personFromEmployeeId(id, detail = '') {
  if (!id) return null;
  const employee = getEmployeeById(id);
  if (!employee) return null;
  return {
    key: `employee:${employee.id}`,
    name: employee.name,
    color: employee.avatarColor,
    detail: detail || employee.role,
  };
}

function taskPrimaryPerson(task) {
  return personFromUser(task.assignee, 'Task assignee')
    || personFromEmployeeId(task.primaryAssignee, 'Primary doer')
    || personFromEmployeeId(task.assignees?.[0], 'Task assignee');
}

function buildContributors(stage, tasks, activities) {
  const people = new Map();
  const add = (person) => {
    if (!person) return;
    if (!people.has(person.key)) people.set(person.key, person);
  };

  add(personFromUser(stage.completedBy, 'Completed stage'));
  tasks.forEach((task) => {
    add(personFromUser(task.assignee, 'Task assignee'));
    add(personFromEmployeeId(task.primaryAssignee, 'Primary doer'));
    add(personFromEmployeeId(task.backupAssignee, 'Backup'));
    (task.assignees || []).forEach((id) => add(personFromEmployeeId(id, 'Task assignee')));
  });
  activities.forEach((activity) => {
    add(personFromUser(activity.actor, 'Activity'));
  });

  return [...people.values()];
}

function isEmptyValue(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function formatMasterValue(field, value) {
  if (isEmptyValue(value)) return EMPTY;
  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' ? 'Yes' : 'No';
    case 'currency':
      return fmtCurrency(value);
    case 'date':
      return fmtDate(value);
    case 'multiselect':
      return Array.isArray(value) ? value.join(', ') : String(value);
    case 'user': {
      const employee = getEmployeeById(value);
      return employee?.name || String(value);
    }
    default:
      return String(value);
  }
}

function DetailSection({ icon: Icon, title, children }) {
  return (
    <section className="col gap-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
      <div className="row gap-2">
        <Icon size={15} className="subtle" />
        <span className="section-title" style={{ fontSize: 14 }}>{title}</span>
      </div>
      {children}
    </section>
  );
}

function InfoCell({ label, value, tone }) {
  return (
    <div className="col gap-1" style={{ minWidth: 150 }}>
      <span className="tiny subtle upper">{label}</span>
      <span className="sm" style={{ fontWeight: 650, color: tone || 'var(--text)' }}>{value}</span>
    </div>
  );
}

function EmptyLine({ children = EMPTY }) {
  return <div className="empty sm" style={{ padding: '16px 12px' }}>{children}</div>;
}

function filterStageActivity(activities, stage, tasks) {
  const taskIds = new Set(tasks.map((task) => String(task._id)));
  return (activities || []).filter((activity) => (
    activity.meta?.stageKey === stage.key
    || (activity.entityType === 'task' && taskIds.has(String(activity.entityId)))
  ));
}

export function StageDetailModal({ project, stage, onClose }) {
  const templateId = project.template?.ref?._id || project.template?.ref;
  const { data: board, isLoading: tasksLoading } = useBoard(project._id);
  const { data: activities, isLoading: activityLoading } = useProjectActivity(project._id);
  const { data: template, isLoading: templateLoading } = useTemplate(templateId);

  if (!stage) return null;

  const stageMeta = STAGE_STATUS_META[stage.status] || { label: stage.status || 'Unknown', color: '#7c7784' };
  const timing = timingForStage(stage);
  const tasks = flattenBoard(board).filter((task) => task.stageKey === stage.key);
  const activity = filterStageActivity(activities, stage, tasks);
  const contributors = buildContributors(stage, tasks, activity);
  const templateStage = template?.stages?.find((item) => item.key === stage.key);
  const masterSchema = [...(templateStage?.masterDataSchema || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const masterValues = project.masterData?.[stage.key] || {};

  return (
    <Modal
      open={!!stage}
      onClose={onClose}
      title={stage.name}
      subtitle={`${stageOrderLabel(stage)}${DEPT_META[stage.ownerDepartment] ? ` - ${DEPT_META[stage.ownerDepartment]}` : ''}`}
      width={820}
    >
      <div className="col gap-5">
        <div className="row between wrap gap-3">
          <div className="row gap-3">
            <span className="badge-dot" style={{ background: stage.color, width: 12, height: 12 }} />
            <div className="col gap-1">
              <span className="tiny subtle upper">Stage Status</span>
              <Badge color={stageMeta.color}>{stageMeta.label}</Badge>
            </div>
          </div>
          <div className="sm" style={{ color: timing.color, fontWeight: 650 }}>{timing.label}</div>
        </div>

        <DetailSection icon={CalendarRange} title="Timeline">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-4)' }}>
            <InfoCell label="Start Date" value={fmtDate(stage.plannedStart)} />
            <InfoCell label="End Date" value={fmtDate(stage.plannedEnd)} />
            <InfoCell label="SLA Duration" value={pluralDays(stage.slaDays || 0)} />
            <InfoCell label="Actual Start" value={fmtDate(stage.startedAt)} />
            <InfoCell label="Actual End" value={fmtDate(stage.completedAt)} />
            <InfoCell label="Actual Time" value={timing.label} tone={timing.color} />
          </div>
        </DetailSection>

        <DetailSection icon={UserRound} title="Assigned Employee/User">
          {contributors.length ? (
            <div className="row gap-3 wrap">
              {contributors.map((person) => (
                <span key={person.key} className="row gap-2" style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
                  <Avatar name={person.name} color={person.color} size={26} />
                  <span className="col" style={{ gap: 1 }}>
                    <span className="sm" style={{ fontWeight: 650 }}>{person.name}</span>
                    {person.detail && <span className="tiny muted">{person.detail}</span>}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <EmptyLine>Not available</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={ListChecks} title="Relevant Tasks">
          {tasksLoading ? <Spinner label="Loading tasks..." /> : tasks.length ? (
            <div className="col">
              {tasks.map((task) => {
                const taskMeta = TASK_STATUS_META[task.status] || { label: task.status, color: '#7c7784' };
                const priorityMeta = PRIORITY_META[task.priority] || PRIORITY_META.medium;
                const assignee = taskPrimaryPerson(task);
                return (
                  <div key={task._id} className="row between gap-3 wrap" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="col gap-1 grow" style={{ minWidth: 220 }}>
                      <span className="mono tiny subtle">{task.code}</span>
                      <span className="sm" style={{ fontWeight: 650 }}>{task.title}</span>
                      <span className="tiny muted">
                        Due {fmtDate(task.plannedEnd)} - {assignee?.name || 'Unassigned'}
                      </span>
                    </div>
                    <div className="row gap-2 wrap">
                      <Badge color={priorityMeta.color}>{priorityMeta.label}</Badge>
                      <Badge color={taskMeta.color}>{taskMeta.label}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLine>No stage-linked tasks available</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={Database} title="Master Data">
          {templateLoading ? <Spinner label="Loading master-data schema..." /> : masterSchema.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--space-4)' }}>
              {masterSchema.map((field) => {
                const value = formatMasterValue(field, masterValues[field.key]);
                const missing = value === EMPTY;
                return (
                  <div key={field.key} className="col gap-1" style={{ paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <span className="tiny subtle upper">{field.label}</span>
                    <span className="sm" style={{ color: missing ? 'var(--text-muted)' : 'var(--text)', fontWeight: missing ? 500 : 650 }}>
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyLine>No master-data fields configured for this stage</EmptyLine>
          )}
        </DetailSection>

        <DetailSection icon={History} title="Activity">
          {activityLoading ? <Spinner label="Loading activity..." /> : activity.length ? (
            <div className="col gap-3">
              {activity.map((item) => (
                <div key={item._id} className="row gap-3">
                  <Avatar name={item.actor?.name || 'System'} color={item.actor?.avatarColor || 'var(--ink-500)'} size={28} />
                  <div className="col grow">
                    <div className="sm"><b>{item.actor?.name || 'System'}</b> <span className="muted">{item.message}</span></div>
                    <div className="tiny muted">{fromNow(item.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyLine>No stage-linked activity available</EmptyLine>
          )}
        </DetailSection>
      </div>
    </Modal>
  );
}

export default StageDetailModal;
