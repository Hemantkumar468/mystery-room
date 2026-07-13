import { useRef } from 'react';

/**
 * NumberInput — drop-in replacement for <input type="number" className="input">.
 *
 * Enforces non-negative values (min ≥ 0) at the UI layer:
 *  - Blocks the '-' and 'e' keys from being typed.
 *  - Blurs the element on mouse-wheel scroll to prevent accidental value drift.
 *  - Clamps the value into [min, max] on blur so the user sees instant feedback.
 *
 * Props:
 *  @param {string}   [variant]     'number' (default) or 'percentage'.
 *                                   'percentage' automatically sets max=100.
 *  @param {number}   [min=0]       Minimum allowed value.
 *  @param {number}   [max]         Maximum allowed value. Defaults to 100 when
 *                                   variant='percentage', otherwise unbounded.
 *  @param {string}   [value]       Controlled value (string while typing).
 *  @param {Function} [onChange]    Standard React change handler.
 *  @param {Function} [onBlur]      Optional extra onBlur callback (fires after clamping).
 *  All other props (className, placeholder, style, id, …) are forwarded to <input>.
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

  /** Block '-' (negative sign) and 'e'/'E' (scientific notation). */
  const handleKeyDown = (e) => {
    if (e.key === '-' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
    }
  };

  /** Remove focus on scroll so the spinner can't silently go negative. */
  const handleWheel = (e) => {
    e.target.blur();
  };

  /**
   * Clamp to [min, effectiveMax] on blur.
   * An empty string is left alone so the user can clear-and-retype freely.
   */
  const handleBlur = (e) => {
    const raw = e.target.value;

    if (raw !== '' && raw !== undefined) {
      const parsed = parseFloat(raw);

      if (!isNaN(parsed)) {
        let clamped = parsed;
        if (clamped < min) clamped = min;
        if (effectiveMax !== undefined && clamped > effectiveMax) clamped = effectiveMax;

        // Only call onChange when the value actually needs correcting.
        if (clamped !== parsed && onChange) {
          const syntheticEvent = {
            ...e,
            target: { ...e.target, value: String(clamped) },
          };
          onChange(syntheticEvent);
        }
      }
    }

    if (onBlur) onBlur(e);
  };

  return (
    <input
      ref={inputRef}
      type="number"
      min={min}
      max={effectiveMax}
      value={value}
      onChange={onChange}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onBlur={handleBlur}
      {...rest}
    />
  );
}

export default NumberInput;
