import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Lock, Ruler, Tags, Package, Hammer, Sofa, ShoppingCart,
} from 'lucide-react';
import { useGoBack } from '../../../components/layout/BackButton.jsx';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { Badge, EmptyState, ProgressBar } from '../../../components/ui/primitives.jsx';
import { SkDetail } from '../../../components/ui/Skeletons.jsx';
import { useProject } from '../../../app/api/projectsApi.js';
import { useGetBoqWorkspaceQuery } from '../../../app/api/flowApi.js';

/**
 * Phase 7 — the BOQ workspace. SCR-07-01.
 *
 * Route: /projects/:id/boq
 *
 * ── Why seven cards and not one table (fix F-2) ──────────────────────
 * The business does not work from one BOQ. It works from seven documents with
 * different owners, different vendors and different timelines, each approved
 * on its own. A single flat list means one approval covers work that seven
 * different people are accountable for, and nobody can answer "is the cameras
 * BOQ signed off?" — which is the question actually asked in the meeting.
 *
 * ── Why the inputs banner is at the top ──────────────────────────────
 * Rule 3: quantities come from the drawings, rates come from the panel, and
 * NEITHER ALONE produces a BOQ. This is the only convergence point in the
 * whole flow, so an empty workspace has two quite different causes and they
 * need different people to fix them. The banner names which half is missing
 * instead of letting seven empty cards look like work nobody has started.
 */

const STREAM_ICON = { construction: Hammer, furniture: Sofa, procurement: ShoppingCart };
const STREAM_COLOR = {
  construction: 'var(--warning)',
  furniture: 'var(--primary)',
  procurement: 'var(--teal-500)',
};

const inr = (n) => {
  if (!n) return '₹0';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

/** Rule 3, in words. Two different blockers, two different people to chase. */
function InputsBanner({ inputs, projectId }) {
  const { quantitiesReady, ratesReady, canStart, blockingDrawings, missingRates } = inputs;
  if (canStart) {
    return (
      <div
        className="card"
        style={{ padding: 16, borderLeft: '4px solid var(--success)', marginBottom: 16, display: 'flex', gap: 14 }}
      >
        <CheckCircle2 size={20} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>Both inputs are in — the BOQ can be built</div>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '92ch' }}>
            Set 1 drawings are approved, so quantities can be extracted; every panel category has a
            confirmed rate card, so those quantities can be priced.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="card"
      style={{ padding: 16, borderLeft: '4px solid var(--warning)', marginBottom: 16, display: 'flex', gap: 14 }}
    >
      <Lock size={20} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>The BOQ is not ready to start</div>
        <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '92ch' }}>
          Quantities come from the drawings and rates come from the vendor panel.{' '}
          <b>Neither alone produces a BOQ</b> — this is the only place in the flow where two streams
          have to meet.
        </p>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Ruler size={15} style={{ color: quantitiesReady ? 'var(--success)' : 'var(--warning)', marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Quantities — {quantitiesReady ? 'ready' : `${blockingDrawings.length} Set 1 drawings outstanding`}
              </div>
              {!quantitiesReady && (
                <Link to={`/projects/${projectId}/drawings`} style={{ fontSize: 12 }}>
                  Open the drawing checklist
                </Link>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Tags size={15} style={{ color: ratesReady ? 'var(--success)' : 'var(--warning)', marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Rates — {ratesReady
                  ? 'ready'
                  : `${missingRates.length} ${missingRates.length === 1 ? 'category' : 'categories'} unconfirmed`}
              </div>
              {!ratesReady && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{missingRates.join(' · ')}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BoqCard({ b, projectId }) {
  const Icon = STREAM_ICON[b.stream] || Package;
  const color = STREAM_COLOR[b.stream] || 'var(--primary)';
  const pct = b.lines ? Math.round((b.approvedLines / b.lines) * 100) : 0;
  const unset = b.sources?.unset || 0;

  return (
    <div className="card" style={{ padding: 16, flex: '1 1 320px', minWidth: 300 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon size={17} style={{ color, flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{b.covers}</div>
        </div>
        {b.fullyApproved && <CheckCircle2 size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 14 }}>
        <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
          {inr(b.value)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {b.lines} line{b.lines === 1 ? '' : 's'}
        </div>
      </div>

      {b.lines > 0 ? (
        <>
          <div style={{ margin: '9px 0 6px' }}><ProgressBar value={pct} /></div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {b.approvedLines} of {b.lines} {b.lines === 1 ? 'line' : 'lines'} approved
            {b.fullyApproved ? ' · BOQ signed off' : ''}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--ink-400)', margin: '10px 0 4px', lineHeight: 1.5 }}>
          No lines yet. Priced from the {b.vendorCategory} rate card.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 11 }}>
        <Badge color={color} soft="var(--surface-2)">{b.stream}</Badge>
        <Badge color="var(--ink-500)" soft="var(--surface-2)">{b.vendorCategory}</Badge>
      </div>

      {unset > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 9 }}>
          {unset} line{unset === 1 ? '' : 's'} with no source of supply — set it before ordering
        </div>
      )}

      <Link
        to={`/projects/${projectId}/phase/p13`}
        style={{ fontSize: 12, display: 'inline-block', marginTop: 10 }}
      >
        Open the lines →
      </Link>
    </div>
  );
}

export default function BoqWorkspacePage() {
  const { id } = useParams();
  const goBack = useGoBack(`/projects/${id}`);
  const { data: project } = useProject(id);
  const { data, isLoading, isError } = useGetBoqWorkspaceQuery(id, { skip: !id });

  if (isLoading) return <><Topbar title="BOQ & Budget" /><div className="content"><SkDetail /></div></>;
  if (isError || !data) {
    return (
      <>
        <Topbar title="BOQ & Budget" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Could not load the BOQ workspace" hint="Try again in a moment." />
        </div>
      </>
    );
  }

  const { boqs, streams, totals, unassigned, inputs } = data;

  return (
    <>
      <Topbar
        title="Phase 7 — BOQ & Budget"
        back={<button type="button" className="btn-ghost" onClick={goBack}><ArrowLeft size={16} /> Back</button>}
      />
      <div className="content">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Seven BOQs, not one</h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0', maxWidth: '92ch', lineHeight: 1.6 }}>
            {project?.name || 'This project'} — each BOQ has its own lines, total, vendor and approval,
            because each has a different owner and a different timeline. A BOQ is a document, not a
            trade: two of these seven buy from the same category.
          </p>
        </div>

        <InputsBanner inputs={inputs} projectId={id} />

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="card" style={{ padding: 15, flex: '1 1 180px' }}>
            <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em' }}>{inr(totals.value)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Total across all seven · {totals.lines} lines
            </div>
          </div>
          <div className="card" style={{ padding: 15, flex: '1 1 180px' }}>
            <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--success)' }}>
              {totals.approvedBoqs}<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 500 }}> / {totals.ofBoqs}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>BOQs fully approved</div>
          </div>
          {streams.map((s) => (
            <div className="card" key={s.key} style={{ padding: 15, flex: '1 1 180px' }}>
              <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', color: STREAM_COLOR[s.key] }}>
                {inr(s.value)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                <b style={{ color: 'var(--text)' }}>{s.label}</b> — {s.goesTo}
              </div>
            </div>
          ))}
        </div>

        {unassigned.lines > 0 && (
          <div
            className="card"
            style={{ padding: 14, borderLeft: '4px solid var(--warning)', marginBottom: 16, display: 'flex', gap: 12 }}
          >
            <AlertTriangle size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                {unassigned.lines} line{unassigned.lines === 1 ? '' : 's'} not filed under a BOQ ({inr(unassigned.value)})
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
                Filed before the seven BOQs existed. Each belongs to exactly one of them — set the BOQ on
                the line and it moves itself. Until then it is counted here and in no BOQ total, so the
                seven cards below reconcile against the seven documents.
              </p>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {boqs.map((b) => <BoqCard key={b.no} b={b} projectId={id} />)}
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 16, lineHeight: 1.7, maxWidth: '100ch' }}>
          <b>One BOQ line = one purchase order = one delivery = one GRN</b> — with one addition: the
          source of supply. A line marked <i>Delhi stock</i> is earmarked and never becomes a PO;{' '}
          <i>Delhi production</i> enters the 20–25 day queue; only <i>outside procurement</i> raises a
          vendor purchase order, and then only against a signed contract in{' '}
          <Link to={`/projects/${id}/contracts`}>Phase 8</Link>.
        </p>
      </div>
    </>
  );
}
