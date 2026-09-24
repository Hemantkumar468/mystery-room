import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown, Package } from 'lucide-react';

/**
 * The small pieces the inventory master and the IMS both draw with.
 *
 * They live here rather than in either page because the two modules are one
 * product to the person using them — the same SKU, the same category pill, the
 * same thumbnail, the same pager — and two copies of "what colour is
 * Electrical" is two copies that drift.
 */

/** 1,322 → "1,322". Indian grouping, because that is where this is read. */
export const n = (v) => Number(v || 0).toLocaleString('en-IN');

/**
 * ₹45 · ₹1,250 · ₹12.50 — and `null` for a price nobody has set.
 *
 * The distinction matters enough to carry all the way to the screen: an
 * unpriced item is not a free one, and rendering `₹0` for it would put a wrong
 * number in front of somebody about to total a stock position.
 */
export function money(v, { blank = '—' } = {}) {
  if (v == null || v === '') return blank;
  const num = Number(v);
  if (!Number.isFinite(num)) return blank;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * A stable hue per category name.
 *
 * WHY HASHED RATHER THAN A COLOUR MAP. There are twenty-one categories today
 * and somebody adds one on the Categories screen this afternoon; a hand-kept
 * map would either not have a colour for it or would need editing every time.
 * The hash gives every name its own hue for ever, with no list to maintain —
 * and the same name is always the same colour, which is the only property that
 * actually matters for scanning a long table.
 *
 * The 37 multiplier and the spread over 360 are just a cheap way to keep
 * near-identical names ("Electrical" / "Electronics") far apart on the wheel.
 */
export function hueFor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 37 + s.charCodeAt(i)) % 360;
  return h;
}

export function CategoryPill({ value, className = '' }) {
  if (!value) return <span className="inv-muted">—</span>;
  return (
    <span className={`inv-pill ${className}`} style={{ '--h': hueFor(value) }} title={value}>
      {value}
    </span>
  );
}

/** Listed / Unlisted / Archived, as the reference draws them — a dot then a word. */
export function VisibilityTag({ value, archived = false }) {
  if (archived) return <span className="inv-tag inv-tag--archived">Archived</span>;
  const v = value === 'Listed' ? 'Listed' : 'Unlisted';
  return <span className={`inv-tag inv-tag--${v.toLowerCase()}`}>{v}</span>;
}

/**
 * The item thumbnail.
 *
 * Falls back to a neutral package glyph both when there is no URL and when the
 * URL FAILS. The second case is the one that matters: the master has 1,322 rows
 * with no picture yet, and a table of broken-image icons reads as an app that is
 * broken rather than a catalogue that is incomplete.
 *
 * A GLYPH, NOT THE NAME'S FIRST LETTER. That was the first attempt, and half
 * this catalogue is named "0.5 W LED Bulb" or "12V DC White LED" — the tile
 * rendered a bare "0" or "1" in the column next to the row number, which reads
 * as data rather than as "no picture".
 */
export function Thumb({ src, alt, size = 38, radius = 9, className = '' }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderRadius: radius };

  if (!src || failed) {
    return (
      <div className={`inv-thumb inv-thumb--empty ${className}`} style={style} aria-hidden="true" title="No picture yet">
        <Package size={Math.max(12, Math.round((typeof size === 'number' ? size : 38) * 0.45))} />
      </div>
    );
  }
  return (
    <img
      className={`inv-thumb ${className}`}
      style={style}
      src={src}
      alt={alt || ''}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** [1, '…', 7, 8, 9, '…', 42] — always the ends, always the neighbours. */
export function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push(`gap-${prev}`);
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * "51–100 of 1,322" and the numbered strip.
 *
 * Says the RANGE, not just the page: somebody working a list this long needs
 * to know how far in they are and how much is left, and a page number alone
 * answers neither. Rendered even on a single page, so the layout does not jump
 * under the cursor as a filter narrows the result.
 */
export function Pager({ page, totalPages, total, limit, onPage, noun = 'items' }) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="inv-pager">
      <span className="inv-pager-count">
        {total === 0 ? `No ${noun}` : <>Showing <b>{n(from)}–{n(to)}</b> of <b>{n(total)}</b> {noun}</>}
      </span>

      <div className="inv-pager-nav">
        <button type="button" className="inv-pager-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={14} />
        </button>
        {pageWindow(page, totalPages).map((p) => (
          typeof p === 'number' ? (
            <button
              key={p}
              type="button"
              className={`inv-pager-btn${p === page ? ' is-current' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
            >
              {p}
            </button>
          ) : <span key={p} className="inv-pager-gap">…</span>
        ))}
        <button type="button" className="inv-pager-btn" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/**
 * A sortable column heading. The arrow is not decoration — the sort is
 * server-side, so it says what the NEXT page will be ordered by. A third click
 * clears back to the default rather than cycling round, because "put it back
 * how it was" is a thing people want and otherwise cannot get.
 */
export function SortHead({ label, sortKey, sort, onSort, align }) {
  if (!sortKey) return <>{label}</>;
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      className={`inv-sort${active ? ' is-active' : ''}`}
      onClick={() => onSort(sortKey)}
      title={active ? 'Click again to reverse, once more to clear' : `Sort by ${String(label).toLowerCase()}`}
      style={align === 'right' ? { marginLeft: 'auto' } : undefined}
    >
      {label}
      <Icon className="inv-sort-icon" size={12} />
    </button>
  );
}

/**
 * A labelled dropdown in the filter bar — the label floats above the control.
 *
 * `width` is a FIXED width, not a minimum, and that distinction is the whole
 * reason the filter bar used to spill onto a second row. A bare `<select>`
 * sizes itself to its longest `<option>`: the Vendor filter holds 148 supplier
 * names, and "2getherz marketing private limited" alone was making that one
 * control ~300px wide. Pinning the width lets the chosen value ellipsise
 * instead, which is what every other truncated cell on these pages already
 * does — and the full text is still there the moment the list is opened.
 */
export function FilterSelect({ label, value, onChange, children, width }) {
  return (
    <label className="inv-select" style={width ? { width, flexBasis: width } : undefined}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}
