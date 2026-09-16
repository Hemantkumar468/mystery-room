import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The pager under every property table.
 *
 * WHAT IT SAYS, and why it says it. "26–50 of 412" rather than a bare page
 * number: somebody working a queue needs to know how much is left, and "page 2"
 * on its own answers neither "how far in am I" nor "how much more is there".
 *
 * WHY THE PAGE NUMBERS ARE WINDOWED. A 400-page queue cannot render 400
 * buttons. First and last are always reachable, the current page keeps two
 * neighbours either side, and the gaps collapse to an ellipsis — so the strip
 * is a fixed width whatever the total, and the two pages people actually jump
 * to (the start and the end) are always one click away.
 *
 * Rendered even on a single page, deliberately: the row count is useful on its
 * own, and a control that appears and disappears as you filter makes the
 * layout jump under the cursor.
 */

/** [1, '…', 7, 8, 9, '…', 42] — always the ends, always the neighbours. */
function pageWindow(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => pages.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => pages.add(n));

  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push(`gap-${prev}`);
    out.push(n);
    prev = n;
  }
  return out;
}

export function PropPager({ page, totalPages, total, limit, onPage, onLimit }) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div className="prop-pager">
      <span className="prop-pager-count">
        {total === 0 ? 'No rows' : <><b>{from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')}</b> of {total.toLocaleString('en-IN')}</>}
      </span>

      <div className="prop-pager-nav">
        <button
          type="button" className="prop-pager-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>

        {pageWindow(page, totalPages).map((n) => (
          typeof n === 'number' ? (
            <button
              key={n}
              type="button"
              className={`prop-pager-btn${n === page ? ' active' : ''}`}
              onClick={() => onPage(n)}
              aria-current={n === page ? 'page' : undefined}
            >
              {n}
            </button>
          ) : <span key={n} className="prop-pager-gap">…</span>
        ))}

        <button
          type="button" className="prop-pager-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <label className="prop-pager-size">
        Rows
        <select value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}

export default PropPager;
