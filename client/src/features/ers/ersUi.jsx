import { useState } from 'react';
import { Star, Info } from 'lucide-react';
import { ERS_STATUS } from '../../app/api/ersApi.js';

/**
 * The pieces the two ERS screens share — the avatar, the star rating, the
 * status pill and the score.
 *
 * Shared rather than repeated because the same employee appears on the podium,
 * in the table, in the drawer and in the outlet cards, and four copies of
 * "what colour is Perfect" is four chances for two of them to drift.
 */

/** 4,671 → "4,671". Indian grouping, because that is where this is read. */
export const n = (v) => Number(v || 0).toLocaleString('en-IN');

/** A score to two decimals — "4.79". Never rounded to a whole number: the gap
    between first and second place is often less than a tenth. */
export const score = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—');

/** "KRISHNAKANT KAILASH GUPTA" → "KK". Two letters; three is a monogram. */
const initials = (name) => String(name || '?')
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((w) => w[0])
  .join('')
  .toUpperCase() || '?';

/** A stable hue per name, so one person is one colour on every screen. */
const hueFor = (name) => {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 37 + s.charCodeAt(i)) % 360;
  return h;
};

/**
 * The employee's face.
 *
 * Falls back to initials on a hashed colour both when there is no photo and
 * when the photo FAILS to load — the second matters, because these URLs point
 * at somebody else's host and a table of broken-image glyphs would read as our
 * app being broken rather than their upload being missing.
 *
 * `rank` 1–3 gets a medal, which travels with the face wherever it is shown.
 */
export function Avatar({ name, photo, size = 34, rank, className = '', onClick }) {
  const [failed, setFailed] = useState(false);
  const px = `${size}px`;

  /* Clickable only when there is a real photo to enlarge. Offering a zoom
     cursor over a lettered fallback promises a bigger picture that does not
     exist. */
  const canOpen = Boolean(onClick && photo && !failed);

  return (
    <span
      className={`ers-ava ${canOpen ? 'is-zoomable ' : ''}${className}`}
      style={{ width: px, height: px, fontSize: Math.round(size * 0.36), '--h': hueFor(name) }}
      title={canOpen ? `${name} — click to enlarge` : name}
      onClick={canOpen ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      onKeyDown={canOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(); } } : undefined}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
    >
      {photo && !failed
        ? <img src={photo} alt="" loading="lazy" onError={() => setFailed(true)} />
        : initials(name)}
      {rank >= 1 && rank <= 3 && (
        <span className={`ers-medal${rank > 1 ? ` ers-medal--${rank}` : ''}`} aria-label={`Rank ${rank}`}>
          {rank}
        </span>
      )}
    </span>
  );
}

/** "4.85 ★" — the raw customer average, distinct from the composite score. */
export function Stars({ value, reviews, tone }) {
  if (!reviews) return <span className="tiny muted">No reviews</span>;
  return (
    <span
      className={`ers-stars${tone ? ` ers-num--${tone}` : ''}`}
      title={`${Number(value).toFixed(2)} average from ${n(reviews)} reviews`}
    >
      <b>{Number(value).toFixed(2)}</b>
      <Star size={12} fill="currentColor" />
    </span>
  );
}

/** The band, as the server sent it. See the note on ERS_STATUS. */
export function StatusPill({ status }) {
  const s = ERS_STATUS[status] || ERS_STATUS['No reviews'];
  return <span className={`ers-pill ers-pill--${s.key}`} title={s.hint}>{s.label}</span>;
}

/**
 * The rank number, or a quiet dash for somebody with no reviews to rank.
 * The top three are tinted gold / silver / bronze so the podium is legible
 * from the number alone, not only from the medal on the avatar.
 */
export function RankCell({ rank }) {
  if (!rank) return <span className="ers-rank ers-rank--none" title="Not ranked — no reviews yet">—</span>;
  return <span className={`ers-rank${rank <= 3 ? ` ers-rank--p${rank}` : ''}`}>{rank}</span>;
}

/* ── colour coding ───────────────────────────────────────────────────── */

/**
 * The tone a figure is drawn in.
 *
 * DELIBERATELY RESTRAINED. Only three columns are coloured — rating, positive
 * share and CPS — because those are the three you scan a leaderboard FOR.
 * Colouring every number would leave nothing standing out, which is the same
 * as colouring none of them.
 *
 * The thresholds match the bands the review service itself uses (4.8 / 4.0),
 * so a green rating and a "Perfect" pill can never disagree on the same row.
 */
export const ratingTone = (v, reviews) => {
  if (!reviews) return 'none';
  if (v >= 4.8) return 'good';
  if (v >= 4.0) return 'mid';
  return 'bad';
};

/** Positive share. 100% is genuinely notable, so it gets its own step. */
export const positiveTone = (v, reviews) => {
  if (!reviews) return 'none';
  if (v >= 99) return 'good';
  if (v >= 90) return 'mid';
  return 'bad';
};

/**
 * CPS against the top of the board rather than an absolute scale.
 *
 * A composite score has no natural ceiling — the best on this board is 4.79,
 * not 5 — so "is 4.13 good?" only means anything next to the leader. Shading
 * by share of the top score answers that; a fixed threshold would paint the
 * whole table one colour the moment standards shifted.
 */
export const cpsTone = (v, best) => {
  if (!v) return 'none';
  const share = best ? v / best : 0;
  if (share >= 0.9) return 'good';
  if (share >= 0.75) return 'mid';
  return 'bad';
};

/**
 * A little "i" that explains the column it sits beside.
 *
 * CSS-only rather than a JS popover: these sit inside a sticky table heading,
 * and a positioned portal fighting a sticky ancestor is a class of bug not
 * worth buying for a tooltip. It is focusable, so the explanation is reachable
 * from the keyboard and not only on hover.
 */
export function InfoTip({ children, align = 'left' }) {
  return (
    <span className={`ers-tip ers-tip--${align}`} tabIndex={0} role="note">
      <Info size={11} aria-hidden="true" />
      <span className="ers-tip-body">{children}</span>
    </span>
  );
}

/**
 * What CPS is, inside the column's tooltip.
 *
 * Reads the formula the review service publishes rather than restating it
 * here — their weights are their business, and a hard-coded "70/20/10" would
 * go quietly wrong the day they tune it. Falls back to a plain sentence if the
 * upstream response carries no formula.
 */
export function CpsExplainer({ formula }) {
  if (!formula) {
    return (
      <>
        <b>Composite Performance Score.</b> Blends rating quality, review volume
        and consistency into one number. The board is ranked by it.
      </>
    );
  }
  return (
    <>
      <b>{formula.name}</b>
      <code>{formula.final_formula}</code>
      {(formula.components || []).map((c) => (
        <span key={c.symbol} style={{ display: 'block', marginTop: 4 }}>
          <b>{c.weight} {c.name}</b> — {c.explanation}
        </span>
      ))}
    </>
  );
}
