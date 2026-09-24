/**
 * Gantt / Timeline — the MD's primary planning view (client doc §9.2).
 *
 * Two scopes in one page. With no project selected it plots the whole
 * portfolio, one row per project with its phases nested under it. Pick a
 * project and it becomes that project's phases, with an option to explode
 * them into tasks.
 *
 * Filters live in the URL so a filtered timeline is a link someone can paste
 * into a review, and the back button walks through what was looked at.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Download, RotateCcw, Printer, ChevronDown, Layers, ListTree,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { ErrorState } from '../../components/ui/primitives.jsx';
import { SkCharts } from '../../components/ui/Skeletons.jsx';
import { GanttChart, ZOOMS } from '../../components/charts/GanttChart.jsx';
import { useGantt } from '../../app/api/ganttApi.js';
import { DEPT_META, TASK_STATUS_META, PRIORITY_META, HEALTH_META, PROJECT_STATUS_META } from '../../lib/ui.js';
import { getStagePath } from '../projects/stagesConfig.jsx';

/** Every filter the page supports, and its default (= absent from the URL). */
const FILTER_KEYS = ['project', 'level', 'city', 'status', 'health', 'department', 'owner', 'priority', 'stageKey', 'taskStatus', 'search', 'zoom'];

export function GanttPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const get = (k, fallback = '') => params.get(k) || fallback;
  const project = get('project');
  const level = get('level', 'phase');
  const zoom = ZOOMS[get('zoom', 'week')] ? get('zoom', 'week') : 'week';

  // Task-level filters are meaningless without a project, so they are dropped
  // from the request rather than sent and silently ignored by the server.
  const query = useMemo(() => {
    const q = {
      project: project || undefined,
      level: project ? level : undefined,
      city: get('city') || undefined,
      status: get('status') || undefined,
      health: get('health') || undefined,
      department: get('department') || undefined,
      owner: get('owner') || undefined,
      stageKey: get('stageKey') || undefined,
    };
    if (project && level === 'task') {
      q.priority = get('priority') || undefined;
      q.taskStatus = get('taskStatus') || undefined;
      q.search = get('search') || undefined;
    }
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params is the dep
  }, [params.toString()]);

  const { data, isLoading, isFetching, isError, refetch } = useGantt(query);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    // Switching away from a project strands the task level and its filters.
    if (key === 'project' && !value) {
      next.delete('level');
      next.delete('priority');
      next.delete('taskStatus');
      next.delete('search');
      next.delete('stageKey');
    }
    setParams(next, { replace: true });
  };

  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  const active = FILTER_KEYS.filter((k) => k !== 'zoom' && k !== 'level' && params.get(k));

  const facets = data?.facets;
  const openRow = (row) => {
    if (row.type === 'task' && row.taskId && row.code) navigate(`/projects/${row.projectId}/tasks/${row.code}`);
    else if (row.type === 'phase') navigate(getStagePath(row.projectId, row.stageKey));
    else if (row.projectId) navigate(`/projects/${row.projectId}`);
  };

  const subtitle = data
    ? `${data.rows.length} rows · ${data.scope === 'portfolio' ? 'whole portfolio' : 'one project'}`
    : 'Planned vs actual across every phase';

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            Timeline (Gantt)
            <span className="tiny muted" style={{ fontWeight: 500 }}>{subtitle}</span>
          </span>
        )}
      />
      <div className="content">
        {isError ? (
          <ErrorState title="Couldn’t load the timeline" onRetry={refetch} />
        ) : isLoading || !data ? (
          <SkCharts />
        ) : (
          <div className="content-wide col gap-3 fade-in" style={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity var(--transition)' }}>
            <div className="tl-toolbar">
              <div className="tl-toolbar-row">
                <Select label="Project" value={project} onChange={(v) => setFilter('project', v)} allLabel="All projects (portfolio)">
                  {facets.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.city ? ` · ${p.city}` : ''}</option>)}
                </Select>

                {project && (
                  <div className="tl-seg" role="group" aria-label="Detail level">
                    <button type="button" className={`tl-seg-btn${level === 'phase' ? ' active' : ''}`} onClick={() => setFilter('level', 'phase')}>
                      <Layers size={13} /> Phases
                    </button>
                    <button type="button" className={`tl-seg-btn${level === 'task' ? ' active' : ''}`} onClick={() => setFilter('level', 'task')}>
                      <ListTree size={13} /> Tasks
                    </button>
                  </div>
                )}

                <div className="tl-seg" role="group" aria-label="Zoom">
                  {Object.values(ZOOMS).map((z) => (
                    <button
                      key={z.key}
                      type="button"
                      className={`tl-seg-btn${zoom === z.key ? ' active' : ''}`}
                      onClick={() => setFilter('zoom', z.key)}
                    >
                      {z.label}
                    </button>
                  ))}
                </div>

                <div className="grow" />

                <button type="button" className="btn btn-subtle btn-sm" onClick={() => exportCsv(data)}>
                  <Download size={14} /> Excel / CSV
                </button>
                <button type="button" className="btn btn-subtle btn-sm" onClick={() => window.print()}>
                  <Printer size={14} /> PDF
                </button>
              </div>

              <div className="tl-toolbar-row">
                {!project && (
                  <>
                    <Select label="City" value={get('city')} onChange={(v) => setFilter('city', v)} allLabel="All cities">
                      {facets.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                    <Select label="Project status" value={get('status')} onChange={(v) => setFilter('status', v)} allLabel="Any status">
                      {Object.entries(PROJECT_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    </Select>
                    <Select label="Health" value={get('health')} onChange={(v) => setFilter('health', v)} allLabel="Any health">
                      {Object.entries(HEALTH_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                    </Select>
                  </>
                )}

                <Select label="Phase" value={get('stageKey')} onChange={(v) => setFilter('stageKey', v)} allLabel="All phases">
                  {facets.phases.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </Select>

                <Select label="Department" value={get('department')} onChange={(v) => setFilter('department', v)} allLabel="All departments">
                  {facets.departments.map((d) => <option key={d} value={d}>{DEPT_META[d] || d}</option>)}
                </Select>

                {project && level === 'task' && (
                  <>
                    <Select label="Owner" value={get('owner')} onChange={(v) => setFilter('owner', v)} allLabel="Anyone">
                      {facets.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </Select>
                    <Select label="Priority" value={get('priority')} onChange={(v) => setFilter('priority', v)} allLabel="Any priority">
                      {facets.priorities.map((p) => <option key={p} value={p}>{PRIORITY_META[p]?.label || p}</option>)}
                    </Select>
                    <Select label="Task status" value={get('taskStatus')} onChange={(v) => setFilter('taskStatus', v)} allLabel="Any status">
                      {facets.taskStatuses.map((s) => <option key={s} value={s}>{TASK_STATUS_META[s]?.label || s}</option>)}
                    </Select>
                    <input
                      className="tl-search"
                      value={get('search')}
                      onChange={(e) => setFilter('search', e.target.value)}
                      placeholder="Search task or code…"
                      aria-label="Search tasks"
                    />
                  </>
                )}

                {active.length > 0 && (
                  <button type="button" className="btn btn-subtle btn-sm" onClick={clearAll}>
                    <RotateCcw size={13} /> Clear {active.length}
                  </button>
                )}
              </div>
            </div>

            <GanttChart data={data} zoom={zoom} onRowClick={openRow} height={620} />

            <div className="tl-legend">
              <span className="tl-legend-item"><span className="tl-legend-swatch tl-legend-swatch--planned" /> Planned</span>
              <span className="tl-legend-item"><span className="tl-legend-swatch" style={{ background: 'var(--success)' }} /> On track</span>
              <span className="tl-legend-item"><span className="tl-legend-swatch" style={{ background: 'var(--warning)' }} /> At risk / due</span>
              <span className="tl-legend-item"><span className="tl-legend-swatch" style={{ background: 'var(--danger)' }} /> Overdue</span>
              <span className="tl-legend-item"><span className="tl-legend-swatch" style={{ background: 'var(--text-subtle)' }} /> Completed</span>
              <span className="tl-legend-item">Click any row to open it.</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Labelled select — the toolbar's only control shape, so it is one component. */
function Select({ label, value, onChange, allLabel, children }) {
  return (
    <label className="tl-field">
      <span className="tl-field-label">{label}</span>
      <span className="tl-field-control">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{allLabel}</option>
          {children}
        </select>
        <ChevronDown size={13} />
      </span>
    </label>
  );
}

/**
 * Flat CSV of exactly the rows on screen, filters included. Opens in Excel,
 * which is what §9.2's "export to PDF and Excel" means in practice — a real
 * .xlsx would need a library for no gain over a CSV Excel opens natively.
 */
function exportCsv(data) {
  const head = ['Type', 'Project', 'Name', 'Owner/Dept', 'Planned start', 'Planned end', 'Actual start', 'Actual end', 'Status', 'Progress %', 'Verdict'];
  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const rows = data.rows.map((r) => [
    r.type,
    r.projectName || '',
    r.label,
    r.owner?.name || r.department || r.sublabel || '',
    fmt(r.plannedStart),
    fmt(r.plannedEnd),
    fmt(r.actualStart),
    fmt(r.actualEnd),
    r.status || '',
    r.progress ?? '',
    r.timing?.label || '',
  ]);

  const csv = [head, ...rows]
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  // BOM so Excel reads it as UTF-8 rather than the local codepage.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `tl-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default GanttPage;
