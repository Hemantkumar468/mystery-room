import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';

/**
 * A TIME FIELD THAT SHOWS A CLOCK UNTIL SOMEBODY ASKS IT A QUESTION.
 *
 * `<input type="time">` renders the browser's own spinner — "--:-- --", three
 * segments and a caret — in every field, filled or not. On a form of eight
 * inputs that is the loudest thing on the screen, and it is loud about the one
 * answer nobody has given yet. Worse, it is a different control in every
 * browser, so the one field on the page that cannot be styled is the one that
 * draws the eye.
 *
 * So the field at rest is a clock icon and nothing else, and the value once
 * there is plain text — "06:00 PM". The picker only exists after a click.
 *
 * WHY A CLOCK FACE AND NOT TWO DROPDOWNS. Picking a time is spatial: people
 * know where half past four is before they know it is 16:30. Two selects of
 * twelve and sixty make them read a list to find something they could have
 * pointed at. The ring is also how every phone has asked this question for a
 * decade, so nothing has to be learnt.
 *
 * Hours first, then minutes, then it closes — three clicks and no Done button,
 * because a confirm step on a control whose every state is already visible is
 * a step that only exists to be forgotten.
 *
 * `value` and `onChange` speak the same 24-hour "HH:mm" an <input type="time">
 * does, so this drops into any form that already had one.
 */

/**
 * THE HAND LANDS ON THE NUMBER, NOT NEAR IT.
 *
 * `RING` is where the numbers are drawn, and the hand's disc has to be drawn
 * at the SAME radius or it is not pointing at anything. It was placed 16px
 * short of them, so the disc sat inside the ring: the selected hour showed as
 * a blue blob beside its own number, the white text on the disc fell on the
 * grey face instead, and the whole clock read as broken — which is exactly
 * what it was. Measured, not guessed: the numbers sat at radius 90 and the
 * disc at 74.
 *
 * `KNOB` is the disc's radius and matches `.tp-num`'s 34px box, so the circle
 * the hand draws is the circle the number sits in. The line stops at the
 * disc's edge rather than running under it.
 */
const FACE = 232;          // the popover's clock, edge to edge
const CENTRE = FACE / 2;
const RING = CENTRE - 26;  // where the numbers sit — and where the hand ends
const KNOB = 17;           // half of .tp-num's 34px box

/** Where a value sits on the ring. 12 o'clock is up; the face runs clockwise. */
const pointAt = (step, radius) => {
  const angle = (step % 12) * 30 * (Math.PI / 180);
  return {
    x: CENTRE + radius * Math.sin(angle),
    y: CENTRE - radius * Math.cos(angle),
  };
};

/** "14:30" -> { h12: 2, m: 30, pm: true }. Anything unparseable -> null. */
function parse(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h24 = Number(m[1]);
  const min = Number(m[2]);
  if (!(h24 >= 0 && h24 <= 23) || !(min >= 0 && min <= 59)) return null;
  return { h12: h24 % 12 === 0 ? 12 : h24 % 12, m: min, pm: h24 >= 12 };
}

const to24 = ({ h12, m, pm }) => {
  const h = (h12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const pad = (n) => String(n).padStart(2, '0');

/** What the closed field reads. */
export function formatTime(value) {
  const t = parse(value);
  return t ? `${pad(t.h12)}:${pad(t.m)} ${t.pm ? 'PM' : 'AM'}` : '';
}

export function TimePicker({
  value,
  onChange,
  id,
  className = '',
  disabled = false,
  ariaLabel = 'Time',
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('hour'); // 'hour' | 'minute'
  const [at, setAt] = useState(null); // where the popover sits, in viewport px
  const wrapRef = useRef(null);
  const popRef = useRef(null);

  /* The picker edits a WORKING COPY and writes on every touch, so the field
     behind it updates as the hand moves — but a field opened empty still has
     something to point the hand at. Noon rather than midnight: a store's
     deadline is in the working day, and midnight would put the hand at 12 AM
     for every new project. */
  const current = parse(value) || { h12: 12, m: 0, pm: true };

  useEffect(() => {
    if (!open) return undefined;
    /* The popover lives on <body>, so "outside" is outside BOTH it and the
       trigger — testing only the trigger would close it on its own numbers. */
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /**
   * WHY THIS IS A PORTAL AND NOT A CHILD OF THE FIELD.
   *
   * Absolutely positioned inside the form, the clock was clipped by the
   * dialog's own scroll box: a quarter of the face and the AM/PM pair sat
   * outside it and could not be reached. No z-index fixes that — an ancestor
   * with `overflow` cuts a descendant whatever it is stacked above. So it is
   * rendered on <body> at viewport coordinates measured from the trigger, and
   * flipped up or pulled left when it would otherwise run off the screen.
   */
  useLayoutEffect(() => {
    if (!open) { setAt(null); return undefined; }

    const place = () => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 268;
      const H = 344;
      const GAP = 6;
      const below = window.innerHeight - r.bottom;
      setAt({
        top: below >= H + GAP || r.top < H + GAP
          ? Math.min(r.bottom + GAP, Math.max(8, window.innerHeight - H - 8))
          : r.top - H - GAP,
        left: Math.max(8, Math.min(r.left, window.innerWidth - W - 8)),
      });
    };

    place();
    /* Scrolling the dialog behind it would otherwise leave the clock hanging
       beside nothing. `true` to catch scrolls in any ancestor, not just the
       window. */
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const commit = (next) => onChange?.(to24(next));

  const pickHour = (h12) => {
    commit({ ...current, h12 });
    setView('minute');
  };
  const pickMinute = (m) => {
    commit({ ...current, m });
    setOpen(false);
    setView('hour');
  };

  const shown = formatTime(value);
  const activeStep = view === 'hour' ? current.h12 : current.m / 5;
  /* The disc sits ON the selected number; the line stops where the disc
     begins, so it meets it rather than running underneath it. */
  const knob = pointAt(activeStep, RING);
  const tip = pointAt(activeStep, RING - KNOB);

  return (
    <div className={`tp ${className}`} ref={wrapRef}>
      <button
        type="button"
        id={id}
        className={`input tp-trigger${shown ? '' : ' is-empty'}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { if (!disabled) { setView('hour'); setOpen((o) => !o); } }}
      >
        <Clock size={15} className="tp-trigger-icon" aria-hidden />
        {/* Empty renders NOTHING beside the icon — no placeholder text, no
            "--:--". The icon is the whole answer to what this field is. */}
        {shown && <span className="tp-trigger-value">{shown}</span>}
      </button>

      {open && at && createPortal(
        <div className="tp-pop" role="dialog" aria-label={ariaLabel} ref={popRef} style={{ top: at.top, left: at.left }}>
          <div className="tp-head">
            {/* The two halves are the view switch. Nothing else selects it —
                a separate pair of tabs would describe the same two states
                twice. */}
            <button
              type="button"
              className={`tp-head-part${view === 'hour' ? ' is-on' : ''}`}
              onClick={() => setView('hour')}
            >
              {pad(current.h12)}
            </button>
            <span className="tp-head-sep">:</span>
            <button
              type="button"
              className={`tp-head-part${view === 'minute' ? ' is-on' : ''}`}
              onClick={() => setView('minute')}
            >
              {pad(current.m)}
            </button>
            <span className="tp-head-mer">
              {['AM', 'PM'].map((mer) => (
                <button
                  key={mer}
                  type="button"
                  className={`tp-mer${(mer === 'PM') === current.pm ? ' is-on' : ''}`}
                  onClick={() => commit({ ...current, pm: mer === 'PM' })}
                >
                  {mer}
                </button>
              ))}
            </span>
          </div>

          <div className="tp-face" style={{ width: FACE, height: FACE }}>
            {/* The hand, drawn under the numbers so a selected one sits on
                top of its own dot rather than behind it. */}
            <svg className="tp-hand" width={FACE} height={FACE} aria-hidden>
              <line x1={CENTRE} y1={CENTRE} x2={tip.x} y2={tip.y} />
              <circle cx={CENTRE} cy={CENTRE} r="3.5" />
              <circle cx={knob.x} cy={knob.y} r={KNOB} className="tp-hand-end" />
            </svg>

            {(view === 'hour'
              ? Array.from({ length: 12 }, (_, i) => ({ step: i + 1, label: pad(i + 1), on: current.h12 === i + 1, pick: () => pickHour(i + 1) }))
              : Array.from({ length: 12 }, (_, i) => ({ step: i, label: pad(i * 5), on: current.m === i * 5, pick: () => pickMinute(i * 5) }))
            ).map(({ step, label, on, pick }) => {
              const p = pointAt(step, RING);
              return (
                <button
                  key={label}
                  type="button"
                  className={`tp-num${on ? ' is-on' : ''}`}
                  style={{ left: p.x, top: p.y }}
                  onClick={pick}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default TimePicker;
