import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

/**
 * Per-row "⋮" actions menu for the Shortlisted Properties table — portaled
 * to `document.body` and positioned from the trigger's own viewport rect,
 * same technique as records/StatusDropdown.jsx and for the same reason:
 * this table lives inside a horizontally-scrolling wrapper, which per the
 * CSS overflow spec forces the vertical axis to `auto` too, clipping any
 * absolutely-positioned (non-portaled) child.
 *
 * `items` is `[{ key, label, icon: Icon, onClick, danger? }]`.
 */
export function RowActionsMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 6, left: Math.max(8, r.right - 220) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current?.contains(e.target)) return;
      if (e.target.closest?.('.status-dropdown-menu')) return;
      setOpen(false);
    };
    const onScrollOrResize = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <div className="status-dropdown" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
      >
        <MoreVertical size={15} />
      </button>

      {open && menuPos && createPortal(
        <div className="status-dropdown-menu" role="menu" style={{ top: menuPos.top, left: menuPos.left, minWidth: 220 }}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="status-dropdown-item"
              style={item.danger ? { color: 'var(--danger)' } : undefined}
              onClick={() => { setOpen(false); item.onClick(); }}
            >
              <item.icon size={14} />
              <span className="status-dropdown-label">{item.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default RowActionsMenu;
