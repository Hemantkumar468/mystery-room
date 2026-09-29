import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Right-hand slide-over panel for detail views. Drawers can stack. */
export function Drawer({ open, onClose, title, subtitle, actions, children, width = 720 }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A modal handles its own Escape; among stacked drawers only the top one closes.
      if (document.querySelector('.overlay')) return;
      const all = document.querySelectorAll('.drawer-overlay');
      if (all[all.length - 1] !== ref.current) return;
      onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="drawer-overlay" ref={ref} onMouseDown={onClose}>
      <aside className="drawer" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div className="col grow" style={{ minWidth: 0 }}>
            <div className="section-title truncate">{title}</div>
            {subtitle && <div className="sm muted truncate">{subtitle}</div>}
          </div>
          {actions}
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export default Drawer;
