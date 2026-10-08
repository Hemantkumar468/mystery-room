import { useMemo, useRef, useState, useEffect } from 'react';
import { useCaptureLabels } from './captureLabels.js';
import { TruncatedText } from '../../components/ui/TruncatedText.jsx';

/**
 * The table every property step renders.
 *
 * ONE COMPONENT, FOUR STEPS. The four steps had four hand-written tables, which
 * is how they ended up disagreeing about column widths and how a layout bug
 * fixed on one of them survived on the other three. A step now declares WHAT
 * its columns are; how a table scrolls, sticks and sorts lives here.
 *
 * WHY THE TABLE CARRIES AN EXPLICIT PIXEL WIDTH. `table-layout: fixed` with
 * `width: 100%` treats a <colgroup> as RATIOS, not sizes: the browser fits the
 * table to its container and squeezes every column proportionally, so a
 * 1,482px set of columns silently became 1,190px of clipped text and nothing
 * scrolled at all. Setting the table's width to the SUM of its columns is what
 * makes it genuinely wider than the container, which is what gives the wrapper
 * something to scroll. `minWidth: 100%` then stops a narrow table from
 * stranding itself on a wide screen.
 *
 * WHICH COLUMNS STICK. Two, at the two edges. The first column sticks on the
 * left because it is what identifies the row — the place, the property, the
 * number — and a row of figures with its name scrolled away is unreadable. A
 * column declaring `pin: 'right'` sticks on the right, and that is where the
 * ACTION column lives: on a table this wide it would otherwise scroll out of
 * reach exactly when you had found the row you wanted to act on. The shadow on
 * each one's inner edge says the row continues past it.
 *
 * WHY THE ACTION IS ON THE RIGHT AND NOT THE LEFT. It used to lead. Reading a
 * row then runs backwards — you are offered the answer before you have been
 * told the question, and every row starts with two buttons you cannot yet
 * decide between. Step 1 already ended with its action; the other steps began
 * with theirs, so the same queue changed shape as you walked through it.
 * Pinning is what makes the move free: last in the reading order, still always
 * on screen.
 */

/**
 * A column: `{ key, label, width, render, sort?, align?, className?, pin?,
 * rowSpan? }`.
 *
 * `pin: 'right'` parks the column against the right edge. Only the LAST column
 * may claim it — a right-pinned column offsets from the edge by zero, so one
 * in the middle would sit on top of the columns after it rather than beside
 * them.
 *
 * `rowSpan: (row, i) => n` MERGES A COLUMN DOWN a run of rows, and is how a
 * table whose rows are parts of one thing says so. Step 5 gives a property six
 * rows, one per document; its Location and Property cells return 6 on the
 * first of them and **0** on the other five, and 0 means no <td> is emitted at
 * all — a cell covered by a span must not also exist, or the row gains a
 * column and every cell after it shifts one to the right. The merged cell then
 * centres itself vertically for free, because that is what a table does.
 *
 * `sort: true` marks the column sortable; the SORTING ITSELF happens on the
 * server (see propertyCapture.service.js). Sorting a page in the browser sorts
 * twenty-five rows out of four hundred — you get the top of page 3, not the
 * third page of the top — which is the classic pagination bug and the reason
 * this component stopped doing it itself.
 */
export function PropTable({
  columns, rows, rowKey, sort, onSort, busy, onRowClick,
  /* A class per row, for tables whose rows belong to each other - Step 5
     gives a property's six documents one bordered block so the eye can see
     where one property's paperwork ends and the next begins. */
  rowClass,
}) {
  /* A column that names the form field it shows (`field: 'carpet_area'`) is
     headed with the FORM's wording for it; `label` is only the fallback. */
  const { labelOf } = useCaptureLabels();
  const headingOf = (c) => (c.field ? labelOf(c.field, c.label) : c.label);
  const wrapRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [more, setMore] = useState(false);

  const totalWidth = useMemo(
    () => columns.reduce((n, c) => n + (c.width || 140), 0),
    [columns],
  );

  /* The right-pinned column, if the step declared one. Only honoured on the
     last column — see the note on the column contract above. */
  const pinRight = columns.length - 1;
  const hasPinRight = columns[pinRight]?.pin === 'right';
  const pinRightWidth = hasPinRight ? (columns[pinRight].width || 140) : 0;

  /**
   * Two edge states, both only shown when they mean something.
   *
   * `scrolled` puts a shadow on the pinned first column once something is
   * actually hidden behind it. `more` is the important one: these tables are
   * 1,400–1,800px wide and a 14" laptop shows about half, so without a visible
   * right edge people reasonably conclude the other columns do not exist. It
   * is reported as missing columns, and it is not — it is a missing
   * affordance.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const sync = () => {
      setScrolled(el.scrollLeft > 2);
      setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    el.addEventListener('scroll', sync, { passive: true });
    /* Also on resize: collapsing the sidebar or dragging the window wider can
       bring the last column into view, and the hint has to stop lying. */
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => { el.removeEventListener('scroll', sync); ro.disconnect(); };
  }, [columns]);

  /**
   * The banner row above the headers, built from consecutive columns that
   * declare the same `group`.
   *
   * Four assessments with five facts each is twenty columns, and twenty bare
   * headers is a wall nobody can navigate — "By" and "On" mean nothing on
   * their own when there are four of each. The banner says which assessment a
   * run of columns belongs to, so the sub-heads can stay short.
   *
   * Only rendered when something actually declares a group; every other table
   * in this module keeps its single header row.
   */
  const groups = useMemo(() => {
    const out = [];
    for (const c of columns) {
      const last = out[out.length - 1];
      if (last && last.group && last.group === c.group) last.span += 1;
      else out.push({ group: c.group || null, span: 1, key: c.key });
    }
    return out;
  }, [columns]);
  const hasGroups = groups.some((g) => g.group);

  /**
   * THE PAGE MOVES FIRST, THEN THE ROWS.
   *
   * The table scrolls inside itself so its header and side scroll bar stay on
   * screen, and it is sized to fill the window once it reaches the top. But a
   * wheel over a scroll box scrolls the box, so the page never moved: the
   * table sat half-way down under the KPIs and the flow rail, showing three
   * or four rows of the twenty-five asked for. So a downward wheel first
   * carries the page until the table's top meets the top of the view, and
   * only then reaches the rows. Upward needs nothing: the box scrolls back to
   * its first row, then the browser hands the wheel to the page.
   */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    /* Whatever scrolls the page: `.content` on most screens, `.pc2` on the
       FMS steps. Found when the wheel turns, not on mount, because the first
       box that CAN scroll (a wrapper with overflow: auto for the sideways bar)
       is not always one that has anything to scroll. */
    const pageOf = () => {
      let p = el.parentElement;
      while (p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1)) p = p.parentElement;
      return p;
    };
    const onWheel = (e) => {
      if (e.ctrlKey || e.deltaY <= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const page = pageOf();
      if (!page) return;
      const gap = el.getBoundingClientRect().top - page.getBoundingClientRect().top;
      const room = page.scrollHeight - page.clientHeight - page.scrollTop;
      if (gap <= 1 || room <= 1) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      page.scrollTop += Math.min(dy, gap, room);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* Back to the top on a new page. Keeping the scroll position means page 2
     opens halfway down itself. */
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div
      className={`prop-table-frame${more ? ' is-more' : ''}${hasPinRight ? ' has-pin-r' : ''}`}
      style={hasPinRight ? { '--pin-r': `${pinRightWidth}px` } : undefined}
    >
      <div className={`prop-table-wrap${scrolled ? ' is-scrolled' : ''}${busy ? ' is-busy' : ''}`} ref={wrapRef}>
        <table
          className="prop-table"
          style={{
            width: totalWidth,
            minWidth: '100%',
            /* How far the frozen first column reaches, so a sticky band label
               can park just past it instead of sliding underneath. */
            '--sticky-l': `${columns[0]?.width ?? 0}px`,
          }}
        >
          <colgroup>
            {columns.map((c) => <col key={c.key} style={{ width: c.width || 140 }} />)}
          </colgroup>
          <thead className={hasGroups ? 'has-groups' : ''}>
            {hasGroups && (
              <tr className="prop-group-row">
                {groups.map((g, i) => (
                  <th
                    key={g.key}
                    colSpan={g.span}
                    className={`${i === 0 ? 'is-sticky ' : ''}${hasPinRight && i === groups.length - 1 ? 'is-sticky-r ' : ''}${g.group ? 'is-group' : 'is-blank'}`}
                  >
                    {/* The name travels with its band. Wrapped so it can be
                      sticky INSIDE the cell: the cell spans eight columns, so
                      once you have scrolled past its start the label would
                      otherwise be off to the left and the reader is looking
                      at "Civil / HVAC / Parking" with nothing saying which
                      assessment they belong to. See .prop-group-label. */}
                    {g.group ? <span className="prop-group-label">{g.group}</span> : ''}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  className={`${i === 0 ? 'is-sticky ' : ''}${c.pin === 'right' && i === pinRight ? 'is-sticky-r ' : ''}${c.className || ''}`}
                  style={c.align ? { textAlign: c.align } : undefined}
                  /* The full name, for the narrow columns where it is clipped. */
                  title={headingOf(c)}
                >
                  <span className="prop-th">
                    {headingOf(c)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              /* Optional, and only passed by a table that has taken its Action
                 column away: without it, removing those buttons would leave the
                 row with nothing to open. Keyboard-reachable for the same
                 reason — a click-only row is a row half the users cannot use. */
              <tr
                key={rowKey(row)}
                className={[onRowClick ? 'prop-row-open' : null, rowClass?.(row)].filter(Boolean).join(' ') || undefined}
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                /**
                 * THE ROW OPENS ONLY WHEN THE ROW WAS CLICKED.
                 *
                 * Every cell here carries its own controls — file links, form
                 * buttons, verdicts — and a click on one of them bubbled up to
                 * this handler as well, so pressing a file on Step 1 opened the
                 * preview AND the property report on top of it. Most cells had
                 * grown their own `e.stopPropagation()` to survive that; the
                 * ones that had not were a bug waiting for somebody to notice.
                 * Asked once here instead, so a new cell cannot reintroduce it.
                 */
                onClick={onRowClick ? (e) => {
                  /* Interactive things only — NOT `[role="button"]`, because
                     the row itself carries that for keyboard users and would
                     therefore match every click on itself. */
                  if (e.target.closest('a, button, input, select, textarea, label')) return;
                  onRowClick(row);
                } : undefined}
                onKeyDown={onRowClick ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(row); }
                } : undefined}
              >
                {columns.map((c, i) => {
                  /* 0 = this cell is inside a span opened further up, so it is
                     not rendered at all. See the column contract above. */
                  const span = c.rowSpan ? c.rowSpan(row, rowIndex) : 1;
                  if (!span) return null;
                  return (
                    <td
                      key={c.key}
                      rowSpan={span > 1 ? span : undefined}
                      className={`${i === 0 ? 'is-sticky ' : ''}${c.pin === 'right' && i === pinRight ? 'is-sticky-r ' : ''}${c.className || ''}`}
                      style={c.align ? { textAlign: c.align } : undefined}
                    >
                      {/* `rowIndex`, not `i`: the inner map over columns shadows
                        the outer one, so passing `i` handed every row the COLUMN
                        index — zero for the first cell, which made the "#"
                        column print 1 on every line. */}
                      {(() => {
                        const cellContent = c.render(row, rowIndex);
                        if (typeof cellContent === 'string') {
                          const words = cellContent.trim().split(/\s+/).filter(Boolean);
                          if (words.length > 10) {
                            return <TruncatedText text={cellContent} />;
                          }
                        }
                        return cellContent;
                      })()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PropTable;
