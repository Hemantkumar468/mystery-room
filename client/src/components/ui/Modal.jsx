import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, children, footer, width = 560, className = '' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={onClose}>
      {/* `width` sets maxWidth inline (legacy API); pass `width={null}` with a
          sizing `className` (e.g. for a large-format modal) to let CSS take over. */}
      <div
        className={`modal fade-in${className ? ` ${className}` : ''}`}
        style={width ? { maxWidth: width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* modal-header/-body/-footer (alongside the existing card-head/
            card-body classes, which still supply all the padding/border
            styling) are pure layout hooks: .modal is a flex column and only
            .modal-body scrolls, so the header and footer — Save Draft/
            Submit/Cancel included — stay fixed in place no matter how long
            the form content is. Every modal in the app (RecordFormModal's
            forms, Add/Edit Property, template dialogs, …) goes through this
            one component, so this is a single, global fix. */}
        <div className="card-head modal-header">
          <div className="col">
            <div className="section-title">{title}</div>
            {subtitle && <div className="sm muted">{subtitle}</div>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="card-body modal-body">{children}</div>
        {footer && (
          <div className="card-head modal-footer" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none', justifyContent: 'flex-end' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Modal;
