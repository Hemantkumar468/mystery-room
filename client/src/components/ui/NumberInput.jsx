import { useRef } from 'react';

/**
 * NumberInput — drop-in replacement for a numeric <input className="input">.
 *
 * Uses type="text" with inputMode="decimal" rather than type="number". A
 * controlled type="number" input is unreliable: while typing, if the browser
 * considers the field's contents momentarily invalid it reports e.target.value
 * as "" — which a controlled React input then "accepts", so the keystroke is
 * silently dropped and the field feels un-fillable. A filtered text input has
 * no such quirk, still shows a numeric keypad on mobile, and keeps the exact
 * same string-value onChange contract every caller already relies on.
 *
 * Enforces non-negative values (min ≥ 0) at the UI layer:
 *  - Only digits and a single '.' are accepted (blocks '-', 'e', letters).
 *  - Clamps into [min, max] on blur so the user sees instant feedback.
 *
 * Props:
 *  @param {string}   [variant]     'number' (default) or 'percentage'.
 *                                   'percentage' automatically sets max=100.
 *  @param {number}   [min=0]       Minimum allowed value.
 *  @param {number}   [max]         Maximum allowed value. Defaults to 100 when
 *                                   variant='percentage', otherwise unbounded.
 *  @param {string}   [value]       Controlled value (string while typing).
 *  @param {Function} [onChange]    Standard React change handler (reads e.target.value).
 *  @param {Function} [onBlur]      Optional extra onBlur callback (fires after clamping).
 *  All other props (className, placeholder, style, id, disabled, …) are forwarded.
 */
export function NumberInput({
  variant = 'number',
  min = 0,
  max,
  value,
  onChange,
  onBlur,
  ...rest
}) {
  const inputRef = useRef(null);

  // Resolve effective max: explicit prop wins, then percentage default.
  const effectiveMax = max !== undefined ? max : variant === 'percentage' ? 100 : undefined;

  /** Emit onChange with `value` swapped for our sanitised string. */
  const emit = (e, nextValue) => {
    if (!onChange) return;
    onChange({ ...e, target: { ...e.target, value: nextValue } });
  };

  /** Keep only digits and a single decimal point — no sign, no notation.
   * Also clamps against `max` as the user types (not just on blur) when a
   * max is set — e.g. a "/10" score field should never even display "15"
   * mid-typing, not just snap back once the field loses focus. */
  const handleChange = (e) => {
    let raw = e.target.value.replace(/[^\d.]/g, '');
    const firstDot = raw.indexOf('.');
    if (firstDot !== -1) {
      // Collapse any extra dots after the first.
      raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, '');
    }
    if (effectiveMax !== undefined && raw !== '' && raw !== '.') {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > effectiveMax) raw = String(effectiveMax);
    }
    emit(e, raw);
  };

  /** Clamp to [min, effectiveMax] on blur; empty is left alone. */
  const handleBlur = (e) => {
    const raw = e.target.value;
    if (raw !== '' && raw !== undefined) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) {
        let clamped = parsed;
        if (clamped < min) clamped = min;
        if (effectiveMax !== undefined && clamped > effectiveMax) clamped = effectiveMax;
        if (clamped !== parsed) emit(e, String(clamped));
      }
    }
    if (onBlur) onBlur(e);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={value ?? ''}
      onChange={handleChange}
      onBlur={handleBlur}
      {...rest}
    />
  );
}

export default NumberInput;
