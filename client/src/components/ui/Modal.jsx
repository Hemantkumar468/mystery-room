import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, icon, children, footer, width = 560, className = '', variant }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const isDrawer = variant === 'drawer';
  return (
    <div className={`overlay${isDrawer ? ' overlay--drawer' : ''}`} onMouseDown={onClose}>
      <div
        className={`modal fade-in${isDrawer ? ' modal--drawer' : ''}${className ? ` ${className}` : ''}`}
        style={width && !isDrawer ? { maxWidth: width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="card-head modal-header">
          {(title || subtitle || icon) ? (
            <div className="modal-title-group" style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: 1 }}>
              {icon && <div className="modal-header-icon" style={{ flexShrink: 0 }}>{icon}</div>}
              <div className="col" style={{ minWidth: 0 }}>
                {title && <div className="section-title">{title}</div>}
                {subtitle && <div className="sm muted">{subtitle}</div>}
              </div>
            </div>
          ) : <div style={{ flex: 1 }} />}
          <button className="btn btn-ghost btn-icon modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="card-body modal-body">{children}</div>
        {footer && (
          <div className="card-head modal-footer" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
