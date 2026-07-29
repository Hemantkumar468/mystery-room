import { useEffect } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectToasts, toastDismissed } from '../../app/slices/notificationSlice.js';

/**
 * Single toast host, mounted once by AppShell.
 *
 * Replaces three independent, hand-rolled implementations that used to live
 * in EmployeesPage, SiteEvaluationPage and TemplatesPage — each with its own
 * `{ text, type }` state, its own auto-dismiss timer (4000/5000/4000ms) and
 * its own inline styles (there was no shared `.toast` class). None of them
 * could be triggered from any other page. `errorMiddleware` now raises a
 * toast for any RTK Query failure regardless of what's mounted; anything else
 * (success confirmations, etc.) dispatches `toastPushed` directly.
 */
function ToastIcon({ kind }) {
  if (kind === 'success') return <CheckCircle2 size={16} />;
  if (kind === 'error') return <XCircle size={16} />;
  if (kind === 'warning') return <AlertTriangle size={16} />;
  return <Info size={16} />;
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast.timeout) return undefined;
    const t = setTimeout(onDismiss, toast.timeout);
    return () => clearTimeout(t);
  }, [toast.timeout, onDismiss]);

  return (
    <div className={`toast toast-${toast.kind}`} role="status">
      <span className="toast-icon"><ToastIcon kind={toast.kind} /></span>
      <div className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </div>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useAppSelector(selectToasts);
  const dispatch = useAppDispatch();

  if (!toasts.length) return null;

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => dispatch(toastDismissed(t.id))} />
      ))}
    </div>
  );
}

export default ToastHost;
