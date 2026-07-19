import { useTheme } from '../../hooks/useTheme.js';

/**
 * Animated Sun/Moon theme switch (adapted from Uiverse.io by JkHuger).
 * Purely a UI swap over the existing useTheme() hook — theme state,
 * localStorage persistence and the data-theme attribute are all still owned
 * by useTheme, unchanged.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
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
