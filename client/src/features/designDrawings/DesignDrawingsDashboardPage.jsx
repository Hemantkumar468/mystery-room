import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Search, Eye, Plus, MoreVertical, ExternalLink, PenSquare,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { PropTable } from '../property/PropTable.jsx';
import { PropPager } from '../property/PropPager.jsx';
import { PageHead, PropEmpty } from '../property/propertyUi.jsx';
import { fmtDate } from '../../lib/format.js';
import dayjs from '../../lib/dayjs.js';
import { PROJECT_STATUS_META } from '../../lib/ui.js';
import { useGetFmsOverviewQuery } from '../../app/api/designDrawingsApi.js';

/**
 * Design & Drawings FMS — the multi-project dashboard.
 *
 * A read model over the same 37-drawing checklist the FMS tab works through,
 * asked across every project instead of inside one. Every number comes from
 * `useGetFmsOverviewQuery()`; nothing here is hardcoded.
 *
 * Styled with the Property module's `.prop-*` system (see
 * property-capture.css, loaded globally by main.jsx) for the same reason the
 * FMS tab is: the two tabs are one module and must not drift into two
 * palettes. Gold on cream, white cards, semantic tag colours — no blue.
 */

/* Status tags reuse Property's own tag tokens, so both tabs tint the same. */
const HEALTH_TAG = {
  on_track: { label: 'On Track', bg: 'var(--p-tag-captured-bg)', fg: 'var(--p-tag-captured-fg)' },
  at_risk: { label: 'At Risk', bg: 'var(--p-tag-wanted-bg)', fg: 'var(--p-tag-wanted-fg)' },
  delayed: { label: 'Delayed', bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', fg: 'var(--danger)' },
};
const HEALTH_BAR = {
  on_track: 'var(--p-tag-captured-fg)',
  at_risk: 'var(--p-tag-wanted-fg)',
  delayed: 'var(--danger)',
};

function csvRow(cells) {
  return cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',');
}

function exportProjectsCsv(rows) {
  const header = ['Project', 'Code', 'Location', 'Manager', 'Start', 'Target', 'Progress %', 'Phase 1', 'Phase 2', 'Phase 3', 'Status', 'Delay (days)'];
  const lines = [csvRow(header), ...rows.map((p) => csvRow([
    p.name, p.code, p.location || '', p.manager?.name || '',
    p.startDate ? fmtDate(p.startDate) : '', p.targetDate ? fmtDate(p.targetDate) : '',
    p.overallProgress, `${p.phase1.approved}/${p.phase1.total}`, `${p.phase2.approved}/${p.phase2.total}`,
    `${p.phase3.approved}/${p.phase3.total}`, p.health.status, p.health.delayDays,
  ]))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `design-drawings-${dayjs().format('YYYY-MM-DD')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** The ⋮ on each row. */
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <span style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        className="prop-open"
        style={{ padding: '6px 7px' }}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <span
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20, minWidth: 176,
            display: 'flex', flexDirection: 'column', padding: 4, borderRadius: 9,
            background: 'var(--p-paper)', border: '1px solid var(--p-line)',
            boxShadow: '0 10px 28px -12px rgba(0,0,0,.28)',
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6,
                border: 0, background: 'none', font: 'inherit', fontSize: 13, color: 'var(--p-text)',
                cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
              }}
            >
              <it.icon size={14} /> {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default function DesignDrawingsDashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGetFmsOverviewQuery();

  const [projectFilter, setProjectFilter] = useState('all');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [managerFilter, setManagerFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  const projects = data?.projects || [];

  const managers = useMemo(() => [...new Map(
    projects.filter((p) => p.manager).map((p) => [p.manager.id, p.manager]),
  ).values()], [projects]);
  const locations = useMemo(() => [...new Set(projects.map((p) => p.location).filter(Boolean))].sort(), [projects]);
  const statuses = useMemo(() => [...new Set(projects.map((p) => p.status).filter(Boolean))], [projects]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (projectFilter !== 'all' && p.id !== projectFilter) return false;
      if (needle && !`${p.name} ${p.code}`.toLowerCase().includes(needle)) return false;
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (managerFilter !== 'all' && p.manager?.id !== managerFilter) return false;
      if (locationFilter !== 'all' && p.location !== locationFilter) return false;
      if (phaseFilter !== 'all' && String(p.currentPhase) !== phaseFilter) return false;
      const target = p.targetDate ? p.targetDate.slice(0, 10) : '';
      if (fromDate && (!target || target < fromDate)) return false;
      if (toDate && (!target || target > toDate)) return false;
      return true;
    });
  }, [projects, projectFilter, q, statusFilter, managerFilter, locationFilter, phaseFilter, fromDate, toDate]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const shownPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((shownPage - 1) * limit, shownPage * limit);

  const filtersOn = [
    projectFilter !== 'all', !!q.trim(), statusFilter !== 'all', managerFilter !== 'all',
    locationFilter !== 'all', phaseFilter !== 'all', !!fromDate, !!toDate,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setProjectFilter('all'); setQ(''); setStatusFilter('all'); setManagerFilter('all');
    setLocationFilter('all'); setPhaseFilter('all'); setFromDate(''); setToDate(''); setPage(1);
  };

  const viewDrawings = (id) => navigate(`/design-drawings/${id}`);
  /* Every count in this table is the answer to a question the breakdown page
     can already answer in full, so the number opens it pre-filtered rather
     than leaving the reader to reproduce the filter by hand. */
  const openMetric = (metric, filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v != null && v !== '')).toString();
    navigate(`/design-drawings/metric/${metric}${qs ? `?${qs}` : ''}`);
  };

  const columns = useMemo(() => [
    { key: 'no', label: '#', width: 54, render: (p) => <span className="prop-dim">{filtered.indexOf(p) + 1}</span> },
    {
      key: 'project',
      label: 'Project',
      width: 196,
      render: (p) => (
        <>
          <div className="prop-name">{p.name}</div>
          <div className="prop-dim" style={{ fontSize: 11.5 }}>{p.code}</div>
        </>
      ),
    },
    { key: 'location', label: 'Location', width: 118, render: (p) => p.location || <span className="prop-dim">—</span> },
    { key: 'manager', label: 'Manager', width: 140, render: (p) => p.manager?.name || <span className="prop-dim">—</span> },
    { key: 'start', label: 'Start', width: 112, render: (p) => (p.startDate ? fmtDate(p.startDate) : <span className="prop-dim">—</span>) },
    { key: 'target', label: 'Target', width: 112, render: (p) => (p.targetDate ? fmtDate(p.targetDate) : <span className="prop-dim">—</span>) },
    {
      key: 'progress',
      label: 'Progress',
      width: 150,
      render: (p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--p-line)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${p.overallProgress}%`, height: '100%', background: HEALTH_BAR[p.health.status] }} />
          </span>
          <button type="button" className="dd-cell-link" style={{ fontSize: 11.5, width: 34, textAlign: 'right' }} onClick={() => openMetric('drawings', { projectId: p.id })} title={`The 37 drawings behind ${p.overallProgress}%`}>
            <b>{p.overallProgress}%</b>
          </button>
        </div>
      ),
    },
    {
      key: 'phase1',
      label: 'Phase 1',
      width: 88,
      render: (p) => (
        <button type="button" className="dd-cell-link" onClick={() => openMetric('drawings', { projectId: p.id, set: 1 })} title={`The ${p.phase1.total} Set 1 drawings the BOQ waits for`}>
          {`${p.phase1.approved}/${p.phase1.total}`}
        </button>
      ),
    },
    {
      key: 'phase2',
      label: 'Phase 2',
      width: 88,
      render: (p) => (
        <button type="button" className="dd-cell-link" onClick={() => openMetric('drawings', { projectId: p.id, set: 2 })} title={`The ${p.phase2.total} Set 2 drawings`}>
          {`${p.phase2.approved}/${p.phase2.total}`}
        </button>
      ),
    },
    {
      key: 'phase3',
      label: 'Phase 3',
      width: 88,
      render: (p) => (
        <button type="button" className="dd-cell-link" onClick={() => openMetric('drawings', { projectId: p.id })} title={`All ${p.phase3.total} drawings on ${p.name}`}>
          {`${p.phase3.approved}/${p.phase3.total}`}
        </button>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: 116,
      render: (p) => {
        const t = HEALTH_TAG[p.health.status] || HEALTH_TAG.on_track;
        return <span className="prop-badge" style={{ background: t.bg, color: t.fg }}>{t.label}</span>;
      },
    },
    {
      key: 'delay',
      label: 'Delay',
      width: 86,
      render: (p) => (p.health.delayDays > 0
        ? (
          <button type="button" className="dd-cell-link" style={{ color: 'var(--danger)' }} onClick={() => openMetric('delayed', { projectId: p.id })} title={`What is overdue on ${p.name}`}>
            <b>{p.health.delayDays}d</b>
          </button>
        )
        : <span className="prop-dim">—</span>),
    },
    {
      key: 'action',
      label: 'Action',
      width: 124,
      render: (p) => (
        <div className="prop-action-cell">
          <button type="button" className="prop-open" onClick={() => viewDrawings(p.id)}>
            <Eye size={12} /> View
          </button>
          <RowMenu
            items={[
              { label: 'Open in FMS', icon: PenSquare, onClick: () => viewDrawings(p.id) },
              { label: 'Open the project', icon: ExternalLink, onClick: () => navigate(`/projects/${p.id}`) },
            ]}
          />
        </div>
      ),
    },
  ], [filtered, navigate]);

  if (isLoading) return <><Topbar title="Design & Drawings FMS" /><div className="content"><SkDetail /></div></>;
  if (isError || !data) {
    return (
      <>
        <Topbar title="Design & Drawings FMS" />
        <div className="content">
          <div className="card" style={{ padding: 28, textAlign: 'center' }}>
            <AlertTriangle size={26} style={{ color: 'var(--warning)' }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>Could not load the dashboard</div>
            <div className="sm muted" style={{ marginTop: 4 }}>Try again in a moment.</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Design & Drawings FMS" />

      <div className="prop-shell dd-shell">
        <div className="prop-page dd-page">

          <div className="prop-toolbar is-bare" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <PageHead
              title="Design & Drawings"
              subtitle="Track, manage and deliver all design drawings across projects."
            />
            <div className="dd-head-actions">
              <label className="prop-field">
                <span className="prop-field-label">PROJECT</span>
                <select className="prop-city" value={projectFilter} onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}>
                  <option value="all">All Projects</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="prop-toolbar">
            <div className="prop-filters">
              <label className="prop-field">
                <span className="prop-field-label">SEARCH</span>
                <span className="prop-search" style={{ width: 210 }}>
                  <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Project name or code…" />
                </span>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">STATUS</span>
                <select className="prop-city" style={{ minWidth: 132 }} value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
                  <option value="all">All Statuses</option>
                  {statuses.map((s) => <option key={s} value={s}>{PROJECT_STATUS_META[s]?.label || s}</option>)}
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">MANAGER</span>
                <select className="prop-city" style={{ minWidth: 132 }} value={managerFilter} onChange={(e) => { setManagerFilter(e.target.value); setPage(1); }}>
                  <option value="all">All Managers</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">LOCATION</span>
                <select className="prop-city" style={{ minWidth: 132 }} value={locationFilter} onChange={(e) => { setLocationFilter(e.target.value); setPage(1); }}>
                  <option value="all">All Locations</option>
                  {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">PHASE</span>
                <select className="prop-city" style={{ minWidth: 118 }} value={phaseFilter} onChange={(e) => { setPhaseFilter(e.target.value); setPage(1); }}>
                  <option value="all">All Phases</option>
                  <option value="1">Phase 1</option>
                  <option value="2">Phase 2</option>
                  <option value="3">Phase 3</option>
                </select>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">TARGET DATE</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="date" className="prop-city" style={{ minWidth: 0 }} value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} aria-label="Target from" />
                  <span className="prop-dim">→</span>
                  <input type="date" className="prop-city" style={{ minWidth: 0 }} value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} aria-label="Target to" />
                </span>
              </label>
              {filtersOn > 0 && (
                <div className="prop-field">
                  <span className="prop-field-label">&nbsp;</span>
                  <button type="button" className="prop-clear" onClick={clearFilters}>Clear · {filtered.length} found</button>
                </div>
              )}
            </div>
          </div>

          {!pageRows.length ? (
            <PropEmpty
              title="No project matches that"
              hint={filtersOn ? 'Clear the filters to see every project.' : 'No projects yet.'}
            />
          ) : (
            <PropTable columns={columns} rows={pageRows} rowKey={(p) => p.id} />
          )}

          <PropPager
            page={shownPage}
            totalPages={totalPages}
            total={filtered.length}
            limit={limit}
            onPage={setPage}
            onLimit={(n) => { setLimit(n); setPage(1); }}
          />
        </div>
      </div>
    </>
  );
}
