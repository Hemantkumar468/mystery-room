import { useEffect } from 'react';

/**
 * Closes a floating surface on outside pointer-down or Escape.
 * Pointer-down (not click) so the popover dies before a click lands behind it.
 */
export function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ref, open, onClose]);
}

export default useDismiss;
