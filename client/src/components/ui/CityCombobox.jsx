import { useState, useEffect, useMemo, useRef } from 'react';
import { MapPin, ChevronDown, Check, Search } from 'lucide-react';
import { INDIAN_CITIES } from '../../lib/indianCities.js';

/**
 * City picker — a searchable combobox. Click (or the chevron) opens the full
 * bundled Indian-cities list; typing filters it; picking a row fills the
 * field. Still fully free-text: any city not in the list can be typed and
 * kept, so no real value is ever blocked. Options come from INDIAN_CITIES,
 * never hardcoded inline.
 *
 * Extracted from NewProjectModal.jsx (which originally defined this inline)
 * so Branch's city field — free text, matching Project.city's own
 * convention exactly, not a hard enum — can reuse it instead of duplicating
 * ~120 lines of combobox logic. Uses the `.np-combo*` CSS classes from
 * styles/new-project-modal.css, which is loaded globally (main.jsx), not
 * scoped to the New Project modal despite the filename.
 */
export function CityCombobox({ value, onChange, onBlur, invalid }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const query = (value || '').trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return INDIAN_CITIES;
    const starts = [];
    const contains = [];
    for (const c of INDIAN_CITIES) {
      const lc = c.toLowerCase();
      if (lc.startsWith(query)) starts.push(c);
      else if (lc.includes(query)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false);
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onBlur]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[active];
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const emit = (v) => onChange({ target: { value: v } });
  const pick = (c) => { emit(c); setOpen(false); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && open) {
      if (matches[active]) { e.preventDefault(); pick(matches[active]); }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={`np-combo${open ? ' open' : ''}`} ref={wrapRef}>
      <div className="np-combo-control">
        <MapPin size={14} className="np-combo-lead" />
        <input
          className={`input np-combo-input${invalid ? ' np-invalid' : ''}`}
          value={value}
          onChange={(e) => { onChange(e); setActive(0); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search or type any Indian city…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="city-combo-list"
        />
        <button
          type="button"
          className="np-combo-toggle"
          tabIndex={-1}
          aria-label="Toggle city list"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {open && (
        <div className="np-combo-pop">
          <ul className="np-combo-list" id="city-combo-list" role="listbox" ref={listRef}>
            {matches.length === 0 ? (
              <li className="np-combo-empty">
                <Search size={13} /> No match — "{value}" will be used as a custom city.
              </li>
            ) : (
              matches.slice(0, 100).map((c, i) => (
                <li
                  key={c}
                  role="option"
                  aria-selected={c === value}
                  className={`np-combo-opt${i === active ? ' active' : ''}${c === value ? ' selected' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(c); }}
                >
                  <MapPin size={13} className="np-combo-opt-icon" />
                  {c}
                  {c === value && <Check size={14} className="np-combo-opt-check" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CityCombobox;
