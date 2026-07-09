import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, children, footer, width = 560 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal fade-in" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="card-head">
          <div className="col">
            <div className="section-title">{title}</div>
            {subtitle && <div className="sm muted">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="card-body">{children}</div>
        {footer && (
          <div className="card-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', justifyContent: 'flex-end' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
