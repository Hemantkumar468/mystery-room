import { useAppDispatch, useAppSelector } from '../../app/hooks.js';
import { selectTheme, themeToggled } from '../../app/slices/uiSlice.js';

/**
 * Animated Sun/Moon theme switch (adapted from Uiverse.io by JkHuger).
 *
 * Theme used to live in `hooks/useTheme.js` as a per-instance `useState` —
 * it only worked because this was its one and only consumer; a second would
 * have desynced immediately, since the real shared state was the DOM
 * attribute and localStorage, not the hook. It's a genuine Redux slice now.
 */
export function ThemeToggle() {
  const theme = useAppSelector(selectTheme);
  const dispatch = useAppDispatch();
  const toggle = () => dispatch(themeToggled());
  const isDark = theme === 'dark';

  return (
    <label htmlFor="theme" className="theme" title="Toggle theme">
      <span className="theme__toggle-wrap">
        <input
          id="theme"
          className="theme__toggle"
          type="checkbox"
          role="switch"
          name="theme"
          value="dark"
          checked={isDark}
          aria-checked={isDark}
          aria-label="Toggle dark mode"
          onChange={toggle}
        />
        <span className="theme__fill" />
        <span className="theme__icon">
          {Array.from({ length: 9 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} className="theme__icon-part" />
          ))}
        </span>
      </span>
    </label>
  );
}

export default ThemeToggle;
