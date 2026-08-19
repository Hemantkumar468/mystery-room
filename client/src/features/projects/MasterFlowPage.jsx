import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ChevronDown, ChevronRight, ShieldCheck, GitBranch, Users, CalendarDays,
} from 'lucide-react';
import { useProject } from '../../app/api/projectsApi.js';
import { PhaseBrief, phaseTiming } from '../../components/ui/PhaseBrief.jsx';
import { BackButton } from '../../components/layout/BackButton.jsx';
import { fmtDate } from '../../lib/format.js';

/**
 * The MD's master view of one project: every phase, in order, connected, with
 * What / Who / When / How on each — and the two places the flow splits drawn
 * as actual splits rather than as more rows in a list.
 *
 * Why this page exists. The phase pages answer "what do I do here?" for the
 * person doing it. Nothing answered "what is the whole shape of this opening,
 * who owns each part, how long should each take, and where are we against
 * that?" — which is the only question leadership actually asks. The client's
 * flowchart answers it on paper; this is that flowchart, live.
 *
 * Everything is read from the project's own stage snapshot. No second source
 * of truth, and no hardcoded phase list — a template change shows up here
 * automatically for projects created from it.
 */

/** Status → plain-language label and tone. Never shows a raw enum. */
const STATUS_META = {
  completed: { label: 'Completed', tone: 'done' },
  in_progress: { label: 'In progress', tone: 'active' },
  on_hold: { label: 'On hold', tone: 'hold' },
  not_started: { label: 'Not started yet', tone: 'idle' },
};
const statusMeta = (s) => STATUS_META[s] || STATUS_META.not_started;

/**
 * Group consecutive stages that share a `parallelGroup` into one row.
 *
 * Consecutive is the right test, not "all stages with this group": two phases
 * are drawn side by side because they RUN side by side at one point in the
 * flow. If a group key were ever reused later in the lifecycle, those later
 * phases belong in their own band, not teleported up next to the first pair.
 */
function toBands(stages) {
  const bands = [];
  for (const stage of stages) {
    const prev = bands[bands.length - 1];
    if (stage.parallelGroup && prev?.group === stage.parallelGroup) prev.stages.push(stage);
    else bands.push({ group: stage.parallelGroup || null, stages: [stage] });
  }
  return bands;
}

function PhaseCard({ stage, projectId, expanded, onToggle }) {
  const meta = statusMeta(stage.status);
  const { planned, verdict } = phaseTiming(stage);
  const owner = stage.whatWhoWhenHow?.[0]?.who;

  return (
    <article className={`mflow-card is-${meta.tone}`} style={{ '--phase-color': stage.color || 'var(--brand)' }}>
      <button
        type="button"
        className="mflow-card-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        <span className="mflow-card-name">{stage.name}</span>
        <span className={`mflow-status is-${meta.tone}`}>{meta.label}</span>
      </button>

      {/* The at-a-glance answer to who/when, so the MD does not have to expand
          seventeen phases to see ownership and duration. */}
      <div className="mflow-meta">
        {owner && (
          <span className="mflow-meta-item" title="Who is responsible">
            <Users size={12} aria-hidden /> {owner}
          </span>
        )}
        {planned != null && (
          <span className="mflow-meta-item" title="Planned duration">
            <CalendarDays size={12} aria-hidden /> {planned} day{planned === 1 ? '' : 's'}
          </span>
        )}
        {stage.plannedStart && (
          <span className="mflow-meta-item muted">
            {fmtDate(stage.plannedStart)} – {fmtDate(stage.plannedEnd)}
          </span>
        )}
        {verdict && <span className={`mflow-verdict is-${verdict.tone}`}>{verdict.text}</span>}
      </div>

      {expanded && (
        <div className="mflow-card-body">
          {stage.description && <p className="mflow-desc">{stage.description}</p>}
          <PhaseBrief stage={stage} />
          <Link className="mflow-open" to={`/projects/${projectId}`}>
            Open this phase →
          </Link>
        </div>
      )}
    </article>
  );
}

export default function MasterFlowPage() {
  const { id } = useParams();
  const { data: project, isLoading } = useProject(id);
  // Phases start collapsed: seventeen expanded briefs is a wall of text, and
  // the whole point of this page is that the shape is readable at a glance.
  const [open, setOpen] = useState(() => new Set());

  const bands = useMemo(
    () => toBands([...(project?.stages || [])].sort((a, b) => a.order - b.order)),
    [project],
  );

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const allKeys = useMemo(() => (project?.stages || []).map((s) => s.key), [project]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));

  if (isLoading) return <div className="page"><div className="skeleton-block" /></div>;
  if (!project) return <div className="page"><p className="muted">Project not found.</p></div>;

  return (
    <div className="page mflow-page">
      <header className="mflow-head">
        {/* This page draws its own header instead of a Topbar, so the back
            control every other page gets from the bar is placed by hand. */}
        <div className="row gap-2" style={{ alignItems: 'flex-start', minWidth: 0 }}>
          <BackButton to={`/projects/${id}`} label="Back to project" />
          <div>
            <h1 className="mflow-title">{project.name}</h1>
            <p className="mflow-sub">
              The complete opening flow — every phase, who owns it, how long it should take,
              and how it is actually going.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => setOpen(allOpen ? new Set() : new Set(allKeys))}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </header>

      <ol className="mflow-list">
        {bands.map((band, bandIdx) => {
          const isSplit = band.stages.length > 1;
          return (
            <li className="mflow-band" key={band.stages.map((s) => s.key).join('+')}>
              {isSplit && (
                <p className="mflow-split-note">
                  <GitBranch size={13} aria-hidden />
                  These {band.stages.length} phases run <strong>at the same time</strong>, not one after the other.
                </p>
              )}
              <div className={isSplit ? 'mflow-row is-split' : 'mflow-row'}>
                {band.stages.map((stage) => (
                  <PhaseCard
                    key={stage.key}
                    stage={stage}
                    projectId={id}
                    expanded={open.has(stage.key)}
                    onToggle={() => toggle(stage.key)}
                  />
                ))}
              </div>

              {/* A gate belongs BETWEEN bands — it is what must clear before the
                  next one may begin, so it is drawn as a bar across the flow
                  rather than as a badge inside one phase. */}
              {band.stages.filter((s) => s.gate?.label).map((s) => (
                <p className="mflow-gate" key={`gate-${s.key}`}>
                  <ShieldCheck size={14} aria-hidden />
                  <strong>{s.gate.label}</strong>
                  {s.gate.approver && <> — {s.gate.approver} must approve before the next phase starts</>}
                </p>
              ))}

              {bandIdx < bands.length - 1 && <span className="mflow-connector" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
