import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Users, Building2, Factory, ChevronRight, Scale,
} from 'lucide-react';
import { useGoBack } from '../../../components/layout/BackButton.jsx';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { SkDetail } from '../../../components/ui/Skeletons.jsx';
import { useProject } from '../../../app/api/projectsApi.js';
import { useGetPanelBoardQuery } from '../../../app/api/flowApi.js';
import { useGlobalStageRecords, useUpdateRecord, useCreateRecord } from '../../../app/api/recordsApi.js';

/**
 * Phase 6 — the Vendor & Contractor Panel. SCR-06-01.
 *
 * Route: /projects/:id/vendor-panel
 *
 * ── Why a fixed list and not a free one (fix F-3) ────────────────────
 * "Vendor Identification" described a quotation hunt, as if every branch
 * started from zero. It does not: there is a standing panel of teams who have
 * built these rooms before, and per site the questions are only which team, at
 * what rate, and who the local general contractor is. So the page opens with
 * the work already enumerated — every row that needs a rate is on screen from
 * day one, greyed until someone fills it — rather than an empty list and an
 * Add button that tells you nothing about what is missing.
 *
 * ── Why seven rows and not six ───────────────────────────────────────
 * The rows are keyed on the seven BOQs, not the six panel categories, because
 * a BOQ is what needs pricing and "All games furniture" and "Common area
 * furniture" buy from the SAME category. Collapsing to six would hide a BOQ;
 * pretending there are seven independent categories would ask for one rate
 * card twice. The two rows that share a category say so, and confirming either
 * satisfies both.
 *
 * ── What a missing rate actually blocks ──────────────────────────────
 * Not the BOQ being built — quantities come from the drawings and can be
 * entered today. It blocks that BOQ being APPROVED, because an approved BOQ
 * with no agreed rate behind it is a number nobody has committed to. Each row
 * says exactly that rather than showing a bare warning triangle.
 */

const TYPE_ICON = { Panel: Users, Local: Building2, Internal: Factory };
const TYPE_TONE = {
  Panel: { color: 'var(--primary)', soft: 'var(--surface-2)' },
  Local: { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  Internal: { color: 'var(--teal-600)', soft: 'var(--surface-2)' },
};

function CardState({ card }) {
  if (card.state === 'none') {
    return <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>No rate card</span>;
  }
  if (card.state === 'standard') {
    return (
      <span style={{ fontSize: 12 }}>
        <b>Standard</b>
        <span style={{ color: 'var(--muted)' }}> · {card.lines} line{card.lines === 1 ? '' : 's'}</span>
      </span>
    );
  }
  return (
    <span style={{ fontSize: 12 }}>
      <b style={{ color: 'var(--warning)' }}>Site-specific</b>
      <span style={{ color: 'var(--muted)' }}>
        {' '}· {card.overrides} of {card.lines} overridden
      </span>
      {card.unexplained > 0 && (
        <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 2 }}>
          {card.unexplained} with no reason given
        </div>
      )}
    </span>
  );
}

/**
 * Assigning a team. A dropdown over vendors already in the master, filtered to
 * this category — not a "create vendor" form. Typing a firm's details again
 * per project is how one firm becomes three records that disagree about its
 * GST; the vendor module already solved that and this reads from it.
 */
function PickFromPanel({ row, projectId, onDone }) {
  const [open, setOpen] = useState(false);
  const { data: all } = useGlobalStageRecords('p12', { enabled: open });
  const update = useUpdateRecord(projectId, 'p12');
  const create = useCreateRecord(projectId, 'p12');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const rows = all?.items || all?.records || all || [];
    const seen = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r.assessmentType) continue; // rate lines live on p12 too
      const name = String(r.values?.vendor_name || '').trim();
      if (!name) continue;
      /* One row per FIRM, not per past engagement — the same team on four
         branches is one choice here, with the count as the useful signal. */
      const key = name.toLowerCase();
      const hit = seen.get(key) || { name, branches: 0, category: r.values?.panel_category || '' };
      hit.branches += 1;
      if (!hit.category && r.values?.panel_category) hit.category = r.values.panel_category;
      seen.set(key, hit);
    }
    return [...seen.values()].sort((a, b) => b.branches - a.branches);
  }, [all]);

  const assign = async (name) => {
    setBusy(true);
    try {
      if (row.vendorId) {
        await update.mutateAsync({ id: row.vendorId, values: { vendor_name: name, panel_category: row.category, on_panel: true } });
      } else {
        await create.mutateAsync({
          projectId, stageKey: 'p12',
          values: { vendor_name: name, panel_category: row.category, on_panel: true, status: 'Identified' },
        });
      }
      setOpen(false);
      onDone?.();
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        {row.vendorName ? 'Change team' : 'Pick from panel'}
      </button>
    );
  }
  return (
    <div style={{ minWidth: 230 }}>
      {!candidates.length ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          No vendor in the master for this category yet — add one in{' '}
          <Link to="/vendors">Vendors</Link>, or use Compare quotes.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 190, overflowY: 'auto' }}>
          {candidates.map((c) => (
            <button
              key={c.name}
              type="button"
              className="btn-ghost"
              disabled={busy}
              style={{ justifyContent: 'space-between', textAlign: 'left' }}
              onClick={() => assign(c.name)}
            >
              <span>{c.name}</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {c.branches} branch{c.branches === 1 ? '' : 'es'}
              </span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn-ghost" style={{ marginTop: 6 }} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

export default function VendorPanelPage() {
  const { id } = useParams();
  const goBack = useGoBack(`/projects/${id}`);
  const { data: project } = useProject(id);
  const { data, isLoading, isError, refetch } = useGetPanelBoardQuery(id, { skip: !id });

  if (isLoading) return <><Topbar title="Vendor & Contractor Panel" /><div className="content"><SkDetail /></div></>;
  if (isError || !data) {
    return (
      <>
        <Topbar title="Vendor & Contractor Panel" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Could not load the panel" hint="Try again in a moment." />
        </div>
      </>
    );
  }

  const { rows, confirmed, total, categories, localContractor, unexplainedOverrides } = data;
  const ready = confirmed === total;

  return (
    <>
      <Topbar
        title="Phase 6 — Vendor & Contractor Panel"
        back={<button type="button" className="btn-ghost" onClick={goBack}><ArrowLeft size={16} /> Back</button>}
      />
      <div className="content">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Which team, at what rate</h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0', maxWidth: '92ch', lineHeight: 1.6 }}>
            {project?.name || 'This project'} — the standing panel already knows this work, so per site
            there are only three questions: which team, at what rate, and who the local general
            contractor is. Comparing quotes stays available for a new category or a new city.
          </p>
        </div>

        <div
          className="card"
          style={{
            padding: 16, marginBottom: 16, display: 'flex', gap: 14,
            borderLeft: `4px solid ${ready ? 'var(--success)' : 'var(--warning)'}`,
          }}
        >
          {ready
            ? <CheckCircle2 size={20} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
            : <Scale size={20} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />}
          <div>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
              {ready
                ? 'Every BOQ has a confirmed rate behind it'
                : `${total - confirmed} of ${total} BOQ${total - confirmed === 1 ? '' : 's'} still `
                  + `${total - confirmed === 1 ? 'has' : 'have'} no confirmed rate`}
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '92ch' }}>
              {ready ? (
                <>All {total} BOQs can be priced and approved. {localContractor
                  ? <>Local general contractor: <b>{localContractor}</b>.</>
                  : 'No local general contractor marked yet.'}</>
              ) : (
                <>
                  A category with no confirmed rate does <b>not</b> stop its BOQ being built — quantities
                  come from the drawings and can be entered today. It stops that BOQ being{' '}
                  <b>approved</b>, because an approved BOQ with no agreed rate is a number nobody has
                  committed to. {total} BOQs are served by {categories} panel categories.
                </>
              )}
            </p>
            {unexplainedOverrides > 0 && (
              <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--danger)' }}>
                {unexplainedOverrides} negotiated rate{unexplainedOverrides === 1 ? '' : 's'}{' '}
                {unexplainedOverrides === 1 ? 'carries' : 'carry'} no reason. A rate nobody can
                explain cannot be defended at closure.
              </p>
            )}
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['BOQ / category', 'Team', 'Type', 'Rate card', 'Status', ''].map((h, i) => (
                    <th
                      key={h || i}
                      style={{
                        textAlign: 'left', padding: '10px 15px', fontSize: 11, textTransform: 'uppercase',
                        letterSpacing: '.05em', color: 'var(--ink-400)', fontWeight: 700,
                        borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = TYPE_ICON[r.vendorType] || Users;
                  const tone = TYPE_TONE[r.vendorType];
                  return (
                    <tr key={r.boqNo} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '12px 15px' }}>
                        <div style={{ fontWeight: 600 }}>{r.boqName}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{r.category}</div>
                        {r.sharesWith.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--ink-400)', marginTop: 3 }}>
                            same panel as {r.sharesWith.join(', ')} — confirming once serves both
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '12px 15px' }}>
                        {r.vendorName
                          ? (
                            <>
                              <div style={{ fontWeight: 500 }}>{r.vendorName}</div>
                              {r.isLocalGc && (
                                <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
                                  local general contractor
                                </div>
                              )}
                            </>
                          )
                          : <span style={{ color: 'var(--ink-400)', fontSize: 12.5 }}>Not assigned</span>}
                      </td>
                      <td style={{ padding: '12px 15px' }}>
                        <Badge color={tone.color} soft={tone.soft}>
                          <Icon size={11} style={{ marginRight: 5, verticalAlign: -1 }} />
                          {r.vendorType}
                        </Badge>
                      </td>
                      <td style={{ padding: '12px 15px' }}><CardState card={r.card} /></td>
                      <td style={{ padding: '12px 15px', maxWidth: 260 }}>
                        {r.rateConfirmed
                          ? <Badge color="var(--success)" soft="var(--success-soft)">Rate confirmed</Badge>
                          : (
                            <>
                              <Badge color="var(--warning)" soft="var(--warning-soft)">Not confirmed</Badge>
                              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>
                                {r.blocks}
                              </div>
                            </>
                          )}
                      </td>
                      <td style={{ padding: '12px 15px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'flex-start' }}>
                          {r.vendorId ? (
                            <Link className="btn-ghost" to={`/projects/${id}/vendor-panel/${r.vendorId}`}>
                              Rate card <ChevronRight size={14} />
                            </Link>
                          ) : (
                            <PickFromPanel row={r} projectId={id} onDone={refetch} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.7, maxWidth: '100ch' }}>
          This is not a quotation hunt. <Link to={`/projects/${id}/phase/p12`}>Compare quotes</Link> on
          the phase page is the path for a <b>new category or a new city</b>, where there genuinely is no
          panel yet — it is deliberately not the default. Firm-level details (GST, PAN, past
          performance) live once in <Link to="/vendors">the vendor master</Link>, not per project.
        </p>
      </div>
    </>
  );
}
