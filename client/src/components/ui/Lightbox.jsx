import { useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

/**
 * Full-screen photo viewer. There was no such component anywhere in the client
 * — uploaded photos were only ever thumbnails or a new browser tab — and an
 * approver judging site evidence has to be able to actually look at it.
 *
 * `items` is [{ id, url, name }]; `index` is which one is open; `onClose` and
 * `onIndex` are controlled by the caller so the page owns the state and the
 * viewer stays a pure renderer.
 *
 * Keyboard is not a nicety here. Someone reviewing twelve site photos arrows
 * through them; making that mouse-only turns a ten-second check into a chore,
 * which is how evidence stops being looked at.
 */
export function Lightbox({ items = [], index = 0, onClose, onIndex }) {
  const count = items.length;
  const open = count > 0 && index >= 0 && index < count;

  const go = useCallback((delta) => {
    if (!count) return;
    // Wraps, so arrowing off either end continues rather than dead-ending.
    onIndex?.((index + delta + count) % count);
  }, [index, count, onIndex]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    /* The page behind must not scroll while this is open — on a phone the
       viewer otherwise drifts off-screen under the drag. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, go, onClose]);

  if (!open) return null;
  const item = items[index];

  return (
    <div className="lightbox" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={item.name || 'Photo'}>
      <div className="lightbox-bar" onMouseDown={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{item.name || 'Photo'}</span>
        <span className="lightbox-count">{index + 1} of {count}</span>
        <a
          className="lightbox-btn"
          href={item.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open original in a new tab"
          title="Open original"
        >
          <Download size={16} />
        </a>
        <button type="button" className="lightbox-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav left"
          onMouseDown={(e) => { e.stopPropagation(); go(-1); }}
          aria-label="Previous photo"
        >
          <ChevronLeft size={26} />
        </button>
      )}

      <img
        className="lightbox-img"
        src={item.url}
        alt={item.name || 'Submitted photo'}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {count > 1 && (
        <button
          type="button"
          className="lightbox-nav right"
          onMouseDown={(e) => { e.stopPropagation(); go(1); }}
          aria-label="Next photo"
        >
          <ChevronRight size={26} />
        </button>
      )}
    </div>
  );
}

export default Lightbox;
