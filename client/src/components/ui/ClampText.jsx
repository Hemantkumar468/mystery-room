/**
 * Text clamped to a fixed number of lines, with a "Read more" affordance that
 * only appears when the text is genuinely being cut off.
 *
 * Line clamping rather than a character count: `title.slice(0, 80) + '…'` cuts
 * at a different visual point in every column width and on every screen, and
 * it truncates short-but-wide text that would have fitted. `-webkit-line-clamp`
 * cuts at the real rendered line, so the row height is what is actually being
 * promised.
 *
 * The trade-off is that overflow can only be detected after layout, so the
 * toggle is decided by measuring rather than guessing — see the observer below.
 * Guessing was the alternative and it is wrong in both directions: a "Show
 * more" that expands to reveal nothing, or none offered on text that is cut.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function ClampText({
  children,
  lines = 2,
  className = '',
  /** When set, "Read more" calls this instead of expanding in place — used by
   *  list rows, where the full text belongs on the detail page rather than
   *  inside a table cell that would push every other row down. */
  onMore,
  moreLabel = 'Read more',
  lessLabel = 'Show less',
  as: Tag = 'div',
  title,
  ...rest
}) {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Re-measured on resize, because whether text overflows is a function of the
  // column width — a title that fits on a wide screen is clipped on a narrow
  // one, and the toggle has to appear and disappear with it.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Compare against the clamped box only; once expanded the element is its
    // full height by definition and would always report "not clipped".
    if (expanded) return;
    setClipped(el.scrollHeight - el.clientHeight > 1);
  }, [expanded]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const showToggle = clipped || expanded;
  const clampStyle = expanded
    ? undefined
    : {
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        overflowWrap: 'anywhere',
      };

  return (
    <>
      <Tag
        ref={ref}
        className={className}
        style={clampStyle}
        // Native tooltip carries the full text even before anyone clicks —
        // often all someone needs to confirm they have the right row.
        title={title ?? (typeof children === 'string' ? children : undefined)}
        {...rest}
      >
        {children}
      </Tag>
      {showToggle && (
        <button
          type="button"
          className="clamp-more"
          onClick={(e) => {
            // Rows are usually clickable; expanding must not also navigate.
            e.stopPropagation();
            e.preventDefault();
            if (onMore) onMore();
            else setExpanded((v) => !v);
          }}
        >
          {onMore || !expanded ? moreLabel : lessLabel}
        </button>
      )}
    </>
  );
}

export default ClampText;
