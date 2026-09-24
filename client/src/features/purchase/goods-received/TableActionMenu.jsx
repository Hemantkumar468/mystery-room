import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal } from 'lucide-react';

const MENU_WIDTH = 200;

/**
 * The row's "…" menu.
 *
 * Positioned FIXED off the trigger's rect rather than absolutely inside the
 * cell: the table sits in a `overflow: hidden` card with an `overflow-x:
 * auto` scroller inside it, and an absolutely-positioned menu is clipped by
 * both — on the last two rows it simply never appeared. Fixed positioning
 * escapes the clip, at the cost of having to close on scroll, which is what
 * the listeners below do.
 *
 * `items` is data, not markup, so a row decides what it can offer (a receipt
 * with no GRN has no invoice to raise) without this component knowing
 * anything about purchase orders.
 */
export function TableActionMenu({ items, label = 'Row actions' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const onDocClick = (e) => {
      if (!menuRef.current?.contains(e.target) && !btnRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    /* `true` — capture, so a scroll inside the table's own scroller closes it
       too, not just a scroll of the page. */
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = btnRef.current.getBoundingClientRect();
    /* Flip up when there is not room below — the last row of a full sheet is
       exactly where this menu is most used. */
    const below = window.innerHeight - r.bottom;
    const needed = items.length * 36 + 20;
    setPos({
      left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      top: below < needed ? undefined : r.bottom + 6,
      bottom: below < needed ? window.innerHeight - r.top + 6 : undefined,
    });
    setOpen(true);
  };

  const run = (item) => (e) => {
    e.stopPropagation();
    setOpen(false);
    if (item.to) navigate(item.to);
    else item.onClick?.();
  };

  return (
    <span className="gr-actions">
      <button
        type="button"
        ref={btnRef}
        className="gr-more"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="gr-menu"
          role="menu"
          style={{ position: 'fixed', width: MENU_WIDTH, ...pos }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button type="button" key={item.key} role="menuitem" className="gr-menu-item" onClick={run(item)}>
              {item.icon && <item.icon size={15} />} {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default TableActionMenu;
