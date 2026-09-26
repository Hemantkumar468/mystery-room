import { create } from 'zustand';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

/** Minimal toast system: `toast.success('Saved')`, `toast.error(msg)`. */
const useToasts = create((set) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ items: [...s.items, { id, ...t }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), t.ttl || 3600);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  success: (message) => useToasts.getState().push({ kind: 'success', message }),
  error: (message) => useToasts.getState().push({ kind: 'error', message, ttl: 6000 }),
  info: (message) => useToasts.getState().push({ kind: 'info', message }),
};

const ICON = { success: CheckCircle2, error: AlertTriangle, info: Info };

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => {
        const Icon = ICON[t.kind] || Info;
        return (
          <div key={t.id} className={`toast toast-${t.kind} fade-in`}>
            <Icon size={16} />
            <span className="grow">{t.message}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default toast;
