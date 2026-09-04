import { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Table2, Download, CheckCircle2, FileText, ClipboardList, ExternalLink, ChevronsUpDown, ChevronUp, ChevronDown,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { RecordFormModal } from './records/RecordFormModal.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { EmptyState } from '../../components/ui/primitives.jsx';
import { SkTable } from '../../components/ui/Skeletons.jsx';
import { useProjects, useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import {
  DELIVERY_META, DELIVERY_ORDER, phaseDelivery, projectDelivery,
} from '../../lib/deliveryStatus.js';

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

/**
 * ONE TASK, OPENED WHERE YOU ARE.
 *
 * "Open" used to be a link to the task's own page, which threw away the phase
 * you were reading and everything you had scrolled to get to. Reading a task
 * is not a reason to leave the sheet — so it opens here, over it, and closing
 * puts you back exactly where you were.
 *
 * Read-only on purpose: the Data Explorer is where the record is READ. The
 * one link out is at the bottom, for the person who came to act rather than
 * to look.
 */
function TaskPanel({ task, projectId, onClose }) {
  const brief = task.brief || {};
  const hasBrief = brief.what || brief.who || brief.when || brief.how;
  const checklist = task.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={task.title}
      subtitle={task.code}
      width={620}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Link className="dx-file" to={`/projects/${projectId}/tasks/${task.code}`}>
            Open the full task page <ExternalLink size={11} />
          </Link>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      )}
    >
      <div className="col gap-3">
        <div className="dx-tfacts">
          <div><span>Doer</span><b>{task.assignee?.name || task.primaryAssignee || 'Unassigned'}</b></div>
          {(task.backupAssignee || task.backupAssignees?.[0]) && (
            <div><span>Backup</span><b>{task.backupAssignee || task.backupAssignees[0]}</b></div>
          )}
          <div><span>Department</span><b>{task.department || '—'}</b></div>
          <div><span>Priority</span><b>{task.priority || 'medium'}</b></div>
          <div>
            <span>Planned</span>
            <b>{task.plannedStart ? `${fmtDate(task.plannedStart)} → ${fmtDate(task.plannedEnd)}` : '—'}</b>
          </div>
          <div><span>Done on</span><b>{task.completedAt ? fmtDate(task.completedAt) : 'Not yet'}</b></div>
          <div><span>Status</span><b>{TASK_STATUS_LABEL[task.status] || task.status}</b></div>
        </div>

        {hasBrief && (
          <div className="col gap-1">
            <span className="label">What this task is</span>
            <div className="dx-tbrief">
              {brief.what && <div><span>What</span><p>{brief.what}</p></div>}
              {brief.who && <div><span>Who</span><p>{brief.who}</p></div>}
              {brief.when && <div><span>When</span><p>{brief.when}</p></div>}
              {brief.how && <div><span>How</span><p>{brief.how}</p></div>}
            </div>
          </div>
        )}

        {checklist.length > 0 && (
          <div className="col gap-1">
            <span className="label">Checklist — {doneCount} of {checklist.length} ticked</span>
            <ul className="dx-tcheck">
              {checklist.map((c) => (
                <li key={c._id || c.label} className={c.done ? 'is-done' : undefined}>
                  <i aria-hidden>{c.done ? '✓' : '○'}</i>
                  {c.label}
                  {c.required && <em>required</em>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * Phases whose forms are filled in ONCE PER RECORD OF AN EARLIER PHASE.
 *
 * Phase 1 captures several properties and shortlists some; Phase 2 then runs
 * its four expert assessments against EACH of them. That link lives on every
 * assessment as `parentRecordId`, so it is normally discovered from the data
 * — this map only supplies it before the first assessment exists, which is
 * exactly when "four owed, none started" is the thing worth seeing.
 *
 * Keep it to phases whose records genuinely hang off another phase's records.
 * Guessing at "the previous phase" would give Phase 3 — six modules, one set
 * per project — a property grouping it does not have.
 */
const ASSESSED_PER_RECORD_OF = { p2: 'p1' };

/**
 * PROPERTY BY PROPERTY, and under each one every assessment it owes.
 *
 * Site Evaluation has no useful notion of "entries": it has four assessments
 * PER SHORTLISTED PROPERTY, and the only two questions asked of it are "which
 * property is this?" and "which of its four are still missing?". A flat table
 * of assessment rows answers neither — it buries the property in a column,
 * and an assessment nobody has started is not a row at all, so the gap that
 * matters is invisible.
 *
 * Here each property is a heading, and under it EVERY assessment the template
 * defines, filed or not. Click a filled one and that assessment's own form
 * opens — Feasibility opens Feasibility, not the property, not the phase.
 */
function AssessedByParent({ stage, modules, properties, rows, onOpen }) {
  /** parentId → assessmentType → the record answering it. */
  const filed = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const pid = String(r.parentRecordId || '');
      if (!pid) continue;
      if (!m.has(pid)) m.set(pid, new Map());
      m.get(pid).set(r.assessmentType, r);
    }
    return m;
  }, [rows]);

  const nameOf = (p, i) => p.title || p.values?.property_name || p.values?.locality || `Property ${i + 1}`;

  if (!properties.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No property has reached this phase yet"
        hint={`Shortlist a property in the previous phase and it appears here with all ${modules.length} assessments waiting against it.`}
      />
    );
  }

  const totalDone = properties.reduce((a, p) => a + (filed.get(String(p._id))?.size || 0), 0);

  return (
    <div className="col gap-2">
      <div className="row gap-2" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="tiny muted">
          {properties.length} propert{properties.length === 1 ? 'y' : 'ies'} carried into{' '}
          {stage.name} · {totalDone} of {properties.length * modules.length} assessments filed.
          Click a filled one to read it.
        </span>
      </div>

      {properties.map((p, i) => {
        const mine = filed.get(String(p._id));
        const done = mine?.size || 0;
        return (
          <div className="dx-prop" key={p._id}>
            <div className="dx-prop-head">
              <span className="dx-prop-no">{i + 1}</span>
              <b>{nameOf(p, i)}</b>
              {p.values?.locality && <span className="tiny muted">{p.values.locality}</span>}
              {p.status && <span className="dx-prop-tag">{p.status}</span>}
              <span className={`dx-prop-count${done === modules.length ? ' is-all' : ''}`}>
                {done} of {modules.length} assessed
              </span>
            </div>
            <div className="dx-prop-rows">
              {modules.map((mod) => {
                const rec = mine?.get(mod.key);
                return (
                  <button
                    type="button"
                    key={mod.key}
                    className={`dx-asmt${rec ? '' : ' is-empty'}`}
                    disabled={!rec}
                    onClick={rec ? () => onOpen(rec, mod) : undefined}
                    title={rec ? `Open the ${mod.name} form` : 'Nothing filed against this one yet'}
                  >
                    <span className="dx-asmt-name">{mod.name}</span>
                    <span className="dx-asmt-state">
                      {rec ? (rec.status || 'draft') : 'Not filed yet'}
                    </span>
                    <span className="dx-asmt-who">
                      {rec ? (rec.submittedBy?.name || rec.createdBy?.name || '—') : ''}
                    </span>
                    <span className="dx-asmt-when">
                      {rec ? fmtDate(rec.submittedAt || rec.createdAt) : `${(mod.masterDataSchema || []).length} questions`}
                    </span>
                    <span className="dx-asmt-open">{rec ? 'View' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
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
function TasksSheet({ project, stage, onOpenTask }) {
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

  /* The card's head and body are rendered HERE, not by the caller, so Export
     can sit in the head beside the title. It used to be a right-aligned row
     of its own inside the body, under the head's own padding — an empty band
     the width of the card with a single small button floating in it. */
  const head = (
    <div className="card-head">
      <h2 className="card-title">Tasks in this phase</h2>
      {rows.length > 0 && (
        <button type="button" className="btn btn-subtle btn-sm" onClick={exportCsv}>
          <Download size={13} /> Export CSV
        </button>
      )}
    </div>
  );

  if (isLoading) return <>{head}<div className="card-body"><SkTable rows={3} /></div></>;
  if (!rows.length) {
    return <>{head}<div className="card-body"><p className="tiny muted" style={{ margin: 0 }}>No tasks in this phase.</p></div></>;
  }

  return (
    <>
      {head}
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
                <td>
                  <button type="button" className="dx-openbtn" onClick={() => onOpenTask(t)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

  /* ── The launch in one line ────────────────────────────────────────────
     ONE fetch for every task in the project, for the same reason the records
     arrive in one: these five facts are a rollup of ALL of them, and asking
     phase by phase would mean the line could not be drawn until every tab had
     been clicked.

     Every number here is computed by the shared rule engine
     (lib/deliveryStatus.js), never counted locally — so "Past their date 3"
     on this line and a red row inside a phase are the same three tasks, by
     construction rather than by two pieces of code agreeing. */
  const { data: taskResp } = useTasks(
    { project: projectId, limit: 1000 },
    { skip: !projectId },
  );
  const allTasks = useMemo(() => {
    const raw = taskResp?.data || taskResp || [];
    return Array.isArray(raw) ? raw : [];
  }, [taskResp]);

  const user = useAppSelector(selectCurrentUser);
  // Only changes the WORDS on the blue fact — someone who can approve reads
  // "With you", everyone else "Waiting". The colour and the count are the same
  // either way, so two people never see one launch differently.
  const viewerDecides = can.decide(user?.role);

  const launch = useMemo(() => {
    const byStageKey = new Map();
    for (const t of allTasks) {
      if (!byStageKey.has(t.stageKey)) byStageKey.set(t.stageKey, []);
      byStageKey.get(t.stageKey).push(t);
    }
    const phaseVerdicts = stages.map((s) => ({
      verdict: phaseDelivery(byStageKey.get(s.key) || [], { viewerDecides }),
    }));
    return projectDelivery(project, phaseVerdicts, allTasks, { viewerDecides });
  }, [project, stages, allTasks, viewerDecides]);

  const [showLegend, setShowLegend] = useState(false);
  const [stageKey, setStageKey] = useState(stageParam);

  /* ONE ASSESSMENT OPEN AT A TIME. `openAssessment` refuses to replace what is
     already up, so a double click — or a click that lands on both a row and a
     button inside it — cannot stack a second form over the first. */
  const [openRecord, setOpenRecord] = useState(null);
  const openAssessment = (record, mod) => {
    setOpenRecord((current) => (current ? current : { record, mod }));
  };
  const [openTask, setOpenTask] = useState(null);
  useEffect(() => {
    if (!stageKey && stages.length) {
      setStageKey(stages.find((s) => s.status === 'in_progress')?.key || stages[0].key);
    }
  }, [stages, stageKey]);

  const stage = stages.find((s) => s.key === stageKey) || null;
  const stageIndex = stages.findIndex((s) => s.key === stageKey);
  const templateStage = template?.stages?.find((s) => s.key === stageKey);

  /**
   * The records this phase's assessments are filed AGAINST — the properties
   * carried forward from the capture phase. Null for every ordinary phase,
   * which then keeps the flat sheet.
   *
   * Discovered from the data wherever an assessment exists (its
   * `parentRecordId` names the record it assesses, and that record's stage is
   * therefore the parent stage); ASSESSED_PER_RECORD_OF only fills the gap
   * before the first one is filed. Rejected properties drop out — nobody is
   * assessing them any more.
   */
  const assessedProperties = useMemo(() => {
    if (!stageKey || !(templateStage?.assessmentTypes || []).length) return null;
    const own = byStage.get(stageKey) || [];
    const ids = new Set(own.map((r) => r.parentRecordId).filter(Boolean).map(String));
    let parentStageKey = ids.size
      ? allRecords.find((r) => ids.has(String(r._id)))?.stageKey || null
      : null;
    if (!parentStageKey) parentStageKey = ASSESSED_PER_RECORD_OF[stageKey] || null;
    if (!parentStageKey) return null;
    return (byStage.get(parentStageKey) || []).filter((r) => r.status !== 'rejected');
  }, [stageKey, templateStage, byStage, allRecords]);

  const pick = (key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key === 'project') next.delete('phase');
      return next;
    }, { replace: true });
    // Moving to another phase or launch closes whatever was open over it — a
    // Phase 2 assessment left hanging over Phase 7 is a misread waiting to
    // happen.
    setOpenRecord(null);
    setOpenTask(null);
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
            {/* ── The launch in one line, and the colour key behind a button.
                   Closed by default: a legend is read once, a table every
                   day, so it does not get to occupy the page permanently. ── */}
            <div className="dx-strip">
              <span className="dx-fact">Phases <b>{launch.phasesDone} of {launch.phases}</b></span>
              <span className="dx-vr" />
              <span className="dx-fact">Tasks <b>{launch.done} of {launch.total}</b></span>
              <span className="dx-vr" />
              <span className="dx-fact is-overdue">Past their date <b>{launch.overdue}</b></span>
              <span className="dx-vr" />
              <span className="dx-fact is-waiting">
                {viewerDecides ? 'With you' : 'Waiting'} <b>{launch.waiting}</b>
              </span>
              {launch.projectedOpening && (
                <>
                  <span className="dx-vr" />
                  <span className="dx-fact">
                    {launch.slip > 0 ? 'Projected opening' : 'Opening'}{' '}
                    <b>{fmtDate(launch.projectedOpening)}</b>
                  </span>
                </>
              )}
              <button
                type="button"
                className="dx-helpbtn"
                aria-expanded={showLegend}
                onClick={() => setShowLegend((v) => !v)}
              >
                {showLegend ? 'Hide the key' : 'What the colours mean'}
              </button>
            </div>

            {showLegend && (
              <div className="dx-legend" role="note" aria-label="What the colours mean">
                {DELIVERY_ORDER.map((k) => (
                  <span key={k} className={`dx-kchip is-${k}`}>
                    <i aria-hidden />
                    <b>{DELIVERY_META[k].legend}</b>
                    <span>{DELIVERY_META[k].gloss}</span>
                  </span>
                ))}
              </div>
            )}

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
                    {assessedProperties ? (
                      <AssessedByParent
                        stage={stage}
                        modules={templateStage?.assessmentTypes || []}
                        properties={assessedProperties}
                        rows={byStage.get(stage.key) || []}
                        onOpen={openAssessment}
                      />
                    ) : (
                      <RecordsSheet
                        project={project}
                        stage={stage}
                        rows={byStage.get(stage.key) || []}
                        schema={templateStage?.masterDataSchema || []}
                        assessmentTypes={templateStage?.assessmentTypes || []}
                      />
                    )}
                  </div>
                </div>

                <div className="card">
                  <TasksSheet project={project} stage={stage} onOpenTask={setOpenTask} />
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* ONE CLICK, ONE FORM. Clicking Feasibility opens the FEASIBILITY form,
          filled in exactly as it was submitted — not the property it belongs
          to, not the phase, with nothing further to click through. Read-only:
          this page is where a record is read. */}
      {openTask && (
        <TaskPanel task={openTask} projectId={projectId} onClose={() => setOpenTask(null)} />
      )}

      {openRecord && (
        <RecordFormModal
          open
          readOnly
          onClose={() => setOpenRecord(null)}
          // The questions live on the assessment module the record answers,
          // so opening Feasibility shows Feasibility's twelve, never the
          // phase's generic form.
          schema={openRecord.mod?.masterDataSchema || []}
          loading={!template}
          projectId={projectId}
          recordNoun={openRecord.mod?.name || 'Assessment'}
          recordNo={openRecord.record.title || undefined}
          initialValues={openRecord.record.values}
          meta={{
            typeLabel: openRecord.mod?.name,
            submittedBy: openRecord.record.submittedBy?.name || openRecord.record.createdBy?.name,
            submittedOn: fmtDate(openRecord.record.submittedAt || openRecord.record.createdAt),
            statusLabel: openRecord.record.status || 'Draft',
            statusColor: RECORD_STATUS_TONE[openRecord.record.status] || 'var(--text-subtle)',
            decidedBy: (openRecord.record.approvedBy || openRecord.record.rejectedBy
              || openRecord.record.decidedBy)?.name,
            decidedOn: (openRecord.record.approvedAt || openRecord.record.rejectedAt)
              ? fmtDate(openRecord.record.approvedAt || openRecord.record.rejectedAt) : undefined,
            rejectReason: openRecord.record.rejectReason,
          }}
        />
      )}
    </>
  );
}

export default DataExplorerPage;
