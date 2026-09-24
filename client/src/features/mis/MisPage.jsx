import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Download, MoreHorizontal, RefreshCw, BarChart3,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, ErrorState } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { ComparisonBar, TrendArea, HBar } from '../../components/charts/chartkit.jsx';
import { KpiCard, SegmentedMix, HealthMeters, SlipChart } from './misWidgets.jsx';
import { useMisPortfolio } from '../../app/api/misApi.js';
import { HEALTH_META, DEPT_META } from '../../lib/ui.js';
import { fmtNumber, fromNow } from '../../lib/format.js';

/** Mirrors the server's `MIS_RANGES` enum — anything else is a 400. */
const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const DEFAULT_RANGE = '30';
const RANGE_VALUES = RANGE_OPTIONS.map((o) => o.value);

/** Only the worst two get banner space — past that it stops being a signal. */
const MAX_ALERTS = 2;

export function MisPage() {
  // Filters live in the URL, not component state: a filtered view is the thing
  // people paste into chat, and the back button should walk through slices.
  const [params, setParams] = useSearchParams();
  const range = RANGE_VALUES.includes(params.get('range')) ? params.get('range') : DEFAULT_RANGE;
  const dept = params.get('dept') || 'all';

  const { data, isLoading, isFetching, isError, error, refetch } = useMisPortfolio({ range, dept });

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === (key === 'range' ? DEFAULT_RANGE : 'all')) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const filters = (
    <Filters
      range={range}
      dept={dept}
      departments={data?.departments || []}
      onChange={setFilter}
      onRefresh={refetch}
      onExport={() => exportCsv(data, { range, dept })}
      busy={isFetching}
      canExport={Boolean(data)}
    />
  );

  const subtitle = data
    ? `Live across ${fmtNumber(data.kpis.totalProjects)} ${data.kpis.totalProjects === 1 ? 'project' : 'projects'} · updated ${fromNow(data.generatedAt)}`
    : 'Live management information across the portfolio';

  return (
    <>
      <Topbar title="MIS & Analytics" subtitle={subtitle} actions={filters} />
      <div className="content">
        {isError ? (
          <ErrorState
            title="Couldn’t load the MIS report"
            hint={error?.data?.message || 'The analytics service did not respond.'}
            onRetry={refetch}
          />
        ) : isLoading || !data ? (
          <SkCharts />
        ) : (
          // Refetching on a filter change keeps the previous numbers on screen
          // and dims them, rather than collapsing the page back to skeletons.
          <div
            className="content-narrow col gap-4 fade-in"
            style={{ opacity: isFetching ? 0.55 : 1, transition: 'opacity var(--transition)' }}
          >
            <Alerts alerts={data.alerts} />

            <div className="mis-kpi-grid">
              <KpiCard
                label="Completion rate"
                value={`${data.kpis.completionRate}%`}
                delta={data.deltas?.completionRate}
                meter={data.kpis.completionRate}
                meterColor="var(--success)"
                foot={`${fmtNumber(data.kpis.doneTasks)} of ${fmtNumber(data.kpis.totalTasks)} tasks`}
                to="/tasks"
              />
              <KpiCard
                label="On-time delivery"
                value={`${data.onTimeRate.rate}%`}
                delta={data.deltas?.onTimeRate}
                meter={data.onTimeRate.rate}
                meterColor="var(--warning)"
                foot={data.onTimeRate.total
                  ? `${fmtNumber(data.onTimeRate.late)} delivered late`
                  : 'No completions yet'}
                to="/tasks"
              />
              <KpiCard
                label="Overdue tasks"
                value={fmtNumber(data.kpis.overdueTasks)}
                delta={data.deltas?.overdueTasks}
                meter={data.kpis.overdueRate}
                meterColor="var(--danger)"
                foot={`${data.kpis.overdueRate}% of all tasks`}
                to="/tasks/overdue"
                alert={data.kpis.overdueRate >= 10}
              />
              <KpiCard
                label="Effort logged"
                value={`${fmtNumber(data.kpis.actualHours)}h`}
                delta={data.deltas?.actualHours}
                // Capped at 100 so a 300% overrun doesn't overflow the track;
                // the exact ratio is spelled out in the footnote either way.
                meter={Math.min(100, data.kpis.effortRatio ?? 0)}
                meterColor="var(--gold-400)"
                foot={data.kpis.effortRatio != null
                  ? `${data.kpis.effortRatio}% of ${fmtNumber(data.kpis.estimatedHours)}h planned`
                  : 'No effort estimates set'}
              />
            </div>

            <div className="mis-split">
              <SectionCard
                title="Task status mix"
                subtitle={`${fmtNumber(data.taskMix.total)} tasks across the board`}
              >
                {data.taskMix.total ? (
                  <SegmentedMix
                    buckets={data.taskMix.buckets}
                    total={data.taskMix.total}
                    linkFor={(b) => (b.key === 'overdue' && b.count ? '/tasks/overdue' : null)}
                  />
                ) : (
                  <EmptyState icon={BarChart3} title="No tasks in this range" hint="Widen the date range or clear the team filter." />
                )}
              </SectionCard>

              <SectionCard
                title="Project health"
                subtitle={`${fmtNumber(data.kpis.totalProjects)} ${data.kpis.totalProjects === 1 ? 'project' : 'projects'}`}
              >
                {data.kpis.totalProjects ? (
                  <HealthMeters
                    rows={data.healthDistribution.map((h) => ({
                      key: h.health,
                      label: HEALTH_META[h.health]?.label || h.health,
                      color: HEALTH_META[h.health]?.color,
                      count: h.count,
                    }))}
                    total={data.kpis.totalProjects}
                  />
                ) : (
                  <EmptyState icon={BarChart3} title="No projects in scope" />
                )}
              </SectionCard>
            </div>

            <SectionCard
              title="Planned vs actual duration"
              subtitle="Working days per stage — sorted by biggest slip"
            >
              {data.plannedVsActual.length ? (
                <>
                  <SlipChart rows={data.plannedVsActual.slice(0, 8)} />
                  {data.plannedVsActual.length > 8 && (
                    <div className="mis-card-note">
                      Showing the 8 stages with the largest slip of {data.plannedVsActual.length} measured.
                    </div>
                  )}
                </>
              ) : (
                <div className="empty sm">Not enough completed tasks yet to compare against plan</div>
              )}
            </SectionCard>

            <div className="mis-split">
              <SectionCard title="Throughput" subtitle="Tasks completed per week (last 8 weeks)">
                <TrendArea
                  data={data.throughput.map((t) => ({ label: t.week, completed: t.completed }))}
                  dataKey="completed"
                  name="Completed"
                  color="#16a79a"
                  height={250}
                />
              </SectionCard>

              <SectionCard title="Stage cycle time" subtitle="Avg days a stage’s tasks take">
                {data.stageCycleTime.length ? (
                  <ComparisonBar
                    data={data.stageCycleTime.slice(0, 8).map((s) => ({ label: s.stage, Days: s.avgDays }))}
                    keys={[{ key: 'Days', name: 'Avg days', color: '#a855f7' }]}
                    height={250}
                    suffix="d"
                  />
                ) : (
                  <div className="empty sm">No completed stages yet</div>
                )}
              </SectionCard>
            </div>

            <SectionCard title="Team workload" subtitle="Open vs overdue tasks per assignee — current, not range-scoped">
              {data.assigneeLoad.length ? (
                <HBar
                  data={data.assigneeLoad.map((a) => ({
                    label: a.name,
                    open: a.open - a.overdue,
                    overdue: a.overdue,
                  }))}
                  height={Math.max(200, data.assigneeLoad.length * 40)}
                />
              ) : (
                <div className="empty sm">No open tasks assigned</div>
              )}
            </SectionCard>

            <div className="tiny muted" style={{ textAlign: 'center', paddingBottom: 'var(--space-4)' }}>
              Range metrics cover tasks in play during the selected period; movement is measured against
              the previous period of equal length. Workload, health and throughput are current-state.
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Range + team pickers and the overflow menu, mounted in the topbar. */
function Filters({ range, dept, departments, onChange, onRefresh, onExport, busy, canExport }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mis-filters">
      <select
        className="mis-select"
        value={range}
        onChange={(e) => onChange('range', e.target.value)}
        aria-label="Date range"
      >
        {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select
        className="mis-select"
        value={dept}
        onChange={(e) => onChange('dept', e.target.value)}
        aria-label="Team"
      >
        <option value="all">All teams</option>
        {departments.map((d) => <option key={d} value={d}>{DEPT_META[d] || d}</option>)}
      </select>

      <div className="mis-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className="mis-menu-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-label="Report options"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <MoreHorizontal size={17} />
        </button>
        {open && (
          <div className="card mis-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="mis-menu-item"
              onClick={() => { setOpen(false); onRefresh(); }}
            >
              <RefreshCw size={15} className={busy ? 'mis-spin' : undefined} /> Refresh data
            </button>
            <button
              type="button"
              role="menuitem"
              className="mis-menu-item"
              disabled={!canExport}
              onClick={() => { setOpen(false); onExport(); }}
            >
              <Download size={15} /> Export as CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The "worth a look first" banners, most interrupting first. */
function Alerts({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div className="col gap-2">
      {alerts.slice(0, MAX_ALERTS).map((a) => (
        <div key={a.key} className={`mis-alert mis-alert--${a.tone}`} role="status">
          <AlertTriangle size={17} className="mis-alert-icon" />
          <span className="grow">{a.message}</span>
          {a.actionTo && (
            <Link to={a.actionTo} className="mis-alert-action">{a.actionLabel}</Link>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Flat "section, metric, value" CSV — the shape that pastes cleanly into the
 * spreadsheets these numbers end up in, rather than one wide row nobody can
 * read. Built from the already-loaded report, so it costs no extra request.
 */
function exportCsv(report, { range, dept }) {
  if (!report) return;
  const rows = [['Section', 'Metric', 'Value']];
  const push = (section, metric, value) => rows.push([section, metric, value]);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label || range;
  push('Report', 'Range', rangeLabel);
  push('Report', 'Team', dept === 'all' ? 'All teams' : DEPT_META[dept] || dept);
  push('Report', 'Generated', new Date(report.generatedAt).toISOString());

  const k = report.kpis;
  push('KPIs', 'Completion rate (%)', k.completionRate);
  push('KPIs', 'On-time delivery (%)', report.onTimeRate.rate);
  push('KPIs', 'Overdue tasks', k.overdueTasks);
  push('KPIs', 'Overdue rate (%)', k.overdueRate);
  push('KPIs', 'Tasks completed', k.doneTasks);
  push('KPIs', 'Tasks total', k.totalTasks);
  push('KPIs', 'Effort logged (h)', k.actualHours);
  push('KPIs', 'Effort planned (h)', k.estimatedHours);
  push('KPIs', 'Projects', k.totalProjects);

  report.taskMix.buckets.forEach((b) => push('Task mix', b.label, b.count));
  report.healthDistribution.forEach((h) => push('Project health', HEALTH_META[h.health]?.label || h.health, h.count));
  report.plannedVsActual.forEach((s) => {
    push('Planned vs actual', `${s.stage} — planned (d)`, s.planned);
    push('Planned vs actual', `${s.stage} — actual (d)`, s.actual);
    push('Planned vs actual', `${s.stage} — slip (d)`, s.slip);
  });
  report.stageCycleTime.forEach((s) => push('Cycle time', `${s.stage} (avg d)`, s.avgDays));
  report.assigneeLoad.forEach((a) => {
    push('Workload', `${a.name} — open`, a.open);
    push('Workload', `${a.name} — overdue`, a.overdue);
  });
  report.throughput.forEach((t) => push('Throughput', `Week of ${t.week}`, t.completed));

  // Quote every field and double any embedded quotes — stage names come from
  // user-authored templates and routinely contain commas.
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  // Leading BOM so Excel opens the file as UTF-8 rather than the local
  // codepage — without it the en-dashes in these labels arrive as mojibake.
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mis-report-${range}-${dept}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default MisPage;
