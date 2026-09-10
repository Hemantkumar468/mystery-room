import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, AlertTriangle, CheckCircle2, Plus, Trash2, Save, ShieldAlert,
} from 'lucide-react';
import { useGoBack } from '../../../components/layout/BackButton.jsx';
import { Topbar } from '../../../components/layout/Topbar.jsx';
import { Badge, EmptyState } from '../../../components/ui/primitives.jsx';
import { SkDetail } from '../../../components/ui/Skeletons.jsx';
import { useGetRateCardQuery } from '../../../app/api/flowApi.js';
import {
  useCreateRecord, useUpdateRecord, useDeleteRecord, useUpdateRecordTracking,
} from '../../../app/api/recordsApi.js';

/**
 * Phase 6 — one vendor's rate card. SCR-06-02.
 *
 * Route: /projects/:id/vendor-panel/:vendorId
 *
 * ── What this screen is for ──────────────────────────────────────────
 * The rate card is what Phase 6 actually hands to Phase 7. A BOQ line is
 * quantity × rate, and the rate comes from here — so until this is confirmed,
 * that BOQ can be built but not approved.
 *
 * ── The one rule that is enforced, not merely asked ──────────────────
 * A site rate that differs from the panel's standard rate must say WHY. At
 * closure, when budget variance and vendor performance are being explained,
 * "why did this branch pay 12% more for partitions?" has to be answerable from
 * the record rather than from somebody's memory. The reason field is optional
 * in the schema — it does not apply when the rates match — and required
 * exactly when they differ, which is a rule about two fields together. The
 * server holds it too (flow.service.js#assertRateLineExplained), so it is not
 * merely a form validation somebody can POST around.
 *
 * ── Why the rows are Records ─────────────────────────────────────────
 * Each line is a Record with `assessmentType: 'rate_line'` and
 * `parentRecordId` pointing at the vendor — the same nesting Site Evaluation
 * uses for its four assessments. That gives every rate change an author, a
 * timestamp and a place in the activity trail without inventing a table.
 */

const UNITS = ['sq ft', 'running ft', 'nos', 'set', 'lot', 'kg', 'litre', 'day'];

const money = (n) => (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** A row being edited. Kept flat and local — one row at a time is saved. */
function RateRow({ line, projectId, vendorId, onSaved }) {
  const isNew = !line.id;
  const [draft, setDraft] = useState({
    item: line.item || '',
    unit: line.unit || 'nos',
    standard_rate: line.standardRate || '',
    site_rate: line.siteRate || '',
    override_reason: line.reason || '',
    valid_till: line.validTill ? String(line.validTill).slice(0, 10) : '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const create = useCreateRecord(projectId, 'p12');
  const update = useUpdateRecord(projectId, 'p12');
  const remove = useDeleteRecord(projectId, 'p12');

  const std = Number(draft.standard_rate) || 0;
  const site = Number(draft.site_rate) || 0;
  const overridden = std > 0 && site > 0 && std !== site;
  const needsReason = overridden && !String(draft.override_reason).trim();
  const delta = overridden ? Math.round(((site - std) / std) * 100) : 0;

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {
    setErr('');
    if (!String(draft.item).trim()) { setErr('Give the item a name.'); return; }
    if (!site) { setErr('Enter the rate for this site.'); return; }
    if (needsReason) { setErr('This rate differs from the standard one — say why.'); return; }
    setBusy(true);
    try {
      const values = { ...draft };
      if (isNew) {
        await create.mutateAsync({
          projectId, stageKey: 'p12', assessmentType: 'rate_line', parentRecordId: vendorId, values,
        });
      } else {
        await update.mutateAsync({ id: line.id, values });
      }
      onSaved?.();
    } catch (e) {
      /* The server holds the same rule. Surface its words rather than a
         generic failure — it is the message that says which rule was broken. */
      setErr(e?.data?.message || e?.message || 'Could not save that line.');
    } finally { setBusy(false); }
  };

  const del = async () => {
    setBusy(true);
    try { await remove.mutateAsync(line.id); onSaved?.(); } finally { setBusy(false); }
  };

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '8px 12px' }}>
        <input value={draft.item} onChange={set('item')} placeholder="Item" style={{ width: '100%', minWidth: 160 }} />
      </td>
      <td style={{ padding: '8px 12px' }}>
        <select value={draft.unit} onChange={set('unit')}>
          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <input
          type="number" value={draft.standard_rate} onChange={set('standard_rate')}
          placeholder="—" style={{ width: 100, textAlign: 'right' }}
        />
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <input
          type="number" value={draft.site_rate} onChange={set('site_rate')}
          style={{
            width: 100, textAlign: 'right',
            borderColor: overridden ? 'var(--warning)' : undefined,
          }}
        />
        {overridden && (
          <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>
            {delta > 0 ? '+' : ''}{delta}% vs standard
          </div>
        )}
      </td>
      <td style={{ padding: '8px 12px' }}>
        {overridden ? (
          <input
            value={draft.override_reason}
            onChange={set('override_reason')}
            placeholder="Why does it differ? (required)"
            style={{ width: '100%', minWidth: 180, borderColor: needsReason ? 'var(--danger)' : undefined }}
          />
        ) : (
          <span style={{ fontSize: 12, color: 'var(--ink-400)' }}>—</span>
        )}
      </td>
      <td style={{ padding: '8px 12px' }}>
        <input type="date" value={draft.valid_till} onChange={set('valid_till')} />
      </td>
      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>
          <Save size={13} /> {isNew ? 'Add' : 'Save'}
        </button>
        {!isNew && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={del} title="Remove this line">
            <Trash2 size={13} />
          </button>
        )}
        {err && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4, maxWidth: 220 }}>{err}</div>}
      </td>
    </tr>
  );
}

export default function VendorRateCardPage() {
  const { id, vendorId } = useParams();
  const goBack = useGoBack(`/projects/${id}/vendor-panel`);
  const { data, isLoading, isError, refetch } = useGetRateCardQuery(
    { projectId: id, vendorId }, { skip: !id || !vendorId },
  );
  const [adding, setAdding] = useState(false);
  const confirmCard = useUpdateRecordTracking(id, 'p12');
  const [confirmErr, setConfirmErr] = useState('');

  const lines = data?.lines || [];
  const vendor = data?.vendor;

  const stats = useMemo(() => {
    const overridden = lines.filter((l) => l.overridden);
    return {
      lines: lines.length,
      overrides: overridden.length,
      unexplained: overridden.filter((l) => !l.reason).length,
    };
  }, [lines]);

  useEffect(() => { if (!isLoading) setAdding(false); }, [lines.length, isLoading]);

  const confirm = async () => {
    setConfirmErr('');
    try {
      await confirmCard.mutateAsync({
        id: vendorId,
        values: { rate_confirmed: true },
        note: `Rate card confirmed — ${stats.lines} lines, ${stats.overrides} negotiated`,
      });
      refetch();
    } catch (e) {
      setConfirmErr(e?.data?.message || e?.message || 'Could not confirm the card.');
    }
  };

  if (isLoading) return <><Topbar title="Rate card" /><div className="content"><SkDetail /></div></>;
  if (isError || !data) {
    return (
      <>
        <Topbar title="Rate card" />
        <div className="content">
          <EmptyState icon={AlertTriangle} title="Could not load the rate card" hint="Try again in a moment." />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={`Rate card — ${vendor.name}`}
        back={<button type="button" className="btn-ghost" onClick={goBack}><ArrowLeft size={16} /> Panel</button>}
      />
      <div className="content">
        <div style={{ marginBottom: 14 }}>
          <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>{vendor.name}</h1>
          <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '6px 0 0', maxWidth: '90ch', lineHeight: 1.6 }}>
            {vendor.category || 'No panel category set'} — the rates this branch is charged. The BOQ that
            this category prices cannot be approved until the card is confirmed.
          </p>
        </div>

        <div
          className="card"
          style={{
            padding: 15, marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-start',
            borderLeft: `4px solid ${vendor.rateConfirmed ? 'var(--success)' : 'var(--warning)'}`,
          }}
        >
          {vendor.rateConfirmed
            ? <CheckCircle2 size={19} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
            : <ShieldAlert size={19} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {vendor.rateConfirmed ? 'Rate card confirmed' : 'Not yet confirmed'}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}>
              {stats.lines} line{stats.lines === 1 ? '' : 's'}
              {stats.overrides > 0 && ` · ${stats.overrides} negotiated away from the standard rate`}
              {stats.unexplained > 0 && (
                <b style={{ color: 'var(--danger)' }}> · {stats.unexplained} with no reason given</b>
              )}
            </p>
            {confirmErr && (
              <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--danger)' }}>{confirmErr}</p>
            )}
          </div>
          {!vendor.rateConfirmed && (
            <div style={{ textAlign: 'right' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={!stats.lines || stats.unexplained > 0}
                onClick={confirm}
              >
                Confirm this card
              </button>
              {/* Never a disabled button with no explanation. */}
              {(!stats.lines || stats.unexplained > 0) && (
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 5, maxWidth: 230 }}>
                  {!stats.lines
                    ? 'Add at least one rate line first.'
                    : `${stats.unexplained} negotiated rate${stats.unexplained === 1 ? '' : 's'} still need a reason.`}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 940 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  {['Item', 'Unit', 'Standard rate', 'Rate for this site', 'Why it differs', 'Valid till', ''].map((h, i) => (
                    <th
                      key={h || i}
                      style={{
                        textAlign: h.includes('rate') || h.includes('Rate') ? 'right' : 'left',
                        padding: '10px 12px', fontSize: 11, textTransform: 'uppercase',
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
                {lines.map((l) => (
                  <RateRow key={l.id} line={l} projectId={id} vendorId={vendorId} onSaved={refetch} />
                ))}
                {adding && (
                  <RateRow key="new" line={{}} projectId={id} vendorId={vendorId} onSaved={refetch} />
                )}
                {!lines.length && !adding && (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                      No rates yet. Add the lines this branch is charged against — the BOQ prices itself from them.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn-ghost" onClick={() => setAdding(true)} disabled={adding}>
              <Plus size={14} /> Add a rate line
            </button>
          </div>
        </div>

        {stats.overrides > 0 && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge color="var(--warning)" soft="var(--warning-soft)">
              {stats.overrides} negotiated rate{stats.overrides === 1 ? '' : 's'}
            </Badge>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Every one carries its reason into the closure report, where budget variance is explained.
            </span>
          </div>
        )}

        <p style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.7, maxWidth: '100ch' }}>
          Firm-level details — GST, PAN, bank, past performance — belong to the vendor once, not to this
          project: they live in <Link to="/vendors">the vendor master</Link>. What is per-site is only what
          is on this page: which team, at what rate.
        </p>
      </div>
    </>
  );
}
