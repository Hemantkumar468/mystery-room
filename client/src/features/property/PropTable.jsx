import { useMemo, useRef, useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

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
 * WHAT THE FIRST COLUMN DOES. It sticks. The action is the reason to read the
 * row, and on a table this wide it would otherwise scroll out of reach exactly
 * when you had found the row you wanted to act on. The shadow on its edge is
 * the affordance that says the rest of the row continues past it.
 */

/**
 * A column: `{ key, label, width, render, sort?, align?, className? }`.
 *
 * `sort: true` marks the column sortable; the SORTING ITSELF happens on the
 * server (see propertyCapture.service.js). Sorting a page in the browser sorts
 * twenty-five rows out of four hundred — you get the top of page 3, not the
 * third page of the top — which is the classic pagination bug and the reason
 * this component stopped doing it itself.
 */
export function PropTable({ columns, rows, rowKey, sort, onSort, busy }) {
  const wrapRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [more, setMore] = useState(false);

  const totalWidth = useMemo(
    () => columns.reduce((n, c) => n + (c.width || 140), 0),
    [columns],
  );

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

  /* Back to the top on a new page. Keeping the scroll position means page 2
     opens halfway down itself. */
  useEffect(() => {
    if (wrapRef.current) wrapRef.current.scrollTop = 0;
  }, [rows]);

  return (
    <div className={`prop-table-frame${more ? ' is-more' : ''}`}>
      {/* Says how many columns are off to the right, not just that some are.
          "+4 more" is actionable; a bare arrow is decoration. */}
      {more && <span className="prop-more-hint" aria-hidden="true">scroll →</span>}
      <div className={`prop-table-wrap${scrolled ? ' is-scrolled' : ''}${busy ? ' is-busy' : ''}`} ref={wrapRef}>
      <table className="prop-table" style={{ width: totalWidth, minWidth: '100%' }}>
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
                  className={`${i === 0 ? 'is-sticky ' : ''}${g.group ? 'is-group' : 'is-blank'}`}
                >
                  {g.group || ''}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {columns.map((c, i) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={`${i === 0 ? 'is-sticky ' : ''}${c.sort ? 'is-sortable ' : ''}${active ? 'is-sorted ' : ''}${c.className || ''}`}
                  style={c.align ? { textAlign: c.align } : undefined}
                  onClick={() => c.sort && onSort?.(c.key)}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  /* The full name, for the narrow columns where it is clipped. */
                  title={typeof c.label === 'string' ? c.label : undefined}
                >
                  <span className="prop-th">
                    {c.label}
                    {c.sort && (
                      active
                        ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)
                        : <ChevronsUpDown size={12} className="prop-th-idle" />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`${i === 0 ? 'is-sticky ' : ''}${c.className || ''}`}
                  style={c.align ? { textAlign: c.align } : undefined}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export default PropTable;
