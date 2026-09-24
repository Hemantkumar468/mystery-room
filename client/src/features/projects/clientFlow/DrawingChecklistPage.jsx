import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, Clock, Lock, Unlock, AlertTriangle, FileText, Search,
} from 'lucide-react';
import { useGoBack } from '../../../components/layout/BackButton.jsx';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { Badge, EmptyState, ProgressBar } from '../../../components/ui/primitives.jsx';
import { SkDetail } from '../../../components/ui/Skeletons.jsx';
import { useProject } from '../../../app/api/projectsApi.js';
import { useGetDrawingChecklistQuery } from '../../../app/api/flowApi.js';
import { fmtDate } from '../../../lib/format.js';

/**
 * Phase 5 — the Drawing Checklist board. SCR-05-01.
 *
 * Route: /projects/:id/drawings
 *
 * ── Why this screen exists (fix F-1 of PMS_UI_SPEC_00 §1) ────────────
 * Phase 5 used to be a flat list of whatever the architect happened to upload.
 * That can show what arrived. It can never show what is MISSING — and missing
 * is the only question this phase is asked, because the BOQ cannot start
 * without it.
 *
 * So the checklist is the deliverable, not the uploads. All 37 rows are on
 * screen from the day the project is created, at "Not started". Filing a
 * drawing fills a row in; it does not create one. An empty board is therefore
 * a complete statement of the work, not an empty page.
 *
 * ── The one number that matters ──────────────────────────────────────
 * Set 1 approved / 29. That is the gate: the BOQ waits for every one of them
 * and for nothing else. Set 2 is shown with equal care but is never allowed to
 * affect the gate — the banner says so in words, because "why is the BOQ still
 * locked when I have approved 35 of 37 drawings?" is exactly the question this
 * split exists to answer.
 */

const STATUS_TONE = {
  Approved: { color: 'var(--success)', soft: 'var(--success-soft)', Icon: CheckCircle2 },
  'Submitted for review': { color: 'var(--warning)', soft: 'var(--warning-soft)', Icon: Clock },
  'In progress': { color: 'var(--info)', soft: 'var(--info-soft)', Icon: Clock },
  'Not started': { color: 'var(--ink-400)', soft: 'var(--surface-2)', Icon: Circle },
};

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE['Not started'];
  const { Icon } = tone;
  return (
    <Badge color={tone.color} soft={tone.soft}>
      <Icon size={12} style={{ marginRight: 5, verticalAlign: -2 }} />
      {status}
    </Badge>
  );
}

/** The gate, stated in words rather than left to be inferred from a number. */
function GateBanner({ summary }) {
  const unlocked = summary.boqUnlocked;
  const left = summary.blocking.length;
  /**
   * Three states, not two. A project where nobody has touched the checklist
   * has the same arithmetic as a blocked one — 0 of 29 approved — but it is
   * not the same fact, and saying "waiting on 29 drawings" to a project that
   * is already ordering is a false alarm. See flow.service.js#drawingSummary.
   */
  const untouched = !summary.started && !unlocked;
  const tone = unlocked ? 'var(--success)' : (untouched ? 'var(--ink-400)' : 'var(--warning)');
  return (
    <div
      className="card"
      style={{
        display: 'flex', gap: 16, alignItems: 'flex-start', padding: 18,
        borderLeft: `4px solid ${tone}`,
        marginBottom: 16,
      }}
    >
      {unlocked
        ? <Unlock size={22} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />
        : <Lock size={22} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>
          {unlocked
            ? 'Set 1 is complete — the BOQ can start'
            : untouched
              ? 'The checklist has not been started on this project'
              : `The BOQ is waiting on ${left} Set 1 drawing${left === 1 ? '' : 's'}`}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '90ch' }}>
          {unlocked ? (
            <>
              All {summary.set1.total} Set 1 drawings are approved, so quantities can be extracted.
              Set 2 ({summary.set2.approved} of {summary.set2.total} approved) runs on into execution
              and holds nothing up.
            </>
          ) : untouched ? (
            <>
              No drawing on this project has been filed against a checklist row yet, so there is
              nothing here to report on — this is not a statement that the work is behind. Projects
              that started before the checklist existed will look like this until their drawings are
              filed against it. All {summary.set1.total} Set 1 rows are listed below, ready to be
              filled in.
            </>
          ) : (
            <>
              Quantities are extracted from Set 1, so <b>every one of its {summary.set1.total} drawings
              must be approved</b> before the BOQ can begin. Set 2 — wall finishes, the 3D reception
              and the coordination sets — is needed for execution, not for counting, so it never
              blocks ordering however far behind it is.
            </>
          )}
        </p>
        {!unlocked && !untouched && left > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {summary.blocking.slice(0, 8).map((d) => (
              <span
                key={d.no}
                style={{
                  fontSize: 11.5, padding: '3px 8px', borderRadius: 6,
                  background: 'var(--warning-soft)', color: 'var(--warning)', fontWeight: 500,
                }}
              >
                {d.no}. {d.name}
              </span>
            ))}
            {left > 8 && (
              <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>
                +{left - 8} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SetCard({ label, hint, stat, tone }) {
  const pct = stat.total ? Math.round((stat.approved / stat.total) * 100) : 0;
  return (
    <div className="card" style={{ padding: 16, flex: '1 1 260px', minWidth: 240 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: tone }}>
          {stat.approved}<span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> / {stat.total}</span>
        </div>
      </div>
      <div style={{ margin: '10px 0 8px' }}>
        <ProgressBar value={pct} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{hint}</div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
        {stat.started - stat.approved > 0 && `${stat.started - stat.approved} in progress · `}
        {stat.notStarted} not started
      </div>
    </div>
  );
}

export default function DrawingChecklistPage() {
  const { id } = useParams();
  const goBack = useGoBack(`/projects/${id}`);
  const { data: project } = useProject(id);
  const { data, isLoading, isError } = useGetDrawingChecklistQuery(id, { skip: !id });

  const [setFilter, setSetFilter] = useState('all'); // all | 1 | 2
  const [statusFilter, setStatusFilter] = useState('all');
  const [q, setQ] = useState('');

  const rows = data?.rows || [];
  const summary = data?.summary;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (setFilter !== 'all' && String(r.set) !== String(setFilter)) return false;
      if (statusFilter === 'blocking' && (!r.blocksBoq || r.approved)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'blocking' && r.status !== statusFilter) return false;
      if (needle && !`${r.no} ${r.name} ${r.category}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, setFilter, statusFilter, q]);

  /* Grouped by category, in master order — nine headings rather than a flat
     37-row wall. An engineer looking for "the electrical drawings" thinks in
     categories, not row numbers. */
  const grouped = useMemo(() => {
    const out = [];
    for (const r of shown) {
      const last = out[out.length - 1];
      if (last && last.category === r.category) last.rows.push(r);
      else out.push({ category: r.category, rows: [r] });
    }
    return out;
  }, [shown]);

  if (isLoading) return <><Topbar title="Drawing Checklist" /><div className="content"><SkDetail /></div></>;
  if (isError || !summary) {
    return (
      <>
        <Topbar title="Drawing Checklist" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Could not load the checklist" hint="Try again in a moment." />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="Phase 5 — Design & Drawings"
        back={<button type="button" className="btn-ghost" onClick={goBack}><ArrowLeft size={16} /> Back</button>}
      />
      <div className="content">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Drawing checklist</h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0', maxWidth: '92ch', lineHeight: 1.6 }}>
            All {summary.total} drawings on the master, in two sets, for {project?.name || 'this project'}.
            Every row is here from the day the project is created — the checklist is the deliverable, not
            the uploads. Filing a drawing fills its row in.
          </p>
        </div>

        <GateBanner summary={summary} />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <SetCard
            label="Set 1 — the BOQ waits for these"
            hint="Quantities are extracted from these 29. Every one must be approved before the BOQ can start."
            stat={summary.set1}
            tone="var(--primary)"
          />
          <SetCard
            label="Set 2 — blocks nothing"
            hint="Finishes, the 3D reception and coordination sets. Needed for execution, not for counting."
            stat={summary.set2}
            tone="var(--teal-500)"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {[['all', 'All sets'], ['1', 'Set 1'], ['2', 'Set 2']].map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={setFilter === v ? 'btn-primary' : 'btn-ghost'}
              onClick={() => setSetFilter(v)}
            >
              {label}
            </button>
          ))}
          <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
          {[['all', 'Any status'], ['blocking', `Blocking the BOQ (${summary.blocking.length})`],
            ['Approved', 'Approved'], ['Not started', 'Not started']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={statusFilter === v ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setStatusFilter(v)}
              >
                {label}
              </button>
          ))}
          <div style={{ position: 'relative', marginLeft: 'auto' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--ink-400)' }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a drawing…"
              style={{ paddingLeft: 30, minWidth: 220 }}
            />
          </div>
        </div>

        {!shown.length ? (
          <EmptyState
            icon={FileText}
            title="No drawing matches that"
            hint="Clear the filters to see all 37 rows."
          />
        ) : (
          grouped.map(({ category, rows: catRows }) => (
            <div className="card" key={category} style={{ marginBottom: 12, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '11px 16px', borderBottom: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'var(--surface-2)',
                }}
              >
                <b style={{ fontSize: 13.5 }}>{category}</b>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {catRows.filter((r) => r.approved).length} of {catRows.length} approved
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <tbody>
                    {catRows.map((r) => (
                      <tr key={r.no} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 16px', width: 48, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {r.no}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ fontWeight: 500 }}>
                            {r.name}
                            {r.unconfirmed && (
                              <span
                                title="The client's sheet cuts this label off — open question Q-1. Confirm the wording before relying on it."
                                style={{ marginLeft: 8, fontSize: 11, color: 'var(--warning)', fontWeight: 500 }}
                              >
                                label unconfirmed
                              </span>
                            )}
                          </div>
                          {r.revision != null && r.revision > 0 && (
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                              Revision {r.revision}
                              {r.updatedAt ? ` · ${fmtDate(r.updatedAt)}` : ''}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 8px', width: 92 }}>
                          <Badge
                            color={r.set === 1 ? 'var(--primary)' : 'var(--teal-600)'}
                            soft={r.set === 1 ? 'var(--primary-soft, var(--surface-2))' : 'var(--surface-2)'}
                          >
                            {r.setLabel}
                          </Badge>
                        </td>
                        <td style={{ padding: '10px 8px', width: 120 }}>
                          {r.blocksBoq && !r.approved
                            ? <span style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 600 }}>blocks the BOQ</span>
                            : <span style={{ fontSize: 11.5, color: 'var(--ink-400)' }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 16px', width: 190, textAlign: 'right' }}>
                          <StatusPill status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.7, maxWidth: '100ch' }}>
          Drawings are filed and approved on the phase page, where each one is a record with its own
          revisions, reviewer comments and approval trail —{' '}
          <Link to={`/projects/${id}/phase/p11`}>open Phase 5</Link>. This board is the view over them:
          it shows the whole master so the gap is visible, which a list of uploads cannot do.
        </p>
      </div>
    </>
  );
}
