import { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Table2, Download, CheckCircle2, FileText, ClipboardList, ExternalLink, ChevronsUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useProjects, useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

/**
 * The Data Explorer — the auditor's walk through one project.
 *
 * The shell is a STEP TAB BAR, left to right: one tab per phase in template
 * order, each carrying the count of entries filed in it, the active one
 * underlined — the way a stepped review screen reads. Under it, the active
 * phase's title, then its data as spreadsheet rows: every filled form field
 * a column (sortable), then who filed, when, what was decided; documents as
 * open-in-new-tab links; CSV export on every table.
 *
 * ONE fetch serves the whole walk: all of the project's records arrive
 * together and are grouped by phase client-side — that is also what puts a
 * live count on every tab without fifteen requests.
 */

const csvEscape = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;

function downloadCsv(filename, header, rows) {
  const lines = [header.map(csvEscape).join(','), ...rows.map((r) => r.map(csvEscape).join(','))];
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** One cell, for the screen. Files become links; structures become words. */
function CellValue({ value }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (Array.isArray(value)) {
    const files = value.filter((x) => x && typeof x === 'object' && x.url);
    if (files.length) {
      return (
        <span className="row gap-1 wrap">
          {files.map((f, i) => (
            <a key={f.url || i} className="dx-file" href={f.url} target="_blank" rel="noreferrer">
              <FileText size={11} /> {f.name || f.originalName || `file ${i + 1}`}
            </a>
          ))}
        </span>
      );
    }
    return <>{value.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')}</>;
  }
  if (typeof value === 'object') {
    if (Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
      return (
        <a className="dx-file" href={`https://www.google.com/maps?q=${value.lat},${value.lng}`} target="_blank" rel="noreferrer">
          {value.lat.toFixed(4)}, {value.lng.toFixed(4)} <ExternalLink size={10} />
        </a>
      );
    }
    if (value.mapUrl) return <a className="dx-file" href={value.mapUrl} target="_blank" rel="noreferrer">map <ExternalLink size={10} /></a>;
    if (value.url) return <a className="dx-file" href={value.url} target="_blank" rel="noreferrer"><FileText size={11} /> {value.name || 'file'}</a>;
    return <>{JSON.stringify(value)}</>;
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return <>{s.length > 10 ? fmtDateTime(s) : fmtDate(s)}</>;
  return <>{s}</>;
}

/** The same cell, for the CSV. */
function cellText(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Array.isArray(value)) {
    const files = value.filter((x) => x && typeof x === 'object' && x.url);
    if (files.length) return files.map((f) => f.url).join(' ');
    return value.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  }
  if (typeof value === 'object') {
    if (Number.isFinite(value.lat)) return `${value.lat}, ${value.lng}`;
    if (value.url) return value.url;
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

const RECORD_STATUS_TONE = {
  approved: 'var(--success)',
  shortlisted: 'var(--primary)',
  submitted: 'var(--warning)',
  rejected: 'var(--danger)',
};

const TASK_STATUS_LABEL = {
  todo: 'To do',
  in_progress: 'In progress',
  waiting_approval: 'Waiting approval',
  waiting_management_approval: 'Waiting approval',
  approved: 'Completed',
  done: 'Completed',
  rejected: 'Sent back',
};

/* ── Sorting: click a header, sort by that column; click again to flip. ── */
function useSort() {
  const [sort, setSort] = useState(null); // { key, dir: 1 | -1 }
  const toggle = (key) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  const apply = (rows, accessor) => {
    if (!sort) return rows;
    return [...rows].sort((a, b) => {
      const av = accessor(a, sort.key);
      const bv = accessor(b, sort.key);
      const an = Number(av); const bn = Number(bv);
      const cmp = Number.isFinite(an) && Number.isFinite(bn) && String(an) === String(av).trim() && String(bn) === String(bv).trim()
        ? an - bn
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return cmp * sort.dir;
    });
  };
  return { sort, toggle, apply };
}

function Th({ label, sortKey, sort, onToggle }) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ChevronUp : ChevronDown;
  return (
    <th>
      <button type="button" className={`dx-th${active ? ' is-on' : ''}`} onClick={() => onToggle(sortKey)}>
        {label} <Icon size={11} />
      </button>
    </th>
  );
}

/** One phase's records, as the audit sheet. */
function RecordsSheet({ project, stage, rows, schema, assessmentTypes }) {
  const hasTypes = (assessmentTypes || []).length > 0;
  const typeName = (key) => (assessmentTypes || []).find((a) => a.key === key)?.name || key;
  const { sort, toggle, apply } = useSort();

  const fields = useMemo(() => {
    const used = new Set();
    for (const r of rows) for (const k of Object.keys(r.values || {})) used.add(k);
    const all = hasTypes
      ? [...(schema || []), ...(assessmentTypes || []).flatMap((a) => a.masterDataSchema || [])]
      : (schema || []);
    const seen = new Set();
    return all.filter((f) => {
      if (seen.has(f.key)) return false;
      seen.add(f.key);
      return used.has(f.key);
    });
  }, [rows, schema, assessmentTypes, hasTypes]);

  const accessor = (r, key) => {
    if (key === '__title') return r.title;
    if (key === '__status') return r.status;
    if (key === '__by') return r.submittedBy?.name || r.createdBy?.name;
    if (key === '__on') return r.submittedAt || r.createdAt;
    if (key === '__decided') return (r.approvedBy || r.rejectedBy || r.decidedBy)?.name;
    if (key === '__form') return r.assessmentType;
    return cellText(r.values?.[key]);
  };
  const sorted = apply(rows, accessor);

  const exportCsv = () => {
    const header = [
      'No', ...(hasTypes ? ['Form'] : []), 'Title', ...fields.map((f) => f.label),
      'Status', 'Filed by', 'Filed on', 'Decided by', 'Decided on', 'Reject reason',
    ];
    const body = sorted.map((r, i) => [
      i + 1,
      ...(hasTypes ? [r.assessmentType ? typeName(r.assessmentType) : ''] : []),
      r.title || '',
      ...fields.map((f) => cellText(r.values?.[f.key])),
      r.status || '',
      r.submittedBy?.name || r.createdBy?.name || '',
      r.submittedAt || r.createdAt || '',
      r.approvedBy?.name || r.rejectedBy?.name || r.decidedBy?.name || '',
      r.approvedAt || r.rejectedAt || '',
      r.rejectReason || '',
    ]);
    downloadCsv(`${project.code}-${stage.key}-records.csv`, header, body);
  };

  if (!rows.length) {
    return <EmptyState icon={ClipboardList} title="Nothing filed in this phase yet" hint="Entries appear here the moment someone submits the phase's form." />;
  }

  return (
    <div className="col gap-2">
      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-subtle btn-sm" onClick={exportCsv}><Download size={13} /> Export CSV</button>
      </div>
      <div className="dx-scroll">
        <table className="dx-table">
          <thead>
            <tr>
              <th>#</th>
              {hasTypes && <Th label="Form" sortKey="__form" sort={sort} onToggle={toggle} />}
              <Th label="Title" sortKey="__title" sort={sort} onToggle={toggle} />
              {fields.map((f) => <Th key={f.key} label={f.label} sortKey={f.key} sort={sort} onToggle={toggle} />)}
              <Th label="Status" sortKey="__status" sort={sort} onToggle={toggle} />
              <Th label="Filed by" sortKey="__by" sort={sort} onToggle={toggle} />
              <Th label="Filed on" sortKey="__on" sort={sort} onToggle={toggle} />
              <Th label="Decided by" sortKey="__decided" sort={sort} onToggle={toggle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r._id}>
                <td>{i + 1}</td>
                {hasTypes && <td>{r.assessmentType ? typeName(r.assessmentType) : '—'}</td>}
                <td style={{ fontWeight: 650 }}>{r.title || '—'}</td>
                {fields.map((f) => <td key={f.key}><CellValue value={r.values?.[f.key]} /></td>)}
                <td>
                  <span className="dx-status" style={{ '--tone': RECORD_STATUS_TONE[r.status] || 'var(--text-subtle)' }}>
                    {r.status || 'draft'}
                  </span>
                  {r.rejectReason && <div className="tiny" style={{ color: 'var(--danger)' }}>{r.rejectReason}</div>}
                </td>
                <td>{r.submittedBy?.name || r.createdBy?.name || '—'}</td>
                <td>{fmtDate(r.submittedAt || r.createdAt)}</td>
                <td>
                  {(r.approvedBy || r.rejectedBy || r.decidedBy)?.name || '—'}
                  {(r.approvedAt || r.rejectedAt) && <div className="tiny muted">{fmtDate(r.approvedAt || r.rejectedAt)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The phase's tasks: who was meant to do what, and what actually happened. */
function TasksSheet({ project, stage }) {
  const { data, isLoading } = useTasks({ project: project._id, stageKey: stage.key, limit: 500 });
  const rows = data?.data || data || [];
  const { sort, toggle, apply } = useSort();

  const accessor = (t, key) => {
    if (key === 'assignee') return t.assignee?.name;
    if (key === 'status') return TASK_STATUS_LABEL[t.status] || t.status;
    return t[key];
  };
  const sorted = apply(rows, accessor);

  const exportCsv = () => {
    downloadCsv(
      `${project.code}-${stage.key}-tasks.csv`,
      ['Code', 'Task', 'Assignee', 'Department', 'Planned start', 'Planned end', 'Completed on', 'Approved on', 'Status'],
      sorted.map((t) => [
        t.code, t.title, t.assignee?.name || '', t.department || '',
        t.plannedStart || '', t.plannedEnd || '', t.completedAt || '', t.approvedAt || '',
        TASK_STATUS_LABEL[t.status] || t.status,
      ]),
    );
  };

  if (isLoading) return <SkTable rows={3} />;
  if (!rows.length) return <p className="tiny muted">No tasks in this phase.</p>;

  return (
    <div className="col gap-2">
      <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-subtle btn-sm" onClick={exportCsv}><Download size={13} /> Export CSV</button>
      </div>
      <div className="dx-scroll">
        <table className="dx-table">
          <thead>
            <tr>
              <Th label="Code" sortKey="code" sort={sort} onToggle={toggle} />
              <Th label="Task" sortKey="title" sort={sort} onToggle={toggle} />
              <Th label="Assignee" sortKey="assignee" sort={sort} onToggle={toggle} />
              <Th label="Department" sortKey="department" sort={sort} onToggle={toggle} />
              <Th label="Planned" sortKey="plannedStart" sort={sort} onToggle={toggle} />
              <Th label="Done on" sortKey="completedAt" sort={sort} onToggle={toggle} />
              <Th label="Status" sortKey="status" sort={sort} onToggle={toggle} />
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t._id}>
                <td className="proj-code">{t.code}</td>
                <td style={{ fontWeight: 650 }}>{t.title}</td>
                <td>{t.assignee?.name || '—'}</td>
                <td>{t.department || '—'}</td>
                <td>{t.plannedStart ? `${fmtDate(t.plannedStart)} → ${fmtDate(t.plannedEnd)}` : '—'}</td>
                <td>{t.completedAt ? fmtDate(t.completedAt) : '—'}{t.completedBy?.name ? <div className="tiny muted">by {t.completedBy.name}</div> : null}</td>
                <td>
                  <span className="dx-status" style={{ '--tone': ['approved', 'done'].includes(t.status) ? 'var(--success)' : t.status === 'rejected' ? 'var(--danger)' : 'var(--text-subtle)' }}>
                    {TASK_STATUS_LABEL[t.status] || t.status}
                  </span>
                </td>
                <td><Link className="dx-file" to={`/projects/${project._id}/tasks/${t.code}`}>open <ExternalLink size={10} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DataExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const stageParam = searchParams.get('phase');

  const { data: projResp } = useProjects({ limit: 200 });
  const projects = projResp?.data?.items || projResp?.data || projResp || [];
  const { data: project } = useProject(projectId);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);

  /* ONE fetch for the whole project's records: it feeds both the per-tab
     counts and the active phase's sheet. */
  const { data: allRecResp, isLoading: recsLoading } = useStageRecords(projectId, undefined, {}, {
    enabled: Boolean(projectId),
  });
  const allRecords = allRecResp?.data || allRecResp || [];
  const byStage = useMemo(() => {
    const m = new Map();
    for (const r of allRecords) {
      if (!m.has(r.stageKey)) m.set(r.stageKey, []);
      m.get(r.stageKey).push(r);
    }
    return m;
  }, [allRecords]);

  const stages = useMemo(
    () => [...(project?.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [project],
  );
  const [stageKey, setStageKey] = useState(stageParam);
  useEffect(() => {
    if (!stageKey && stages.length) {
      setStageKey(stages.find((s) => s.status === 'in_progress')?.key || stages[0].key);
    }
  }, [stages, stageKey]);

  const stage = stages.find((s) => s.key === stageKey) || null;
  const stageIndex = stages.findIndex((s) => s.key === stageKey);
  const templateStage = template?.stages?.find((s) => s.key === stageKey);

  const pick = (key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key === 'project') next.delete('phase');
      return next;
    }, { replace: true });
    if (key === 'phase') setStageKey(value);
    if (key === 'project') setStageKey(null);
  };

  return (
    <>
      <Topbar
        title={<span className="row gap-2" style={{ alignItems: 'center' }}><Table2 size={18} /> Data Explorer</span>}
        subtitle="Every entry of every phase, laid out like a spreadsheet — who filed what, when, and what was decided"
      />
      <div className="content col gap-3">
        <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            className="pt-select"
            style={{ minWidth: 260 }}
            value={projectId || ''}
            onChange={(e) => pick('project', e.target.value || null)}
            aria-label="Project"
          >
            <option value="">Pick a launch…</option>
            {(Array.isArray(projects) ? projects : []).map((p) => (
              <option key={p._id} value={p._id}>{p.name} — {p.code}</option>
            ))}
          </select>
          {project && (
            <Link className="tbrief-link" to={`/projects/${project._id}`}>Open the project →</Link>
          )}
        </div>

        {!projectId ? (
          <EmptyState
            icon={Table2}
            title="Pick a launch to walk through"
            hint="Phase by phase, every form entry and every task — with who, when, and what was decided — exportable to Excel."
          />
        ) : !project || recsLoading ? (
          <SkTable rows={4} />
        ) : (
          <>
            {/* ── The step bar: one tab per phase, its entry count on it. ── */}
            <div className="card dx-tabbar-card">
              <div className="dx-tabbar" role="tablist" data-guide="dx-steps">
                {stages.map((s, i) => {
                  const count = (byStage.get(s.key) || []).length;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={s.key === stageKey}
                      className={`dx-tab${s.key === stageKey ? ' is-on' : ''}${s.status === 'completed' ? ' is-done' : ''}`}
                      onClick={() => pick('phase', s.key)}
                      title={s.name}
                    >
                      Phase {i + 1}
                      {count > 0 && <span className="dx-tab-count">{count}</span>}
                    </button>
                  );
                })}
              </div>
              {stage && (
                <div className="dx-section-title">
                  {stage.status === 'completed' && <CheckCircle2 size={15} />}
                  {stage.name}
                  <span className="tiny muted" style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
                    {stage.status === 'completed' ? 'Completed' : stage.status === 'in_progress' ? 'In progress' : 'Not started'}
                    {stageIndex >= 0 ? ` · ${(byStage.get(stage.key) || []).length} entries` : ''}
                  </span>
                </div>
              )}
            </div>

            {stage && (
              <>
                <div className="card">
                  <div className="card-body">
                    <RecordsSheet
                      project={project}
                      stage={stage}
                      rows={byStage.get(stage.key) || []}
                      schema={templateStage?.masterDataSchema || []}
                      assessmentTypes={templateStage?.assessmentTypes || []}
                    />
                  </div>
                </div>

                <div className="card">
                  <div className="card-head"><h2 className="card-title">Tasks in this phase</h2></div>
                  <div className="card-body">
                    <TasksSheet project={project} stage={stage} />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default DataExplorerPage;
