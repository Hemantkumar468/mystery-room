import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, FileSignature, ShieldAlert, Ban, PackageCheck,
} from 'lucide-react';
import { useGoBack } from '../../../components/layout/BackButton.jsx';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { SkDetail } from '../../../components/ui/Skeletons.jsx';
import { useProject } from '../../../app/api/projectsApi.js';
import { useGetFlowContractsQuery, useGetOrderabilityQuery } from '../../../app/api/flowApi.js';
import { fmtDate } from '../../../lib/format.js';

/**
 * Phase 8 — Contracts & Work Orders. SCR-08-01.
 *
 * Route: /projects/:id/contracts
 *
 * ── The step that had no home (fix F-4) ──────────────────────────────
 * This phase did not exist anywhere in the system. Rates were captured in
 * Phase 6 and quantities in Phase 7, and then a purchase order was raised —
 * but the agreement in between, the one both sides actually sign, lived in
 * somebody's drawer. The completion date on it is the promise the vendor made,
 * and it was the single most important date on the project that the PMS did
 * not hold.
 *
 * ── Why the ordering panel is on this page ───────────────────────────
 * A contract screen that only lists documents is a filing cabinet. The reason
 * this phase is worth a screen is the consequence: a signed contract RELEASES
 * a vendor to be ordered from, and an unsigned one blocks every line against
 * them. Showing that consequence next to the contracts is what makes signing
 * feel like the thing it is — releasing work — rather than paperwork.
 *
 * The same check runs on the server (flow.service.js#assertOrderable), so the
 * rule holds for anyone posting to the API and not only for people looking
 * at this page.
 */

const STATUS_TONE = {
  Signed: { color: 'var(--success)', soft: 'var(--success-soft)' },
  'Sent to vendor': { color: 'var(--info)', soft: 'var(--info-soft)' },
  'Under negotiation': { color: 'var(--warning)', soft: 'var(--warning-soft)' },
  Draft: { color: 'var(--ink-500)', soft: 'var(--surface-2)' },
  Cancelled: { color: 'var(--danger)', soft: 'var(--danger-soft)' },
};

const inr = (n) => {
  if (!n) return '₹0';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

export default function ContractsPage() {
  const { id } = useParams();
  const goBack = useGoBack(`/projects/${id}`);
  const { data: project } = useProject(id);
  const { data, isLoading, isError } = useGetFlowContractsQuery(id, { skip: !id });
  const { data: orders } = useGetOrderabilityQuery(id, { skip: !id });

  if (isLoading) return <><Topbar title="Contracts & Work Orders" /><div className="content"><SkDetail /></div></>;
  if (isError || !data) {
    return (
      <>
        <Topbar title="Contracts & Work Orders" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Could not load contracts" hint="Try again in a moment." />
        </div>
      </>
    );
  }

  const { contracts, counts, value, signedWithoutCopy } = data;

  return (
    <>
      <Topbar
        title="Phase 8 — Contracts & Work Orders"
        back={<button type="button" className="btn-ghost" onClick={goBack}><ArrowLeft size={16} /> Back</button>}
      />
      <div className="content">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Contracts &amp; work orders</h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0', maxWidth: '92ch', lineHeight: 1.6 }}>
            The BOQ says what and how much. The contract says <b>who, for how much money, by what date</b> —
            plus penalties and retention, which are the only things that make the date mean anything.
            Nothing is ordered on {project?.name || 'this project'} before a contract exists.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="card" style={{ padding: 15, flex: '1 1 170px' }}>
            <div style={{ fontSize: 23, fontWeight: 700, color: 'var(--success)' }}>{counts.signed}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Signed — vendors released to order</div>
          </div>
          <div className="card" style={{ padding: 15, flex: '1 1 170px' }}>
            <div style={{ fontSize: 23, fontWeight: 700, color: counts.draft ? 'var(--warning)' : 'var(--ink-400)' }}>
              {counts.draft}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Not yet signed — these block ordering</div>
          </div>
          <div className="card" style={{ padding: 15, flex: '1 1 170px' }}>
            <div style={{ fontSize: 23, fontWeight: 700 }}>{inr(value.signed)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Committed under signature{value.total !== value.signed ? ` · ${inr(value.total)} drafted` : ''}
            </div>
          </div>
          {orders && (
            <div className="card" style={{ padding: 15, flex: '1 1 170px' }}>
              <div style={{ fontSize: 23, fontWeight: 700, color: orders.blocked ? 'var(--danger)' : 'var(--success)' }}>
                {orders.blocked}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                BOQ lines blocked from ordering
              </div>
            </div>
          )}
        </div>

        {/* The consequence, stated where the decision is taken. */}
        {orders && (
          <div
            className="card"
            style={{
              padding: 16, marginBottom: 16, display: 'flex', gap: 14,
              borderLeft: `4px solid ${orders.blocked ? 'var(--danger)' : 'var(--success)'}`,
            }}
          >
            {orders.blocked
              ? <Ban size={20} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
              : <PackageCheck size={20} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5 }}>
                {orders.blocked
                  ? `${orders.blocked} BOQ line${orders.blocked === 1 ? '' : 's'} cannot be ordered yet`
                  : 'Every line that needs a purchase order has a signed contract behind it'}
              </div>
              <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, maxWidth: '92ch' }}>
                {orders.blocked ? (
                  <>
                    Signing a contract releases that vendor immediately.{' '}
                    {/* Only the vendors blocked FOR WANT OF A CONTRACT are named here.
                        A vendor whose contract is already signed can still have a
                        blocked line — because that line is unapproved — and naming
                        them would send somebody chasing a signature that exists. */}
                    {orders.awaitingContract?.length > 0 && (
                      <>Waiting on a signature from: <b>{orders.awaitingContract.join(', ')}</b>. </>
                    )}
                    {orders.awaitingApproval > 0 && (
                      <>
                        A further {orders.awaitingApproval} line{orders.awaitingApproval === 1 ? ' is' : 's are'}{' '}
                        held up by BOQ approval, not by a contract.{' '}
                      </>
                    )}
                    {orders.orderable > 0 && `${orders.orderable} line${orders.orderable === 1 ? ' is' : 's are'} already clear to order. `}
                    {orders.notApplicable > 0 && (
                      <>
                        A further {orders.notApplicable} {orders.notApplicable === 1 ? 'line is' : 'lines are'} earmarked
                        from Delhi stock or production and never become purchase orders at all.
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {orders.orderable} line{orders.orderable === 1 ? '' : 's'} clear to order
                    {orders.notApplicable > 0 && `; ${orders.notApplicable} earmarked from stock or production, which never become purchase orders`}.
                  </>
                )}
              </p>
              <Link to={`/projects/${id}/procurement`} style={{ fontSize: 12.5, display: 'inline-block', marginTop: 8 }}>
                Open the order tracker →
              </Link>
            </div>
          </div>
        )}

        {signedWithoutCopy.length > 0 && (
          <div
            className="card"
            style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 12, borderLeft: '4px solid var(--warning)' }}
          >
            <ShieldAlert size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                Marked signed, but no executed copy uploaded
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
                <b>{signedWithoutCopy.join(', ')}</b>. A contract with no document is a claim, not a
                contract — and it is currently releasing purchase orders. Attach the signed copy.
              </p>
            </div>
          </div>
        )}

        {!contracts.length ? (
          <EmptyState
            icon={FileSignature}
            title="No contracts yet"
            hint="Once a BOQ is approved, draft a work order for each vendor you will order from — scope, value, completion date, penalties and retention. Nothing can be ordered until one is signed."
            action={<Link className="btn-primary" to={`/projects/${id}/phase/p21`}>Draft a work order</Link>}
          />
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    {['Vendor', 'Covers', 'Value', 'Completion', 'Retention', 'Status'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === 'Value' || h === 'Retention' ? 'right' : 'left',
                          padding: '10px 15px', fontSize: 11, textTransform: 'uppercase',
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
                  {contracts.map((c) => {
                    const tone = STATUS_TONE[c.status] || STATUS_TONE.Draft;
                    return (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '11px 15px' }}>
                          <div style={{ fontWeight: 600 }}>{c.vendor || <span style={{ color: 'var(--ink-400)' }}>No vendor set</span>}</div>
                          {c.category && (
                            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{c.category}</div>
                          )}
                        </td>
                        <td style={{ padding: '11px 15px', fontSize: 12.5, color: 'var(--muted)' }}>
                          {c.boqType || '—'}
                        </td>
                        <td style={{ padding: '11px 15px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {inr(c.value)}
                        </td>
                        <td style={{ padding: '11px 15px', fontSize: 12.5 }}>
                          {c.completionDate ? fmtDate(c.completionDate)
                            : <span style={{ color: 'var(--warning)' }}>not set</span>}
                        </td>
                        <td style={{ padding: '11px 15px', textAlign: 'right', fontSize: 12.5 }}>
                          {c.retentionPct != null ? `${c.retentionPct}%` : '—'}
                        </td>
                        <td style={{ padding: '11px 15px' }}>
                          <Badge color={tone.color} soft={tone.soft}>
                            {c.signed && <CheckCircle2 size={12} style={{ marginRight: 5, verticalAlign: -2 }} />}
                            {c.status}
                          </Badge>
                          {c.signed && !c.hasSignedCopy && (
                            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>no copy attached</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 16, lineHeight: 1.7, maxWidth: '100ch' }}>
          Contracts are drafted and signed on the phase page, where each is a record with its own
          approval and audit trail — <Link to={`/projects/${id}/phase/p21`}>open Phase 8</Link>. The
          completion date recorded there is the vendor&apos;s promise, and every delay downstream is
          measured against it.
        </p>
      </div>
    </>
  );
}
