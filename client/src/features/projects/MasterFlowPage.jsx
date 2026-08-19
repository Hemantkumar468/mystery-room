import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronRight, GitBranch, Download, ShieldCheck,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../components/ui/primitives.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { PhaseBrief, phaseTiming } from '../../components/ui/PhaseBrief.jsx';
import { useProject } from '../../app/api/projectsApi.js';
import { useTemplate } from '../../app/api/templatesApi.js';
import { useStageRecords } from '../../app/api/recordsApi.js';
import { useTasks } from '../../app/api/tasksApi.js';
import { useEmployees } from '../../hooks/useEmployees.js';
import { getStagePath } from './stagesConfig.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

/**
 * Plan vs Actual — the whole project on one page, in the four questions the
 * client runs the business by (What / Who / When / How) plus the one
 * comparison the MD actually reads: what we PLANNED against what HAPPENED.
 *
 * Route: /projects/:id/flow  ·  Sidebar: "Plan vs Actual"
 *
 * One row per phase: who owns it, planned window, actual window, and a
 * plain-words verdict ("Finished 2 days early", "Took 3 days longer than
 * planned"). Click a row and it opens in place: the full What/Who/When/How
 * table, and every record filled in that phase — what was entered, by whom,
 * at what time — with one-click export to Excel.
 *
 * Everything reads from the project's own snapshot and its records. No second
 * source of truth; a phase added to the template tomorrow appears here with
 * no code change.
 */

const STATUS_META = {
  completed: { label: 'Completed', color: 'var(--success)', soft: 'var(--success-soft)' },
  in_progress: { label: 'In progress', color: 'var(--primary)', soft: 'var(--primary-soft, var(--surface-2))' },
  on_hold: { label: 'On hold', color: 'var(--warning)', soft: 'var(--warning-soft)' },
  not_started: { label: 'Not started', soft: 'var(--surface-2)' },
};

/** Whole days between two dates, or null. */
const days = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : null);

/** "21 Sep – 23 Sep (2 days)" — the shape both the Planned and Actual columns use. */
function Window({ start, end, fallback = 'Not started yet' }) {
  if (!start) return <span className="muted">{fallback}</span>;
  const d = days(start, end);
  return (
    <span>
      {fmtDate(start)}{end ? ` – ${fmtDate(end)}` : ' – …'}
      {d != null && <span className="muted"> ({d} day{d === 1 ? '' : 's'})</span>}
    </span>
  );
}

/**
 * Everything filled in one phase — fetched only when its row is opened, so the
 * page itself costs one project read no matter how many phases it lists.
 */
function PhaseDrill({ projectId, stage, schema }) {
  const { data } = useStageRecords(projectId, stage.key);
  const rows = data?.data || data || [];
  // The first few fields identify a row; the export carries every field.
  const cols = (schema || []).filter((f) => !['file', 'location'].includes(f.type)).slice(0, 4);

  /** CSV with a UTF-8 BOM so Excel opens ₹ and Hindi text correctly. */
  const exportExcel = () => {
    const all = (schema || []).filter((f) => !['file'].includes(f.type));
    const esc = (val) => {
      const s = val == null ? '' : Array.isArray(val) ? val.join('; ') : typeof val === 'object' ? '' : String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [
      ['No.', ...all.map((f) => f.label || f.key), 'Status', 'Last updated'].map(esc).join(','),
      ...rows.map((r, i) => [
        i + 1,
        ...all.map((f) => r.values?.[f.key]),
        r.status || '',
        r.updatedAt ? fmtDateTime(r.updatedAt) : '',
      ].map(esc).join(',')),
    ];
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${stage.name.replace(/[^\w]+/g, '-')}-records.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="pva-drill">
      <PhaseBrief stage={stage} />

      <div className="pva-drill-head">
        <h3>What was filled in this phase ({rows.length})</h3>
        {rows.length > 0 && (
          <button type="button" className="btn btn-subtle btn-sm" onClick={exportExcel}>
            <Download size={13} /> Export to Excel
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="sm muted" style={{ margin: 0 }}>Nothing recorded in this phase yet.</p>
      ) : (
        <div className="pi-table-wrap">
          <table className="table pva-records">
            <thead>
              <tr>
                <th style={{ width: 44 }}>No.</th>
                {cols.map((f) => <th key={f.key}>{f.label || f.key}</th>)}
                <th>Status</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r._id}>
                  <td>{i + 1}</td>
                  {cols.map((f) => {
                    const val = r.values?.[f.key];
                    const s = val == null || val === '' ? '—'
                      : Array.isArray(val) ? `${val.length} item${val.length === 1 ? '' : 's'}`
                        : typeof val === 'object' ? 'Attached' : String(val);
                    return <td key={f.key}>{s.length > 48 ? `${s.slice(0, 48)}…` : s}</td>;
                  })}
                  <td><Badge soft="var(--surface-2)">{r.status || 'draft'}</Badge></td>
                  <td className="muted">{r.updatedAt ? fmtDateTime(r.updatedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MasterFlowPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: project, isLoading } = useProject(id);
  const templateId = project?.template?.ref?._id || project?.template?.ref;
  const { data: template } = useTemplate(templateId);
  const [open, setOpen] = useState(null); // one phase open at a time — this is a report, not an accordion farm

  /**
   * "Who" = the actual people, by name. One task fetch serves the whole
   * report; each phase shows the resolved names of its tasks' doers (assigned
   * user, else roster primary). The template's role phrase appears only while
   * a phase has nobody on it yet — a report that answers "who" with a
   * department code is not answering the question.
   */
  const { data: taskResp } = useTasks({ project: id, limit: 500 });
  const { resolve } = useEmployees();
  const whoByStage = useMemo(() => {
    const tasks = taskResp?.data || taskResp || [];
    const map = {};
    for (const t of tasks) {
      const name = resolve(t.assignee?._id || t.assignee)?.name || resolve(t.primaryAssignee)?.name;
      if (!name) continue;
      (map[t.stageKey] ||= new Set()).add(name);
    }
    return map;
  }, [taskResp, resolve]);

  const stages = useMemo(
    () => [...(project?.stages || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [project],
  );

  if (isLoading) return (<><Topbar title="Plan vs Actual" /><div className="content"><SkDetail /></div></>);
  if (!project) return (<><Topbar title="Plan vs Actual" /><div className="content"><EmptyState title="Project not found" /></div></>);

  const done = stages.filter((s) => s.status === 'completed').length;

  return (
    <>
      <Topbar
        title={(
          <span className="row gap-3" style={{ alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate(`/projects/${id}`)} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            Plan vs Actual
            <span className="tiny muted" style={{ fontWeight: 500 }}>{project.name} · {done} of {stages.length} phases done</span>
          </span>
        )}
      />

      <div className="content col gap-3">
        <p className="pva-intro">
          Every phase on one page: who does it, when it was planned, when it actually
          happened. Click any phase to see its full details and everything filled in it.
        </p>

        <div className="pva-list">
          {/* Header row, so the columns read as a report without a legend. */}
          <div className="pva-row pva-row--head" aria-hidden>
            <span />
            <span>Phase &amp; who does it</span>
            <span>Planned</span>
            <span>Actual</span>
            <span>Result</span>
          </div>

          {stages.map((stage) => {
            const meta = STATUS_META[stage.status] || STATUS_META.not_started;
            const { verdict } = phaseTiming(stage);
            const isOpen = open === stage.key;
            const names = [...(whoByStage[stage.key] || [])];
            const who = names.length
              ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '')
              : (stage.whatWhoWhenHow?.[0]?.who || 'Not assigned yet');
            const schema = template?.stages?.find((s) => s.key === stage.key)?.masterDataSchema || [];

            return (
              <div key={stage.key} className={`pva-phase${isOpen ? ' is-open' : ''}`} style={{ '--phase-color': stage.color || 'var(--primary)' }}>
                <button
                  type="button"
                  className="pva-row"
                  onClick={() => setOpen(isOpen ? null : stage.key)}
                  aria-expanded={isOpen}
                >
                  <span className="pva-caret">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                  <span className="pva-name">
                    <span className="pva-name-text">{stage.name}</span>
                    <span className="pva-who">{who}{stage.parallelGroup && (
                      <span className="pva-parallel"><GitBranch size={11} /> runs in parallel</span>
                    )}</span>
                  </span>
                  <span className="pva-window"><Window start={stage.plannedStart} end={stage.plannedEnd} fallback="—" /></span>
                  <span className="pva-window"><Window start={stage.startedAt} end={stage.completedAt} /></span>
                  <span className="pva-result">
                    <Badge color={meta.color} soft={meta.soft}>{meta.label}</Badge>
                    {verdict && <span className={`pva-verdict is-${verdict.tone}`}>{verdict.text}</span>}
                  </span>
                </button>

                {stage.gate?.label && (
                  <p className="pva-gate">
                    <ShieldCheck size={12} /> {stage.gate.label} — {stage.gate.approver}
                  </p>
                )}

                {isOpen && (
                  <div className="pva-open">
                    {stage.description && <p className="pva-desc">{stage.description}</p>}
                    <PhaseDrill projectId={id} stage={stage} schema={schema} />
                    <button
                      type="button"
                      className="tbrief-link"
                      onClick={() => navigate(getStagePath(id, stage.key))}
                    >
                      Open this phase to work in it →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
