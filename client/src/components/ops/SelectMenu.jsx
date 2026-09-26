import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

/**
 * A dropdown that is part of the PAGE, not part of the browser.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 * A native `<select>`'s option list is painted by the browser itself: it is
 * not in the DOM, no CSS can size or clip it, and it is free to open wider
 * than the screen it belongs to. On a phone-sized viewport that is exactly
 * what it did — the list ran off the right edge of the form and there was
 * nothing in the stylesheet that could stop it.
 *
 * This renders the list as ordinary elements, so it obeys the viewport like
 * everything else.
 *
 * ── Portalled and fixed, on purpose ──────────────────────────────────
 * The list is portalled to <body> and positioned `fixed`. Absolutely
 * positioning it inside the form would put it inside `.modal-body`, which
 * scrolls and clips — the list would be cut off by the very container it
 * was opened from. Fixed + portal is the same approach the flow board's
 * hover card uses, for the same reason.
 *
 * ── It never opens off-screen ────────────────────────────────────────
 * The width matches the trigger but is clamped to the viewport, and the list
 * opens downward unless there is more room above, in which case it flips.
 * That is the whole point of replacing the native control, so it is measured
 * rather than assumed — see `place()`.
 *
 * ── Still a real control ─────────────────────────────────────────────
 * Arrow keys move, Enter and Space choose, Escape and an outside click
 * close, Home and End jump, and typing a letter jumps to the next option
 * starting with it. It reports itself as a listbox to a screen reader and
 * moves `aria-activedescendant` as you go, because a div that merely looks
 * like a select is worse than the select it replaced.
 */

const GAP = 6;       // between the trigger and the list
const EDGE = 8;      // smallest gap to the viewport edge
const MAX_H = 280;   // the list scrolls past this rather than filling the screen

export function SelectMenu({
  value,
  onChange,
  options = [],
  placeholder = 'Select…',
  disabled = false,
  className = '',
  id,
  'aria-label': ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typed = useRef({ text: '', at: 0 });
  const reactId = useId();
  const listId = `${id || reactId}-list`;

  const selectedIndex = options.findIndex((o) => String(o.value) === String(value ?? ''));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  /** Where the list goes — measured against the real viewport every time. */
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    /* Downward unless upward genuinely has more room — flipping for the sake
       of a few pixels makes the list jump around as the page scrolls. */
    const flip = below < Math.min(MAX_H, 160) && above > below;
    const height = Math.min(MAX_H, Math.max(flip ? above : below, 120));

    const width = Math.min(Math.max(r.width, 160), vw - EDGE * 2);
    /* Clamped both ways: a list wider than its trigger must not push past
       the right edge, and must not start left of the screen either. */
    const left = Math.min(Math.max(r.left, EDGE), vw - width - EDGE);

    setBox({
      left,
      width,
      height,
      top: flip ? undefined : r.bottom + GAP,
      bottom: flip ? vh - r.top + GAP : undefined,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    /* Anything that moves the trigger moves the list. `true` catches scrolls
       inside .modal-body, which do not bubble. */
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (triggerRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  /* Keep the highlighted row in view when arrowing through a long list. */
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openMenu = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (i) => {
    const o = options[i];
    if (!o) return;
    onChange?.(o.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openMenu(); }
      return;
    }
    if (e.key === 'Escape') {
      /* STOP IT HERE. Modal.jsx listens for Escape on `window` and closes the
         whole dialog — so without this, dismissing the dropdown threw away
         the half-filled form behind it. Escape closes the innermost thing
         that is open, which is this list. */
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Home') { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); return; }

    /* Type-ahead, the one thing people miss most when a select is replaced. */
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      typed.current = {
        text: now - typed.current.at > 700 ? e.key : typed.current.text + e.key,
        at: now,
      };
      const q = typed.current.text.toLowerCase();
      const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(q));
      const hit = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(q));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`select selectmenu${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
      >
        <span className={`selectmenu-value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open && box && createPortal(
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="selectmenu-list"
          style={{
            left: box.left,
            width: box.width,
            maxHeight: box.height,
            ...(box.top !== undefined ? { top: box.top } : { bottom: box.bottom }),
          }}
          onKeyDown={onKeyDown}
        >
          {options.map((o, i) => {
            const isSel = String(o.value) === String(value ?? '');
            return (
              <div
                key={`${o.value}-${i}`}
                id={`${listId}-${i}`}
                data-i={i}
                role="option"
                aria-selected={isSel}
                className={`selectmenu-opt${i === active ? ' is-active' : ''}${isSel ? ' is-selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
              >
                <span className="selectmenu-opt-label">{o.label}</span>
                {isSel && <Check size={14} aria-hidden="true" />}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export default SelectMenu;
