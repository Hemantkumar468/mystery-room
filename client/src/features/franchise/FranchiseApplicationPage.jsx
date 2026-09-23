/**
 * One franchise application, on its own URL — /franchise/enquiries/:id.
 *
 * Everything the applicant sent, readable in one place: who they are, and
 * every property they brought — details, photos, walkthrough videos, Google
 * Drive links, documents — each property openable on its own.
 *
 * The decision lives here too, because the decision NEEDS this much context.
 * Three roads, chosen explicitly:
 *   Shortlist & assess — tick the promising properties; the project starts at
 *     Phase 1-2 with every property filed and the ticked ones shortlisted,
 *     then the normal assessment picks the winner.
 *   Straight to LOI — one obvious property; Phases 1-2 close themselves and
 *     the project stands at Phase 3 with that property approved as the site.
 *   Start the property search — they have no property yet; the project starts
 *     at Phase 1 in their city of interest.
 */
import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Phone, Mail, MapPin, Building2, IndianRupee, CheckCircle2, XCircle,
  FolderKanban, AlertTriangle, ChevronDown, ChevronRight, Video, FileText,
  Link2, ClipboardCheck, FileSignature, Search,
} from 'lucide-react';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { SectionCard, EmptyState, Badge, PageLoader } from '../../components/ui/primitives.jsx';
import { flashSuccess } from '../../components/ui/SuccessFlash.jsx';
import { useGetFranchiseEnquiryQuery, useDecideFranchiseEnquiryMutation } from '../../app/api/franchiseApi.js';
import { useAppSelector } from '../../app/hooks.js';
import { selectCurrentUser } from '../../app/slices/authSlice.js';
import { can } from '../../lib/roles.js';
import { fmtDateTime } from '../../lib/format.js';
import { ENQUIRY_STATUS_META, OWNERSHIP_LABEL, mapsLinkFor } from './franchiseUi.js';
import './franchise.css';

/** One property, expandable — all its facts and every file they attached. */
function PropertyCard({ prop, index, open, onToggle, selectable, selected, onSelect }) {
  const maps = mapsLinkFor(prop.location);
  const title = prop.label || `${prop.locality || prop.city} property`;
  const filesCount = (prop.photos?.length || 0) + (prop.videos?.length || 0)
    + (prop.documents?.length || 0) + (prop.driveLinks?.length || 0);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="row gap-2"
        style={{ alignItems: 'center', padding: '10px 14px', cursor: 'pointer', background: selected ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : undefined }}
        onClick={onToggle}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <div className="col grow" style={{ minWidth: 0 }}>
          <span className="sm" style={{ fontWeight: 650 }}>{index + 1}. {title}</span>
          <span className="tiny muted">
            {prop.city}{prop.locality ? ` · ${prop.locality}` : ''}
            {prop.carpetAreaSqft ? ` · ${Number(prop.carpetAreaSqft).toLocaleString('en-IN')} sq ft` : ''}
            {filesCount ? ` · ${filesCount} file${filesCount === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        {selectable && (
          <label className="row gap-1" style={{ alignItems: 'center', fontSize: 13, fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={onSelect} /> Shortlist
          </label>
        )}
      </div>

      {open && (
        <div className="col gap-3" style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--border)' }}>
          <div className="fr-facts" style={{ marginTop: 10 }}>
            <div><span className="fr-k">City</span><span className="fr-v">{prop.city}{prop.locality ? ` · ${prop.locality}` : ''}</span></div>
            <div><span className="fr-k">Carpet area</span><span className="fr-v">{prop.carpetAreaSqft ? `${Number(prop.carpetAreaSqft).toLocaleString('en-IN')} sq ft` : '—'}</span></div>
            <div><span className="fr-k">Floor</span><span className="fr-v">{prop.floor || '—'}</span></div>
            <div><span className="fr-k">Frontage</span><span className="fr-v">{prop.frontage || (prop.frontageFt ? `${prop.frontageFt} ft` : '—')}</span></div>
            <div><span className="fr-k">Ownership</span><span className="fr-v">{OWNERSHIP_LABEL[prop.ownership] || prop.ownership || '—'}</span></div>
          </div>
          <div>
            <span className="fr-k"><Building2 size={10} /> Address</span>
            <p className="sm" style={{ margin: '2px 0 0' }}>
              {prop.address}
              {maps && <> · <a href={maps} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}><MapPin size={11} /> map pin</a></>}
            </p>
          </div>

          {(prop.photos || []).length > 0 && (
            <div className="col gap-1">
              <span className="fr-k">Photos</span>
              <div className="fr-photos">
                {prop.photos.map((p, i) => (
                  <a key={p.url || i} href={p.url} target="_blank" rel="noreferrer" title={p.name || `photo ${i + 1}`}>
                    <img src={p.url} alt={p.name || `Property photo ${i + 1}`} loading="lazy" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {(prop.videos || []).length > 0 && (
            <div className="col gap-1">
              <span className="fr-k"><Video size={10} /> Walkthrough videos</span>
              <div className="row gap-2 wrap">
                {prop.videos.map((v, i) => (
                  <video key={v.url || i} src={v.url} controls preload="metadata" style={{ maxWidth: 320, width: '100%', borderRadius: 8, border: '1px solid var(--border)' }} />
                ))}
              </div>
            </div>
          )}

          {(prop.driveLinks || []).length > 0 && (
            <div className="col gap-1">
              <span className="fr-k"><Link2 size={10} /> Drive links</span>
              {prop.driveLinks.map((l, i) => (
                <a key={i} className="sm" href={l} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', overflowWrap: 'anywhere' }}>{l}</a>
              ))}
            </div>
          )}

          {(prop.documents || []).length > 0 && (
            <div className="col gap-1">
              <span className="fr-k"><FileText size={10} /> Documents</span>
              {prop.documents.map((d, i) => (
                <a key={d.url || i} className="sm" href={d.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{d.name || `document ${i + 1}`}</a>
              ))}
            </div>
          )}

          {prop.remarks && (
            <div className="col gap-1">
              <span className="fr-k">In their words</span>
              <p className="fr-quote">{prop.remarks}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FranchiseApplicationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const canDecide = can.decide(user?.role);

  const { data: e, isLoading } = useGetFranchiseEnquiryQuery(id);
  const [decide, { isLoading: deciding }] = useDecideFranchiseEnquiryMutation();

  const props = useMemo(() => e?.properties || [], [e]);
  const [openIdx, setOpenIdx] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [road, setRoad] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  if (isLoading) return (<><Topbar title="Franchise Application" /><PageLoader /></>);
  if (!e) {
    return (
      <><Topbar title="Franchise Application" />
        <div className="content"><EmptyState icon={AlertTriangle} title="Application not found" hint="It may have been removed. Go back to the enquiries list." /></div>
      </>
    );
  }

  const meta = ENQUIRY_STATUS_META[e.status] || {};
  const pending = e.status === 'submitted';
  const phone = String(e.phone || '').replace(/[^\d]/g, '');
  const wa = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}` : null;
  const hasProps = props.length > 0;
  /* Default road once data is here: one property → LOI, several → assess. */
  const activeRoad = road || (!hasProps ? 'scout' : props.length === 1 ? 'loi' : 'assess');

  const toggleSelect = (pid) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const chosenIds = [...selected];
  const roadReady =
    activeRoad === 'scout' ? true
      : activeRoad === 'assess' ? chosenIds.length >= 1
        : (props.length === 1 || chosenIds.length === 1);

  const approve = async () => {
    setError(null);
    try {
      const out = await decide({
        id: e._id, decision: 'approve', mode: activeRoad,
        propertyIds: activeRoad === 'scout' ? [] : (chosenIds.length ? chosenIds : props.slice(0, 1).map((p) => String(p._id))),
      }).unwrap();
      flashSuccess({
        assess: 'Approved — project created; the shortlisted properties go to assessment',
        loi: 'Approved — project created at Phase 3 (LOI)',
        scout: 'Approved — project created; the property search starts',
      }[activeRoad]);
      const pid = out?.project?._id || out?.project;
      if (pid) navigate(`/projects/${pid}`);
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not approve right now.');
    }
  };

  const reject = async () => {
    setError(null);
    if (!reason.trim()) { setError('Say why — the reason is the record of this decision.'); return; }
    try {
      await decide({ id: e._id, decision: 'reject', reason: reason.trim() }).unwrap();
      flashSuccess('Application rejected');
      setRejecting(false);
    } catch (err) {
      setError(err?.data?.message || err?.message || 'Could not reject right now.');
    }
  };

  const roadCard = (key, icon, title, hint, disabled) => {
    const Icon = icon;
    const on = activeRoad === key;
    return (
      <button
        type="button"
        className="col gap-1"
        style={{
          flex: 1, minWidth: 200, textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
          border: on ? '2px solid var(--primary)' : '1px solid var(--border)',
          background: on ? 'color-mix(in srgb, var(--primary) 7%, transparent)' : 'var(--surface)',
          opacity: disabled ? 0.5 : 1,
        }}
        onClick={() => !disabled && setRoad(key)}
      >
        <span className="row gap-1" style={{ alignItems: 'center', fontWeight: 700, fontSize: 13.5 }}><Icon size={14} /> {title}</span>
        <span className="tiny muted">{hint}</span>
      </button>
    );
  };

  return (
    <>
      <Topbar title={`${e.name} — Franchise Application`} />
      <div className="content">
        <div className="content-narrow col gap-3 fade-in">

          <SectionCard title="The applicant">
            <div className="col gap-3">
              <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge color={meta.color} soft={meta.soft} dot>{meta.label || e.status}</Badge>
                <span className="tiny muted">Applied {fmtDateTime(e.createdAt)}</span>
                {wa && <a className="btn btn-ghost btn-sm" href={wa} target="_blank" rel="noreferrer"><Phone size={12} /> WhatsApp {e.phone}</a>}
                {e.email && <a className="btn btn-ghost btn-sm" href={`mailto:${e.email}`}><Mail size={12} /> {e.email}</a>}
              </div>

              {e.status === 'approved' && (
                <p className="fr-decided is-approved">
                  <CheckCircle2 size={13} /> Approved by {e.decidedBy?.name || 'someone'} on {fmtDateTime(e.decidedAt)}
                  {e.decisionMode ? ` — ${{ assess: 'shortlisted for assessment', loi: 'straight to LOI', scout: 'property search started' }[e.decisionMode]}` : ''}.
                  {e.project && <> Project: <Link to={`/projects/${e.project._id || e.project}`}><FolderKanban size={12} /> {e.project.name || 'open'}</Link></>}
                </p>
              )}
              {e.status === 'rejected' && (
                <p className="fr-decided is-rejected">
                  <XCircle size={13} /> Rejected by {e.decidedBy?.name || 'someone'} on {fmtDateTime(e.decidedAt)}{e.rejectReason ? ` — ${e.rejectReason}` : ''}.
                </p>
              )}

              <div className="fr-facts">
                <div><span className="fr-k"><IndianRupee size={10} /> Investment</span><span className="fr-v">{e.investmentReady || '—'}</span></div>
                <div><span className="fr-k">Properties brought</span><span className="fr-v">{hasProps ? props.length : 'None — interested'}</span></div>
                {!hasProps && <div><span className="fr-k">City of interest</span><span className="fr-v">{e.interestCity || '—'}{e.interestArea ? ` · ${e.interestArea}` : ''}</span></div>}
              </div>

              {e.background && (
                <div className="col gap-1"><span className="fr-k">Their background</span><p className="fr-quote">{e.background}</p></div>
              )}
              {!hasProps && e.plan && (
                <div className="col gap-1"><span className="fr-k">Their plan</span><p className="fr-quote">{e.plan}</p></div>
              )}
              {e.message && (
                <div className="col gap-1"><span className="fr-k">In their words</span><p className="fr-quote">{e.message}</p></div>
              )}
            </div>
          </SectionCard>

          {hasProps && (
            <SectionCard title={`Properties (${props.length})`}>
              <div className="col gap-2">
                {pending && canDecide && props.length > 1 && (
                  <p className="tiny muted" style={{ margin: 0 }}>
                    Open each property to review it, and tick <b>Shortlist</b> on the ones worth assessing.
                  </p>
                )}
                {props.map((p, i) => (
                  <PropertyCard
                    key={String(p._id)}
                    prop={p}
                    index={i}
                    open={openIdx === i}
                    onToggle={() => setOpenIdx((cur) => (cur === i ? -1 : i))}
                    selectable={pending && canDecide}
                    selected={selected.has(String(p._id))}
                    onSelect={() => toggleSelect(String(p._id))}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          {pending && canDecide && (
            <SectionCard title="The decision">
              <div className="col gap-3">
                <div className="row gap-2 wrap">
                  {hasProps && roadCard('assess', ClipboardCheck, 'Shortlist & assess',
                    'Project starts at Phase 1–2: every property filed, the ticked ones shortlisted; assessment picks the winner, then LOI.',
                    false)}
                  {hasProps && roadCard('loi', FileSignature, 'Straight to LOI',
                    props.length === 1
                      ? 'This property becomes the approved site; Phases 1–2 close themselves; the project stands at Phase 3.'
                      : 'Tick exactly one property — it becomes the approved site and the project stands at Phase 3.',
                    false)}
                  {!hasProps && roadCard('scout', Search, 'Start the property search',
                    `Project starts at Phase 1 — scouting in ${e.interestCity || 'their city'} together with the partner.`,
                    false)}
                </div>

                {activeRoad === 'assess' && chosenIds.length === 0 && (
                  <p className="tiny" style={{ color: 'var(--warning, #b45309)', margin: 0 }}>Tick at least one property above to shortlist it.</p>
                )}
                {activeRoad === 'loi' && props.length > 1 && chosenIds.length !== 1 && (
                  <p className="tiny" style={{ color: 'var(--warning, #b45309)', margin: 0 }}>Straight to LOI needs exactly one ticked property.</p>
                )}

                {rejecting ? (
                  <div className="col gap-2">
                    <label className="label" htmlFor="fr-reason">Why not? (kept on the application)</label>
                    <textarea id="fr-reason" className="textarea" rows={3} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Too close to our Agra centre; area under 2,000 sq ft; not investment-ready" autoFocus />
                    <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-ghost" onClick={() => setRejecting(false)} disabled={deciding}>Back</button>
                      <button type="button" className="btn btn-danger" onClick={reject} disabled={deciding}>
                        <XCircle size={14} /> {deciding ? 'Saving…' : 'Reject with this reason'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-subtle" onClick={() => setRejecting(true)} disabled={deciding}>
                      <XCircle size={14} /> Reject
                    </button>
                    <button type="button" className="btn btn-primary" onClick={approve} disabled={deciding || !roadReady}>
                      <CheckCircle2 size={14} /> {deciding ? 'Creating the project…' : 'Approve — create the project'}
                    </button>
                  </div>
                )}
                {error && <div className="pt-alert pt-alert--bad"><AlertTriangle size={14} /> {error}</div>}
              </div>
            </SectionCard>
          )}

          {pending && !canDecide && (
            <p className="tiny muted">Only leadership and managers can decide an application.</p>
          )}
        </div>
      </div>
    </>
  );
}

export default FranchiseApplicationPage;
