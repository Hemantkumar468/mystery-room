import { useState } from 'react';
import { Modal } from '../../components/ui/Modal.jsx';
import { Lightbox } from '../../components/ui/Lightbox.jsx';
import { useGetErsEmployeeQuery } from '../../app/api/ersApi.js';
import { Avatar, StatusPill, Stars, n, score } from './ersUi.jsx';

/**
 * One employee's performance, opened from any row, card or podium tile.
 *
 * READ-ONLY, like everything in this module — there is nothing here to save,
 * because the ratings belong to the review service and this ERP only shows
 * them.
 *
 * IT EXPLAINS ITS OWN SCORE. The bottom panel prints the actual CPS formula
 * the review service publishes, with its three weights. That is not decoration:
 * this is a number people are ranked and compared by, and a ranking that
 * cannot answer "why am I fourth?" is one that gets argued with rather than
 * acted on.
 */

/** "16 Mar 2026" — join dates are read, not calculated with. */
const when = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Metric({ label, value, lead = false, title }) {
  return (
    <div className={`ers-metric${lead ? ' is-lead' : ''}`} title={title}>
      <span className="ers-metric-label">{label}</span>
      <span className="ers-metric-value">{value}</span>
    </div>
  );
}

/** One of the five scopes, as a bar. The percentile is what the bar fills to. */
function RankRow({ label, rank }) {
  if (!rank) return null;
  const pct = Math.max(2, Math.min(100, Number(rank.percentile) || 0));
  return (
    <div className="ers-rankrow">
      <span className="ers-rankrow-label">{label}</span>
      <span className="ers-rankbar" title={`${pct}th percentile`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="ers-rankrow-val">
        <b>{rank.rank}</b> of {n(rank.total)}
      </span>
    </div>
  );
}

export default function EmployeeDrawer({ employeeId, period, onClose }) {
  /* -1 is "closed" — the Lightbox's own convention, so the drawer does not
     invent a second one. */
  const [photo, setPhoto] = useState(-1);

  const { data: raw, isLoading, isError } = useGetErsEmployeeQuery(
    { id: employeeId, ...(period ? { period } : {}) },
    { skip: !employeeId },
  );

  if (!employeeId) return null;

  const payload = raw?.employee ? raw : (raw?.data ?? {});
  const e = payload.employee;
  const peers = payload.peers || [];
  const formula = payload.formula;

  /* The subject first, then their outlet-mates — only those with a real photo,
     because a lettered fallback has nothing to enlarge. */
  const photos = [e, ...peers]
    .filter((p) => p?.photo)
    .map((p) => ({ id: p.id, url: p.photo, name: `${p.name}${p.position ? ` — ${p.position}` : ''}` }));

  /**
   * Escape closes the photo viewer, NOT the drawer behind it.
   *
   * Both listen for Escape on `window`, so one press reached both and the
   * drawer vanished along with the picture — you pressed Escape to stop
   * looking at a face and lost the whole profile. The drawer registers its
   * listener first (it mounts first), so it sees the viewer still open and
   * declines; the viewer's own handler then closes just itself.
   */
  const closeDrawer = () => {
    if (photo >= 0) return;
    onClose();
  };

  return (
    <Modal
      open
      onClose={closeDrawer}
      variant="drawer"
      width={null}
      title={e?.name || 'Employee'}
      subtitle={e ? `${e.position || '—'}${e.code ? ` · ${e.code}` : ''}` : ''}
      footer={(
        <div className="row gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      )}
    >
      {isLoading ? (
        <span className="tiny muted">Loading…</span>
      ) : isError || !e ? (
        <div className="pt-alert pt-alert--bad">Could not load this employee from the review service.</div>
      ) : (
        <div className="ers-drawer">
          <div className="ers-hero">
            <Avatar name={e.name} photo={e.photo} size={64} rank={e.rank} onClick={() => setPhoto(photos.findIndex((x) => x.id === e.id))} />
            <div style={{ minWidth: 0 }}>
              <div className="ers-hero-name">{e.name}</div>
              <div className="ers-hero-meta">
                {[e.outlet, e.city, e.brand].filter(Boolean).join(' · ')}
              </div>
              <div className="row gap-2" style={{ marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <StatusPill status={e.status} />
                <Stars value={e.avgRating} reviews={e.totalReviews} />
              </div>
            </div>
          </div>

          {/* The eight figures the review service publishes per employee. CPS
              leads because it is the one the ranking is actually sorted by. */}
          <div className="col gap-2">
            <h3 className="inv-section-title">Performance</h3>
            <div className="ers-metrics">
              <Metric label="CPS" value={score(e.cps)} lead title="Composite Performance Score — what the ranking sorts by" />
              <Metric label="Avg rating" value={e.totalReviews ? Number(e.avgRating).toFixed(2) : '—'} title="Raw customer average" />
              <Metric label="Reviews" value={n(e.totalReviews)} />
              <Metric label="Positive" value={`${Math.round(e.positivePct)}%`} title="Share of ratings that were positive" />
              <Metric label="Bayesian" value={score(e.bayesian)} title="Rating adjusted for how many reviews it is based on" />
              <Metric label="Consistency σ" value={Number(e.stddev).toFixed(3)} title="Spread of their ratings — lower is steadier" />
              <Metric label="Volume bonus" value={score(e.volumeBonus)} title="Out of 5" />
              <Metric label="Steadiness bonus" value={score(e.consistencyBonus)} title="Out of 5" />
            </div>
          </div>

          {/* The same person, ranked at five widths. A percentile answers "is
              first of six impressive?" in a way a rank alone cannot. */}
          <div className="col gap-2">
            <h3 className="inv-section-title">Standing</h3>
            <div className="ers-ranks">
              <RankRow label="Global" rank={e.ranks?.global} />
              <RankRow label="Country" rank={e.ranks?.country} />
              <RankRow label="State" rank={e.ranks?.state} />
              <RankRow label="City" rank={e.ranks?.city} />
              <RankRow label="Outlet" rank={e.ranks?.outlet} />
            </div>
          </div>

          <div className="ers-metrics">
            <Metric label="Outlet" value={e.outlet || '—'} />
            <Metric label="City" value={e.city || '—'} />
            <Metric label="State" value={e.state || '—'} />
            <Metric label="Joined" value={when(e.joinDate)} />
          </div>

          {peers.length > 0 && (
            <div className="col gap-2">
              <h3 className="inv-section-title">Others at {e.outlet}</h3>
              <div className="col gap-1">
                {peers.map((p) => (
                  <div key={p.id} className="ims-row">
                    <Avatar name={p.name} photo={p.photo} size={28} onClick={() => setPhoto(photos.findIndex((x) => x.id === p.id))} />
                    <span className="ims-row-main">
                      <span className="ims-row-name">{p.name}</span>
                      <span className="ims-row-sub">{p.position || '—'}</span>
                    </span>
                    <span className="ers-cps">{score(p.cps)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {formula && (
            <details className="col gap-2">
              <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--primary)' }}>
                How is this score calculated?
              </summary>
              <div className="ers-formula" style={{ marginTop: 8 }}>
                <p className="inv-hint">{formula.description}</p>
                <div className="ers-formula-eq">{formula.final_formula}</div>
                {(formula.components || []).map((c) => (
                  <div key={c.symbol} className="ers-weight">
                    <span className="ers-weight-pct">{c.weight}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="ers-weight-name">{c.name}</span>
                      <span className="ers-weight-txt">{c.explanation}</span>
                    </span>
                  </div>
                ))}
                <span className="tiny muted">{formula.ranking_method}</span>
              </div>
            </details>
          )}
        </div>
      )}

      {/* The profile photo, full size. The viewer sits at z-index 300 — above
          this drawer's 60 — so it covers the whole window rather than opening
          inside a 46vw panel, which is the point of looking at it properly.
          The peers ride along after the subject, so arrowing through the team
          works without a second component. */}
      <Lightbox
        items={photos}
        index={photo}
        onClose={() => setPhoto(-1)}
        onIndex={setPhoto}
      />
    </Modal>
  );
}
