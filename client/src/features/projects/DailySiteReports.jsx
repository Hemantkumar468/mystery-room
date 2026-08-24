/**
 * Daily Site Reports — the Site Execution phase's running log.
 *
 * One row per working day, newest first: progress, who was on site, what came
 * in, what is short, what is blocking, and the photographs. The site
 * supervisor files one from their task (or from the button here); everyone
 * else reads. "Progress vs plan" at the top is the auto-computed comparison the
 * client document asks for — expected progress from the phase's planned dates
 * against what the supervisor actually reported.
 *
 * A report filed more than a day after the date it covers is a LATE ENTRY and
 * says so — the document is explicit that back-filling is allowed and must be
 * visible, never hidden.
 */
import { useMemo, useState } from 'react';
import {
  Plus, Camera, AlertTriangle, Users, Package, TrendingUp, TrendingDown, CalendarDays, Eye,
} from 'lucide-react';
import { SectionCard, EmptyState, Badge, Avatar } from '../../components/ui/primitives.jsx';
import { useStageRecords, useCreateRecord, useUpdateRecord } from '../../app/api/recordsApi.js';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { RecordDetailDrawer } from './records/RecordDetailDrawer.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import { can } from '../../lib/roles.js';
import dayjs from '../../lib/dayjs.js';

const STAGE_KEY = 'p6';
export const DAILY_REPORT_TYPE = 'daily_site_report';

const TRADES = [['masons', 'Masons'], ['carpenters', 'Carpenters'], ['electricians', 'Electricians'], ['painters', 'Painters'], ['helpers', 'Helpers']];

/** Sum of the per-trade counts — "how many people were on site". */
const workersOn = (v = {}) => TRADES.reduce((n, [k]) => n + (Number(v[k]) || 0), 0);

/** More than one day between the day reported on and the day it was filed. */
const isLate = (r) => {
  const d = r?.values?.report_date;
  if (!d) return false;
  return dayjs(r.createdAt).startOf('day').diff(dayjs(d).startOf('day'), 'day') > 1;
};

/**
 * Where the plan says the site should be today, as a 0–100 figure, from the
 * phase's planned window. Null when the window is not set — a guess would be
 * worse than no number.
 */
function expectedProgress(stage) {
  if (!stage?.plannedStart || !stage?.plannedEnd) return null;
  const start = dayjs(stage.plannedStart);
  const end = dayjs(stage.plannedEnd);
  const total = end.diff(start, 'day');
  if (total <= 0) return null;
  const elapsed = dayjs().diff(start, 'day');
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

export function DailySiteReports({ projectId }) {
  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const type = template?.stages?.find((s) => s.key === STAGE_KEY)?.assessmentTypes?.find((a) => a.key === DAILY_REPORT_TYPE) || null;
  const schema = type?.masterDataSchema || [];
  const stage = project?.stages?.find((s) => s.key === STAGE_KEY);

  const { data, isLoading } = useStageRecords(projectId, STAGE_KEY, { assessmentType: DAILY_REPORT_TYPE });
  const reports = useMemo(
    () => [...(data?.data || data || [])].sort((a, b) => {
      const byDate = new Date(b.values?.report_date || b.createdAt) - new Date(a.values?.report_date || a.createdAt);
      return byDate || new Date(b.createdAt) - new Date(a.createdAt);
    }),
    [data],
  );

  const createReport = useCreateRecord(projectId, STAGE_KEY);
  const updateReport = useUpdateRecord(projectId, STAGE_KEY);
  const user = useAppSelector(selectCurrentUser);
  const canFile = can.capture(user?.role);
  const canDecide = can.decide(user?.role);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);

  const latest = reports[0] || null;
  const reported = latest ? Number(latest.values?.overall_progress_pct) : null;
  const expected = expectedProgress(stage);
  const gap = reported != null && expected != null ? reported - expected : null;
  const todayFiled = reports.some((r) => dayjs(r.values?.report_date).isSame(dayjs(), 'day'));
  const openBlockers = reports.filter((r) => r.values?.blocked === true).slice(0, 3);

  const save = async ({ values, status }) => {
    if (editing) await updateReport.mutateAsync({ id: editing._id, values, status });
    else await createReport.mutateAsync({ values, status, assessmentType: DAILY_REPORT_TYPE });
    setFormOpen(false);
    setEditing(null);
  };

  // The form seeds today's date so the common case is one tap fewer; the
  // supervisor changes it only when back-filling.
  const seed = { report_date: dayjs().format('YYYY-MM-DD') };

  return (
    <div className="col gap-3">
      {/* ── Progress vs plan ─────────────────────────────────── */}
      <div className="dsr-strip">
        <div className="dsr-stat">
          <span className="dsr-stat-label">Reported progress</span>
          <span className="dsr-stat-value">{reported != null && Number.isFinite(reported) ? `${reported}%` : '—'}</span>
          <span className="tiny muted">{latest ? `as of ${fmtDate(latest.values?.report_date || latest.createdAt)}` : 'No report yet'}</span>
        </div>
        <div className="dsr-stat">
          <span className="dsr-stat-label">Plan says</span>
          <span className="dsr-stat-value">{expected != null ? `${expected}%` : '—'}</span>
          <span className="tiny muted">{stage?.plannedEnd ? `finish by ${fmtDate(stage.plannedEnd)}` : 'No planned window'}</span>
        </div>
        <div className={`dsr-stat${gap != null ? (gap < -10 ? ' is-bad' : gap < 0 ? ' is-warn' : ' is-ok') : ''}`}>
          <span className="dsr-stat-label">Against plan</span>
          <span className="dsr-stat-value row gap-1" style={{ alignItems: 'center' }}>
            {gap == null ? '—' : (
              <>
                {gap >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {gap > 0 ? `+${gap}` : gap} pts
              </>
            )}
          </span>
          <span className="tiny muted">
            {gap == null ? 'Needs a report and a plan' : gap < -10 ? 'Behind — flag it' : gap < 0 ? 'Slightly behind' : 'On or ahead of plan'}
          </span>
        </div>
        <div className="dsr-stat">
          <span className="dsr-stat-label">Today</span>
          <span className="dsr-stat-value">{todayFiled ? 'Filed' : 'Not yet'}</span>
          <span className="tiny muted">{reports.length} report{reports.length === 1 ? '' : 's'} so far</span>
        </div>
      </div>

      {openBlockers.length > 0 && (
        <div className="info-panel info-panel--danger">
          <AlertTriangle size={17} className="info-panel-icon" />
          <div className="col gap-1">
            <div className="info-panel-title">Blockers raised from site</div>
            <div className="info-panel-body col gap-1">
              {openBlockers.map((r) => (
                <span key={r._id}>
                  <strong>{fmtDate(r.values?.report_date)}</strong> — {r.values?.blocker_details}
                  {r.values?.blocker_owner && <span className="muted"> · needs {r.values.blocker_owner}</span>}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── The log ──────────────────────────────────────────── */}
      <SectionCard
        title="Daily Site Reports"
        subtitle="One per working day from the site supervisor — newest first"
        action={canFile && type && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={14} /> File today's report
          </button>
        )}
      >
        {!type ? (
          <EmptyState icon={CalendarDays} title="Daily reports are not set up on this template" hint="Run the migration that adds the Daily Site Report form to the Site Execution phase." />
        ) : isLoading ? (
          <div className="tiny muted" style={{ padding: 12 }}>Loading…</div>
        ) : reports.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No reports yet" hint="The site supervisor files the first one from their task, or with the button above." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-clickable">
              <thead>
                <tr>
                  <th>Date</th><th>Progress</th><th>On site</th><th>Materials</th><th>Blocked</th><th>Photos</th><th>Filed by</th><th></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const v = r.values || {};
                  const late = isLate(r);
                  const photos = Array.isArray(v.site_photos) ? v.site_photos.length : (v.site_photos ? 1 : 0);
                  const who = r.submittedBy || r.createdBy;
                  return (
                    <tr key={r._id} onClick={() => setViewing(r)}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <div className="col">
                          <span className="sm" style={{ fontWeight: 650 }}>{fmtDate(v.report_date || r.createdAt)}{v.shift ? ` · ${v.shift}` : ''}</span>
                          <span className="tiny muted">filed {fmtDateTime(r.createdAt)}{late && <Badge color="var(--warning)" soft="var(--warning-soft)" style={{ marginLeft: 6 }}>Late entry</Badge>}</span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="sm" style={{ fontWeight: 700 }}>{v.overall_progress_pct != null ? `${v.overall_progress_pct}%` : '—'}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="row gap-1 sm" style={{ alignItems: 'center' }}><Users size={13} className="muted" /> {workersOn(v)}{v.planned_workers ? <span className="tiny muted">/ {v.planned_workers} planned</span> : null}</span>
                      </td>
                      <td>
                        {v.material_shortage
                          ? <Badge color="var(--warning)" soft="var(--warning-soft)" dot>Shortage</Badge>
                          : <span className="row gap-1 tiny muted" style={{ alignItems: 'center' }}><Package size={12} /> OK</span>}
                      </td>
                      <td>
                        {v.blocked
                          ? <Badge color="var(--danger)" soft="var(--danger-soft)" dot>Blocked</Badge>
                          : <span className="tiny muted">No</span>}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="row gap-1 tiny muted" style={{ alignItems: 'center' }}><Camera size={12} /> {photos}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {who?.name ? (
                          <span className="row gap-2" style={{ alignItems: 'center' }}>
                            <Avatar name={who.name} color={who.avatarColor} size={22} />
                            <span className="tiny">{who.name}</span>
                          </span>
                        ) : <span className="tiny muted">—</span>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(r)} title="Open">
                          <Eye size={13} />
                        </button>
                        {canFile && r.status !== 'approved' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(r); setFormOpen(true); }}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {formOpen && type && (
        <RecordFormModal
          open
          onClose={() => { setFormOpen(false); setEditing(null); }}
          schema={schema}
          recordNoun={type.name}
          projectId={projectId}
          initialValues={editing?.values || null}
          seedValues={editing ? null : seed}
          saving={createReport.isPending || updateReport.isPending}
          onSaveDraft={({ values }) => save({ values, status: 'draft' })}
          onSubmit={({ values }) => save({ values, status: 'submitted' })}
        />
      )}

      {viewing && (
        <RecordDetailDrawer
          open
          onClose={() => setViewing(null)}
          record={viewing}
          schema={schema}
          recordNoun={type?.name || 'Daily Site Report'}
          projectId={projectId}
          stageKey={STAGE_KEY}
          canDecide={canDecide}
          onEdit={canFile && viewing.status !== 'approved' ? () => { setEditing(viewing); setViewing(null); setFormOpen(true); } : undefined}
        />
      )}
    </div>
  );
}

export default DailySiteReports;
