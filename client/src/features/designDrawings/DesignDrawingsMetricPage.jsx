import { useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Eye, Search, Download, X,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SkDetail } from '../../components/ui/Skeletons.jsx';
import { PropTable } from '../property/PropTable.jsx';
import { PropPager } from '../property/PropPager.jsx';
import { PageHead, PropEmpty } from '../property/propertyUi.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import dayjs from '../../lib/dayjs.js';
import { useGetFmsBreakdownQuery } from '../../app/api/designDrawingsApi.js';
import { StatCard, kpiCards } from './designDrawingsUi.jsx';

/**
 * What is behind one KPI card.
 *
 * The six cards on the dashboard each count something real — 1,030 Pending
 * drawings are 1,030 rows of the 37-drawing checklist, on named projects, with
 * owners and planned dates already decided by the phase task. The count alone
 * is the one thing that cannot answer "which ones?", so every card opens here.
 *
 * AND SO DOES EVERY OTHER NUMBER ON THIS PAGE. The fact tiles and the group
 * bars are each a filter you can click; clicking one narrows the table below
 * to exactly the rows that produced it, and the filter appears as a chip you
 * can take off again. A number you cannot open is a dead end, and a filter you
 * cannot see is a page that looks like it has lost rows.
 *
 * NOTHING HERE IS COMPUTED IN THE BROWSER. The rows, the totals, the counts
 * and the delay maths all come from `/design-drawings/breakdown/:metric`,
 * which classifies rows with the same `classifyDrawing` pass the KPI strip
 * itself is counted with, and filters them with the same predicates that
 * produced the tile you clicked. That is deliberate: a page that re-derived
 * "delayed" in the browser would disagree with the card that sent you to it
 * the first time the two ran in different timezones.
 *
 * Filters live in the URL, so a filtered view is a link — the dashboard's own
 * table cells are links into exactly this page, and Back undoes a filter.
 */

/* Same tokens as the dashboard and the single-project checklist — one palette
   across the module, gold on cream, no blue. */
const STATUS_TAG = {
  Approved: { label: 'Approved', bg: 'var(--p-tag-captured-bg)', fg: 'var(--p-tag-captured-fg)' },
  'Submitted for review': { label: 'Submitted', bg: 'var(--p-tag-captured-bg)', fg: 'var(--p-tag-captured-fg)' },
  'In progress': { label: 'In Progress', bg: 'var(--p-tag-wanted-bg)', fg: 'var(--p-tag-wanted-fg)' },
  'Not started': { label: 'Not Started', bg: 'var(--p-tag-neutral-bg)', fg: 'var(--p-tag-neutral-fg)' },
};
const OVERDUE_TAG = { label: 'Overdue', bg: 'color-mix(in srgb, var(--danger) 15%, transparent)', fg: 'var(--danger)' };

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

const Tag = ({ t }) => <span className="prop-badge" style={{ background: t.bg, color: t.fg }}>{t.label}</span>;
const Dash = () => <span className="prop-dim">—</span>;

/** A drawing's chip: its own status, unless it is sitting past its date. */
function statusTag(row) {
  if (row.bucket === 'delayed') return OVERDUE_TAG;
  return STATUS_TAG[row.status] || STATUS_TAG['Not started'];
}

/**
 * A number from the server's `summary`, and the filter that produced it.
 *
 * `hint` is the second line, and it is the reason these are worth the space:
 * "807" is a number, "807 of these block the BOQ" is the thing the number is
 * FOR. Clicking narrows the table to those 807; clicking the live one again
 * takes the filter off, so a tile is a toggle and never a trap.
 */
function Fact({
  label, value, hint, tint, filter, active, onPick,
}) {
  const body = (
    <>
      <span className="dd-fact-label">{label}</span>
      <b className="dd-fact-value" style={tint ? { color: tint } : undefined}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </b>
      {hint && <span className="dd-fact-hint">{hint}</span>}
    </>
  );
  if (!filter) return <div className="dd-fact">{body}</div>;
  return (
    <button
      type="button"
      className={`dd-fact dd-fact-open${active ? ' is-active' : ''}`}
      onClick={() => onPick(filter, active)}
      title={active ? 'Showing only these — click to take the filter off' : `Show only the ${label.toLowerCase()}`}
    >
      {body}
    </button>
  );
}

/**
 * One group-by, as a clickable bar list.
 *
 * Bars rather than a donut: these are rankings ("which project holds most of
 * the 1,030"), and a reader compares bar lengths down a column far faster than
 * arc lengths around a circle. Capped at eight with the rest summed, because a
 * 28-project list is a scrollbar, not an answer.
 *
 * Each bar filters by its own `value` — an id where the server had one, so two
 * people sharing a name still filter apart.
 */
function GroupPanel({
  title, rows, note, tint = 'var(--p-gold)', filterKey, activeValue, onPick,
}) {
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8);
  const max = rows[0]?.count || 1;
  return (
    <div className="dd-card dd-group">
      <div className="dd-group-head">{title}</div>
      {!rows.length ? (
        <div className="dd-group-empty">Nothing to group — there are no rows in this count.</div>
      ) : (
        <div className="dd-group-list">
          {shown.map((r) => {
            const on = activeValue != null && String(activeValue) === String(r.value);
            return (
              <button
                key={String(r.value)}
                type="button"
                className={`dd-group-row${on ? ' is-active' : ''}`}
                onClick={() => onPick({ [filterKey]: r.value }, on)}
                title={on ? `Showing only ${r.label} — click to take the filter off` : `Show only ${r.label}`}
              >
                <span className="dd-group-label">{r.label}</span>
                <span className="dd-group-bar">
                  <i style={{ width: `${Math.max(3, (r.count / max) * 100)}%`, background: tint }} />
                </span>
                <b className="dd-group-count">{r.count.toLocaleString('en-IN')}</b>
              </button>
            );
          })}
          {rest.length > 0 && (
            <div className="dd-group-more">
              {`+${rest.length} more, ${rest.reduce((n, r) => n + r.count, 0).toLocaleString('en-IN')} between them`}
            </div>
          )}
        </div>
      )}
      {note && <div className="dd-panel-note">{note}</div>}
    </div>
  );
}

/** A number in a table cell that opens the rows behind it. */
const CellLink = ({ onClick, title, children, tint }) => (
  <button type="button" className="dd-cell-link" style={tint ? { color: tint } : undefined} onClick={onClick} title={title}>
    {children}
  </button>
);

/** Assigned To, with where the name came from — inherited data has to say so. */
function OwnerCell({ row }) {
  if (!row.assignedTo) {
    return (
      <>
        <Dash />
        <div className="prop-dim" style={{ fontSize: 11 }}>nobody assigned</div>
      </>
    );
  }
  return (
    <>
      <div className="prop-name" style={{ fontWeight: 600 }}>{row.assignedTo.name}</div>
      <div className="prop-dim" style={{ fontSize: 11 }}>
        {[
          row.inherited?.assignedTo ? 'from phase task' : null,
          row.buddy ? `backup: ${row.buddy.name}` : null,
        ].filter(Boolean).join(' · ') || row.responsibleRole || ''}
      </div>
    </>
  );
}

/** The CSV of the page on screen. */
function exportCsv(rows, metric, kind) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = kind === 'project'
    ? ['Project', 'Code', 'Location', 'Manager', 'Progress %', 'Submitted', 'In Progress', 'Pending', 'Delayed', 'Health', 'Target']
    : ['Project', 'Code', '#', 'Drawing', 'Category', 'Set', 'Status', 'Assigned To', 'Planned', 'Days Overdue', 'Filed On', 'Approved On'];
  const body = rows.map((r) => (kind === 'project'
    ? [r.name, r.code, r.location, r.manager?.name, r.overallProgress, r.counts.submitted,
      r.counts.inProgress, r.counts.pending, r.counts.delayed,
      HEALTH_TAG[r.health.status]?.label, r.targetDate ? fmtDate(r.targetDate) : '']
    : [r.projectName, r.projectCode, r.no, r.name, r.category, r.setLabel, r.status,
      r.assignedTo?.name, r.plannedDate ? fmtDate(r.plannedDate) : '', r.daysOverdue || '',
      r.submittedAt ? fmtDate(r.submittedAt) : '', r.approvedAt ? fmtDate(r.approvedAt) : '']));

  const csv = [head, ...body].map((cells) => cells.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `design-drawings-${metric}-${dayjs().format('YYYY-MM-DD')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Only these travel to the server; anything else in the URL is ignored. */
const FILTER_KEYS = [
  'q', 'projectId', 'set', 'category', 'status', 'owner', 'flag',
  'location', 'manager', 'projectStatus', 'sort',
];

export function DesignDrawingsMetricPage() {
  const { metric = 'drawings' } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const get = (k) => sp.get(k) || '';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const limit = Number(sp.get('limit')) || 25;

  /**
   * Merge values into the URL. Anything empty is REMOVED rather than written
   * as a blank, so a cleared filter leaves no `?owner=` behind to puzzle over.
   *
   * Every change but paging drops back to page 1 — page 7 of an unfiltered
   * list is very rarely a page of the filtered one.
   */
  const patch = (next, opts = {}) => {
    const merged = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || v == null) merged.delete(k);
      else merged.set(k, String(v));
    }
    if (!('page' in next)) merged.delete('page');
    setSp(merged, opts);
  };
  /* Clicking the filter that is already on takes it off — a tile is a toggle,
     never a trap you have to hunt for the way out of. */
  const pick = (filter, isActive) => patch(
    isActive ? Object.fromEntries(Object.keys(filter).map((k) => [k, null])) : filter,
  );
  const clearAll = () => patch(Object.fromEntries(FILTER_KEYS.filter((k) => k !== 'sort').map((k) => [k, null])));

  const query = useMemo(() => {
    const out = { metric, page, limit };
    for (const k of FILTER_KEYS) if (sp.get(k)) out[k] = sp.get(k);
    return out;
  }, [metric, page, limit, sp]);

  const {
    data, isLoading, isFetching, isError,
  } = useGetFmsBreakdownQuery(query);

  const kind = data?.kind;
  const rows = data?.rows || [];
  const s = data?.summary || {};
  const applied = data?.applied || [];

  /* A filtered view is a link, so the dashboard and this page's own tables can
     point straight at it. */
  const openMetric = (m, filters = {}) => {
    const qs = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v != null && v !== ''),
    ).toString();
    navigate(`/design-drawings/metric/${m}${qs ? `?${qs}` : ''}`);
  };

  const drawingColumns = useMemo(() => [
    {
      key: 'drawing',
      label: 'Drawing',
      width: 268,
      render: (r) => (
        <>
          <div className="prop-name">{`${r.no}. ${r.name}`}</div>
          <div className="prop-dim" style={{ fontSize: 11.5 }}>
            {r.category} · {r.setLabel}
            {r.blocksBoq && <span className="dd-flag" title="Set 1 — the BOQ cannot start until this is approved"> BOQ</span>}
          </div>
        </>
      ),
    },
    {
      key: 'project',
      label: 'Project',
      width: 178,
      render: (r) => (
        <>
          <CellLink onClick={() => patch({ projectId: r.projectId })} title={`Show only ${r.projectName}`}>
            <span className="prop-name">{r.projectName}</span>
          </CellLink>
          <div className="prop-dim" style={{ fontSize: 11.5 }}>{[r.projectCode, r.location].filter(Boolean).join(' · ')}</div>
        </>
      ),
    },
    { key: 'status', label: 'Status', width: 116, render: (r) => <Tag t={statusTag(r)} /> },
    { key: 'owner', label: 'Assigned To', width: 168, render: (r) => <OwnerCell row={r} /> },
    {
      key: 'planned',
      label: 'Planned',
      width: 128,
      render: (r) => (r.plannedDate ? (
        <>
          <div>{fmtDate(r.plannedDate)}</div>
          {r.daysOverdue > 0
            ? <div style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 700 }}>{r.daysOverdue}d overdue</div>
            : r.inherited?.plannedDate && <div className="prop-dim" style={{ fontSize: 11 }}>from phase task</div>}
        </>
      ) : <Dash />),
    },
    {
      key: 'filed',
      label: 'Filed',
      width: 150,
      render: (r) => (r.submittedAt ? (
        <>
          <div>{fmtDate(r.submittedAt)}</div>
          <div className="prop-dim" style={{ fontSize: 11 }}>
            {r.submittedBy?.name ? `by ${r.submittedBy.name}` : ''}{r.revision ? ` · R${r.revision}` : ''}
          </div>
        </>
      ) : <span className="prop-dim">not filed</span>),
    },
    {
      key: 'approved',
      label: 'Approved',
      width: 150,
      render: (r) => {
        if (r.approvedAt) {
          return (
            <>
              <div>{fmtDate(r.approvedAt)}</div>
              <div className="prop-dim" style={{ fontSize: 11 }}>{r.approvedBy?.name ? `by ${r.approvedBy.name}` : ''}</div>
            </>
          );
        }
        /* A sent-back drawing is the one row somebody has to act on, and the
           reason it came back is the whole of the instruction. */
        if (r.rejectReason) {
          return (
            <>
              <span className="prop-badge" style={{ background: OVERDUE_TAG.bg, color: OVERDUE_TAG.fg }}>Sent back</span>
              <div className="prop-dim" style={{ fontSize: 11 }} title={r.rejectReason}>{r.rejectReason}</div>
            </>
          );
        }
        return <Dash />;
      },
    },
    { key: 'manager', label: 'Manager', width: 138, render: (r) => r.manager?.name || <Dash /> },
    {
      key: 'action',
      label: 'Action',
      width: 104,
      render: (r) => (
        <button type="button" className="prop-open" onClick={() => navigate(`/design-drawings/${r.projectId}`)}>
          <Eye size={12} /> Open
        </button>
      ),
    },
  ], [navigate, sp]);

  const projectColumns = useMemo(() => [
    {
      key: 'project',
      label: 'Project',
      width: 196,
      render: (p) => (
        <>
          <CellLink onClick={() => openMetric('drawings', { projectId: p.id })} title={`All 37 drawings on ${p.name}`}>
            <span className="prop-name">{p.name}</span>
          </CellLink>
          <div className="prop-dim" style={{ fontSize: 11.5 }}>{[p.code, p.location].filter(Boolean).join(' · ')}</div>
        </>
      ),
    },
    { key: 'manager', label: 'Manager', width: 140, render: (p) => p.manager?.name || <Dash /> },
    {
      key: 'progress',
      label: 'Progress',
      width: 152,
      render: (p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, height: 7, borderRadius: 4, background: 'var(--p-line)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${p.overallProgress}%`, height: '100%', background: HEALTH_BAR[p.health.status] }} />
          </span>
          <b style={{ fontSize: 11.5, width: 32, textAlign: 'right' }}>{p.overallProgress}%</b>
        </div>
      ),
    },
    {
      key: 'submitted',
      label: 'Submitted',
      width: 96,
      render: (p) => (
        <CellLink tint="var(--p-tag-captured-fg)" onClick={() => openMetric('submitted', { projectId: p.id })} title={`The ${p.counts.submitted} filed on ${p.name}`}>
          <b>{p.counts.submitted}</b>
        </CellLink>
      ),
    },
    {
      key: 'inProgress',
      label: 'In Progress',
      width: 100,
      render: (p) => (
        <CellLink tint="var(--p-tag-wanted-fg)" onClick={() => openMetric('inProgress', { projectId: p.id })} title={`The ${p.counts.inProgress} being drawn on ${p.name}`}>
          <b>{p.counts.inProgress}</b>
        </CellLink>
      ),
    },
    {
      key: 'pending',
      label: 'Pending',
      width: 92,
      render: (p) => (
        <CellLink onClick={() => openMetric('pending', { projectId: p.id })} title={`The ${p.counts.pending} not started on ${p.name}`}>
          {p.counts.pending}
        </CellLink>
      ),
    },
    {
      key: 'delayed',
      label: 'Delayed',
      width: 92,
      render: (p) => (p.counts.delayed > 0
        ? (
          <CellLink tint="var(--danger)" onClick={() => openMetric('delayed', { projectId: p.id })} title={`The ${p.counts.delayed} past their date on ${p.name}`}>
            <b>{p.counts.delayed}</b>
          </CellLink>
        )
        : <Dash />),
    },
    {
      key: 'phase1',
      label: 'Phase 1',
      width: 88,
      render: (p) => (
        <CellLink onClick={() => openMetric('drawings', { projectId: p.id, set: 1 })} title={`The ${p.phase1.total} Set 1 drawings the BOQ waits for`}>
          {`${p.phase1.approved}/${p.phase1.total}`}
        </CellLink>
      ),
    },
    {
      key: 'phase2',
      label: 'Phase 2',
      width: 88,
      render: (p) => (
        <CellLink onClick={() => openMetric('drawings', { projectId: p.id, set: 2 })} title={`The ${p.phase2.total} Set 2 drawings`}>
          {`${p.phase2.approved}/${p.phase2.total}`}
        </CellLink>
      ),
    },
    {
      key: 'health',
      label: 'Health',
      width: 116,
      render: (p) => <Tag t={HEALTH_TAG[p.health.status] || HEALTH_TAG.on_track} />,
    },
    {
      key: 'worst',
      label: 'Holding It Up',
      width: 210,
      /* A count says a project is late; this says what to go and chase. */
      render: (p) => (p.worstDrawing ? (
        <CellLink onClick={() => openMetric('delayed', { projectId: p.id })} title={`Everything overdue on ${p.name}`}>
          <span className="prop-name" style={{ fontWeight: 600 }}>{`${p.worstDrawing.no}. ${p.worstDrawing.name}`}</span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--danger)', fontWeight: 700 }}>{p.worstDrawing.days}d overdue</span>
        </CellLink>
      ) : <span className="prop-dim">nothing overdue</span>),
    },
    { key: 'target', label: 'Target', width: 112, render: (p) => (p.targetDate ? fmtDate(p.targetDate) : <Dash />) },
    {
      key: 'action',
      label: 'Action',
      width: 104,
      render: (p) => (
        <button type="button" className="prop-open" onClick={() => navigate(`/design-drawings/${p.id}`)}>
          <Eye size={12} /> Open
        </button>
      ),
    },
  ], [navigate, sp]);

  if (isLoading) return <><Topbar title="Design & Drawings FMS" /><div className="content"><SkDetail /></div></>;

  if (isError || !data) {
    return (
      <>
        <Topbar title="Design & Drawings FMS" />
        <div className="content">
          <div className="dd-card" style={{ padding: 28, textAlign: 'center' }}>
            <AlertTriangle size={26} style={{ color: 'var(--warning)' }} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>Could not load this breakdown</div>
            <div className="sm muted" style={{ marginTop: 4 }}>Try again in a moment.</div>
            <button type="button" className="prop-open" style={{ marginTop: 14 }} onClick={() => navigate('/design-drawings')}>
              <ArrowLeft size={12} /> Back to the dashboard
            </button>
          </div>
        </div>
      </>
    );
  }

  const facts = kind === 'project' ? (
    <>
      <Fact label="Projects" value={s.projects} hint="in this count" />
      <Fact label="On Track" value={s.onTrack} tint="var(--p-tag-captured-fg)" hint="no drawing past its date" filter={{ flag: 'on_track' }} active={get('flag') === 'on_track'} onPick={pick} />
      <Fact label="At Risk" value={s.atRisk} tint="var(--p-tag-wanted-fg)" hint="1–3 days late" filter={{ flag: 'at_risk' }} active={get('flag') === 'at_risk'} onPick={pick} />
      <Fact label="Delayed" value={s.delayed} tint="var(--danger)" hint="4 days late or more" filter={{ flag: 'delayed' }} active={get('flag') === 'delayed'} onPick={pick} />
      <Fact label="Avg Progress" value={`${s.avgProgress}%`} hint="of 37 drawings approved" />
      <Fact label="On Phase 1" value={s.phase1} hint={`${s.phase2} on Phase 2 · ${s.phase3} done`} filter={{ flag: 'phase1' }} active={get('flag') === 'phase1'} onPick={pick} />
    </>
  ) : (
    <>
      <Fact label="Drawings" value={s.drawings} hint={`across ${s.projects} project${s.projects === 1 ? '' : 's'}`} />
      <Fact
        label="Blocks The BOQ"
        value={s.blocksBoq}
        tint={s.blocksBoq ? 'var(--p-gold)' : undefined}
        hint={`Set 1 · ${s.set2} in Set 2`}
        filter={{ flag: 'boq' }}
        active={get('flag') === 'boq'}
        onPick={pick}
      />
      <Fact label="Has An Owner" value={s.assigned} hint={`${s.unassigned} with nobody on them`} filter={{ flag: 'owner' }} active={get('flag') === 'owner'} onPick={pick} />
      <Fact label="Has A Date" value={s.dated} hint={`${s.undated} with none set`} filter={{ flag: 'dated' }} active={get('flag') === 'dated'} onPick={pick} />
      <Fact
        label="Overdue"
        value={s.overdue}
        tint={s.overdue ? 'var(--danger)' : undefined}
        hint={s.worstOverdue ? `worst is ${s.worstOverdue} days` : 'nothing past its date'}
        filter={{ flag: 'overdue' }}
        active={get('flag') === 'overdue'}
        onPick={pick}
      />
      <Fact
        label="Approved"
        value={s.approved}
        tint={s.approved ? 'var(--p-tag-captured-fg)' : undefined}
        hint={`${s.awaitingReview} awaiting review · ${s.sentBack} sent back`}
        filter={{ flag: 'approved' }}
        active={get('flag') === 'approved'}
        onPick={pick}
      />
    </>
  );

  return (
    <>
      <Topbar title="Design & Drawings FMS" />

      <div className="prop-shell dd-shell">
        <div className="prop-page dd-page">

          <div className="prop-toolbar is-bare" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <button type="button" className="dd-back" onClick={() => navigate('/design-drawings')}>
                <ArrowLeft size={13} /> Design &amp; Drawings
              </button>
              <PageHead title={data.title} subtitle={data.blurb} />
            </div>
            <div className="dd-head-actions">
              <button type="button" className="prop-open" onClick={() => exportCsv(rows, metric, kind)}>
                <Download size={13} /> Export page
              </button>
            </div>
          </div>

          {/* The whole strip, still live. Landing here having clicked Pending
              and then wanting Delayed is one click, not a trip back. */}
          <div className="dd-grid dd-kpis">
            {kpiCards(data.totals).map(({ metric: m, ...card }) => (
              <StatCard
                key={m}
                {...card}
                active={m === metric}
                onOpen={() => openMetric(m)}
              />
            ))}
          </div>

          <div className="dd-facts">{facts}</div>

          {/* What a click just did, and how to undo it. */}
          {applied.length > 0 && (
            <div className="dd-chips">
              <span className="dd-chips-lead">Showing only:</span>
              {applied.map((f) => (
                <button key={f.key} type="button" className="dd-chip" onClick={() => patch({ [f.key]: null })} title="Take this filter off">
                  {f.label} <X size={11} />
                </button>
              ))}
              {applied.length > 1 && (
                <button type="button" className="dd-chip is-clear" onClick={clearAll}>Clear all</button>
              )}
            </div>
          )}

          <div className="dd-grid dd-groups">
            {kind === 'project' ? (
              <>
                <GroupPanel title="By Location" rows={data.groups.byLocation} filterKey="location" activeValue={get('location')} onPick={pick} />
                <GroupPanel title="By Manager" rows={data.groups.byManager} tint="var(--p-tag-captured-fg)" filterKey="manager" activeValue={get('manager')} onPick={pick} />
                <GroupPanel title="By Project Status" rows={data.groups.byStatus} tint="var(--p-tag-wanted-fg)" filterKey="projectStatus" activeValue={get('projectStatus')} onPick={pick} />
              </>
            ) : (
              <>
                <GroupPanel
                  title="By Project"
                  rows={data.groups.byProject}
                  filterKey="projectId"
                  activeValue={get('projectId')}
                  onPick={pick}
                  note="Which projects this count is actually sitting on. Click one to see only its rows."
                />
                <GroupPanel title="By Drawing Category" rows={data.groups.byCategory} tint="var(--p-tag-captured-fg)" filterKey="category" activeValue={get('category')} onPick={pick} />
                <GroupPanel
                  title="By Owner"
                  rows={data.groups.byOwner}
                  tint="var(--p-tag-wanted-fg)"
                  filterKey="owner"
                  activeValue={get('owner')}
                  onPick={pick}
                  note="Owners inherited from the phase task count here too — that is who would be chased."
                />
              </>
            )}
          </div>

          <div className="prop-toolbar">
            <div className="prop-filters">
              <label className="prop-field">
                <span className="prop-field-label">SEARCH</span>
                <span className="prop-search" style={{ width: 230 }}>
                  <Search size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                  <input
                    value={get('q')}
                    /* `replace` so typing leaves one history entry, not one per
                       keystroke to back out through. */
                    onChange={(e) => patch({ q: e.target.value }, { replace: true })}
                    placeholder={kind === 'project' ? 'Project, code, city or manager…' : 'Drawing, project or owner…'}
                  />
                </span>
              </label>
              <label className="prop-field">
                <span className="prop-field-label">PROJECT</span>
                <select className="prop-city" value={get('projectId')} onChange={(e) => patch({ projectId: e.target.value })}>
                  <option value="">All Projects</option>
                  {data.projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {kind !== 'project' && (
                <label className="prop-field">
                  <span className="prop-field-label">SET</span>
                  <select className="prop-city" value={get('set')} onChange={(e) => patch({ set: e.target.value })}>
                    <option value="">Both Sets</option>
                    <option value="1">Set 1 — blocks the BOQ (29)</option>
                    <option value="2">Set 2 — execution only (8)</option>
                  </select>
                </label>
              )}
              <label className="prop-field">
                <span className="prop-field-label">SORT</span>
                <select className="prop-city" value={get('sort')} onChange={(e) => patch({ sort: e.target.value })}>
                  {kind === 'project' ? (
                    <>
                      <option value="">Project name</option>
                      <option value="progress">Most progress</option>
                      <option value="delayed">Most delayed rows</option>
                      <option value="health">Worst health</option>
                      <option value="target">Target date</option>
                    </>
                  ) : (
                    <>
                      <option value="">Project, then drawing</option>
                      <option value="drawing">Checklist order</option>
                      <option value="planned">Planned date</option>
                      <option value="overdue">Most overdue</option>
                      <option value="status">Status</option>
                      <option value="updated">Recently touched</option>
                    </>
                  )}
                </select>
              </label>
              {applied.length > 0 && (
                <div className="prop-field">
                  <span className="prop-field-label">&nbsp;</span>
                  <button type="button" className="prop-clear" onClick={clearAll}>
                    Clear · {data.total.toLocaleString('en-IN')} found
                  </button>
                </div>
              )}
            </div>
          </div>

          {!rows.length ? (
            <PropEmpty
              title={applied.length ? 'Nothing matches those filters' : 'Nothing in this count'}
              hint={applied.length
                ? 'Take a filter off above to widen it again.'
                : `Nothing is ${data.title.toLowerCase()} right now — which is why the card reads 0.`}
            />
          ) : (
            <>
              <PropTable
                columns={kind === 'project' ? projectColumns : drawingColumns}
                rows={rows}
                rowKey={(r) => r.key || r.id}
                busy={isFetching}
              />
              <PropPager
                page={data.page}
                totalPages={Math.max(1, Math.ceil(data.total / data.limit))}
                total={data.total}
                limit={data.limit}
                onPage={(n) => patch({ page: n })}
                onLimit={(n) => patch({ limit: n })}
              />
            </>
          )}

          {/* The last time anything under this count moved — the honest answer
              to "is this stale?", which a page of zeroes otherwise invites. */}
          {kind !== 'project' && rows.some((r) => r.updatedAt) && (
            <div className="dd-updated">
              {`Most recent activity in this count: ${fmtDateTime(
                rows.reduce((a, r) => (r.updatedAt && (!a || new Date(r.updatedAt) > new Date(a)) ? r.updatedAt : a), null),
              )}`}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default DesignDrawingsMetricPage;
