import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

/**
 * A date field whose calendar we actually own.
 *
 * `<input type="date">` opens the BROWSER's picker, which is chrome outside the
 * page: it cannot be sized, themed or repositioned from CSS. On a narrow
 * viewport it opened wider than the screen and ran off the right edge, with no
 * way to reach the days it had pushed out of view.
 *
 * So the calendar is ours now. Two things make it safe where the native one was
 * not:
 *
 *  - It is `position: fixed`, with coordinates measured from the trigger. Every
 *    record form here lives inside a modal whose body scrolls, and a normally
 *    positioned popup would be clipped by that ancestor's overflow.
 *  - Its placement is CLAMPED to the viewport. Below 560px it stops floating
 *    altogether and opens INLINE, directly beneath the field. A floating panel
 *    inside a scrolling dialog has no honest resting place on a small screen:
 *    docked to the viewport it ended up drawn outside the dialog entirely.
 *    Inline it is simply part of the form — sized to the field, scrolling with
 *    it, unable to escape anything.
 *
 * The value contract is unchanged from the input it replaces: a `YYYY-MM-DD`
 * string in, the same string out, so no caller needs to know it changed.
 */

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

/**
 * Parsed by hand, deliberately not `new Date(str)`: that reads a bare
 * `YYYY-MM-DD` as UTC midnight, so anywhere west of Greenwich every stored date
 * renders a day early.
 */
function parts(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
}

const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
const firstWeekday = (y, m) => new Date(y, m, 1).getDay();

export function DatePicker({
  id, value, onChange, disabled = false, placeholder = 'Select a date',
  className = 'input', min, max, ...rest
}) {
  const chosen = parts(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => ({
    y: chosen?.y ?? today.getFullYear(),
    m: chosen?.m ?? today.getMonth(),
  }));
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  // Open on the month the field already holds, not on wherever it was left.
  useEffect(() => {
    if (!open) return;
    const p = parts(value);
    if (p) setView({ y: p.y, m: p.m });
  }, [open, value]);

  /* Measured after layout but before paint, so the panel never shows at 0,0 for
     a frame and then jumps into position. */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      if (window.innerWidth <= 560) { setPos({ inline: true }); return; }
      const r = el.getBoundingClientRect();
      const W = 300;
      const H = popRef.current?.offsetHeight || 330;
      // Flip above the field when there is not room beneath it.
      const room = window.innerHeight - r.bottom;
      const top = room < H + 8 && r.top > H + 8 ? r.top - H - 6 : r.bottom + 6;
      // Clamped both ways, so the panel cannot land outside the viewport.
      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
      setPos({ top, left, width: W });
    };
    place();
    window.addEventListener('resize', place);
    // Capture phase: the scroller is the modal body, not the window.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const step = (by) => setView((v) => {
    const m = v.m + by;
    if (m < 0) return { y: v.y - 1, m: 11 };
    if (m > 11) return { y: v.y + 1, m: 0 };
    return { y: v.y, m };
  });

  const blanks = firstWeekday(view.y, view.m);
  const total = daysInMonth(view.y, view.m);
  const sameDay = (d) => chosen && chosen.y === view.y && chosen.m === view.m && chosen.d === d;
  const isToday = (d) => today.getFullYear() === view.y
    && today.getMonth() === view.m && today.getDate() === d;
  const blocked = (d) => {
    const v = iso(view.y, view.m, d);
    return Boolean((min && v < min) || (max && v > max));
  };

  return (
    <div className="dp-field">
      <button
        {...rest}
        id={id}
        ref={triggerRef}
        type="button"
        className={`${className} dp-trigger`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={chosen ? undefined : 'dp-placeholder'}>
          {chosen ? `${pad(chosen.d)} ${MONTHS[chosen.m].slice(0, 3)} ${chosen.y}` : placeholder}
        </span>
        <CalendarIcon size={15} aria-hidden />
      </button>

      {open && pos && (
        <div
          ref={popRef}
          className={`dp-pop${pos.inline ? ' dp-pop--inline' : ''}`}
          style={pos.inline ? undefined : { top: pos.top, left: pos.left, width: pos.width }}
          role="dialog"
          aria-label="Choose a date"
        >
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => step(-1)} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span className="dp-month">{MONTHS[view.m]} {view.y}</span>
            <button type="button" className="dp-nav" onClick={() => step(1)} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="dp-grid dp-dow">
            {DAYS.map((d) => <span key={d}>{d}</span>)}
          </div>

          <div className="dp-grid">
            {Array.from({ length: blanks }, (_, i) => <span key={`blank-${i}`} />)}
            {Array.from({ length: total }, (_, i) => {
              const d = i + 1;
              return (
                <button
                  key={d}
                  type="button"
                  className={`dp-day${sameDay(d) ? ' is-chosen' : ''}${isToday(d) ? ' is-today' : ''}`}
                  onClick={() => { onChange(iso(view.y, view.m, d)); setOpen(false); }}
                  disabled={blocked(d)}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div className="dp-foot">
            <button type="button" className="dp-link" onClick={() => { onChange(''); setOpen(false); }}>
              Clear
            </button>
            <button
              type="button"
              className="dp-link"
              onClick={() => {
                onChange(iso(today.getFullYear(), today.getMonth(), today.getDate()));
                setOpen(false);
              }}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DatePicker;
